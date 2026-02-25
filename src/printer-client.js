const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { PNG } = require('pngjs');

class NonRetryableTransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NonRetryableTransportError';
    this.retryable = false;
  }
}

function getEncoderConstructor() {
  // Support scoped package first, then legacy package names.
  const candidates = [
    '@point-of-sale/receipt-printer-encoder',
    'receipt-printer-encoder',
    'ReceiptPrinterEncoder'
  ];

  let lastError;
  for (const name of candidates) {
    try {
      const mod = require(name);
      return mod.default || mod.ReceiptPrinterEncoder || mod;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Could not load ReceiptPrinterEncoder package. Tried: ${candidates.join(', ')}. Last error: ${lastError?.message || 'unknown'}`
  );
}

function getSupportedModelIds(Encoder) {
  const models = Encoder.printerModels;
  if (!Array.isArray(models)) {
    return [];
  }

  return models
    .map((model) => {
      if (typeof model === 'string') {
        return model;
      }
      if (model && typeof model === 'object' && typeof model.id === 'string') {
        return model.id;
      }

      return '';
    })
    .filter(Boolean);
}

function normalizePrinterModel(inputModel, Encoder) {
  const value = String(inputModel || '').trim().toLowerCase();
  if (!value) {
    return '';
  }

  const aliases = {
    'star-mc-print3': 'star-mc-print2',
    'mcp31lb': 'star-mc-print2',
    'mcp21lb': 'star-mc-print2',
    'tm-m30iii': 'epson-tm-m30iii'
  };

  const desired = aliases[value] || value;
  const supported = new Set(getSupportedModelIds(Encoder));

  if (!supported.has(desired)) {
    return '';
  }

  return desired;
}

function createEncoder(config) {
  const Encoder = getEncoderConstructor();
  const options = {
    language: config.printerLanguage,
  };

  const normalizedModel = normalizePrinterModel(config.printerModel, Encoder);
  if (normalizedModel) {
    options.printerModel = normalizedModel;
  }

  return new Encoder(options);
}

function callIfExists(target, methodName, ...args) {
  if (target && typeof target[methodName] === 'function') {
    target[methodName](...args);
    return true;
  }

  return false;
}

function writeLine(encoder, text = '') {
  if (callIfExists(encoder, 'line', text)) {
    return;
  }

  if (callIfExists(encoder, 'text', text)) {
    callIfExists(encoder, 'newline');
    return;
  }

  throw new Error('Encoder does not support line/text methods');
}

function encodeTextReceipt(config, payload) {
  const encoder = createEncoder(config);

  callIfExists(encoder, 'initialize');
  callIfExists(encoder, 'align', 'center');
  callIfExists(encoder, 'bold', true);
  writeLine(encoder, payload.headline || 'HA Receipt Printer');
  callIfExists(encoder, 'bold', false);

  callIfExists(encoder, 'newline');
  callIfExists(encoder, 'align', 'left');

  for (const line of payload.lines || []) {
    writeLine(encoder, line);
  }

  callIfExists(encoder, 'newline');
  writeLine(encoder, payload.footer || new Date().toLocaleString());

  applyFeed(encoder, payload.feedLines || 0);
  applyCut(encoder, payload.cut, payload.cutMode || config.printerCutMode);

  if (typeof encoder.encode !== 'function') {
    throw new Error('Encoder missing encode() method');
  }

  const encoded = encoder.encode();
  return Buffer.from(encoded);
}

function encodeImageReceipt(config, options) {
  const imagePath = path.resolve(options.imagePath);
  const imageBuffer = fs.readFileSync(imagePath);
  const png = PNG.sync.read(imageBuffer);

  const encoder = createEncoder(config);
  callIfExists(encoder, 'initialize');
  callIfExists(encoder, 'align', 'center');

  const pixelData = new Uint8ClampedArray(png.data);
  const prepared = padImageHeightToMultipleOf8(pixelData, png.width, png.height);
  const imageInput = {
    data: prepared.data,
    width: prepared.width,
    height: prepared.height
  };

  if (typeof encoder.image !== 'function') {
    throw new Error('Encoder missing image() method');
  }

  // ReceiptPrinterEncoder expects RGBA pixel data + width/height.
  encoder.image(imageInput, prepared.width, prepared.height, 'atkinson', 128);

  const feedLines = options.feedLines === undefined ? 3 : Number(options.feedLines);
  applyFeed(encoder, feedLines);
  applyCut(encoder, options.cut, options.cutMode || config.printerCutMode);

  if (typeof encoder.encode !== 'function') {
    throw new Error('Encoder missing encode() method');
  }

  const encoded = encoder.encode();
  return Buffer.from(encoded);
}

function padImageHeightToMultipleOf8(rgbaData, width, height) {
  const remainder = height % 8;
  if (remainder === 0) {
    return {
      data: rgbaData,
      width,
      height
    };
  }

  const paddedHeight = height + (8 - remainder);
  const output = new Uint8ClampedArray(width * paddedHeight * 4);

  // Initialize padded rows as solid white.
  for (let i = 0; i < output.length; i += 4) {
    output[i] = 255;
    output[i + 1] = 255;
    output[i + 2] = 255;
    output[i + 3] = 255;
  }

  output.set(rgbaData);

  return {
    data: output,
    width,
    height: paddedHeight
  };
}

function sendToPrinter(config, payload) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    let writeCompleted = false;
    const timeoutMs = Number(config.printTimeoutMs) || 15000;

    const succeed = () => {
      if (settled) {
        return;
      }

      settled = true;
      socket.setTimeout(0);
      resolve({
        bytesSent: payload.length,
        host: config.printerHost,
        port: config.printerPort
      });
    };

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.setTimeout(0);
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs);

    socket.on('error', (error) => fail(error));
    socket.on('timeout', () => {
      if (writeCompleted) {
        fail(new NonRetryableTransportError(
          `Socket timeout after write completion (${timeoutMs}ms). ` +
          'Printer may have already received data.'
        ));
        return;
      }

      fail(new Error(`Socket timeout before write completion (${timeoutMs}ms)`));
    });

    socket.on('close', (hadError) => {
      if (settled) {
        return;
      }

      if (hadError) {
        fail(new Error('Socket closed with transport error'));
        return;
      }

      if (writeCompleted) {
        succeed();
        return;
      }

      fail(new Error('Socket closed before payload write completed'));
    });

    socket.connect(config.printerPort, config.printerHost, () => {
      socket.write(payload, (error) => {
        if (error) {
          fail(error);
          return;
        }

        writeCompleted = true;
        socket.end(() => {
          succeed();
        });
      });
    });
  });
}

function applyFeed(encoder, feedLines) {
  const count = Number(feedLines);
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }

  if (callIfExists(encoder, 'feed', count)) {
    return;
  }

  if (callIfExists(encoder, 'newline', count)) {
    return;
  }

  for (let i = 0; i < count; i += 1) {
    writeLine(encoder, '');
  }
}

function applyCut(encoder, enabled, cutMode) {
  if (!enabled) {
    return;
  }

  const normalizedMode = normalizeCutMode(cutMode);
  if (normalizedMode === 'none') {
    return;
  }

  callIfExists(encoder, 'cut', normalizedMode);
}

function normalizeCutMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'partial' || mode === 'full' || mode === 'none') {
    return mode;
  }

  return 'full';
}

module.exports = {
  encodeTextReceipt,
  encodeImageReceipt,
  sendToPrinter
};
