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
  console.warn(`[ha-client] ${message}`);
}

function sanitizeBaseUrl(value) {
  const base = asString(value, '').replace(/\/+$/, '');
  if (!base) {
    return '';
  }
  return base;
}

function buildHeaders(config) {
  const headers = {
    Accept: 'application/json'
  };

  const token = asString(config.haApiToken, '');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchHomeAssistantJson(config, endpoint) {
  const baseUrl = sanitizeBaseUrl(config.haApiBaseUrl);
  if (!baseUrl) {
    throw new Error('HA API base URL is empty');
  }

  const url = `${baseUrl}${endpoint}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(config)
  });

  if (!response.ok) {
    throw new Error(`HA API request failed (${response.status}) for ${endpoint}`);
  }

  return response.json();
}

function parseDomain(entityId) {
  const value = asString(entityId, '');
  const index = value.indexOf('.');
  if (index <= 0) {
    return '';
  }
  return value.slice(0, index);
}

function normalizeEntityState(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const entityId = asString(entry.entity_id, '');
  if (!entityId) {
    return null;
  }

  const attributes = entry.attributes && typeof entry.attributes === 'object'
    ? entry.attributes
    : {};

  const friendlyName = asString(attributes.friendly_name, entityId);
  const domain = parseDomain(entityId);

  return {
    entity_id: entityId,
    friendly_name: friendlyName,
    domain,
    state: asString(entry.state, ''),
    device_class: asString(attributes.device_class, ''),
    unit_of_measurement: asString(attributes.unit_of_measurement, '')
  };
}

function typeMatches(entity, type) {
  const normalizedType = asString(type, '').toLowerCase();
  if (!normalizedType) {
    return true;
  }

  const id = entity.entity_id.toLowerCase();
  const domain = entity.domain.toLowerCase();
  const deviceClass = entity.device_class.toLowerCase();

  switch (normalizedType) {
    case 'weather':
      return domain === 'weather';
    case 'calendar':
      return domain === 'calendar';
    case 'battery':
      return (
        deviceClass === 'battery' ||
        id.includes('battery') ||
        domain === 'sensor' ||
        domain === 'binary_sensor'
      );
    case 'sleep':
      return id.includes('sleep');
    case 'alert':
      return domain === 'alert' || domain === 'binary_sensor' || id.includes('alert');
    case 'notes':
      return domain === 'input_text' || domain === 'text' || id.includes('note');
    default:
      return true;
  }
}

function entitySearchMatches(entity, query) {
  const q = asString(query, '').toLowerCase();
  if (!q) {
    return true;
  }

  return (
    entity.entity_id.toLowerCase().includes(q) ||
    entity.friendly_name.toLowerCase().includes(q)
  );
}

async function listHomeAssistantEntities(config, options = {}) {
  const search = asString(options.search, '');
  const type = asString(options.type, '');
  const max = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(1000, Number(options.limit)))
    : 300;

  try {
    const states = await fetchHomeAssistantJson(config, '/states');
    const normalized = Array.isArray(states)
      ? states
        .map(normalizeEntityState)
        .filter(Boolean)
      : [];

    return normalized
      .filter((entity) => typeMatches(entity, type))
      .filter((entity) => entitySearchMatches(entity, search))
      .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name))
      .slice(0, max);
  } catch (error) {
    warn(`entity listing failed: ${error.message}`);
    return [];
  }
}

module.exports = {
  fetchHomeAssistantJson,
  listHomeAssistantEntities
};
