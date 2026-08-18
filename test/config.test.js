'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePrinter, sanitizePrinters } = require('../src/config');

const legacyPrinter = {
  host: '10.0.0.25',
  port: 9100,
  language: 'star-prnt',
  model: '',
  cutMode: 'full',
  paperWidth: 576
};

test('structured printers keep independent endpoints and settings', () => {
  const printers = sanitizePrinters([
    {
      id: 'Kitchen Printer',
      name: 'Kitchen',
      host: '10.0.0.10',
      port: 9100,
      language: 'star-prnt',
      model: 'star-mc-print3',
      cut_mode: 'full',
      paper_width: 576
    },
    {
      id: 'office',
      name: 'Office',
      host: '10.0.0.11',
      port: 9200,
      language: 'esc-pos',
      cut_mode: 'partial',
      paper_width: 512
    }
  ], legacyPrinter);

  assert.equal(printers.length, 2);
  assert.equal(printers[0].id, 'kitchen_printer');
  assert.equal(printers[1].port, 9200);
  assert.equal(printers[1].language, 'esc-pos');
  assert.equal(printers[1].paperWidth, 512);
});

test('empty structured list preserves the legacy printer', () => {
  assert.deepEqual(sanitizePrinters([], legacyPrinter), [
    { id: 'default', name: 'Receipt Printer', ...legacyPrinter }
  ]);
});

test('printer selection rejects unknown explicit IDs', () => {
  const config = {
    printers: sanitizePrinters([
      { id: 'kitchen', host: '10.0.0.10', port: 9100 }
    ], legacyPrinter),
    defaultPrinterId: 'kitchen'
  };

  const selected = resolvePrinter(config, 'kitchen');
  assert.equal(selected.printerHost, '10.0.0.10');
  assert.equal(selected.printerId, 'kitchen');
  assert.throws(() => resolvePrinter(config, 'missing'), /Unknown printer: missing/);
});
