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
  const title = asString(event.title, '');
  const location = asString(event.location, '');
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
  const batteryLines = batteries.map(formatBatteryLine).filter(Boolean);
  const alerts = Array.isArray(source.alerts)
    ? source.alerts.map((alert) => asString(alert, '')).filter(Boolean)
    : [];
  const notesText = asString(source.notes, '');
  const notesLines = notesText
    ? notesText.split(/\r?\n/g).map((line) => asString(line, '')).filter(Boolean)
    : [];
  const contentLines = Array.isArray(template.lines) ? template.lines : [];

  const currentTemp = asString(weather.temp, '');
  const weatherSummary = asString(weather.summary, '');
  const weatherHigh = asString(weather.high, '');
  const weatherLow = asString(weather.low, '');
  const hoursOfSleep = asString(sleep.hours, '');
  const printedAt = asString(template.printedAt, generatedAt.toLocaleString());
  const subtitle = asString(source.subtitle, '');

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
    todays_calendar_events: eventLines.join('\n'),
    todays_calendar_events_count: String(eventLines.length),
    todays_calendar_events_html: buildListHtml(eventLines, 'events-list', 'event-item'),
    battery_levels: batteryLines.join('\n'),
    battery_levels_count: String(batteryLines.length),
    battery_levels_html: buildListHtml(batteryLines, 'battery-list', 'battery-item'),
    alerts: alerts.join('\n'),
    alerts_count: String(alerts.length),
    alerts_html: buildListHtml(alerts, 'alerts-list', 'alert-item'),
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
