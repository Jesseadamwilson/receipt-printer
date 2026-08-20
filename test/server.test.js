'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReceiptServer } = require('../src/server');

function createTestServer(capturedJobs) {
  const config = {
    publicDir: '',
    outputDir: '',
    printerCutMode: 'full',
    defaultPrinterId: 'kitchen',
    printers: [
      {
        id: 'kitchen',
        name: 'Kitchen',
        host: '10.0.0.10',
        port: 9100,
        language: 'star-prnt',
        model: '',
        cutMode: 'full',
        paperWidth: 576
      }
    ]
  };
  const profileData = {
    version: 1,
    defaultDailyAgendaProfileId: 'daily_agenda_main',
    profiles: [
      {
        id: 'daily_agenda_main',
        name: 'Daily Agenda',
        template: 'daily_agenda',
        enabled: true,
        printerId: 'kitchen',
        items: []
      },
      {
        id: 'message_main',
        name: 'Message',
        template: 'message',
        enabled: true,
        printerId: 'kitchen',
        messageHeader: 'FROM THE KITCHEN',
        messageSubject: 'Dinner is ready',
        messageImageName: 'dinner.heic',
        items: []
      }
    ]
  };

  return createReceiptServer({
    config,
    queue: {
      async enqueue(type, payload) {
        capturedJobs.push({ type, payload });
        return { id: 'job-test', type, status: 'completed' };
      },
      getStatus() {
        return {};
      },
      getJob() {
        return null;
      }
    },
    serviceMeta: { name: 'test', version: '1.0.0' },
    profileStore: {
      get() {
        return profileData;
      },
      save() {
        return profileData;
      },
      getStorePath() {
        return '/tmp/profiles.json';
      }
    },
    printerStore: {
      get() {
        return {
          version: 1,
          defaultPrinterId: config.defaultPrinterId,
          printers: config.printers
        };
      },
      save(nextStore) {
        config.printers = nextStore.printers;
        config.defaultPrinterId = nextStore.defaultPrinterId;
        return this.get();
      },
      getStorePath() {
        return '/tmp/printers.json';
      }
    },
    messageImageStore: {
      getPath(profileId) {
        return `/tmp/${profileId}.png`;
      },
      async save(input) {
        return {
          profileId: input.profileId,
          path: `/tmp/${input.profileId}.png`,
          name: input.fileName,
          mimeType: 'image/png'
        };
      },
      remove(profileId) {
        return { profileId, path: `/tmp/${profileId}.png`, removed: true };
      }
    },
    async listEntities() {
      return [];
    },
    async previewMessage() {
      return {};
    },
    async previewDailyAgenda() {
      return {};
    },
    readTemplateCss() {
      return { path: '', css: '' };
    },
    writeTemplateCss(css) {
      return { path: '', css };
    }
  });
}

test('printer and job metadata are exposed and print jobs retain printer ID', async (t) => {
  const capturedJobs = [];
  const server = createTestServer(capturedJobs);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const printers = await (await fetch(`${baseUrl}/api/printers`)).json();
  assert.equal(printers.defaultPrinterId, 'kitchen');
  assert.equal(printers.printers[0].host, '10.0.0.10');

  const jobs = await (await fetch(`${baseUrl}/api/jobs`)).json();
  assert.deepEqual(jobs.jobs.map((job) => job.type), ['daily_agenda', 'message']);
  assert.equal(Object.hasOwn(jobs.jobs[0], 'scriptEntity'), false);
  assert.equal(Object.hasOwn(jobs.jobs[1], 'scriptEntity'), false);
  assert.equal(jobs.jobs[1].messageHeader, 'FROM THE KITCHEN');
  assert.equal(jobs.jobs[1].messageSubject, 'Dinner is ready');
  assert.equal(jobs.jobs[1].messageImageName, 'dinner.heic');

  const uploadResponse = await fetch(`${baseUrl}/api/message-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId: 'message_main',
      fileName: 'new-photo.heic',
      mimeType: 'image/heic',
      dataUrl: 'data:image/heic;base64,AAAA'
    })
  });
  assert.equal(uploadResponse.status, 200);
  const uploaded = await uploadResponse.json();
  assert.equal(uploaded.image.name, 'new-photo.heic');

  const removeImageResponse = await fetch(`${baseUrl}/api/message-image/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: 'message_main' })
  });
  assert.equal(removeImageResponse.status, 200);

  const savePrintersResponse = await fetch(`${baseUrl}/api/printers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      defaultPrinterId: 'office',
      printers: [
        { id: 'kitchen', name: 'Kitchen', host: '10.0.0.10', port: 9100 },
        { id: 'office', name: 'Office', host: '10.0.0.20', port: 9100 }
      ]
    })
  });
  assert.equal(savePrintersResponse.status, 200);
  const savedPrinters = await savePrintersResponse.json();
  assert.equal(savedPrinters.defaultPrinterId, 'office');
  assert.equal(savedPrinters.printers[1].host, '10.0.0.20');

  const printResponse = await fetch(`${baseUrl}/print/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printerId: 'kitchen', message: 'Hello' })
  });
  assert.equal(printResponse.status, 200);
  assert.equal(capturedJobs[0].payload.printerId, 'kitchen');

  const agendaResponse = await fetch(`${baseUrl}/print/daily-agenda`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      printerId: 'kitchen',
      sourceConfig: {
        agendaWeatherEntity: 'weather.home',
        agendaSleepEntity: 'sensor.health_connect_sleep_duration',
        agendaCalendarEntities: ['calendar.family']
      }
    })
  });
  assert.equal(agendaResponse.status, 200);
  assert.deepEqual(capturedJobs[1].payload.sourceConfig, {
    agendaWeatherEntity: 'weather.home',
    agendaSleepEntity: 'sensor.health_connect_sleep_duration',
    agendaCalendarEntities: ['calendar.family']
  });

  const invalidResponse = await fetch(`${baseUrl}/print/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ printerId: 'missing', message: 'Hello' })
  });
  assert.equal(invalidResponse.status, 400);
});
