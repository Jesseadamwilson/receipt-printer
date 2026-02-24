const { PNG } = require('pngjs');
const RawTcpTransport = require('./transports/rawTcpTransport');
const NoopTransport = require('./transports/noopTransport');

class PrinterService {
  constructor(options) {
    this.paperWidthPx = options.paperWidthPx;
    this.defaultFeedLines = options.defaultFeedLines;
    this.defaultCut = options.defaultCut;
    this.defaultThreshold = options.defaultThreshold;
    this.transport = this._buildTransport(options);
  }

  async printPng(pngBuffer, options = {}) {
    const threshold = this._resolveThreshold(options.threshold);
    const feedLines = this._resolveFeedLines(options.feedLines);
    const cut = options.cut === undefined ? this.defaultCut : Boolean(options.cut);

    const { width, height, rasterBytes } = this._pngToRaster(pngBuffer, threshold);
    const payload = this._buildEscPosPayload({
      width,
      height,
      rasterBytes,
      feedLines,
      cut
    });

    const transportResult = await this.transport.send(payload, options.timeoutMs);

    return {
      width,
      height,
      threshold,
      feedLines,
      cut,
      payloadBytes: payload.length,
      ...transportResult
    };
  }

  _buildTransport(options) {
    if (!options.enabled) {
      return new NoopTransport({ reason: 'print_enabled=false' });
    }

    if (options.transport === 'raw_tcp') {
      return new RawTcpTransport({
        host: options.host,
        port: options.port
      });
    }

    if (options.transport === 'noop') {
      return new NoopTransport({ reason: 'transport=noop' });
    }

    throw new Error(`Unsupported transport: ${options.transport}`);
  }

  _pngToRaster(buffer, threshold) {
    const image = PNG.sync.read(buffer);
    const width = image.width;
    const height = image.height;

    if (width > this.paperWidthPx) {
      throw new Error(`Rendered width ${width}px exceeds configured paper width ${this.paperWidthPx}px`);
    }

    const widthBytes = Math.ceil(width / 8);
    const raster = Buffer.alloc(widthBytes * height, 0x00);

    for (let y = 0; y < height; y += 1) {
      for (let xByte = 0; xByte < widthBytes; xByte += 1) {
        let byte = 0x00;

        for (let bit = 0; bit < 8; bit += 1) {
          const x = xByte * 8 + bit;
          if (x >= width) {
            continue;
          }

          const index = (width * y + x) * 4;
          const r = image.data[index];
          const g = image.data[index + 1];
          const b = image.data[index + 2];
          const a = image.data[index + 3] / 255;

          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          const adjusted = 255 - (255 - luminance) * a;

          if (adjusted < threshold) {
            byte |= 0x80 >> bit;
          }
        }

        raster[y * widthBytes + xByte] = byte;
      }
    }

    return {
      width,
      height,
      widthBytes,
      rasterBytes: raster
    };
  }

  _buildEscPosPayload({ width, height, rasterBytes, feedLines, cut }) {
    const widthBytes = Math.ceil(width / 8);

    const init = Buffer.from([0x1b, 0x40]);
    const rasterHeader = Buffer.from([
      0x1d,
      0x76,
      0x30,
      0x00,
      widthBytes & 0xff,
      (widthBytes >> 8) & 0xff,
      height & 0xff,
      (height >> 8) & 0xff
    ]);

    const chunks = [init, rasterHeader, rasterBytes];

    if (feedLines > 0) {
      chunks.push(Buffer.from([0x1b, 0x64, feedLines]));
    }

    if (cut) {
      chunks.push(Buffer.from([0x1d, 0x56, 0x00]));
    }

    return Buffer.concat(chunks);
  }

  _resolveThreshold(value) {
    if (value === undefined || value === null || value === '') {
      return this.defaultThreshold;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return this.defaultThreshold;
    }

    return Math.max(1, Math.min(255, parsed));
  }

  _resolveFeedLines(value) {
    if (value === undefined || value === null || value === '') {
      return this.defaultFeedLines;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return this.defaultFeedLines;
    }

    return Math.max(0, Math.min(255, parsed));
  }
}

module.exports = PrinterService;
