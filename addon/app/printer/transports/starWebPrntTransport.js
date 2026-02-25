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

    const success = readXmlTag(responseText, 'success');
    if (success && success.toLowerCase() !== 'true') {
      const code = readXmlTag(responseText, 'code') || 'unknown';
      throw new Error(`StarWebPRNT failure code ${code}: ${compact(responseText)}`);
    }

    return {
      bytesSent: body.length,
      httpStatus: response.status,
      responseBytes: Buffer.byteLength(responseText),
      responsePreview: compact(responseText)
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

module.exports = StarWebPrntTransport;
