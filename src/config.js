const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function parseIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function parseStringEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) {
    return fallback;
  }

  return String(raw).trim();
}

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return fallback;
}

function resolveChromiumPath() {
  const configured = parseStringEnv('CHROMIUM_PATH', '');
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function resolveTemplatePaths() {
  const configured = parseStringEnv('TEMPLATE_PATH', '');
  const candidates = [];

  if (configured) {
    candidates.push(configured);
  }

  candidates.push('/config/receipt-printer/templates/receipt.html');
  candidates.push(path.resolve(process.cwd(), 'templates', 'receipt.html'));

  const normalized = candidates.map((candidate) => {
    return path.isAbsolute(candidate)
      ? candidate
      : path.resolve(process.cwd(), candidate);
  });

  return Array.from(new Set(normalized));
}

function loadConfig() {
  const templatePaths = resolveTemplatePaths();

  return {
    apiHost: parseStringEnv('API_HOST', '0.0.0.0'),
    apiPort: parseIntEnv('API_PORT', 8099),
    printerHost: parseStringEnv('PRINTER_HOST', '10.0.0.25'),
    printerPort: parseIntEnv('PRINTER_PORT', 9100),
    printerLanguage: parseStringEnv('PRINTER_LANGUAGE', 'star-prnt'),
    printerModel: parseStringEnv('PRINTER_MODEL', ''),
    printerCutMode: parseStringEnv('PRINTER_CUT_MODE', 'full'),
    printTimeoutMs: parseIntEnv('PRINT_TIMEOUT_MS', 15000),
    queueMaxRetries: parseIntEnv('QUEUE_MAX_RETRIES', 2),
    queueRetryDelayMs: parseIntEnv('QUEUE_RETRY_DELAY_MS', 1000),
    agendaIncludeDefaults: {
      header: parseBooleanEnv('AGENDA_INCLUDE_HEADER', true),
      weather: parseBooleanEnv('AGENDA_INCLUDE_WEATHER', true),
      sleep: parseBooleanEnv('AGENDA_INCLUDE_SLEEP', true),
      events: parseBooleanEnv('AGENDA_INCLUDE_EVENTS', true),
      alerts: parseBooleanEnv('AGENDA_INCLUDE_ALERTS', true),
      notes: parseBooleanEnv('AGENDA_INCLUDE_NOTES', true),
      footer: parseBooleanEnv('AGENDA_INCLUDE_FOOTER', true)
    },
    paperWidth: parseIntEnv('PAPER_WIDTH', 576),
    chromiumPath: resolveChromiumPath(),
    outputDir: path.resolve(process.cwd(), 'output'),
    templatePath: templatePaths[0],
    templatePaths
  };
}

module.exports = {
  loadConfig
};
