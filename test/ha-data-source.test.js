'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapSleepStateToDuration } = require('../src/ha-data-source');
const { buildDailyAgendaTemplateData } = require('../src/daily-agenda');

test('Health Connect sleep duration minutes are converted to hours and minutes', () => {
  const result = mapSleepStateToDuration({
    state: '453',
    attributes: { unit_of_measurement: 'min' }
  }, 'sensor.pixel_health_connect_sleep_duration');

  assert.deepEqual(result, {
    hours: '7:33',
    minutes: 453,
    sourceUnit: 'min'
  });
});

test('Health Connect entity IDs imply minutes when the unit is absent', () => {
  const result = mapSleepStateToDuration({
    state: '480',
    attributes: {}
  }, 'sensor.phone_health_connect_sleep_duration');

  assert.equal(result.hours, '8:00');
  assert.equal(result.minutes, 480);
});

test('unknown sleep readings are ignored instead of printed', () => {
  assert.equal(mapSleepStateToDuration({ state: 'unknown' }), null);
  assert.equal(mapSleepStateToDuration({ state: 'unavailable' }), null);
});

test('a recorded duration remains printable across repeated agenda builds', () => {
  const input = {
    sleep: { hours: '7:33' },
    include: { sleep: true }
  };
  const first = buildDailyAgendaTemplateData(input);
  const second = buildDailyAgendaTemplateData(input);

  assert.match(first.lines.join('\n'), /7h 33m last night/);
  assert.match(second.lines.join('\n'), /7h 33m last night/);
  assert.doesNotMatch(second.lines.join('\n'), /Not Recorded/i);
});
