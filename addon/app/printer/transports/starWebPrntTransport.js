class StarWebPrntTransport {
  constructor(options) {
    this.host = options.host;
    this.port = options.port || 80;
    this.path = options.path || '/StarWebPRNT/SendMessage';
    this.scheme = options.scheme || 'http';
    this.deviceId = options.deviceId || 'local_printer';
    this.paperType = options.paperType || 'normal';
    this.holdPrintTimeoutMs = normalizePositiveInt(options.holdPrintTimeoutMs, 10_000);
  }

  async send(requestXml, timeoutMs = 15_000) {
    if (!this.host) {
      throw new Error('Printer host is required for star_webprnt transport');
    }

    if (this.port === 9100 || this.port === 9101) {
      throw new Error(
        `star_webprnt transport cannot use raw print port ${this.port}. Set printer_port to 80 (http) or 443 (https).`
      );
    }

    if (!requestXml || typeof requestXml !== 'string') {
      throw new Error('StarWebPRNT request XML must be a string');
    }

    const url = `${this.scheme}://${this.host}:${this.port}${this.path}`;

    const messageTimeout = normalizePositiveInt(timeoutMs, 15_000);
    const form = new URLSearchParams({
      request: requestXml,
      devid: this.deviceId,
      timeout: String(messageTimeout),
      holdprint_timeout: String(this.holdPrintTimeoutMs),
      status: 'true',
      drawerstatus: 'true',
      responseformat: 'xml',
      papertype: this.paperType,
      blackmark_type: 'invalid',
      blackmark_sensor: 'front_side',
      retrieval: 'invalid',
      compulsion_switch: 'invalid',
      command: 'invalid',
      secure: 'invalid',
      media: 'invalid',
      deflation: 'invalid',
      led: 'invalid',
      batch: 'invalid',
      textparser: 'invalid'
    });
    const body = form.toString();

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), messageTimeout + 2_000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body,
        signal: abortController.signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`StarWebPRNT request timed out after ${messageTimeout}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`StarWebPRNT HTTP ${response.status}: ${compact(responseText)}`);
    }

    const inner = decodeXmlEntities(readXmlTag(responseText, 'Response')) || responseText;

    const success = readXmlTag(inner, 'success');
    const code = readXmlTag(inner, 'code') || '';
    const statusHex = readXmlTag(inner, 'status') || '';
    const drawerStatusHex = readXmlTag(inner, 'drawerstatus') || '';
    const decodedStatus = decodeStatus(statusHex, drawerStatusHex);
    if (success && success.toLowerCase() !== 'true') {
      throw new Error(`StarWebPRNT failure code ${code || 'unknown'}: ${compact(inner)}`);
    }

    return {
      bytesSent: body.length,
      httpStatus: response.status,
      responseBytes: Buffer.byteLength(responseText),
      responsePreview: compact(inner),
      traderSuccess: success || '',
      traderCode: code || '',
      traderStatus: statusHex || '',
      traderDrawerStatus: drawerStatusHex || '',
      statusFlags: decodedStatus
    };
  }
}

function readXmlTag(xml, tagName) {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = String(xml).match(pattern);
  return match ? match[1].trim() : '';
}

function compact(value) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 300);
}

function decodeXmlEntities(value) {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function decodeStatus(statusHex, drawerStatusHex) {
  const status = String(statusHex || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (!status) {
    return {
      available: false
    };
  }

  const readByte = (byteIndex) => {
    const offset = byteIndex * 2;
    if (status.length < offset + 2) {
      return 0;
    }

    const chunk = status.slice(offset, offset + 2);
    const parsed = Number.parseInt(chunk, 16);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const offline = readByte(0);
  const etbAvailable = readByte(4);
  const etbCounter = readByte(5);
  const presenterState = readByte(6);
  const presenterState2 = readByte(7);
  const presenterState3 = readByte(8);
  const etbCounter2 = readByte(9);
  const presenterState4 = readByte(10);

  const drawer = String(drawerStatusHex || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  const drawerByte = drawer.length >= 2 ? Number.parseInt(drawer.slice(0, 2), 16) : 0;
  const drawerBits = Number.isFinite(drawerByte) ? drawerByte : 0;

  return {
    available: true,
    raw: status,
    isOffLine: (offline & 0x08) === 0x08,
    isCoverOpen: (offline & 0x20) === 0x20,
    isPaperEmpty: (etbAvailable & 0x08) === 0x08,
    isErrorOccured: (etbAvailable & 0x40) === 0x40,
    isCompulsionSwitchClose: (etbCounter & 0x04) === 0x04,
    isEtbCounterError: (etbCounter & 0x40) === 0x40,
    isBlackMarkError: (etbCounter & 0x20) === 0x20,
    isPaperPresent: (presenterState & 0x02) === 0x02,
    isPaperNearEnd: (presenterState & 0x04) === 0x04,
    isPaperJamError: (presenterState & 0x08) === 0x08,
    isHeadUpError: (presenterState & 0x10) === 0x10,
    isVoltageError: (presenterState & 0x20) === 0x20,
    isReceiptBlackMarkDetectionError: (presenterState & 0x40) === 0x40,
    isPageModeCommandError: (presenterState & 0x80) === 0x80,
    isPresenterPaperPresent: (presenterState2 & 0x02) === 0x02,
    isPresenterPaperJamError: (presenterState2 & 0x04) === 0x04,
    isSlipTOFError: (presenterState2 & 0x08) === 0x08,
    isSlipCOFError: (presenterState2 & 0x10) === 0x10,
    isSlipBOFError: (presenterState2 & 0x20) === 0x20,
    isSlipPaperPresent: (presenterState2 & 0x40) === 0x40,
    isValidationPaperPresent: (presenterState2 & 0x80) === 0x80,
    isThermalHeadOverheating: (presenterState3 & 0x04) === 0x04,
    isMotorOverheating: (presenterState3 & 0x08) === 0x08,
    isCutterError: (presenterState3 & 0x10) === 0x10,
    isPresenterPaperPullOutError: (presenterState3 & 0x20) === 0x20,
    isThermistorError: (presenterState3 & 0x40) === 0x40,
    isCpuOverheating: (presenterState3 & 0x80) === 0x80,
    isVoltageWarning: (etbCounter2 & 0x08) === 0x08,
    isHighVoltageExternalCircuitError: (etbCounter2 & 0x10) === 0x10,
    isRecoveryWaitingTimeError: (etbCounter2 & 0x20) === 0x20,
    isWaitingforPrint: (etbCounter2 & 0x40) === 0x40,
    isWaitingforOnline: (etbCounter2 & 0x80) === 0x80,
    isWaitingforPaperPresent: (presenterState4 & 0x02) === 0x02,
    isDrawerOpen: (drawerBits & 0x04) === 0x04,
    isDrawerClose: (drawerBits & 0x08) === 0x08
  };
}

module.exports = StarWebPrntTransport;
