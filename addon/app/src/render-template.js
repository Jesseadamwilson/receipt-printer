const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

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

function renderTemplateString(templateHtml, data) {
  const map = {
    headline: escapeHtml(data.headline || ''),
    content_html: buildContentHtml(Array.isArray(data.lines) ? data.lines : []),
    printedAt: escapeHtml(data.printedAt || ''),
    header_html: buildHeaderHtml(data),
    footer_html: buildFooterHtml(data)
  };

  return templateHtml
    .replace('{{header_html}}', map.header_html)
    .replace('{{headline}}', map.headline)
    .replace('{{content_html}}', map.content_html)
    .replace('{{printedAt}}', map.printedAt)
    .replace('{{footer_html}}', map.footer_html);
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

async function renderTemplateToPng(config, data) {
  const templatePath = resolveTemplatePath(config);
  const templateHtml = fs.readFileSync(templatePath, 'utf8');
  const html = renderTemplateString(templateHtml, data);

  if (!config.chromiumPath) {
    throw new Error('Chromium path not found. Set CHROMIUM_PATH in .env');
  }

  fs.mkdirSync(config.outputDir, { recursive: true });
  const outputPath = path.join(config.outputDir, 'rendered.png');

  const browser = await chromium.launch({
    executablePath: config.chromiumPath,
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox']
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: config.paperWidth,
        height: 1400
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
  renderTemplateToPng
};
