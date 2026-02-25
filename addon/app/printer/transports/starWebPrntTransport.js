class StarWebPrntTransport {
  constructor(options) {
    this.host = options.host;
    this.port = options.port || 80;
    this.path = options.path || '/StarWebPRNT/SendMessage';
    this.scheme = options.scheme || 'http';
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

    const body = new URLSearchParams({
      request: requestXml,
      devid: 'local_printer'
    }).toString();

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

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
        throw new Error(`StarWebPRNT request timed out after ${timeoutMs}ms`);
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
    if (success && success.toLowerCase() !== 'true') {
      const code = readXmlTag(inner, 'code') || 'unknown';
      throw new Error(`StarWebPRNT failure code ${code}: ${compact(inner)}`);
    }

    return {
      bytesSent: body.length,
      httpStatus: response.status,
      responseBytes: Buffer.byteLength(responseText),
      responsePreview: compact(inner)
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

module.exports = StarWebPrntTransport;
