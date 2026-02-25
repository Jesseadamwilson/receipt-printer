const { loadConfig } = require('../src/config');
const { encodeTextReceipt, sendToPrinter } = require('../src/printer-client');

async function main() {
  const config = loadConfig();

  const payload = encodeTextReceipt(config, {
    headline: 'Socket Text Test',
    lines: [
      `Language: ${config.printerLanguage}`,
      `Model: ${config.printerModel}`,
      `Host: ${config.printerHost}:${config.printerPort}`,
      'This is the first baseline print test.'
    ],
    footer: new Date().toLocaleString(),
    feedLines: 3,
    cut: true
  });

  const result = await sendToPrinter(config, payload);
  console.log(JSON.stringify({ ok: true, test: 'text', ...result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, test: 'text', error: error.message }, null, 2));
  process.exit(1);
});
