const path = require('node:path');
const express = require('express');
const config = require('./config');
const RenderService = require('./renderer/renderService');
const PrinterService = require('./printer/printerService');
const PrintQueue = require('./queue/printQueue');

const app = express();

const renderService = new RenderService({
  paperWidthPx: config.rendering.paperWidthPx,
  templateDirs: config.templates.dirs,
  chromiumPath: config.rendering.chromiumPath,
  timezone: config.rendering.timezone
});

const printerService = new PrinterService({
  host: config.printer.host,
  port: config.printer.port,
  transport: config.printer.transport,
  webPrntScheme: config.printer.webPrntScheme,
  webPrntPath: config.printer.webPrntPath,
  webPrntDeviceId: config.printer.webPrntDeviceId,
  webPrntPaperType: config.printer.webPrntPaperType,
  webPrntHoldPrintTimeoutMs: config.printer.webPrntHoldPrintTimeoutMs,
  enabled: config.printer.enabled,
  paperWidthPx: config.rendering.paperWidthPx,
  defaultFeedLines: config.printer.defaultFeedLines,
  defaultCut: config.printer.defaultCut,
  defaultThreshold: config.printer.defaultThreshold
});

const printQueue = new PrintQueue({
  timeoutMs: config.queue.timeoutMs,
  maxRetries: config.queue.maxRetries
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    transport: config.printer.transport,
    printer_port: config.printer.port,
    print_enabled: config.printer.enabled,
    webprnt_scheme: config.printer.webPrntScheme,
    webprnt_path: config.printer.webPrntPath,
    webprnt_device_id: config.printer.webPrntDeviceId,
    webprnt_paper_type: config.printer.webPrntPaperType,
    webprnt_holdprint_timeout_ms: config.printer.webPrntHoldPrintTimeoutMs,
    paper_width_px: config.rendering.paperWidthPx,
    template_dirs: config.templates.dirs,
    timezone: config.rendering.timezone,
    agenda_include_defaults: config.agenda.includeDefaults
  });
});

app.post('/render/message', async (req, res, next) => {
  try {
    const data = buildMessagePayload(req.body);
    const output = await renderService.renderTemplate('message', data);
    sendPngResponse(res, output.png, 'message');
  } catch (error) {
    next(error);
  }
});

app.post('/render/daily-agenda', async (req, res, next) => {
  try {
    const data = buildDailyAgendaPayload(req.body);
    const output = await renderService.renderTemplate('daily-agenda', data);
    sendPngResponse(res, output.png, 'daily-agenda');
  } catch (error) {
    next(error);
  }
});

app.post('/render/template', async (req, res, next) => {
  try {
    const template = requireTemplateName(req.body.template);
    const data = req.body.data || {};
    const output = await renderService.renderTemplate(template, data);
    sendPngResponse(res, output.png, template);
  } catch (error) {
    next(error);
  }
});

app.post('/print/message', async (req, res, next) => {
  try {
    const data = buildMessagePayload(req.body);
    const printOptions = extractPrintOptions(req.body);

    const result = await enqueuePrintJob({
      type: 'message',
      template: 'message',
      data,
      printOptions
    });

    res.status(202).json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/print/daily-agenda', async (req, res, next) => {
  try {
    const data = buildDailyAgendaPayload(req.body);
    const printOptions = extractPrintOptions(req.body);

    const result = await enqueuePrintJob({
      type: 'daily-agenda',
      template: 'daily-agenda',
      data,
      printOptions
    });

    res.status(202).json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/print/template', async (req, res, next) => {
  try {
    const template = requireTemplateName(req.body.template);
    const data = req.body.data || {};
    const printOptions = extractPrintOptions(req.body);

    const result = await enqueuePrintJob({
      type: 'template',
      template,
      data,
      printOptions
    });

    res.status(202).json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  let status = error.statusCode || 500;

  if (!error.statusCode && /template not found/i.test(error.message)) {
    status = 404;
  } else if (!error.statusCode && /template|message is required|invalid template/i.test(error.message)) {
    status = 400;
  }

  res.status(status).json({
    error: error.message || 'Unexpected error',
    status
  });
});

const server = app.listen(config.port, () => {
  console.log(`[receipt-printer] listening on port ${config.port}`);
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  server.close(async () => {
    await renderService.close();
    process.exit(0);
  });
}

async function enqueuePrintJob({ type, template, data, printOptions }) {
  if (!template) {
    const error = new Error('template is required');
    error.statusCode = 400;
    throw error;
  }

  return printQueue.enqueue({ type }, async (attempt) => {
    const rendered = await renderService.renderTemplate(template, data);
    const printed = await printerService.printPng(rendered.png, printOptions);

    return {
      status: 'queued_and_printed',
      attempt,
      template,
      render: {
        width: rendered.width,
        height: rendered.height
      },
      print: printed
    };
  });
}

function sendPngResponse(res, png, templateName) {
  res
    .status(200)
    .set('Content-Type', 'image/png')
    .set('Cache-Control', 'no-store')
    .set('X-Receipt-Template', String(templateName))
    .send(png);
}

function buildMessagePayload(body = {}) {
  const message = body.message || body.text || '';
  if (!message || typeof message !== 'string' || !message.trim()) {
    const error = new Error('message is required');
    error.statusCode = 400;
    throw error;
  }

  const contentLines = normalizeStringArray(body.content_lines);

  return {
    zones: resolveZones(body.include, {
      header: true,
      content: true,
      footer: true
    }),
    theme: normalizeTheme(body.theme),
    headline: body.headline || 'Home Note',
    message,
    content_lines: contentLines.length ? contentLines : message.split('\n').map((line) => line.trim()).filter(Boolean),
    footer: body.footer || '',
    printed_at: formatLocalTimestamp(new Date())
  };
}

function buildDailyAgendaPayload(body = {}) {
  const now = new Date();
  const include = resolveAgendaInclude(body.include);

  return {
    zones: {
      header: include.header,
      content: true,
      footer: include.footer
    },
    include,
    theme: normalizeTheme(body.theme),
    title: body.title || 'Daily Agenda',
    subtitle: body.subtitle || formatLocalDay(now),
    weather: {
      summary: body.weather?.summary || '',
      temp: body.weather?.temp || '',
      high: body.weather?.high || '',
      low: body.weather?.low || ''
    },
    sleep: {
      hours: body.sleep?.hours || ''
    },
    events: normalizeEvents(body.events),
    alerts: normalizeStringArray(body.alerts),
    notes: body.notes || '',
    printed_at: formatLocalTimestamp(now)
  };
}

function extractPrintOptions(body = {}) {
  const print = body.print || {};

  return {
    cut: print.cut,
    feedLines: print.feed_lines,
    threshold: print.threshold,
    timeoutMs: print.timeout_ms
  };
}

function requireTemplateName(value) {
  if (!value || typeof value !== 'string') {
    const error = new Error('template is required');
    error.statusCode = 400;
    throw error;
  }

  return value;
}

function resolveAgendaInclude(rawInclude = {}) {
  const defaults = config.agenda.includeDefaults;

  return {
    header: coalesceBool(rawInclude.header, defaults.header),
    weather: coalesceBool(rawInclude.weather, defaults.weather),
    sleep: coalesceBool(rawInclude.sleep, defaults.sleep),
    events: coalesceBool(rawInclude.events, defaults.events),
    alerts: coalesceBool(rawInclude.alerts, defaults.alerts),
    notes: coalesceBool(rawInclude.notes, defaults.notes),
    footer: coalesceBool(rawInclude.footer, defaults.footer)
  };
}

function resolveZones(rawInclude = {}, defaults) {
  return {
    header: coalesceBool(rawInclude.header, defaults.header),
    content: coalesceBool(rawInclude.content, defaults.content),
    footer: coalesceBool(rawInclude.footer, defaults.footer)
  };
}

function normalizeTheme(rawTheme = {}) {
  return {
    header_size_px: normalizeInt(rawTheme.header_size_px, 12, 120),
    content_size_px: normalizeInt(rawTheme.content_size_px, 10, 96),
    footer_size_px: normalizeInt(rawTheme.footer_size_px, 8, 80),
    padding_x_px: normalizeInt(rawTheme.padding_x_px, 0, 80),
    padding_y_px: normalizeInt(rawTheme.padding_y_px, 0, 80),
    divider_thickness_px: normalizeInt(rawTheme.divider_thickness_px, 1, 12),
    line_height: normalizeFloat(rawTheme.line_height, 1, 2.8)
  };
}

function normalizeEvents(rawEvents) {
  if (Array.isArray(rawEvents)) {
    return rawEvents
      .map((event) => ({
        time: normalizeString(event?.time),
        title: normalizeString(event?.title),
        location: normalizeString(event?.location)
      }))
      .filter((event) => event.title);
  }

  if (typeof rawEvents === 'string') {
    return rawEvents
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [time = '', title = '', location = ''] = line.split('|').map((part) => part.trim());
        return { time, title, location };
      })
      .filter((event) => event.title);
  }

  return [];
}

function normalizeStringArray(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map((entry) => normalizeString(entry)).filter(Boolean);
  }

  if (typeof rawValue === 'string') {
    return rawValue
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function coalesceBool(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function normalizeInt(value, min, max) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(min, Math.min(max, parsed));
}

function normalizeFloat(value, min, max) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(min, Math.min(max, parsed));
}

function formatLocalDay(date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: config.rendering.timezone
  }).format(date);
}

function formatLocalTimestamp(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: config.rendering.timezone
  }).format(date);
}
