const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { QueueJobError } = require('./queue');

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
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
      printedAt: asString(templateData.printedAt, new Date().toLocaleString())
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
  const { config, queue, serviceMeta } = options;

  if (!queue || typeof queue.enqueue !== 'function') {
    throw new Error('createReceiptServer requires a queue with enqueue()');
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
        });
        res.end();
        return;
      }

      if (!req.url) {
        jsonResponse(res, 404, { ok: false, error: 'Not found' });
        return;
      }

      const fullUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = fullUrl.pathname;

      if (req.method === 'GET' && pathname === '/health') {
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

      jsonResponse(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      handleQueueError(error, res);
    }
  });
}

module.exports = {
  createReceiptServer
};
