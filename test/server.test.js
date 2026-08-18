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
        items: []
      },
      {
        id: 'message_main',
        name: 'Message',
        template: 'message',
        enabled: true,
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
