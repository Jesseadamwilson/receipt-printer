const { loadConfig } = require('../src/config');
const { renderTemplateToPng } = require('../src/render-template');
const { encodeImageReceipt, sendToPrinter } = require('../src/printer-client');

async function main() {
  const config = loadConfig();

  const imagePath = await renderTemplateToPng(config, {
    headline: 'Render + Print Test',
    lines: [
      `Language: ${config.printerLanguage}`,
      `Printer: ${config.printerHost}:${config.printerPort}`,
      'This was rendered to PNG then printed over raw TCP socket.'
    ],
    printedAt: new Date().toLocaleString()
  });

  const payload = encodeImageReceipt(config, {
    imagePath,
    feedLines: 3,
    cut: true
  });

  const result = await sendToPrinter(config, payload);
  console.log(JSON.stringify({ ok: true, test: 'render+print', imagePath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, test: 'render+print', error: error.message }, null, 2));
  process.exit(1);
});
