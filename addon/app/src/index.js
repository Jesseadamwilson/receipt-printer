const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { PrintQueue } = require('./queue');
const { createReceiptServer } = require('./server');
const {
  renderTemplateToPng,
  readCustomCss,
  resolveCustomCssPath
} = require('./render-template');
const { buildDailyAgendaTemplateData } = require('./daily-agenda');
const { hydrateDailyAgendaFromHomeAssistant } = require('./ha-data-source');
const { listHomeAssistantEntities } = require('./ha-client');
const {
  createProfileStore,
  deriveAgendaSourceConfigFromProfile
} = require('./profile-store');
const {
  encodeTextReceipt,
  encodeImageReceipt,
  sendToPrinter
} = require('./printer-client');

function asString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  const result = String(value).trim();
  if (!result) {
    return fallback;
  }

  return result;
}

function asRawString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toTitleCase(value) {
  const raw = asRawString(value, '');
  if (!raw) {
    return '';
  }

  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, (token) => {
    if (/^[A-Z0-9]{2,4}$/.test(token)) {
      return token;
    }

    const lower = token.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

function buildParagraphHtml(lines, lineClass = 'line') {
  const source = Array.isArray(lines) ? lines : [];
  return source
    .map((line) => asRawString(line, ''))
    .map((line) => `<p class="${lineClass}">${escapeHtml(line)}</p>`)
    .join('\n');
}

function buildListHtml(items, listClass, itemClass) {
  const source = Array.isArray(items)
    ? items.map((item) => asRawString(item, '')).filter(Boolean)
    : [];
  if (source.length === 0) {
    return '';
  }

  const listItems = source
    .map((item) => `<li class="${itemClass}">${escapeHtml(item)}</li>`)
    .join('');
  return `<ul class="${listClass}">${listItems}</ul>`;
}

function buildDateTokens(referenceDate = new Date()) {
  const value = referenceDate instanceof Date ? referenceDate : new Date();
  const date = Number.isNaN(value.getTime()) ? new Date() : value;

  return {
    date: date.toLocaleDateString(),
    date_iso: date.toISOString().slice(0, 10),
    day_of_week: date.toLocaleDateString(undefined, { weekday: 'long' }),
    month_day: date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }),
    time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  };
}

function formatAgendaEventLine(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }

  const time = asString(event.time, '');
  const title = toTitleCase(event.title);
  const location = toTitleCase(event.location);
  const left = [time, title].filter(Boolean).join(' ');
  if (!left && !location) {
    return '';
  }
  if (!location) {
    return left;
  }
  if (!left) {
    return `@ ${location}`;
  }

  return `${left} @ ${location}`;
}

function normalizeBatteryLevel(value) {
  const raw = asString(value, '');
  if (!raw) {
    return '';
  }

  if (raw.endsWith('%')) {
    return raw;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return `${Math.round(numeric)}%`;
  }

  return raw;
}

function formatBatteryLine(battery) {
  if (!battery) {
    return '';
  }

  if (typeof battery === 'string') {
    return asString(battery, '');
  }

  if (typeof battery !== 'object') {
    return '';
  }

  const name = asString(
    battery.name || battery.label || battery.friendlyName || battery.entity,
    'Battery'
  );
  const level = normalizeBatteryLevel(
    battery.level !== undefined ? battery.level : battery.state
  );

  if (!level) {
    return name;
  }

  return `${name}: ${level}`;
}

function extractBatteryPercent(value) {
  const normalized = normalizeBatteryLevel(value);
  if (!normalized) {
    return 0;
  }

  const numeric = Number.parseFloat(normalized.replace('%', '').trim());
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  if (numeric < 0) {
    return 0;
  }
  if (numeric > 100) {
    return 100;
  }

  return Math.round(numeric);
}

function pickBatteryDeviceIcon(nameOrEntity) {
  const value = asString(nameOrEntity, '').toLowerCase();
  if (!value) {
    return 'assets/power-icon.svg';
  }

  if (value.includes('iphone')) {
    return 'assets/iphone.svg';
  }
  if (value.includes('ipad')) {
    return 'assets/ipad.svg';
  }
  if (value.includes('macbook') || value.includes('mac book') || value.includes('laptop')) {
    return 'assets/macbook.svg';
  }
  if (value.includes('airpods') || value.includes('air pods') || value.includes('earbud')) {
    return 'assets/airpods.svg';
  }

  return 'assets/power-icon.svg';
}

function buildBatteryItemModel(battery, index = 0) {
  if (!battery) {
    return {
      key: `battery-${index}`,
      name: 'Device',
      level: '',
      percent: 0,
      icon: 'assets/power-icon.svg'
    };
  }

  if (typeof battery === 'string') {
    const raw = asString(battery, '');
    const percent = extractBatteryPercent(raw);
    return {
      key: `battery-${index}`,
      name: raw || `Device ${index + 1}`,
      level: normalizeBatteryLevel(raw),
      percent,
      icon: pickBatteryDeviceIcon(raw)
    };
  }

  if (typeof battery !== 'object') {
    return {
      key: `battery-${index}`,
      name: `Device ${index + 1}`,
      level: '',
      percent: 0,
      icon: 'assets/power-icon.svg'
    };
  }

  const name = asString(
    battery.name || battery.label || battery.friendlyName || battery.entity,
    `Device ${index + 1}`
  );
  const rawLevel = battery.level !== undefined ? battery.level : battery.state;
  const level = normalizeBatteryLevel(rawLevel);
  const percent = extractBatteryPercent(rawLevel);
  const entity = asString(battery.entity, '');

  return {
    key: `battery-${index}`,
    name,
    level,
    percent,
    icon: pickBatteryDeviceIcon(`${name} ${entity}`)
  };
}

function buildDeviceBatteryItemsHtml(batteries) {
  const items = Array.isArray(batteries) ? batteries : [];
  if (items.length === 0) {
    return '';
  }

  const radius = 25;
  const circumference = 2 * Math.PI * radius;

  return items.map((item) => {
    const dash = (Math.max(0, Math.min(100, Number(item.percent) || 0)) / 100) * circumference;

    return [
      `<article class="device-gauge" style="--battery-level:${item.percent};" title="${escapeHtml(`${item.name} ${item.level}`.trim())}">`,
      '<svg class="device-gauge-svg" viewBox="0 0 64 64" aria-hidden="true">',
      '<circle class="device-gauge-outline-ring" cx="32" cy="32" r="25"></circle>',
      '<circle class="device-gauge-track-ring" cx="32" cy="32" r="25"></circle>',
      `<circle class="device-gauge-progress-ring" cx="32" cy="32" r="25" style="stroke-dasharray:${dash.toFixed(2)} ${circumference.toFixed(2)};"></circle>`,
      '</svg>',
      '<div class="device-gauge-core">',
      `<img class="device-gauge-icon" src="${escapeHtml(item.icon)}" alt="${escapeHtml(item.name)}">`,
      '</div>',
      '</article>'
    ].join('');
  }).join('\n');
}

function compactMeridiem(timeText) {
  const value = asString(timeText, '');
  if (!value) {
    return '';
  }

  return value
    .replace(/\s+/g, '')
    .toUpperCase();
}

function wrapTextByWordLimits(value, firstLineLimit = 28, otherLineLimit = 36) {
  const text = toTitleCase(value);
  if (!text) {
    return [];
  }

  const words = text.split(/\s+/g).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const lines = [];
  let current = '';
  let currentLimit = Math.max(8, Number(firstLineLimit) || 28);

  for (const word of words) {
    if (!current) {
      if (word.length > currentLimit) {
        lines.push(word);
        currentLimit = Math.max(8, Number(otherLineLimit) || 36);
      } else {
        current = word;
      }
      continue;
    }

    const next = `${current} ${word}`;
    if (next.length <= currentLimit) {
      current = next;
      continue;
    }

    lines.push(current);
    current = word;
    currentLimit = Math.max(8, Number(otherLineLimit) || 36);
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function buildLeaderRowsHtml(rows, className) {
  const source = Array.isArray(rows) ? rows : [];
  if (source.length === 0) {
    return '';
  }

  return source.map((row) => {
    const left = asString(row.left, '');
    const right = asString(row.right, '');
    if (!left && !right) {
      return '';
    }

    return [
      `<div class="leader-row ${className}">`,
      `<span class="leader-left">${escapeHtml(left)}</span>`,
      '<span class="leader-dots"></span>',
      `<span class="leader-right">${escapeHtml(right)}</span>`,
      '</div>'
    ].join('');
  }).filter(Boolean).join('\n');
}

function buildCalendarRowsHtml(events) {
  const source = Array.isArray(events) ? events : [];
  if (source.length === 0) {
    return '';
  }

  return source.map((event, index) => {
    if (!event || typeof event !== 'object') {
      return '';
    }

    const time = compactMeridiem(event.time) || '--';
    const title = toTitleCase(event.title);
    const location = toTitleCase(event.location);
    const fullText = location
      ? [title || 'Event', location].filter(Boolean).join(' | ')
      : (title || 'Event');
    const lines = wrapTextByWordLimits(fullText, 30, 38);
    if (lines.length === 0) {
      lines.push('Event');
    }

    const firstLine = lines[0];
    const continuationLines = lines.slice(1);

    const continuationHtml = continuationLines.map((line) => {
      return `<span class="leader-right calendar-entry-more">${escapeHtml(line)}</span>`;
    }).join('');

    return [
      `<article class="calendar-entry calendar-row" data-index="${index}">`,
      `<span class="leader-left">${escapeHtml(time)}</span>`,
      '<span class="leader-dots"></span>',
      `<span class="leader-right leader-right-first">${escapeHtml(firstLine)}</span>`,
      continuationHtml,
      '</article>'
    ].join('');
  }).join('\n');
}

function splitAlertLine(value) {
  const text = toTitleCase(value);
  if (!text) {
    return null;
  }

  const colonIndex = text.indexOf(':');
  if (colonIndex > 0 && colonIndex < text.length - 1) {
    return {
      left: text.slice(0, colonIndex).trim(),
      right: text.slice(colonIndex + 1).trim()
    };
  }

  const dashIndex = text.indexOf(' - ');
  if (dashIndex > 0 && dashIndex < text.length - 1) {
    return {
      left: text.slice(0, dashIndex).trim(),
      right: text.slice(dashIndex + 3).trim()
    };
  }

  return {
    left: 'Alert',
    right: text
  };
}

function buildNotificationRowsHtml(alerts, notesLines) {
  const rows = [];

  const alertValues = Array.isArray(alerts) ? alerts : [];
  for (const alert of alertValues) {
    const mapped = splitAlertLine(alert);
    if (mapped) {
      rows.push(mapped);
    }
  }

  const noteValues = Array.isArray(notesLines) ? notesLines : [];
  for (const note of noteValues) {
    const text = toTitleCase(note);
    if (!text) {
      continue;
    }
    rows.push({
      left: 'Note',
      right: text
    });
  }

  return buildLeaderRowsHtml(rows, 'notification-row');
}

function splitMessageLines(value) {
  const raw = asRawString(value, '');
  if (!raw) {
    return [];
  }

  return raw.replace(/\r\n/g, '\n').split('\n');
}

function resolveMessageProfile(profileStore, requestedProfileId) {
  if (!profileStore) {
    return null;
  }

  if (requestedProfileId) {
    const requested = profileStore.getProfileById(requestedProfileId);
    if (requested && requested.template === 'message') {
      return requested;
    }
  }

  const fallback = profileStore.getDefaultMessageProfile();
  if (fallback && fallback.template === 'message') {
    return fallback;
  }

  return null;
}

function buildMessageTemplateData(payload, selectedProfile) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const profileMessage = selectedProfile
    ? asRawString(selectedProfile.messageBody, '')
    : '';
  const messageBodyText = safePayload.hasMessageOverride
    ? asRawString(safePayload.message, '')
    : profileMessage;

  const providedLines = Array.isArray(safePayload.lines)
    ? safePayload.lines.map((line) => asRawString(line, ''))
    : [];
  const lines = providedLines.length > 0
    ? providedLines
    : splitMessageLines(messageBodyText);

  if (lines.length === 0) {
    lines.push('');
  }

  const generatedAt = new Date();
  const printedAt = asString(safePayload.footer, generatedAt.toLocaleString());
  const headline = asString(safePayload.headline, selectedProfile ? selectedProfile.name : 'Message');
  const messageText = lines.join('\n');
  const messageLinesHtml = buildParagraphHtml(lines, 'message-line');
  const dateTokens = buildDateTokens(generatedAt);

  return {
    headline,
    lines,
    printedAt,
    showHeader: true,
    showFooter: true,
    templateContext: {
      template_type: 'message',
      title: headline,
      headline,
      message_text: messageText,
      message_lines: messageText,
      message_lines_html: messageLinesHtml,
      lines_text: messageText,
      lines_html: messageLinesHtml,
      content_html: messageLinesHtml,
      printed_at: printedAt,
      printedAt,
      ...dateTokens
    }
  };
}

function writeCustomCss(config, css) {
  const cssPath = resolveCustomCssPath(config);
  fs.mkdirSync(path.dirname(cssPath), { recursive: true });
  fs.writeFileSync(cssPath, asRawString(css, ''), 'utf8');

  return {
    path: cssPath,
    css: asRawString(css, '')
  };
}

function readPackageMetadata() {
  try {
    const packagePath = path.resolve(process.cwd(), 'package.json');
    const raw = fs.readFileSync(packagePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      name: parsed.name || 'ha-receipt-printer-spike',
      version: parsed.version || '0.0.0'
    };
  } catch (_error) {
    return {
      name: 'ha-receipt-printer-spike',
      version: '0.0.0'
    };
  }
}

function buildDefaultPrintOptions(config, inputPrint = {}) {
  const source = inputPrint && typeof inputPrint === 'object' ? inputPrint : {};
  return {
    feedLines: Number.isFinite(Number(source.feedLines)) ? Number(source.feedLines) : 3,
    cut: typeof source.cut === 'boolean' ? source.cut : true,
    cutMode: String(source.cutMode || config.printerCutMode || 'full')
  };
}

function summarizeAgendaInput(input) {
  const source = input && typeof input === 'object' ? input : {};

  return {
    weather: Boolean(source.weather),
    sleep: Boolean(source.sleep),
    events: Array.isArray(source.events) ? source.events.length : 0,
    batteries: Array.isArray(source.batteries) ? source.batteries.length : 0,
    alerts: Array.isArray(source.alerts) ? source.alerts.length : 0,
    notes: Boolean(source.notes && String(source.notes).trim()),
    source: source.source || 'auto'
  };
}

function buildDailyAgendaTemplateContext(hydratedInput, templateData) {
  const source = hydratedInput && typeof hydratedInput === 'object' ? hydratedInput : {};
  const template = templateData && typeof templateData === 'object' ? templateData : {};
  const generatedAt = new Date();
  const dateTokens = buildDateTokens(generatedAt);

  const weather = source.weather && typeof source.weather === 'object' ? source.weather : {};
  const sleep = source.sleep && typeof source.sleep === 'object' ? source.sleep : {};
  const events = Array.isArray(source.events) ? source.events : [];
  const eventLines = events.map(formatAgendaEventLine).filter(Boolean);
  const batteries = Array.isArray(source.batteries) ? source.batteries : [];
  const batteryItems = batteries.map((battery, index) => buildBatteryItemModel(battery, index));
  const batteryLines = batteries.map(formatBatteryLine).filter(Boolean);
  const alerts = Array.isArray(source.alerts)
    ? source.alerts.map((alert) => toTitleCase(alert)).filter(Boolean)
    : [];
  const notesText = toTitleCase(source.notes);
  const notesLines = notesText
    ? notesText.split(/\r?\n/g).map((line) => toTitleCase(line)).filter(Boolean)
    : [];
  const contentLines = Array.isArray(template.lines) ? template.lines : [];

  const currentTemp = asString(weather.temp, '');
  const weatherSummary = toTitleCase(weather.summary);
  const weatherHigh = asString(weather.high, '');
  const weatherLow = asString(weather.low, '');
  const hoursOfSleep = asString(sleep.hours, '');
  const printedAt = asString(template.printedAt, generatedAt.toLocaleString());
  const subtitle = toTitleCase(source.subtitle);
  const summaryLabel = toTitleCase(source.summaryLabel || 'Summary');
  const sleepLine = hoursOfSleep ? `${hoursOfSleep} Hours Last Night` : '';
  const weatherLine = [currentTemp, weatherSummary].filter(Boolean).join(' | ');
  const dateChip = `${dateTokens.day_of_week} ${dateTokens.month_day}`.trim().toUpperCase();
  const calendarRowsHtml = buildCalendarRowsHtml(events);
  const notificationRowsHtml = buildNotificationRowsHtml(alerts, notesLines);
  const hasNotifications = Boolean(notificationRowsHtml && notificationRowsHtml.trim());
  const deviceBatteryItemsHtml = buildDeviceBatteryItemsHtml(batteryItems);

  return {
    template_type: 'daily_agenda',
    title: asString(template.headline, 'Daily Agenda'),
    headline: asString(template.headline, 'Daily Agenda'),
    subtitle,
    date: dateTokens.date,
    date_iso: dateTokens.date_iso,
    day_of_week: dateTokens.day_of_week,
    month_day: dateTokens.month_day,
    time: dateTokens.time,
    printed_at: printedAt,
    printedAt,
    weather_summary: weatherSummary,
    current_temp: currentTemp,
    weather_high: weatherHigh,
    weather_low: weatherLow,
    hours_of_sleep: hoursOfSleep,
    sleep_line: sleepLine,
    weather_line: weatherLine,
    summary_label: summaryLabel,
    date_chip: dateChip,
    todays_calendar_events: eventLines.join('\n'),
    todays_calendar_events_count: String(eventLines.length),
    todays_calendar_events_html: buildListHtml(eventLines, 'events-list', 'event-item'),
    calendar_rows_html: calendarRowsHtml,
    calendar_count: String(eventLines.length),
    battery_levels: batteryLines.join('\n'),
    battery_levels_count: String(batteryLines.length),
    battery_levels_html: buildListHtml(batteryLines, 'battery-list', 'battery-item'),
    device_battery_items_html: deviceBatteryItemsHtml,
    device_count: String(batteryItems.length),
    alerts: alerts.join('\n'),
    alerts_count: String(alerts.length),
    alerts_html: buildListHtml(alerts, 'alerts-list', 'alert-item'),
    notification_rows_html: notificationRowsHtml,
    notifications_count: String(alerts.length + notesLines.length),
    notifications_hidden_class: hasNotifications ? '' : 'is-hidden',
    notifications_divider_hidden_class: hasNotifications ? '' : 'is-hidden',
    notes: notesText,
    notes_html: buildParagraphHtml(notesLines, 'notes-line'),
    content_text: contentLines.join('\n'),
    content_html: buildParagraphHtml(contentLines, 'line'),
    section_order: Array.isArray(template.sectionOrder) ? template.sectionOrder.join(',') : '',
    weather: {
      summary: weatherSummary,
      temp: currentTemp,
      high: weatherHigh,
      low: weatherLow
    },
    sleep: {
      hours: hoursOfSleep
    }
  };
}

async function runTextJob(config, payload) {
  const print = buildDefaultPrintOptions(config, payload.print);
  const encoded = encodeTextReceipt(config, {
    headline: payload.headline || 'HA Receipt Printer',
    lines: Array.isArray(payload.lines) ? payload.lines : [],
    footer: payload.footer || new Date().toLocaleString(),
    feedLines: print.feedLines,
    cut: print.cut,
    cutMode: print.cutMode
  });

  const transport = await sendToPrinter(config, encoded);
  return {
    mode: 'text',
    payloadBytes: encoded.length,
    print,
    transport
  };
}

async function runMessageJob(config, deps, payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const profileStore = deps && deps.profileStore ? deps.profileStore : null;
  const requestedProfileId = asString(safePayload.profileId, '');
  const selectedProfile = resolveMessageProfile(profileStore, requestedProfileId);
  const templateData = buildMessageTemplateData(safePayload, selectedProfile);

  const result = await runRenderJob(config, {
    templateType: 'message',
    templateData,
    print: safePayload.print
  });

  return {
    ...result,
    mode: 'message',
    profile: selectedProfile
      ? {
        id: selectedProfile.id,
        name: selectedProfile.name,
        template: selectedProfile.template
      }
      : null,
    source: {
      usedProfileBody: !safePayload.hasMessageOverride,
      usedPayloadMessage: safePayload.hasMessageOverride,
      usedPayloadLines: Array.isArray(safePayload.lines) && safePayload.lines.length > 0
    }
  };
}

async function runImageJob(config, payload) {
  const print = buildDefaultPrintOptions(config, payload.print);
  const encoded = encodeImageReceipt(config, {
    imagePath: payload.imagePath,
    feedLines: print.feedLines,
    cut: print.cut,
    cutMode: print.cutMode
  });

  const transport = await sendToPrinter(config, encoded);
  return {
    mode: 'image',
    imagePath: payload.imagePath,
    payloadBytes: encoded.length,
    print,
    transport
  };
}

async function runRenderJob(config, payload) {
  const templateData = payload.templateData && typeof payload.templateData === 'object'
    ? payload.templateData
    : {};
  const print = buildDefaultPrintOptions(config, payload.print);
  const templateType = asString(payload.templateType, 'receipt');
  const templateContext = templateData.templateContext && typeof templateData.templateContext === 'object'
    ? templateData.templateContext
    : {};

  const imagePath = await renderTemplateToPng(config, {
    headline: templateData.headline || 'HA Receipt Printer',
    lines: Array.isArray(templateData.lines) ? templateData.lines : [],
    printedAt: templateData.printedAt || new Date().toLocaleString(),
    showHeader: templateData.showHeader,
    showFooter: templateData.showFooter,
    templateContext
  }, {
    templateType
  });

  const encoded = encodeImageReceipt(config, {
    imagePath,
    feedLines: print.feedLines,
    cut: print.cut,
    cutMode: print.cutMode
  });

  const transport = await sendToPrinter(config, encoded);
  return {
    mode: 'render',
    templateType,
    imagePath,
    payloadBytes: encoded.length,
    print,
    transport
  };
}

async function runDailyAgendaJob(config, deps, payload) {
  const profileStore = deps && deps.profileStore ? deps.profileStore : null;
  const requestedProfileId = asString(payload && payload.profileId, '');
  const selectedProfile = profileStore
    ? (requestedProfileId
      ? profileStore.getProfileById(requestedProfileId)
      : profileStore.getDefaultDailyAgendaProfile())
    : null;

  const profileSources = selectedProfile
    ? deriveAgendaSourceConfigFromProfile(selectedProfile, config)
    : null;
  const effectiveConfig = profileSources
    ? { ...config, ...profileSources }
    : config;

  const rawInput = payload && payload.agendaInput && typeof payload.agendaInput === 'object'
    ? payload.agendaInput
    : {};

  const hydratedInput = await hydrateDailyAgendaFromHomeAssistant(effectiveConfig, rawInput);
  const templateData = buildDailyAgendaTemplateData(hydratedInput, {
    includeDefaults: config.agendaIncludeDefaults,
    sectionOrder: effectiveConfig.agendaSectionOrder
  });
  const templateContext = buildDailyAgendaTemplateContext(hydratedInput, templateData);

  const result = await runRenderJob(effectiveConfig, {
    templateType: 'daily_agenda',
    templateData: {
      ...templateData,
      templateContext
    },
    print: payload.print
  });

  return {
    ...result,
    mode: 'daily_agenda',
    include: templateData.include,
    sectionOrder: templateData.sectionOrder,
    sourceDataSummary: summarizeAgendaInput(hydratedInput),
    profile: selectedProfile
      ? {
        id: selectedProfile.id,
        name: selectedProfile.name,
        template: selectedProfile.template,
        itemCount: Array.isArray(selectedProfile.items) ? selectedProfile.items.length : 0
      }
      : null
  };
}

async function previewMessage(config, deps, payload) {
  const profileStore = deps && deps.profileStore ? deps.profileStore : null;
  const requestedProfileId = asString(payload && payload.profileId, '');
  const selectedProfile = resolveMessageProfile(profileStore, requestedProfileId);
  const templateData = buildMessageTemplateData(payload, selectedProfile);

  const imagePath = await renderTemplateToPng(config, templateData, {
    templateType: 'message',
    outputPath: path.join(config.outputDir, 'preview-message.png')
  });

  return {
    imagePath,
    templateData,
    profile: selectedProfile
      ? {
        id: selectedProfile.id,
        name: selectedProfile.name,
        template: selectedProfile.template
      }
      : null
  };
}

async function previewDailyAgenda(config, deps, payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const profileStore = deps && deps.profileStore ? deps.profileStore : null;
  const requestedProfileId = asString(safePayload.profileId, '');
  const selectedProfile = profileStore
    ? (requestedProfileId
      ? profileStore.getProfileById(requestedProfileId)
      : profileStore.getDefaultDailyAgendaProfile())
    : null;

  const profileSources = selectedProfile
    ? deriveAgendaSourceConfigFromProfile(selectedProfile, config)
    : null;
  const effectiveConfig = profileSources
    ? { ...config, ...profileSources }
    : config;

  const hydratedInput = await hydrateDailyAgendaFromHomeAssistant(
    effectiveConfig,
    safePayload.agendaInput && typeof safePayload.agendaInput === 'object'
      ? safePayload.agendaInput
      : {
        title: asString(safePayload.title || safePayload.headline, 'Daily Agenda'),
        subtitle: asString(safePayload.subtitle, 'Today'),
        printedAt: asString(safePayload.printedAt, new Date().toLocaleString()),
        include: safePayload.include && typeof safePayload.include === 'object' ? safePayload.include : {},
        sectionOrder: safePayload.sectionOrder,
        source: asString(safePayload.source, 'auto'),
        weather: safePayload.weather && typeof safePayload.weather === 'object' ? safePayload.weather : undefined,
        sleep: safePayload.sleep && typeof safePayload.sleep === 'object' ? safePayload.sleep : undefined,
        events: Array.isArray(safePayload.events) ? safePayload.events : [],
        batteries: Array.isArray(safePayload.batteries) ? safePayload.batteries : [],
        alerts: Array.isArray(safePayload.alerts) ? safePayload.alerts : [],
        notes: asString(safePayload.notes, '')
      }
  );

  const templateData = buildDailyAgendaTemplateData(hydratedInput, {
    includeDefaults: config.agendaIncludeDefaults,
    sectionOrder: effectiveConfig.agendaSectionOrder
  });
  const templateContext = buildDailyAgendaTemplateContext(hydratedInput, templateData);

  const imagePath = await renderTemplateToPng(effectiveConfig, {
    ...templateData,
    templateContext
  }, {
    templateType: 'daily_agenda',
    outputPath: path.join(config.outputDir, 'preview-daily-agenda.png')
  });

  return {
    imagePath,
    templateData,
    sourceDataSummary: summarizeAgendaInput(hydratedInput),
    profile: selectedProfile
      ? {
        id: selectedProfile.id,
        name: selectedProfile.name,
        template: selectedProfile.template
      }
      : null
  };
}

async function runPrintJob(config, deps, job) {
  switch (job.type) {
    case 'text':
      return runTextJob(config, job.payload);
    case 'message':
      return runMessageJob(config, deps, job.payload);
    case 'image':
      return runImageJob(config, job.payload);
    case 'render':
      return runRenderJob(config, job.payload);
    case 'daily_agenda':
      return runDailyAgendaJob(config, deps, job.payload);
    default:
      throw new Error(`Unsupported job type: ${job.type}`);
  }
}

function startServer() {
  const config = loadConfig();
  const serviceMeta = readPackageMetadata();
  const profileStore = createProfileStore(config);
  const deps = {
    profileStore
  };

  const queue = new PrintQueue({
    maxRetries: config.queueMaxRetries,
    retryDelayMs: config.queueRetryDelayMs,
    worker: (job) => runPrintJob(config, deps, job)
  });

  const server = createReceiptServer({
    config,
    queue,
    serviceMeta,
    profileStore,
    listEntities: (options) => listHomeAssistantEntities(config, options),
    previewMessage: (payload) => previewMessage(config, deps, payload),
    previewDailyAgenda: (payload) => previewDailyAgenda(config, deps, payload),
    readTemplateCss: () => readCustomCss(config),
    writeTemplateCss: (css) => writeCustomCss(config, css)
  });

  server.on('error', (error) => {
    const message = error && error.message ? error.message : String(error);
    // eslint-disable-next-line no-console
    console.error(`[receipt-printer] server error: ${message}`);
    process.exitCode = 1;
  });

  server.listen(config.apiPort, config.apiHost, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[receipt-printer] API listening on http://${config.apiHost}:${config.apiPort} ` +
      `| printer=${config.printerHost}:${config.printerPort}`
    );
  });

  return {
    server,
    queue,
    config
  };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer
};
