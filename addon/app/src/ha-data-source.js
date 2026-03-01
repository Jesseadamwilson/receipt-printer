const { fetchHomeAssistantJson, callHomeAssistantService } = require('./ha-client');

function asString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  const result = String(value).trim();
  if (!result) {
    return fallback;
  }

  return result;
}

function warn(message) {
  // eslint-disable-next-line no-console
  console.warn(`[ha-data-source] ${message}`);
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function normalizeStateValue(value) {
  return asString(value, '').toLowerCase();
}

function shouldTreatAsMissingValue(value) {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === 'string' && !value.trim()) {
    return true;
  }

  return false;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = asString(value, '').toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseServiceList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item, '').replace(/\//g, '.'))
      .filter(Boolean);
  }

  const raw = asString(value, '');
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((item) => asString(item, '').replace(/\//g, '.'))
    .filter(Boolean);
}

function wait(ms) {
  const delayMs = Number(ms);
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function refreshHomeAssistantData(config, agendaInput = {}) {
  const source = agendaInput && typeof agendaInput === 'object' ? agendaInput : {};
  const refreshEnabled = parseBoolean(
    source.refreshBeforeFetch,
    parseBoolean(config.agendaPreRefreshEnabled, false)
  );

  if (!refreshEnabled) {
    return;
  }

  const services = parseServiceList(source.refreshServices);
  const configuredServices = services.length > 0
    ? services
    : parseServiceList(config.agendaPreRefreshServices);
  if (configuredServices.length === 0) {
    return;
  }

  const delayMs = Number.isFinite(Number(source.refreshDelayMs))
    ? Math.max(0, Number(source.refreshDelayMs))
    : Math.max(0, Number(config.agendaPreRefreshDelayMs) || 0);

  let successCount = 0;
  for (const serviceName of configuredServices) {
    try {
      await callHomeAssistantService(config, serviceName, {});
      successCount += 1;
    } catch (error) {
      warn(`refresh service failed for ${serviceName}: ${error.message}`);
    }
  }

  if (successCount > 0 && delayMs > 0) {
    await wait(delayMs);
  }
}

async function fetchState(config, entityId) {
  const cleanEntityId = asString(entityId, '');
  if (!cleanEntityId) {
    return null;
  }

  try {
    return await fetchHomeAssistantJson(config, `/states/${encodeURIComponent(cleanEntityId)}`);
  } catch (error) {
    warn(`state fetch failed for ${cleanEntityId}: ${error.message}`);
    return null;
  }
}

async function fetchCalendarEvents(config, entityId, startIso, endIso) {
  const cleanEntityId = asString(entityId, '');
  if (!cleanEntityId) {
    return [];
  }

  try {
    const endpoint = `/calendars/${encodeURIComponent(cleanEntityId)}?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
    const events = await fetchHomeAssistantJson(config, endpoint);
    return Array.isArray(events) ? events : [];
  } catch (error) {
    warn(`calendar fetch failed for ${cleanEntityId}: ${error.message}`);
    return [];
  }
}

function formatEventTime(value) {
  const raw = asString(value, '');
  if (!raw) {
    return '';
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
}

function getEventStartRaw(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }

  if (event.start && typeof event.start === 'object') {
    return asString(event.start.dateTime || event.start.date, '');
  }

  return asString(event.start, '');
}

function getEventEndRaw(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }

  if (event.end && typeof event.end === 'object') {
    return asString(event.end.dateTime || event.end.date, '');
  }

  return asString(event.end, '');
}

function mapCalendarEvent(event) {
  const title = asString(
    event && (event.summary || event.title || event.message),
    ''
  );
  const location = asString(event && event.location, '');
  const startRaw = getEventStartRaw(event);
  const endRaw = getEventEndRaw(event);
  const time = formatEventTime(startRaw);

  if (!title && !time && !location) {
    return null;
  }

  return {
    time,
    title: title || 'Calendar Event',
    location,
    start_iso: startRaw || '',
    end_iso: endRaw || '',
    _sortTime: startRaw || ''
  };
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const left = new Date(a._sortTime).getTime();
    const right = new Date(b._sortTime).getTime();

    if (Number.isNaN(left) && Number.isNaN(right)) {
      return 0;
    }
    if (Number.isNaN(left)) {
      return 1;
    }
    if (Number.isNaN(right)) {
      return -1;
    }

    return left - right;
  });
}

function removeSortMetadata(events) {
  return events.map((event) => ({
    time: event.time,
    title: event.title,
    location: event.location,
    start_iso: event.start_iso || '',
    end_iso: event.end_iso || ''
  }));
}

function parsePercentish(value) {
  const raw = asString(value, '');
  if (!raw) {
    return '';
  }

  if (raw.endsWith('%')) {
    return raw;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return `${Math.round(numeric)}%`;
  }

  return raw;
}

function mapBatteryStateToLine(stateData, entityId) {
  if (!stateData || typeof stateData !== 'object') {
    return null;
  }

  const name = asString(
    stateData.attributes && stateData.attributes.friendly_name,
    entityId
  );
  const attributes = stateData.attributes && typeof stateData.attributes === 'object'
    ? stateData.attributes
    : {};

  let level = parsePercentish(stateData.state);
  const normalizedLevel = normalizeStateValue(level);

  if (!level || normalizedLevel === 'unknown' || normalizedLevel === 'unavailable') {
    const fallbackCandidates = [
      attributes.battery_level,
      attributes.battery,
      attributes.level,
      attributes.charge,
      attributes.charge_level
    ];

    for (const candidate of fallbackCandidates) {
      const parsed = parsePercentish(candidate);
      if (!parsed) {
        continue;
      }

      const normalizedParsed = normalizeStateValue(parsed);
      if (normalizedParsed === 'unknown' || normalizedParsed === 'unavailable') {
        continue;
      }

      level = parsed;
      break;
    }
  }

  const normalizedFinal = normalizeStateValue(level);
  if (!level || normalizedFinal === 'unknown' || normalizedFinal === 'unavailable') {
    return null;
  }

  return {
    name,
    level
  };
}

function isAlertState(state) {
  const value = normalizeStateValue(state);
  if (!value) {
    return false;
  }

  return ![
    'off',
    'false',
    '0',
    'none',
    'ok',
    'clear',
    'idle',
    'normal',
    'home',
    'closed',
    'unavailable',
    'unknown'
  ].includes(value);
}

function mapAlertStateToMessage(stateData, entityId) {
  if (!stateData || typeof stateData !== 'object') {
    return '';
  }

  if (!isAlertState(stateData.state)) {
    return '';
  }

  const name = asString(
    stateData.attributes && stateData.attributes.friendly_name,
    entityId
  );
  const state = asString(stateData.state, '');

  if (!state) {
    return name;
  }

  return `${name}: ${state}`;
}

function buildCalendarWindow(config) {
  const now = new Date();
  const startIso = now.toISOString();

  const hours = Number(config.agendaTimeWindowHours);
  const windowHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  const endIso = new Date(now.getTime() + (windowHours * 60 * 60 * 1000)).toISOString();

  return {
    startIso,
    endIso
  };
}

async function hydrateDailyAgendaFromHomeAssistant(config, agendaInput = {}) {
  const input = agendaInput && typeof agendaInput === 'object' ? agendaInput : {};
  const source = asString(input.source, 'auto').toLowerCase();

  if (source === 'payload_only' || source === 'payload') {
    return input;
  }

  await refreshHomeAssistantData(config, input);

  const output = {
    ...input
  };

  if (
    shouldTreatAsMissingValue(output.weather) &&
    asString(config.agendaWeatherEntity, '')
  ) {
    const weatherState = await fetchState(config, config.agendaWeatherEntity);
    if (weatherState) {
      const temperature = asString(
        weatherState.attributes && weatherState.attributes.temperature,
        ''
      );
      const unit = asString(
        weatherState.attributes && weatherState.attributes.temperature_unit,
        ''
      );
      output.weather = {
        summary: asString(weatherState.state, ''),
        temp: `${temperature}${unit}`.trim()
      };
    }
  }

  if (
    shouldTreatAsMissingValue(output.sleep) &&
    asString(config.agendaSleepEntity, '')
  ) {
    const sleepState = await fetchState(config, config.agendaSleepEntity);
    if (sleepState) {
      output.sleep = {
        hours: asString(sleepState.state, '')
      };
    }
  }

  if (!hasNonEmptyArray(output.batteries) && Array.isArray(config.agendaBatteryEntities)) {
    const batteries = [];
    for (const entityId of config.agendaBatteryEntities) {
      const stateData = await fetchState(config, entityId);
      const mapped = mapBatteryStateToLine(stateData, entityId);
      if (mapped) {
        batteries.push(mapped);
      }
    }
    if (batteries.length > 0) {
      output.batteries = batteries;
    }
  }

  if (!hasNonEmptyArray(output.alerts) && Array.isArray(config.agendaAlertEntities)) {
    const alerts = [];
    for (const entityId of config.agendaAlertEntities) {
      const stateData = await fetchState(config, entityId);
      const alertLine = mapAlertStateToMessage(stateData, entityId);
      if (alertLine) {
        alerts.push(alertLine);
      }
    }
    if (alerts.length > 0) {
      output.alerts = alerts;
    }
  }

  if (
    shouldTreatAsMissingValue(output.notes) &&
    asString(config.agendaNotesEntity, '')
  ) {
    const notesState = await fetchState(config, config.agendaNotesEntity);
    if (notesState) {
      output.notes = asString(notesState.state, '');
    }
  }

  if (!hasNonEmptyArray(output.events) && Array.isArray(config.agendaCalendarEntities)) {
    const { startIso, endIso } = buildCalendarWindow(config);
    const events = [];

    for (const calendarEntity of config.agendaCalendarEntities) {
      const rawEvents = await fetchCalendarEvents(
        config,
        calendarEntity,
        startIso,
        endIso
      );

      for (const event of rawEvents) {
        const mapped = mapCalendarEvent(event);
        if (mapped) {
          events.push(mapped);
        }
      }
    }

    if (events.length > 0) {
      output.events = removeSortMetadata(sortEvents(events));
    }
  }

  return output;
}

module.exports = {
  hydrateDailyAgendaFromHomeAssistant
};
