const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { PrintQueue } = require('./queue');
const { createReceiptServer } = require('./server');
const { renderTemplateToPng } = require('./render-template');
const { buildDailyAgendaTemplateData } = require('./daily-agenda');
const { hydrateDailyAgendaFromHomeAssistant } = require('./ha-data-source');
const {
  encodeTextReceipt,
  encodeImageReceipt,
  sendToPrinter
} = require('./printer-client');

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

  const imagePath = await renderTemplateToPng(config, {
    headline: templateData.headline || 'HA Receipt Printer',
    lines: Array.isArray(templateData.lines) ? templateData.lines : [],
    printedAt: templateData.printedAt || new Date().toLocaleString(),
    showHeader: templateData.showHeader,
    showFooter: templateData.showFooter
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
    imagePath,
    payloadBytes: encoded.length,
    print,
    transport
  };
}

async function runDailyAgendaJob(config, payload) {
  const rawInput = payload && payload.agendaInput && typeof payload.agendaInput === 'object'
    ? payload.agendaInput
    : {};

  const hydratedInput = await hydrateDailyAgendaFromHomeAssistant(config, rawInput);
  const templateData = buildDailyAgendaTemplateData(hydratedInput, {
    includeDefaults: config.agendaIncludeDefaults,
    sectionOrder: config.agendaSectionOrder
  });

  const result = await runRenderJob(config, {
    templateData,
    print: payload.print
  });

  return {
    ...result,
    mode: 'daily_agenda',
    include: templateData.include,
    sectionOrder: templateData.sectionOrder
  };
}

async function runPrintJob(config, job) {
  switch (job.type) {
    case 'text':
      return runTextJob(config, job.payload);
    case 'image':
      return runImageJob(config, job.payload);
    case 'render':
      return runRenderJob(config, job.payload);
    case 'daily_agenda':
      return runDailyAgendaJob(config, job.payload);
    default:
      throw new Error(`Unsupported job type: ${job.type}`);
  }
}

function startServer() {
  const config = loadConfig();
  const serviceMeta = readPackageMetadata();

  const queue = new PrintQueue({
    maxRetries: config.queueMaxRetries,
    retryDelayMs: config.queueRetryDelayMs,
    worker: (job) => runPrintJob(config, job)
  });

  const server = createReceiptServer({
    config,
    queue,
    serviceMeta
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
