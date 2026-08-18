const fs = require('node:fs');
const path = require('node:path');
const { sanitizePrinters } = require('./config');

function asString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }
  const result = String(value).trim();
  return result || fallback;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function legacyPrinterFromConfig(config) {
  return {
    host: config.printerHost,
    port: config.printerPort,
    language: config.printerLanguage,
    model: config.printerModel,
    cutMode: config.printerCutMode,
    paperWidth: config.paperWidth
  };
}

function sanitizeStore(rawStore, config) {
  const source = rawStore && typeof rawStore === 'object' ? rawStore : {};
  const rawPrinters = Array.isArray(source.printers) ? source.printers : [];
  if (rawPrinters.length === 0) {
    const error = new Error('At least one valid printer is required');
    error.statusCode = 400;
    throw error;
  }

  for (const [index, printer] of rawPrinters.entries()) {
    const host = asString(printer && printer.host, '');
    const port = Number.parseInt(printer && printer.port, 10);
    if (!printer || typeof printer !== 'object' || !host || !Number.isFinite(port) || port < 1 || port > 65535) {
      const error = new Error(`Printer ${index + 1} requires a host and a port from 1 to 65535`);
      error.statusCode = 400;
      throw error;
    }
  }

  const printers = sanitizePrinters(rawPrinters, legacyPrinterFromConfig(config));
  const requestedDefault = asString(source.defaultPrinterId || source.default_printer_id, '');
  const defaultPrinter = printers.find((printer) => printer.id === requestedDefault) || printers[0];

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    defaultPrinterId: defaultPrinter.id,
    printers
  };
}

function seedStore(config) {
  return sanitizeStore({
    defaultPrinterId: config.defaultPrinterId,
    printers: config.printers
  }, config);
}

function syncRuntimeConfig(config, store) {
  const defaultPrinter = store.printers.find((printer) => printer.id === store.defaultPrinterId)
    || store.printers[0];
  config.printers = deepClone(store.printers);
  config.defaultPrinterId = defaultPrinter.id;
  config.printerHost = defaultPrinter.host;
  config.printerPort = defaultPrinter.port;
  config.printerLanguage = defaultPrinter.language;
  config.printerModel = defaultPrinter.model;
  config.printerCutMode = defaultPrinter.cutMode;
  config.paperWidth = defaultPrinter.paperWidth;
}

function createPrinterStore(config) {
  const storePath = asString(
    config.printerStorePath,
    path.join(path.dirname(config.profileStorePath), 'printers.json')
  );
  let store;

  const persist = (nextStore) => {
    const sanitized = sanitizeStore(nextStore, config);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(sanitized, null, 2), 'utf8');
    fs.renameSync(temporaryPath, storePath);
    store = sanitized;
    syncRuntimeConfig(config, store);
    return deepClone(store);
  };

  try {
    if (fs.existsSync(storePath)) {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      store = sanitizeStore(parsed, config);
      syncRuntimeConfig(config, store);
    } else {
      persist(seedStore(config));
    }
  } catch (error) {
    persist(seedStore(config));
  }

  return {
    getStorePath() {
      return storePath;
    },
    get() {
      return deepClone(store);
    },
    save(nextStore) {
      return persist(nextStore);
    }
  };
}

module.exports = {
  createPrinterStore,
  sanitizePrinterStore: sanitizeStore
};
