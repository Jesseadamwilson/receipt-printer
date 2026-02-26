const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

function asString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  const result = String(value);
  return result;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildContentHtml(lines) {
  return lines.map((line) => `<p class="line">${escapeHtml(line)}</p>`).join('\n');
}

function buildHeaderHtml(data) {
  if (data && data.showHeader === false) {
    return '';
  }

  const headline = escapeHtml(data && data.headline ? data.headline : '');
  return `<header class="header"><h1>${headline}</h1></header>`;
}

function buildFooterHtml(data) {
  if (data && data.showFooter === false) {
    return '';
  }

  const printedAt = escapeHtml(data && data.printedAt ? data.printedAt : '');
  const label = printedAt ? `Printed: ${printedAt}` : '';
  return `<footer class="footer">${label}</footer>`;
}

function resolveTemplatePath(config) {
  const candidates = Array.isArray(config.templatePaths) && config.templatePaths.length > 0
    ? config.templatePaths
    : [config.templatePath].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Template not found. Checked: ${candidates.join(', ')}`
  );
}

function resolveCustomCssPath(config) {
  const configured = asString(config.customCssPath, '').trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  const fallback = path.resolve(process.cwd(), 'templates', 'custom.css');
  return fallback;
}

function readCustomCss(config) {
  const cssPath = resolveCustomCssPath(config);
  if (!fs.existsSync(cssPath)) {
    return {
      path: cssPath,
      css: ''
    };
  }

  return {
    path: cssPath,
    css: fs.readFileSync(cssPath, 'utf8')
  };
}

function injectCustomCss(templateHtml, customCss) {
  const css = asString(customCss, '').trim();
  if (!css) {
    return templateHtml.replace('{{custom_css_block}}', '');
  }

  const block = `<style id="receipt-custom-css">\n${css}\n</style>`;

  if (templateHtml.includes('{{custom_css_block}}')) {
    return templateHtml.replace('{{custom_css_block}}', block);
  }

  if (templateHtml.includes('</head>')) {
    return templateHtml.replace('</head>', `${block}\n</head>`);
  }

  return `${block}\n${templateHtml}`;
}

function renderTemplateString(templateHtml, data, customCss = '') {
  const map = {
    headline: escapeHtml(data.headline || ''),
    content_html: buildContentHtml(Array.isArray(data.lines) ? data.lines : []),
    printedAt: escapeHtml(data.printedAt || ''),
    header_html: buildHeaderHtml(data),
    footer_html: buildFooterHtml(data)
  };

  const rendered = templateHtml
    .replace('{{header_html}}', map.header_html)
    .replace('{{headline}}', map.headline)
    .replace('{{content_html}}', map.content_html)
    .replace('{{printedAt}}', map.printedAt)
    .replace('{{footer_html}}', map.footer_html);

  return injectCustomCss(rendered, customCss);
}

async function renderTemplateToPng(config, data, options = {}) {
  const templatePath = resolveTemplatePath(config);
  const templateHtml = fs.readFileSync(templatePath, 'utf8');
  const { css: customCss } = readCustomCss(config);
  const html = renderTemplateString(templateHtml, data, customCss);

  if (!config.chromiumPath) {
    throw new Error('Chromium path not found. Set CHROMIUM_PATH in .env');
  }

  fs.mkdirSync(config.outputDir, { recursive: true });
  const requestedOutput = asString(options.outputPath, '').trim();
  const outputPath = requestedOutput
    ? (path.isAbsolute(requestedOutput) ? requestedOutput : path.resolve(process.cwd(), requestedOutput))
    : path.join(config.outputDir, 'rendered.png');

  const browser = await chromium.launch({
    executablePath: config.chromiumPath,
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox']
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: config.paperWidth,
        height: 1600
      }
    });

    await page.setContent(html, { waitUntil: 'networkidle' });

    const body = await page.$('body');
    if (!body) {
      throw new Error('Template render failed: body not found');
    }

    await body.screenshot({
      path: outputPath,
      type: 'png'
    });

    return outputPath;
  } finally {
    await browser.close();
  }
}

module.exports = {
  renderTemplateToPng,
  renderTemplateString,
  resolveTemplatePath,
  readCustomCss,
  resolveCustomCssPath
};
