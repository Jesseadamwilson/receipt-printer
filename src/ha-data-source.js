const { fetchHomeAssistantJson } = require('./ha-client');

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

function mapCalendarEvent(event) {
  const title = asString(
    event && (event.summary || event.title || event.message),
    ''
  );
  const location = asString(event && event.location, '');
  const startRaw = getEventStartRaw(event);
  const time = formatEventTime(startRaw);

  if (!title && !time && !location) {
    return null;
  }

  return {
    time,
    title: title || 'Calendar Event',
    location,
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
    location: event.location
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
  const level = parsePercentish(stateData.state);

  if (!level || normalizeStateValue(level) === 'unknown') {
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
