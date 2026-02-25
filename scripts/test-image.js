const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { encodeImageReceipt, sendToPrinter } = require('../src/printer-client');

async function main() {
  const config = loadConfig();
  const imagePath = path.resolve(config.outputDir, 'rendered.png');

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found at ${imagePath}. Run: npm run render`);
  }

  const payload = encodeImageReceipt(config, {
    imagePath,
    feedLines: 3,
    cut: true
  });

  const result = await sendToPrinter(config, payload);
  console.log(JSON.stringify({ ok: true, test: 'image', imagePath, ...result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, test: 'image', error: error.message }, null, 2));
  process.exit(1);
});
