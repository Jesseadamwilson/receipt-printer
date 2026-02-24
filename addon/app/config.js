const fs = require('node:fs');
const path = require('node:path');

function parseIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function parseBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseTemplateDirs() {
  const configured = process.env.TEMPLATE_DIR
    ? [process.env.TEMPLATE_DIR]
        .map((value) => String(value).trim())
        .filter((value) => value && value.toLowerCase() !== 'null')
    : [];

  const candidates = [
    ...configured,
    path.resolve(__dirname, '../../templates'),
    path.join(__dirname, 'templates')
  ];

  return [...new Set(candidates)];
}

function resolveChromiumPath() {
  const configured = process.env.CHROMIUM_PATH;
  if (configured) {
    return configured;
  }

  const candidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

const config = {
  port: parseIntEnv('PORT', 8099),
  printer: {
    host: process.env.PRINTER_HOST || '',
    port: parseIntEnv('PRINTER_PORT', 9100),
    transport: process.env.TRANSPORT || 'raw_tcp',
    enabled: parseBoolEnv('PRINT_ENABLED', false),
    defaultFeedLines: parseIntEnv('DEFAULT_FEED_LINES', 3),
    defaultCut: parseBoolEnv('DEFAULT_CUT', true),
    defaultThreshold: parseIntEnv('DEFAULT_THRESHOLD', 180)
  },
  rendering: {
    paperWidthPx: parseIntEnv('PAPER_WIDTH_PX', 576),
    chromiumPath: resolveChromiumPath(),
    timezone: process.env.TZ || 'America/Chicago'
  },
  queue: {
    timeoutMs: parseIntEnv('QUEUE_TIMEOUT_MS', 20_000),
    maxRetries: parseIntEnv('QUEUE_MAX_RETRIES', 2)
  },
  templates: {
    dirs: parseTemplateDirs()
  },
  agenda: {
    includeDefaults: {
      header: parseBoolEnv('AGENDA_INCLUDE_HEADER', true),
      weather: parseBoolEnv('AGENDA_INCLUDE_WEATHER', true),
      sleep: parseBoolEnv('AGENDA_INCLUDE_SLEEP', true),
      events: parseBoolEnv('AGENDA_INCLUDE_EVENTS', true),
      alerts: parseBoolEnv('AGENDA_INCLUDE_ALERTS', true),
      notes: parseBoolEnv('AGENDA_INCLUDE_NOTES', true),
      footer: parseBoolEnv('AGENDA_INCLUDE_FOOTER', true)
    }
  }
};

module.exports = config;
