'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProfileStore } = require('../src/profile-store');

test('job printer, script, and message entity assignments persist', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-profiles-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = {
    profileStorePath: path.join(directory, 'profiles.json'),
    defaultPrinterId: 'kitchen',
    agendaSectionOrder: ['weather', 'sleep', 'events', 'battery', 'alerts', 'notes']
  };
  const store = createProfileStore(config);
  const initial = store.get();
  const daily = initial.profiles.find((profile) => profile.template === 'daily_agenda');
  const message = initial.profiles.find((profile) => profile.template === 'message');
  daily.printerId = 'office';
  daily.scriptEntity = 'script.prepare_agenda';
  message.printerId = 'office';
  message.scriptEntity = 'script.prepare_message';
  message.messageEntity = 'input_text.receipt_message';

  store.save(initial);
  const restarted = createProfileStore(config).get();
  const savedDaily = restarted.profiles.find((profile) => profile.template === 'daily_agenda');
  const savedMessage = restarted.profiles.find((profile) => profile.template === 'message');
  assert.equal(savedDaily.printerId, 'office');
  assert.equal(savedDaily.scriptEntity, 'script.prepare_agenda');
  assert.equal(savedMessage.printerId, 'office');
  assert.equal(savedMessage.scriptEntity, 'script.prepare_message');
  assert.equal(savedMessage.messageEntity, 'input_text.receipt_message');
});
