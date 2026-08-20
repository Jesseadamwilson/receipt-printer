'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProfileStore } = require('../src/profile-store');

test('job printer and structured message content persist without script hooks', (t) => {
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
  message.printerId = 'office';
  message.messageHeader = 'FROM JESSE';
  message.messageSubject = 'Dinner is ready';
  message.messageBody = 'Come to the kitchen.';
  message.messageImagePath = '/config/receipt-printer/uploads/message_main.png';
  message.messageImageName = 'dinner.heic';

  store.save(initial);
  const restarted = createProfileStore(config).get();
  const savedDaily = restarted.profiles.find((profile) => profile.template === 'daily_agenda');
  const savedMessage = restarted.profiles.find((profile) => profile.template === 'message');
  assert.equal(savedDaily.printerId, 'office');
  assert.equal(savedMessage.printerId, 'office');
  assert.equal(savedMessage.messageHeader, 'FROM JESSE');
  assert.equal(savedMessage.messageSubject, 'Dinner is ready');
  assert.equal(savedMessage.messageBody, 'Come to the kitchen.');
  assert.equal(savedMessage.messageImagePath, '/config/receipt-printer/uploads/message_main.png');
  assert.equal(savedMessage.messageImageName, 'dinner.heic');
  assert.equal(Object.hasOwn(savedDaily, 'scriptEntity'), false);
  assert.equal(Object.hasOwn(savedMessage, 'scriptEntity'), false);
});
