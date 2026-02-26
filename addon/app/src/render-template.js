const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
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

function getTemplateCandidates(config, templateType) {
  const normalizedType = asString(templateType, 'receipt').trim().toLowerCase();
  if (normalizedType === 'message') {
    const messageCandidates = Array.isArray(config.messageTemplatePaths)
      ? config.messageTemplatePaths
      : [];
    return messageCandidates;
  }

  if (normalizedType === 'daily-agenda' || normalizedType === 'daily_agenda') {
    const dailyCandidates = Array.isArray(config.dailyAgendaTemplatePaths)
      ? config.dailyAgendaTemplatePaths
      : [];
    return dailyCandidates;
  }

  return Array.isArray(config.templatePaths) && config.templatePaths.length > 0
    ? config.templatePaths
    : [config.templatePath].filter(Boolean);
}

function resolveTemplatePathByType(config, templateType, explicitPath = '') {
  const forcedPath = asString(explicitPath, '').trim();
  if (forcedPath) {
    const absoluteForcedPath = path.isAbsolute(forcedPath)
      ? forcedPath
      : path.resolve(process.cwd(), forcedPath);
    if (fs.existsSync(absoluteForcedPath)) {
      return absoluteForcedPath;
    }
  }

  const candidates = getTemplateCandidates(config, templateType);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Template not found for "${templateType || 'receipt'}". Checked: ${candidates.join(', ')}`
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

function injectTemplateBaseHref(templateHtml, templatePath) {
  if (templateHtml.includes('<base ')) {
    return templateHtml;
  }

  const templateDir = path.dirname(templatePath);
  const baseHref = pathToFileURL(`${templateDir}${path.sep}`).href;
  const baseTag = `<base href="${baseHref}">`;

  if (templateHtml.includes('<head>')) {
    return templateHtml.replace('<head>', `<head>\n    ${baseTag}`);
  }

  return `${baseTag}\n${templateHtml}`;
}

function inferMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    default:
      return '';
  }
}

function isExternalSrc(src) {
  const value = asString(src, '').trim().toLowerCase();
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:') ||
    value.startsWith('about:') ||
    value.startsWith('javascript:') ||
    value.startsWith('#')
  );
}

function stripQueryAndHash(value) {
  return asString(value, '')
    .replace(/[?#].*$/, '')
    .trim();
}

function uniquePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const candidate of paths) {
    const normalized = asString(candidate, '');
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function resolveImagePathCandidates(src, templatePath) {
  const clean = stripQueryAndHash(src);
  if (!clean) {
    return [];
  }

  const templateDir = path.dirname(templatePath);
  const candidates = [];

  if (clean.startsWith('file://')) {
    try {
      candidates.push(fileURLToPath(clean));
    } catch (_error) {
      // Ignore invalid file:// urls.
    }
  }

  if (path.isAbsolute(clean)) {
    candidates.push(clean);
  } else {
    candidates.push(path.resolve(templateDir, clean));
  }

  const normalized = clean.replace(/\\/g, '/');
  const publicIndex = normalized.indexOf('public/');
  if (publicIndex >= 0) {
    const suffix = normalized.slice(publicIndex + 'public/'.length);
    if (suffix) {
      candidates.push(path.join(process.cwd(), 'public', suffix));
    }
  }

  const assetsIndex = normalized.indexOf('assets/');
  if (assetsIndex >= 0) {
    const suffix = normalized.slice(assetsIndex + 'assets/'.length);
    if (suffix) {
      candidates.push(path.join(process.cwd(), 'public', 'assets', suffix));
    }
  }

  if (normalized.startsWith('/public/')) {
    candidates.push(path.join(process.cwd(), normalized.slice('/public/'.length)));
  }

  if (normalized.startsWith('assets/')) {
    candidates.push(path.join(process.cwd(), 'public', normalized));
  }

  return uniquePaths(candidates);
}

function findExistingImagePath(src, templatePath) {
  const candidates = resolveImagePathCandidates(src, templatePath);
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) {
        continue;
      }

      const stats = fs.statSync(candidate);
      if (stats.isFile()) {
        return candidate;
      }
    } catch (_error) {
      // Ignore inaccessible candidates.
    }
  }

  return '';
}

function toDataUri(filePath) {
  const mime = inferMimeType(filePath);
  if (!mime) {
    return '';
  }

  const bytes = fs.readFileSync(filePath);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function inlineLocalImageSrc(src, templatePath) {
  if (isExternalSrc(src)) {
    return src;
  }

  const imagePath = findExistingImagePath(src, templatePath);
  if (!imagePath) {
    return src;
  }

  const dataUri = toDataUri(imagePath);
  return dataUri || src;
}

function inlineTemplateImages(templateHtml, templatePath) {
  const imageSrcPattern = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi;
  return templateHtml.replace(imageSrcPattern, (full, prefix, quote, src) => {
    const inlinedSrc = inlineLocalImageSrc(src, templatePath);
    return `${prefix}${quote}${inlinedSrc}${quote}`;
  });
}

function flattenContext(value, map, prefix = '') {
  if (value === undefined) {
    return;
  }

  if (value === null) {
    map.set(prefix, '');
    return;
  }

  if (Array.isArray(value)) {
    const joined = value.map((item) => {
      if (item === undefined || item === null) {
        return '';
      }
      if (typeof item === 'object') {
        return JSON.stringify(item);
      }
      return String(item);
    }).join('\n');
    map.set(prefix, joined);

    value.forEach((item, index) => {
      flattenContext(item, map, prefix ? `${prefix}.${index}` : String(index));
    });
    return;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    for (const [key, nested] of entries) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenContext(nested, map, nextPrefix);
    }
    return;
  }

  map.set(prefix, String(value));
}

function buildTokenLookup(context) {
  const output = new Map();
  const source = context && typeof context === 'object' ? context : {};
  flattenContext(source, output, '');
  output.delete('');
  return output;
}

function isHtmlToken(token) {
  const normalized = asString(token, '').toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized.endsWith('_html');
}

function replaceTemplateTokens(templateHtml, context = {}) {
  const tokenLookup = buildTokenLookup(context);

  const renderedRaw = templateHtml.replace(/\{\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}\}/g, (match, tokenName) => {
    if (!tokenLookup.has(tokenName)) {
      return match;
    }

    return tokenLookup.get(tokenName);
  });

  return renderedRaw.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, tokenName) => {
    if (!tokenLookup.has(tokenName)) {
      return match;
    }

    const rawValue = tokenLookup.get(tokenName);
    if (isHtmlToken(tokenName)) {
      return rawValue;
    }

    return escapeHtml(rawValue);
  });
}

function buildRenderContext(data) {
  const source = data && typeof data === 'object' ? data : {};
  const lines = Array.isArray(source.lines) ? source.lines : [];
  const contentHtml = buildContentHtml(lines);
  const headerHtml = buildHeaderHtml(source);
  const footerHtml = buildFooterHtml(source);

  const defaults = {
    headline: asString(source.headline, ''),
    printedAt: asString(source.printedAt, ''),
    printed_at: asString(source.printedAt, ''),
    content_html: contentHtml,
    header_html: headerHtml,
    footer_html: footerHtml,
    lines_text: lines.join('\n'),
    lines_html: contentHtml
  };

  const context = source.templateContext && typeof source.templateContext === 'object'
    ? source.templateContext
    : {};

  return {
    ...defaults,
    ...source,
    ...context
  };
}

function renderTemplateString(templateHtml, data, customCss = '') {
  const renderContext = buildRenderContext(data);
  const rendered = replaceTemplateTokens(templateHtml, renderContext);

  return injectCustomCss(rendered, customCss);
}

async function renderTemplateToPng(config, data, options = {}) {
  const templatePath = resolveTemplatePathByType(
    config,
    options.templateType,
    options.templatePath
  );
  const templateHtml = fs.readFileSync(templatePath, 'utf8');
  const { css: customCss } = readCustomCss(config);
  const htmlWithInlineImages = inlineTemplateImages(templateHtml, templatePath);
  const htmlWithBase = injectTemplateBaseHref(htmlWithInlineImages, templatePath);
  const html = renderTemplateString(htmlWithBase, data, customCss);

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
  resolveTemplatePathByType,
  getTemplateCandidates,
  readCustomCss,
  resolveCustomCssPath
};
