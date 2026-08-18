'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPrinterStore } = require('../src/printer-store');

function createConfig(directory) {
  return {
    profileStorePath: path.join(directory, 'profiles.json'),
    defaultPrinterId: 'kitchen',
    printers: [{
      id: 'kitchen', name: 'Kitchen', host: '10.0.0.10', port: 9100,
      language: 'star-prnt', model: '', cutMode: 'full', paperWidth: 576
    }],
    printerHost: '10.0.0.10', printerPort: 9100, printerLanguage: 'star-prnt',
    printerModel: '', printerCutMode: 'full', paperWidth: 576
  };
}

test('printer additions persist and restore the live runtime configuration', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-printers-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = createConfig(directory);
  const store = createPrinterStore(config);

  store.save({
    defaultPrinterId: 'office',
    printers: [
      config.printers[0],
      { id: 'office', name: 'Office', host: '10.0.0.20', port: 9200, language: 'esc-pos', cutMode: 'partial', paperWidth: 384 }
    ]
  });

  assert.equal(config.defaultPrinterId, 'office');
  assert.equal(config.printerHost, '10.0.0.20');
  assert.equal(config.printers.length, 2);

  const restartedConfig = createConfig(directory);
  const restartedStore = createPrinterStore(restartedConfig);
  assert.equal(restartedStore.get().printers.length, 2);
  assert.equal(restartedConfig.defaultPrinterId, 'office');
  assert.equal(restartedConfig.printerPort, 9200);
});

test('printer store rejects deleting every printer', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-printers-empty-'));
  const store = createPrinterStore(createConfig(directory));
  assert.throws(() => store.save({ printers: [] }), /At least one valid printer/);
  fs.rmSync(directory, { recursive: true, force: true });
});
