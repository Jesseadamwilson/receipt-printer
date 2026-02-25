const DEFAULT_AGENDA_INCLUDE = {
  header: true,
  weather: true,
  sleep: true,
  events: true,
  alerts: true,
  notes: true,
  footer: true
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

  return [`${hours} hours`];
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

function buildDailyAgendaTemplateData(payload = {}, defaults = DEFAULT_AGENDA_INCLUDE) {
  const include = normalizeInclude(payload.include, defaults);
  const title = asString(payload.title || payload.headline, 'Daily Agenda');
  const subtitle = asString(payload.subtitle, '');
  const printedAt = asString(payload.printedAt, new Date().toLocaleString());

  const lines = [];

  if (include.header && subtitle) {
    lines.push(subtitle);
  }

  if (include.weather) {
    appendSection(lines, 'WEATHER', formatWeatherLines(payload.weather));
  }

  if (include.sleep) {
    appendSection(lines, 'SLEEP', formatSleepLines(payload.sleep));
  }

  if (include.events) {
    appendSection(lines, 'EVENTS', formatEventsLines(payload.events));
  }

  if (include.alerts) {
    appendSection(lines, 'ALERTS', formatAlertsLines(payload.alerts));
  }

  if (include.notes) {
    appendSection(lines, 'NOTES', formatNotesLines(payload.notes));
  }

  if (lines.length === 0) {
    lines.push('No agenda sections enabled or no data available.');
  }

  return {
    headline: title,
    lines,
    printedAt,
    showHeader: include.header,
    showFooter: include.footer,
    include
  };
}

module.exports = {
  DEFAULT_AGENDA_INCLUDE,
  normalizeInclude,
  buildDailyAgendaTemplateData
};
