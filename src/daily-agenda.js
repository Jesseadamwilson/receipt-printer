const DEFAULT_AGENDA_INCLUDE = {
  header: true,
  weather: true,
  sleep: true,
  events: true,
  battery: true,
  alerts: true,
  notes: true,
  footer: true
};

const DEFAULT_AGENDA_SECTION_ORDER = [
  'weather',
  'sleep',
  'events',
  'battery',
  'alerts',
  'notes'
];

const SECTION_TITLES = {
  weather: 'WEATHER',
  sleep: 'SLEEP',
  events: 'EVENTS',
  battery: 'BATTERY',
  alerts: 'ALERTS',
  notes: 'NOTES'
};

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

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return fallback;
}

function normalizeInclude(rawInclude, defaults = DEFAULT_AGENDA_INCLUDE) {
  const source = rawInclude && typeof rawInclude === 'object' ? rawInclude : {};
  const normalized = {};

  for (const key of Object.keys(DEFAULT_AGENDA_INCLUDE)) {
    normalized[key] = asBoolean(source[key], asBoolean(defaults[key], DEFAULT_AGENDA_INCLUDE[key]));
  }

  return normalized;
}

function normalizeSectionOrder(rawOrder, defaults = DEFAULT_AGENDA_SECTION_ORDER) {
  const source = Array.isArray(rawOrder)
    ? rawOrder
    : (typeof rawOrder === 'string' ? rawOrder.split(/[\n,]/g) : defaults);

  const output = [];
  for (const item of source) {
    const normalized = asString(item, '').toLowerCase();
    if (!normalized || !(normalized in SECTION_TITLES)) {
      continue;
    }
    if (!output.includes(normalized)) {
      output.push(normalized);
    }
  }

  if (output.length === 0) {
    return [...DEFAULT_AGENDA_SECTION_ORDER];
  }

  return output;
}

function appendSection(lines, heading, values) {
  const sectionValues = Array.isArray(values)
    ? values.map((value) => asString(value, '')).filter(Boolean)
    : [];

  if (sectionValues.length === 0) {
    return;
  }

  if (lines.length > 0) {
    lines.push('');
  }
  lines.push(heading);
  lines.push(...sectionValues);
}

function formatWeatherLines(weather) {
  if (!weather || typeof weather !== 'object') {
    return [];
  }

  const summary = asString(weather.summary, '');
  const temp = asString(weather.temp, '');
  const high = asString(weather.high, '');
  const low = asString(weather.low, '');
  const parts = [summary, temp].filter(Boolean);

  if (high || low) {
    parts.push(`H:${high || '-'} L:${low || '-'}`);
  }

  if (parts.length === 0) {
    return [];
  }

  return [parts.join('  ')];
}

function formatSleepLines(sleep) {
  if (!sleep || typeof sleep !== 'object') {
    return [];
  }

  const hours = asString(sleep.hours, '');
  if (!hours) {
    return [];
  }

  const hoursMinutesMatch = hours.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (hoursMinutesMatch) {
    const h = Number.parseInt(hoursMinutesMatch[1], 10);
    const m = Number.parseInt(hoursMinutesMatch[2], 10);
    if (Number.isFinite(h) && Number.isFinite(m) && h >= 0 && m >= 0 && m < 60) {
      return [`${h}h ${m}m last night`];
    }
  }

  const explicitUnitMatch = hours
    .toLowerCase()
    .match(/^(\d{1,2})\s*h(?:ours?)?(?:\s*(\d{1,2})\s*m(?:in(?:utes?)?)?)?$/);
  if (explicitUnitMatch) {
    const h = Number.parseInt(explicitUnitMatch[1], 10);
    const m = Number.parseInt(explicitUnitMatch[2] || '0', 10);
    if (Number.isFinite(h) && Number.isFinite(m) && h >= 0 && m >= 0 && m < 60) {
      return [`${h}h ${m}m last night`];
    }
  }

  const numericHours = Number(hours.replace(',', '.'));
  if (Number.isFinite(numericHours) && numericHours >= 0) {
    const totalMinutes = Math.round(numericHours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return [`${h}h ${m}m last night`];
  }

  return [`${hours} last night`];
}

function formatEventsLines(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  return events
    .map((event) => {
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
    })
    .filter(Boolean);
}

function formatAlertsLines(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return [];
  }

  return alerts
    .map((alert) => asString(alert, ''))
    .filter(Boolean);
}

function formatNotesLines(notes) {
  const raw = asString(notes, '');
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
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

function formatBatteryLines(batteries) {
  if (!Array.isArray(batteries) || batteries.length === 0) {
    return [];
  }

  return batteries
    .map((battery) => {
      if (typeof battery === 'string') {
        const value = asString(battery, '');
        return value || '';
      }

      if (!battery || typeof battery !== 'object') {
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
    })
    .filter(Boolean);
}

function buildDailyAgendaTemplateData(payload = {}, options = {}) {
  const includeDefaults = options.includeDefaults || DEFAULT_AGENDA_INCLUDE;
  const include = normalizeInclude(payload.include, includeDefaults);
  const sectionOrder = normalizeSectionOrder(payload.sectionOrder, options.sectionOrder);
  const title = asString(payload.title || payload.headline, 'Daily Agenda');
  const subtitle = asString(payload.subtitle, '');
  const printedAt = asString(payload.printedAt, new Date().toLocaleString());
  const sections = {
    weather: formatWeatherLines(payload.weather),
    sleep: formatSleepLines(payload.sleep),
    events: formatEventsLines(payload.events),
    battery: formatBatteryLines(payload.batteries),
    alerts: formatAlertsLines(payload.alerts),
    notes: formatNotesLines(payload.notes)
  };

  const lines = [];
  if (subtitle) {
    lines.push(subtitle);
  }

  for (const section of sectionOrder) {
    if (!include[section]) {
      continue;
    }

    appendSection(lines, SECTION_TITLES[section], sections[section]);
  }

  return {
    headline: title,
    lines,
    printedAt,
    showHeader: include.header,
    showFooter: include.footer,
    include,
    sectionOrder
  };
}

module.exports = {
  DEFAULT_AGENDA_INCLUDE,
  DEFAULT_AGENDA_SECTION_ORDER,
  normalizeInclude,
  normalizeSectionOrder,
  buildDailyAgendaTemplateData
};
