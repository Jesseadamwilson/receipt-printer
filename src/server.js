const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { QueueJobError } = require('./queue');
const { PROFILE_ITEM_TYPES, PROFILE_TEMPLATES } = require('./profile-store');

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
  });
  res.end(body);
}

function fileResponse(res, statusCode, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const body = fs.readFileSync(filePath);
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
  return true;
}

function noContentResponse(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
  });
  res.end();
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    const maxBytes = 1024 * 1024;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('Request body exceeds 1MB limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

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

function asInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return fallback;
}

function normalizeLines(lines, message) {
  if (Array.isArray(lines)) {
    return lines
      .map((line) => String(line))
      .map((line) => line.trim())
      .filter(Boolean);
  }

  if (typeof message === 'string' && message.trim()) {
    return message
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizePrintOptions(rawPrint, defaults = {}) {
  const raw = rawPrint && typeof rawPrint === 'object' ? rawPrint : {};

  return {
    feedLines: asInt(raw.feedLines, defaults.feedLines ?? 3),
    cut: asBoolean(raw.cut, defaults.cut ?? true),
    cutMode: asString(raw.cutMode, defaults.cutMode || 'full')
  };
}

function normalizeImagePath(rawImagePath, outputDir) {
  const imagePath = asString(rawImagePath, path.join(outputDir, 'rendered.png'));
  return path.isAbsolute(imagePath) ? imagePath : path.resolve(process.cwd(), imagePath);
}

function normalizeTextJob(body, config) {
  return {
    headline: asString(body.headline, 'HA Receipt Printer'),
    lines: normalizeLines(body.lines, body.message),
    footer: asString(body.footer, new Date().toLocaleString()),
    print: normalizePrintOptions(body.print, {
      feedLines: 3,
      cut: true,
      cutMode: config.printerCutMode
    })
  };
}

function normalizeImageJob(body, config) {
  const imagePath = normalizeImagePath(body.imagePath, config.outputDir);
  if (!fs.existsSync(imagePath)) {
    const error = new Error(`Image not found: ${imagePath}`);
    error.statusCode = 400;
    throw error;
  }

  return {
    imagePath,
    print: normalizePrintOptions(body.print, {
      feedLines: 3,
      cut: true,
      cutMode: config.printerCutMode
    })
  };
}

function normalizeRenderJob(body, config) {
  const templateData = body.templateData && typeof body.templateData === 'object'
    ? body.templateData
    : body;

  return {
    templateData: {
      headline: asString(templateData.headline, 'HA Receipt Printer'),
      lines: normalizeLines(templateData.lines, templateData.message),
      printedAt: asString(templateData.printedAt, new Date().toLocaleString()),
      showHeader: asBoolean(templateData.showHeader, true),
      showFooter: asBoolean(templateData.showFooter, true)
    },
    print: normalizePrintOptions(body.print, {
      feedLines: 3,
      cut: true,
      cutMode: config.printerCutMode
    })
  };
}

function normalizeDailyAgendaJob(body, config) {
  const payload = body && typeof body === 'object' ? body : {};

  return {
    profileId: asString(payload.profileId, ''),
    agendaInput: {
      title: asString(payload.title || payload.headline, 'Daily Agenda'),
      subtitle: asString(payload.subtitle, ''),
      printedAt: asString(payload.printedAt, new Date().toLocaleString()),
      include: payload.include && typeof payload.include === 'object' ? payload.include : {},
      sectionOrder: payload.sectionOrder,
      source: asString(payload.source, 'auto'),
      weather: payload.weather && typeof payload.weather === 'object' ? payload.weather : undefined,
      sleep: payload.sleep && typeof payload.sleep === 'object' ? payload.sleep : undefined,
      events: Array.isArray(payload.events) ? payload.events : [],
      batteries: Array.isArray(payload.batteries) ? payload.batteries : [],
      alerts: Array.isArray(payload.alerts) ? payload.alerts : [],
      notes: asString(payload.notes, '')
    },
    print: normalizePrintOptions(body.print, {
      feedLines: 3,
      cut: true,
      cutMode: config.printerCutMode
    })
  };
}

function handleQueueError(error, res) {
  const statusCode = error instanceof QueueJobError ? 500 : (error.statusCode || 500);
  const response = {
    ok: false,
    error: error.message
  };

  if (error.job) {
    response.job = error.job;
  }

  jsonResponse(res, statusCode, response);
}

function createReceiptServer(options) {
  const {
    config,
    queue,
    serviceMeta,
    profileStore,
    listEntities
  } = options;

  if (!queue || typeof queue.enqueue !== 'function') {
    throw new Error('createReceiptServer requires a queue with enqueue()');
  }

  if (!profileStore || typeof profileStore.get !== 'function' || typeof profileStore.save !== 'function') {
    throw new Error('createReceiptServer requires a profileStore with get()/save()');
  }

  if (typeof listEntities !== 'function') {
    throw new Error('createReceiptServer requires a listEntities(options) function');
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        noContentResponse(res);
        return;
      }

      if (!req.url) {
        jsonResponse(res, 404, { ok: false, error: 'Not found' });
        return;
      }

      const fullUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = fullUrl.pathname;

      if (req.method === 'GET' && (pathname === '/' || pathname === '/ui' || pathname === '/ui/')) {
        const uiPath = path.join(config.publicDir, 'settings.html');
        if (fileResponse(res, 200, uiPath, 'text/html; charset=utf-8')) {
          return;
        }
      }

      if (req.method === 'GET' && (pathname === '/ui/settings.js' || pathname === '/settings.js')) {
        const scriptPath = path.join(config.publicDir, 'settings.js');
        if (fileResponse(res, 200, scriptPath, 'application/javascript; charset=utf-8')) {
          return;
        }
      }

      if (req.method === 'GET' && (pathname === '/ui/settings.css' || pathname === '/settings.css')) {
        const stylePath = path.join(config.publicDir, 'settings.css');
        if (fileResponse(res, 200, stylePath, 'text/css; charset=utf-8')) {
          return;
        }
      }

      if (req.method === 'GET' && pathname === '/api/profiles') {
        const profiles = profileStore.get();
        jsonResponse(res, 200, {
          ok: true,
          ...profiles,
          templates: PROFILE_TEMPLATES,
          itemTypes: PROFILE_ITEM_TYPES
        });
        return;
      }

      if ((req.method === 'PUT' || req.method === 'POST') && pathname === '/api/profiles') {
        const body = await parseJsonBody(req);
        const saved = profileStore.save(body);
        jsonResponse(res, 200, {
          ok: true,
          ...saved,
          templates: PROFILE_TEMPLATES,
          itemTypes: PROFILE_ITEM_TYPES
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/entities') {
        const entities = await listEntities({
          search: fullUrl.searchParams.get('q') || '',
          type: fullUrl.searchParams.get('type') || '',
          limit: asInt(fullUrl.searchParams.get('limit'), 300)
        });

        jsonResponse(res, 200, { ok: true, entities });
        return;
      }

      if (req.method === 'GET' && pathname === '/health') {
        const profiles = profileStore.get();

        jsonResponse(res, 200, {
          ok: true,
          service: serviceMeta.name,
          version: serviceMeta.version,
          api: {
            host: config.apiHost,
            port: config.apiPort
          },
          printer: {
            host: config.printerHost,
            port: config.printerPort,
            language: config.printerLanguage,
            model: config.printerModel,
            cutMode: config.printerCutMode,
            paperWidth: config.paperWidth
          },
          templates: {
            candidates: config.templatePaths || [config.templatePath]
          },
          homeAssistantApi: {
            baseUrl: config.haApiBaseUrl,
            hasToken: Boolean(config.haApiToken)
          },
          agendaIncludeDefaults: config.agendaIncludeDefaults,
          agendaSources: {
            calendarEntities: config.agendaCalendarEntities,
            weatherEntity: config.agendaWeatherEntity,
            sleepEntity: config.agendaSleepEntity,
            batteryEntities: config.agendaBatteryEntities,
            alertEntities: config.agendaAlertEntities,
            notesEntity: config.agendaNotesEntity,
            sectionOrder: config.agendaSectionOrder,
            timeWindowHours: config.agendaTimeWindowHours
          },
          profiles: {
            storePath: profileStore.getStorePath(),
            count: Array.isArray(profiles.profiles) ? profiles.profiles.length : 0,
            defaultDailyAgendaProfileId: profiles.defaultDailyAgendaProfileId
          },
          queue: queue.getStatus()
        });
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/jobs/')) {
        const jobId = pathname.slice('/jobs/'.length);
        const job = queue.getJob(jobId);
        if (!job) {
          jsonResponse(res, 404, { ok: false, error: `Job not found: ${jobId}` });
          return;
        }

        jsonResponse(res, 200, { ok: true, job });
        return;
      }

      if (req.method === 'POST' && pathname === '/print/text') {
        const body = await parseJsonBody(req);
        const job = await queue.enqueue('text', normalizeTextJob(body, config));
        jsonResponse(res, 200, { ok: true, job });
        return;
      }

      if (req.method === 'POST' && pathname === '/print/image') {
        const body = await parseJsonBody(req);
        const job = await queue.enqueue('image', normalizeImageJob(body, config));
        jsonResponse(res, 200, { ok: true, job });
        return;
      }

      if (req.method === 'POST' && pathname === '/print/render') {
        const body = await parseJsonBody(req);
        const job = await queue.enqueue('render', normalizeRenderJob(body, config));
        jsonResponse(res, 200, { ok: true, job });
        return;
      }

      if (req.method === 'POST' && pathname === '/print/daily-agenda') {
        const body = await parseJsonBody(req);
        const job = await queue.enqueue('daily_agenda', normalizeDailyAgendaJob(body, config));
        jsonResponse(res, 200, { ok: true, job });
        return;
      }

      jsonResponse(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      handleQueueError(error, res);
    }
  });
}

module.exports = {
  createReceiptServer
};
