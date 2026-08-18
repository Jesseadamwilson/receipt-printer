'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('Ingress dashboard exposes persistent printers and structured job controls', () => {
  const html = read('public/settings.html');
  const script = read('public/settings.js');
  assert.match(html, /id="add-printer-btn"/);
  assert.match(html, /data-job-template="daily_agenda"/);
  assert.match(html, /data-job-template="message"/);
  assert.match(html, /data-entity-type="script"/);
  assert.match(html, /id="source-groups"/);
  assert.match(script, /fetchJson\('\/api\/printers', \{/);
  assert.match(script, /method: 'PUT'/);
  assert.match(script, /\/api\/entities\?type=/);
});

test('the packaged add-on contains the same dashboard and runtime sources', () => {
  for (const file of ['settings.html', 'settings.js', 'settings.css']) {
    assert.equal(read(`addon/app/public/${file}`), read(`public/${file}`));
  }
  for (const file of ['ha-client.js', 'index.js', 'printer-store.js', 'profile-store.js', 'server.js']) {
    assert.equal(read(`addon/app/src/${file}`), read(`src/${file}`));
  }
});
