const fs = require('node:fs');
const path = require('node:path');

const PROFILE_TEMPLATES = ['daily_agenda', 'message', 'template'];
const PROFILE_ITEM_TYPES = ['weather', 'sleep', 'calendar', 'battery', 'alert', 'notes'];
const DEFAULT_AGENDA_SECTION_ORDER = ['weather', 'sleep', 'events', 'battery', 'alerts', 'notes'];

const SECTION_BY_ITEM_TYPE = {
  weather: 'weather',
  sleep: 'sleep',
  calendar: 'events',
  battery: 'battery',
  alert: 'alerts',
  notes: 'notes'
};

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

function asRawString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value);
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return fallback;
}

function createId(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeItem(rawItem, fallbackType = 'weather') {
  const source = rawItem && typeof rawItem === 'object' ? rawItem : {};
  const typeCandidate = asString(source.type, fallbackType).toLowerCase();
  const type = PROFILE_ITEM_TYPES.includes(typeCandidate) ? typeCandidate : fallbackType;

  return {
    id: asString(source.id, createId(type)),
    type,
    entity: asString(source.entity, ''),
    label: asString(source.label, ''),
    enabled: asBoolean(source.enabled, true)
  };
}

function sanitizeProfile(rawProfile, fallbackTemplate = 'daily_agenda') {
  const source = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  const templateCandidate = asString(source.template, fallbackTemplate).toLowerCase();
  const template = PROFILE_TEMPLATES.includes(templateCandidate)
    ? templateCandidate
    : fallbackTemplate;

  const nameFallbackByTemplate = {
    daily_agenda: 'Daily Agenda',
    message: 'Message',
    template: 'Template Print'
  };

  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = rawItems.map((item) => sanitizeItem(item));

  const rawGanttDayStartTime = asString(source.ganttDayStartTime, '');
  const rawGanttDayEndTime = asString(source.ganttDayEndTime, '');

  return {
    id: asString(source.id, createId('profile')),
    name: asString(source.name, nameFallbackByTemplate[template]),
    template,
    enabled: asBoolean(source.enabled, true),
    items,
    messageBody: asRawString(source.messageBody, ''),
    ganttDayStartTime: rawGanttDayStartTime,
    ganttDayEndTime: rawGanttDayEndTime
  };
}

function buildDefaultDailyAgendaItems(config) {
  const items = [
    sanitizeItem({ type: 'weather', label: 'Weather', entity: '' }),
    sanitizeItem({ type: 'calendar', label: 'Calendar', entity: '' }),
    sanitizeItem({ type: 'battery', label: 'Battery', entity: '' })
  ];

  return sortItemsBySectionOrder(items, config.agendaSectionOrder || DEFAULT_AGENDA_SECTION_ORDER);
}

function sortItemsBySectionOrder(items, sectionOrder) {
  const order = Array.isArray(sectionOrder) ? sectionOrder : [];
  const weightBySection = new Map(order.map((section, index) => [String(section).toLowerCase(), index]));

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftSection = SECTION_BY_ITEM_TYPE[left.item.type] || '';
      const rightSection = SECTION_BY_ITEM_TYPE[right.item.type] || '';
      const leftWeight = weightBySection.has(leftSection) ? weightBySection.get(leftSection) : 999;
      const rightWeight = weightBySection.has(rightSection) ? weightBySection.get(rightSection) : 999;

      if (leftWeight !== rightWeight) {
        return leftWeight - rightWeight;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function buildDefaultProfiles(config) {
  const dailyAgendaProfileId = 'daily_agenda_main';

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    defaultDailyAgendaProfileId: dailyAgendaProfileId,
    profiles: [
      {
        id: dailyAgendaProfileId,
        name: 'Daily Agenda',
        template: 'daily_agenda',
        enabled: true,
        items: buildDefaultDailyAgendaItems(config),
        ganttDayStartTime: '06:00',
        ganttDayEndTime: '00:00'
      },
      {
        id: 'message_main',
        name: 'Message',
        template: 'message',
        enabled: true,
        items: [],
        messageBody: ''
      }
    ]
  };
}

function sanitizeStore(rawStore, config) {
  const source = rawStore && typeof rawStore === 'object' ? rawStore : {};
  const rawProfiles = Array.isArray(source.profiles) ? source.profiles : [];

  const profiles = rawProfiles
    .map((profile) => sanitizeProfile(profile))
    .filter((profile) => profile.id);

  if (profiles.length === 0) {
    return buildDefaultProfiles(config);
  }

  let defaultDailyAgendaProfileId = asString(source.defaultDailyAgendaProfileId, '');
  if (!defaultDailyAgendaProfileId) {
    const firstDaily = profiles.find((profile) => profile.template === 'daily_agenda');
    defaultDailyAgendaProfileId = firstDaily ? firstDaily.id : profiles[0].id;
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    defaultDailyAgendaProfileId,
    profiles
  };
}

function ensureStoreDirExists(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function deriveAgendaSourceConfigFromProfile(profile, fallbackConfig) {
  const emptyFallback = {
    agendaWeatherEntity: '',
    agendaSleepEntity: '',
    agendaCalendarEntities: [],
    agendaBatteryEntities: [],
    agendaAlertEntities: [],
    agendaNotesEntity: '',
    agendaGanttDayStartTime: '',
    agendaGanttDayEndTime: '',
    agendaSectionOrder: [...(fallbackConfig.agendaSectionOrder || DEFAULT_AGENDA_SECTION_ORDER)]
  };

  if (!profile || !Array.isArray(profile.items)) {
    return emptyFallback;
  }

  const enabledItems = profile.items.filter((item) => {
    return item && item.enabled && asString(item.entity, '');
  });

  const firstEntity = (type) => {
    const found = enabledItems.find((item) => item.type === type);
    return found ? found.entity : '';
  };

  const listEntities = (type) => {
    return enabledItems
      .filter((item) => item.type === type)
      .map((item) => item.entity);
  };

  const sectionOrder = [];
  for (const item of enabledItems) {
    const section = SECTION_BY_ITEM_TYPE[item.type];
    if (!section) {
      continue;
    }
    if (!sectionOrder.includes(section)) {
      sectionOrder.push(section);
    }
  }

  if (sectionOrder.length === 0) {
    sectionOrder.push(...(fallbackConfig.agendaSectionOrder || DEFAULT_AGENDA_SECTION_ORDER));
  }

  return {
    agendaWeatherEntity: firstEntity('weather'),
    agendaSleepEntity: firstEntity('sleep'),
    agendaCalendarEntities: listEntities('calendar'),
    agendaBatteryEntities: listEntities('battery'),
    agendaAlertEntities: listEntities('alert'),
    agendaNotesEntity: firstEntity('notes'),
    agendaGanttDayStartTime: asString(profile.ganttDayStartTime, ''),
    agendaGanttDayEndTime: asString(profile.ganttDayEndTime, ''),
    agendaSectionOrder: sectionOrder
  };
}

function createProfileStore(config) {
  const storePath = asString(
    config.profileStorePath,
    '/config/receipt-printer/profiles.json'
  );
  let store = null;

  const loadFromDisk = () => {
    try {
      if (!fs.existsSync(storePath)) {
        store = buildDefaultProfiles(config);
        ensureStoreDirExists(storePath);
        fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
        return;
      }

      const raw = fs.readFileSync(storePath, 'utf8');
      const parsed = JSON.parse(raw);
      store = sanitizeStore(parsed, config);
    } catch (_error) {
      store = buildDefaultProfiles(config);
    }
  };

  const persist = (nextStore) => {
    const sanitized = sanitizeStore(nextStore, config);
    ensureStoreDirExists(storePath);
    fs.writeFileSync(storePath, JSON.stringify(sanitized, null, 2), 'utf8');
    store = sanitized;
    return deepClone(store);
  };

  loadFromDisk();

  return {
    getStorePath() {
      return storePath;
    },
    get() {
      return deepClone(store);
    },
    save(nextStore) {
      return persist(nextStore);
    },
    getProfileById(profileId) {
      const id = asString(profileId, '');
      if (!id) {
        return null;
      }
      return store.profiles.find((profile) => profile.id === id) || null;
    },
    getDefaultDailyAgendaProfile() {
      const byDefaultId = store.profiles.find((profile) => {
        return profile.id === store.defaultDailyAgendaProfileId && profile.template === 'daily_agenda';
      });
      if (byDefaultId) {
        return byDefaultId;
      }

      const firstDaily = store.profiles.find((profile) => profile.template === 'daily_agenda');
      if (firstDaily) {
        return firstDaily;
      }

      return store.profiles[0] || null;
    },
    getDefaultMessageProfile() {
      const firstMessage = store.profiles.find((profile) => profile.template === 'message');
      if (firstMessage) {
        return firstMessage;
      }

      return store.profiles[0] || null;
    }
  };
}

module.exports = {
  PROFILE_ITEM_TYPES,
  PROFILE_TEMPLATES,
  createProfileStore,
  deriveAgendaSourceConfigFromProfile
};
