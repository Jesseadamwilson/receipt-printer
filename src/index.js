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
  const messageText = safePayload.hasMessageOverride
    ? asRawString(safePayload.message, '')
    : profileMessage;

  const providedLines = Array.isArray(safePayload.lines)
    ? safePayload.lines.map((line) => asRawString(line, ''))
    : [];
  const lines = providedLines.length > 0
    ? providedLines
    : splitMessageLines(messageText);

  if (lines.length === 0) {
    lines.push('');
  }

  return {
    headline: asString(safePayload.headline, selectedProfile ? selectedProfile.name : 'Message'),
    lines,
    printedAt: asString(safePayload.footer, new Date().toLocaleString()),
    showHeader: true,
    showFooter: true
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

  const result = await runRenderJob(effectiveConfig, {
    templateData,
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

  const imagePath = await renderTemplateToPng(effectiveConfig, templateData, {
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
