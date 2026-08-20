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

function parseJsonEnv(name, fallback) {
  const raw = parseStringEnv(name, '');
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function createPrinterId(value, index = 0) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || `printer_${index + 1}`;
}

function sanitizePrinters(rawPrinters, legacyPrinter) {
  const source = Array.isArray(rawPrinters) ? rawPrinters : [];
  const usedIds = new Set();
  const printers = [];

  for (const [index, rawPrinter] of source.entries()) {
    if (!rawPrinter || typeof rawPrinter !== 'object') {
      continue;
    }

    const host = String(rawPrinter.host || '').trim();
    const port = Number.parseInt(rawPrinter.port, 10);
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
      continue;
    }

    let id = createPrinterId(rawPrinter.id || rawPrinter.name, index);
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}_${suffix}`)) {
        suffix += 1;
      }
      id = `${id}_${suffix}`;
    }
    usedIds.add(id);

    printers.push({
      id,
      name: String(rawPrinter.name || '').trim() || `Receipt Printer ${index + 1}`,
      host,
      port,
      language: String(rawPrinter.language || legacyPrinter.language || 'star-prnt').trim(),
      model: String(rawPrinter.model || '').trim(),
      cutMode: String(rawPrinter.cut_mode || rawPrinter.cutMode || legacyPrinter.cutMode || 'full').trim(),
      paperWidth: Number.parseInt(rawPrinter.paper_width || rawPrinter.paperWidth, 10)
        || legacyPrinter.paperWidth
    });
  }

  if (printers.length > 0) {
    return printers;
  }

  return [{
    id: 'default',
    name: 'Receipt Printer',
    ...legacyPrinter
  }];
}

function resolvePrinter(config, requestedPrinterId = '') {
  const printers = Array.isArray(config && config.printers) ? config.printers : [];
  if (printers.length === 0) {
    throw new Error('No receipt printers are configured');
  }

  const requested = String(requestedPrinterId || '').trim();
  const defaultId = String(config.defaultPrinterId || '').trim();
  const printer = (requested && printers.find((entry) => entry.id === requested))
    || (defaultId && printers.find((entry) => entry.id === defaultId))
    || printers[0];

  if (requested && printer.id !== requested) {
    const error = new Error(`Unknown printer: ${requested}`);
    error.statusCode = 400;
    error.retryable = false;
    throw error;
  }

  return {
    ...config,
    printerId: printer.id,
    printerName: printer.name,
    printerHost: printer.host,
    printerPort: printer.port,
    printerLanguage: printer.language,
    printerModel: printer.model,
    printerCutMode: printer.cutMode,
    paperWidth: printer.paperWidth
  };
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

  const legacyPrinter = {
    host: parseStringEnv('PRINTER_HOST', '10.0.0.25'),
    port: parseIntEnv('PRINTER_PORT', 9100),
    language: parseStringEnv('PRINTER_LANGUAGE', 'star-prnt'),
    model: parseStringEnv('PRINTER_MODEL', ''),
    cutMode: parseStringEnv('PRINTER_CUT_MODE', 'full'),
    paperWidth: parseIntEnv('PAPER_WIDTH', 576)
  };
  const printers = sanitizePrinters(parseJsonEnv('PRINTERS_JSON', []), legacyPrinter);
  const requestedDefaultPrinterId = parseStringEnv('DEFAULT_PRINTER_ID', '');
  const defaultPrinter = printers.find((printer) => printer.id === requestedDefaultPrinterId)
    || printers[0];

  return {
    apiHost: parseStringEnv('API_HOST', '0.0.0.0'),
    apiPort: parseIntEnv('API_PORT', 8099),
    profileStorePath: parseStringEnv(
      'PROFILE_STORE_PATH',
      path.resolve(process.cwd(), 'output', 'profiles.json')
    ),
    messageImageDir: parseStringEnv('MESSAGE_IMAGE_DIR', ''),
    printers,
    defaultPrinterId: defaultPrinter.id,
    printerHost: defaultPrinter.host,
    printerPort: defaultPrinter.port,
    printerLanguage: defaultPrinter.language,
    printerModel: defaultPrinter.model,
    printerCutMode: defaultPrinter.cutMode,
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
    paperWidth: defaultPrinter.paperWidth,
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
  loadConfig,
  resolvePrinter,
  sanitizePrinters
};
