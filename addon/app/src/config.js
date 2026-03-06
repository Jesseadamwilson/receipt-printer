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
  if (raw === undefined || raw === null || !String(raw).trim()) {
    return fallback;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseCsvEnv(name, fallback = []) {
  const raw = parseStringEnv(name, '');
  if (!raw) {
    return [...fallback];
  }

  return raw
    .split(',')
    .map((item) => String(item).trim().replace(/\//g, '.'))
    .filter(Boolean);
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

function resolveTemplateDirectory() {
  const candidates = [
    path.resolve(process.cwd(), 'templates'),
    path.resolve(process.cwd(), 'addon', 'app', 'templates')
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch (_error) {
      // Ignore inaccessible candidate paths.
    }
  }

  return candidates[0];
}

function resolveTemplatePaths(templateDir) {
  // Single source of truth for both preview and print rendering.
  return [path.resolve(templateDir, 'receipt.html')];
}

function resolveNamedTemplatePaths(templateDir, defaultFiles) {
  return defaultFiles.map((fileName) => path.resolve(templateDir, fileName));
}

function loadConfig() {
  const templateDir = resolveTemplateDirectory();
  const templatePaths = resolveTemplatePaths(templateDir);
  const messageTemplatePaths = resolveNamedTemplatePaths(templateDir, ['message.html']);
  const dailyAgendaTemplatePaths = resolveNamedTemplatePaths(templateDir, ['daily-agenda.html']);

  return {
    apiHost: parseStringEnv('API_HOST', '0.0.0.0'),
    apiPort: parseIntEnv('API_PORT', 8099),
    profileStorePath: parseStringEnv(
      'PROFILE_STORE_PATH',
      path.resolve(process.cwd(), 'output', 'profiles.json')
    ),
    printerHost: parseStringEnv('PRINTER_HOST', '10.0.0.25'),
    printerPort: parseIntEnv('PRINTER_PORT', 9100),
    printerLanguage: parseStringEnv('PRINTER_LANGUAGE', 'star-prnt'),
    printerModel: parseStringEnv('PRINTER_MODEL', ''),
    printerCutMode: parseStringEnv('PRINTER_CUT_MODE', 'full'),
    printTimeoutMs: parseIntEnv('PRINT_TIMEOUT_MS', 15000),
    queueMaxRetries: parseIntEnv('QUEUE_MAX_RETRIES', 2),
    queueRetryDelayMs: parseIntEnv('QUEUE_RETRY_DELAY_MS', 1000),
    customCssPath: parseStringEnv(
      'CUSTOM_CSS_PATH',
      path.resolve(templateDir, 'custom.css')
    ),
    haApiBaseUrl: parseStringEnv('HA_API_BASE_URL', 'http://supervisor/core/api'),
    haApiToken: parseStringEnv('HA_API_TOKEN', process.env.SUPERVISOR_TOKEN || ''),
    agendaPreRefreshEnabled: parseBooleanEnv('AGENDA_PRE_REFRESH_ENABLED', true),
    agendaPreRefreshServices: parseCsvEnv('AGENDA_PRE_REFRESH_SERVICES', ['icloud.update']),
    agendaPreRefreshDelayMs: parseIntEnv('AGENDA_PRE_REFRESH_DELAY_MS', 2500),
    agendaSectionOrder: ['weather', 'sleep', 'events', 'battery', 'alerts', 'notes'],
    agendaTimeWindowHours: 24,
    agendaIncludeDefaults: {
      header: true,
      weather: true,
      sleep: true,
      events: true,
      battery: true,
      alerts: true,
      notes: true,
      footer: true
    },
    paperWidth: parseIntEnv('PAPER_WIDTH', 576),
    chromiumPath: resolveChromiumPath(),
    publicDir: path.resolve(process.cwd(), 'public'),
    outputDir: path.resolve(process.cwd(), 'output'),
    templateDir,
    templatePath: templatePaths[0],
    templatePaths,
    messageTemplatePaths,
    dailyAgendaTemplatePaths
  };
}

module.exports = {
  loadConfig
};
