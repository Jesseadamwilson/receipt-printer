const fs = require('node:fs/promises');
const path = require('node:path');
const Handlebars = require('handlebars');
const { chromium } = require('playwright-core');

class RenderService {
  constructor(options) {
    this.paperWidthPx = options.paperWidthPx;
    this.templateDirs = options.templateDirs;
    this.chromiumPath = options.chromiumPath;
    this.timezone = options.timezone;
    this.browser = null;

    Handlebars.registerHelper('default', (value, fallback) => {
      if (value === null || value === undefined || value === '') {
        return fallback;
      }
      return value;
    });
  }

  async renderTemplate(templateName, data = {}) {
    const templateBody = await this._loadTemplateSource(templateName);
    const compile = Handlebars.compile(templateBody, { noEscape: true });
    const html = compile({
      ...data,
      paper_width_px: this.paperWidthPx,
      rendered_at: new Date().toISOString()
    });

    const browser = await this._getBrowser();

    let context;
    try {
      context = await browser.newContext({
        viewport: {
          width: this.paperWidthPx,
          height: 1000
        },
        timezoneId: this.timezone,
        deviceScaleFactor: 1
      });
    } catch (_error) {
      context = await browser.newContext({
        viewport: {
          width: this.paperWidthPx,
          height: 1000
        },
        deviceScaleFactor: 1
      });
    }

    const page = await context.newPage();

    await page.setContent(html, { waitUntil: 'networkidle' });

    const height = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      return Math.max(
        doc.scrollHeight,
        doc.offsetHeight,
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        1
      );
    });

    await page.setViewportSize({
      width: this.paperWidthPx,
      height: Math.ceil(height)
    });

    const png = await page.screenshot({
      type: 'png',
      fullPage: true,
      animations: 'disabled'
    });

    await context.close();

    return {
      png,
      width: this.paperWidthPx,
      height: Math.ceil(height)
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async _getBrowser() {
    if (!this.browser) {
      const options = {
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
      };

      if (this.chromiumPath) {
        options.executablePath = this.chromiumPath;
      }

      this.browser = await chromium.launch(options);
    }

    return this.browser;
  }

  async _loadTemplateSource(templateName) {
    const normalized = this._normalizeTemplateName(templateName);

    for (const dir of this.templateDirs) {
      const absolute = path.resolve(dir, normalized);

      try {
        return await fs.readFile(absolute, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    throw new Error(`Template not found: ${normalized}`);
  }

  _normalizeTemplateName(templateName) {
    const raw = `${templateName}`.trim();

    if (!raw) {
      throw new Error('Template name is required');
    }

    const sanitized = raw.endsWith('.html') ? raw : `${raw}.html`;

    if (!/^[a-zA-Z0-9_-]+\.html$/.test(sanitized)) {
      throw new Error('Invalid template name');
    }

    return sanitized;
  }
}

module.exports = RenderService;
