'use strict';

(function bootstrap() {
  const state = {
    templates: [],
    itemTypes: [],
    store: {
      version: 1,
      updatedAt: '',
      defaultDailyAgendaProfileId: '',
      profiles: []
    },
    selectedProfileId: '',
    dirty: false,
    draggingItemId: '',
    entityCache: new Map(),
    entityTimers: new Map()
  };

  const ui = {};

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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createId(prefix) {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  function normalizePath(pathValue) {
    return pathValue.replace(/\/{2,}/g, '/');
  }

  function buildApiUrl(apiPath) {
    const pathname = window.location.pathname;
    let basePath = pathname.replace(/\/+$/, '');

    if (basePath.endsWith('/ui')) {
      basePath = basePath.slice(0, -3);
    }

    if (!basePath) {
      basePath = '/';
    }

    const prefix = basePath === '/' ? '' : basePath;
    return `${window.location.origin}${normalizePath(`${prefix}${apiPath}`)}`;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.toLowerCase().includes('application/json')) {
      const text = await response.text();
      throw new Error(`Expected JSON response, got: ${text.slice(0, 180)}`);
    }

    const payload = await response.json();
    if (!response.ok || (payload && payload.ok === false)) {
      const message = payload && payload.error ? payload.error : `Request failed (${response.status})`;
      throw new Error(message);
    }

    return payload;
  }

  function setStatus(message, kind = 'info') {
    ui.statusBar.textContent = message;
    ui.statusBar.dataset.kind = kind;
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    ui.saveBtn.disabled = !state.dirty;
  }

  function sanitizeItem(rawItem) {
    const source = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const fallbackType = state.itemTypes[0] || 'weather';
    const typeCandidate = asString(source.type, fallbackType).toLowerCase();
    const type = state.itemTypes.includes(typeCandidate) ? typeCandidate : fallbackType;

    return {
      id: asString(source.id, createId(type)),
      type,
      entity: asString(source.entity, ''),
      label: asString(source.label, ''),
      enabled: asBoolean(source.enabled, true)
    };
  }

  function sanitizeProfile(rawProfile) {
    const source = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
    const fallbackTemplate = state.templates[0] || 'daily_agenda';
    const templateCandidate = asString(source.template, fallbackTemplate).toLowerCase();
    const template = state.templates.includes(templateCandidate)
      ? templateCandidate
      : fallbackTemplate;

    return {
      id: asString(source.id, createId('profile')),
      name: asString(source.name, 'New Profile'),
      template,
      enabled: asBoolean(source.enabled, true),
      items: Array.isArray(source.items) ? source.items.map(sanitizeItem) : []
    };
  }

  function ensureStoreIntegrity() {
    if (!Array.isArray(state.store.profiles)) {
      state.store.profiles = [];
    }

    state.store.profiles = state.store.profiles.map(sanitizeProfile);

    if (state.store.profiles.length === 0) {
      const fallback = {
        id: 'daily_agenda_main',
        name: 'Daily Agenda',
        template: 'daily_agenda',
        enabled: true,
        items: []
      };
      state.store.profiles.push(sanitizeProfile(fallback));
    }

    if (!state.selectedProfileId || !findProfileById(state.selectedProfileId)) {
      state.selectedProfileId = state.store.profiles[0].id;
    }

    const dailyProfiles = state.store.profiles.filter((profile) => profile.template === 'daily_agenda');
    if (dailyProfiles.length === 0) {
      state.store.defaultDailyAgendaProfileId = '';
      return;
    }

    const currentDefault = asString(state.store.defaultDailyAgendaProfileId, '');
    const isValid = dailyProfiles.some((profile) => profile.id === currentDefault);
    if (!isValid) {
      state.store.defaultDailyAgendaProfileId = dailyProfiles[0].id;
    }
  }

  function findProfileById(profileId) {
    return state.store.profiles.find((profile) => profile.id === profileId) || null;
  }

  function getSelectedProfile() {
    return findProfileById(state.selectedProfileId);
  }

  function createEmptyProfile() {
    const fallbackTemplate = state.templates[0] || 'daily_agenda';
    return {
      id: createId('profile'),
      name: 'New Profile',
      template: fallbackTemplate,
      enabled: true,
      items: []
    };
  }

  function createEmptyItem() {
    const fallbackType = state.itemTypes[0] || 'weather';
    return {
      id: createId('item'),
      type: fallbackType,
      entity: '',
      label: '',
      enabled: true
    };
  }

  function renderProfileList() {
    if (state.store.profiles.length === 0) {
      ui.profileList.innerHTML = '<div class="empty-list">No profiles configured.</div>';
      return;
    }

    ui.profileList.innerHTML = state.store.profiles.map((profile) => {
      const selectedClass = profile.id === state.selectedProfileId ? 'is-selected' : '';
      return [
        `<div class="profile-row ${selectedClass}">`,
        `<button class="profile-select" data-action="select-profile" data-profile-id="${escapeHtml(profile.id)}">`,
        `<span class="profile-name">${escapeHtml(profile.name)}</span>`,
        `<span class="profile-meta">${escapeHtml(profile.template)}</span>`,
        '</button>',
        `<button class="btn btn-danger" data-action="remove-profile" data-profile-id="${escapeHtml(profile.id)}">Remove</button>`,
        '</div>'
      ].join('');
    }).join('');
  }

  function renderDefaultProfileSelect() {
    const dailyProfiles = state.store.profiles.filter((profile) => profile.template === 'daily_agenda');
    if (dailyProfiles.length === 0) {
      ui.defaultDailyProfile.innerHTML = '<option value="">No daily_agenda profile available</option>';
      ui.defaultDailyProfile.disabled = true;
      return;
    }

    ui.defaultDailyProfile.disabled = false;
    ui.defaultDailyProfile.innerHTML = dailyProfiles.map((profile) => {
      const selected = profile.id === state.store.defaultDailyAgendaProfileId ? ' selected' : '';
      return `<option value="${escapeHtml(profile.id)}"${selected}>${escapeHtml(profile.name)}</option>`;
    }).join('');
  }

  function renderItemRows(profile) {
    if (!profile || !Array.isArray(profile.items) || profile.items.length === 0) {
      ui.itemList.innerHTML = '<div class="empty-list">No data-source items configured.</div>';
      return;
    }

    ui.itemList.innerHTML = profile.items.map((item) => {
      const typeOptions = state.itemTypes.map((type) => {
        const selected = type === item.type ? ' selected' : '';
        return `<option value="${escapeHtml(type)}"${selected}>${escapeHtml(type)}</option>`;
      }).join('');
      const listId = `entities-${item.id}`;
      const checked = item.enabled ? ' checked' : '';

      return [
        `<div class="item-row" draggable="true" data-item-id="${escapeHtml(item.id)}">`,
        `<button class="drag-handle" title="Drag to reorder" type="button">::</button>`,
        `<select data-field="type" data-item-id="${escapeHtml(item.id)}">${typeOptions}</select>`,
        `<input type="text" data-field="entity" data-item-id="${escapeHtml(item.id)}" `,
        `value="${escapeHtml(item.entity)}" list="${escapeHtml(listId)}" placeholder="sensor.example_entity">`,
        `<datalist id="${escapeHtml(listId)}"></datalist>`,
        `<input type="text" data-field="label" data-item-id="${escapeHtml(item.id)}" `,
        `value="${escapeHtml(item.label)}" placeholder="Optional label override">`,
        '<label class="item-enabled">',
        `<input type="checkbox" data-field="enabled" data-item-id="${escapeHtml(item.id)}"${checked}>`,
        'Use',
        '</label>',
        `<button class="btn btn-danger" type="button" data-action="remove-item" data-item-id="${escapeHtml(item.id)}">Remove</button>`,
        '</div>'
      ].join('');
    }).join('');
  }

  function renderEditor() {
    const profile = getSelectedProfile();
    if (!profile) {
      ui.editor.hidden = true;
      ui.emptyState.hidden = false;
      return;
    }

    ui.editor.hidden = false;
    ui.emptyState.hidden = true;

    ui.profileName.value = profile.name;
    ui.profileTemplate.innerHTML = state.templates.map((template) => {
      const selected = template === profile.template ? ' selected' : '';
      return `<option value="${escapeHtml(template)}"${selected}>${escapeHtml(template)}</option>`;
    }).join('');
    ui.profileEnabled.checked = Boolean(profile.enabled);
    renderItemRows(profile);
  }

  function renderAll() {
    ensureStoreIntegrity();
    renderProfileList();
    renderDefaultProfileSelect();
    renderEditor();
    ui.saveBtn.disabled = !state.dirty;
  }

  function reorderItems(items, draggedId, targetId) {
    const sourceIndex = items.findIndex((item) => item.id === draggedId);
    const targetIndex = items.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return items;
    }

    const reordered = [...items];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    return reordered;
  }

  async function loadEntitySuggestions(type, query, limit = 80) {
    const normalizedType = asString(type, '').toLowerCase();
    const normalizedQuery = asString(query, '').toLowerCase();
    const cacheKey = `${normalizedType}|${normalizedQuery}|${limit}`;
    if (state.entityCache.has(cacheKey)) {
      return state.entityCache.get(cacheKey);
    }

    const url = new URL(buildApiUrl('/api/entities'));
    if (normalizedType) {
      url.searchParams.set('type', normalizedType);
    }
    if (normalizedQuery) {
      url.searchParams.set('q', normalizedQuery);
    }
    url.searchParams.set('limit', String(limit));

    const payload = await fetchJson(url.toString());
    const entities = Array.isArray(payload.entities) ? payload.entities : [];
    state.entityCache.set(cacheKey, entities);
    return entities;
  }

  function fillEntityDatalist(datalist, entities) {
    datalist.innerHTML = entities.map((entity) => {
      const name = asString(entity.friendly_name, entity.entity_id);
      return `<option value="${escapeHtml(entity.entity_id)}">${escapeHtml(name)}</option>`;
    }).join('');
  }

  function scheduleEntityLookup(input, itemType) {
    const itemId = asString(input.dataset.itemId, '');
    if (!itemId) {
      return;
    }

    const pending = state.entityTimers.get(itemId);
    if (pending) {
      clearTimeout(pending);
    }

    const timer = setTimeout(async () => {
      const datalistId = asString(input.getAttribute('list'), '');
      if (!datalistId) {
        return;
      }

      const datalist = document.getElementById(datalistId);
      if (!datalist) {
        return;
      }

      try {
        const entities = await loadEntitySuggestions(itemType, input.value, 80);
        fillEntityDatalist(datalist, entities);
      } catch (error) {
        setStatus(`Entity search failed: ${error.message}`, 'warning');
      }
    }, 200);

    state.entityTimers.set(itemId, timer);
  }

  async function refreshProfiles() {
    setStatus('Loading profiles...', 'info');
    const payload = await fetchJson(buildApiUrl('/api/profiles'));

    state.templates = Array.isArray(payload.templates) && payload.templates.length > 0
      ? payload.templates
      : ['daily_agenda', 'message', 'template'];
    state.itemTypes = Array.isArray(payload.itemTypes) && payload.itemTypes.length > 0
      ? payload.itemTypes
      : ['weather', 'sleep', 'calendar', 'battery', 'alert', 'notes'];
    state.store = {
      version: Number.isFinite(Number(payload.version)) ? Number(payload.version) : 1,
      updatedAt: asString(payload.updatedAt, ''),
      defaultDailyAgendaProfileId: asString(payload.defaultDailyAgendaProfileId, ''),
      profiles: Array.isArray(payload.profiles) ? payload.profiles : []
    };

    ensureStoreIntegrity();
    setDirty(false);
    setStatus(`Loaded ${state.store.profiles.length} profile(s).`, 'success');
    renderAll();
  }

  async function saveProfiles() {
    ensureStoreIntegrity();
    setStatus('Saving profiles...', 'info');

    const payload = await fetchJson(buildApiUrl('/api/profiles'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: state.store.version || 1,
        defaultDailyAgendaProfileId: state.store.defaultDailyAgendaProfileId,
        profiles: state.store.profiles
      })
    });

    state.store = {
      version: Number.isFinite(Number(payload.version)) ? Number(payload.version) : 1,
      updatedAt: asString(payload.updatedAt, ''),
      defaultDailyAgendaProfileId: asString(payload.defaultDailyAgendaProfileId, ''),
      profiles: Array.isArray(payload.profiles) ? payload.profiles : []
    };
    setDirty(false);
    setStatus('Profiles saved.', 'success');
    renderAll();
  }

  function onProfileListClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      return;
    }

    const profileId = asString(actionEl.dataset.profileId, '');
    if (!profileId) {
      return;
    }

    if (actionEl.dataset.action === 'select-profile') {
      state.selectedProfileId = profileId;
      renderAll();
      return;
    }

    if (actionEl.dataset.action === 'remove-profile') {
      const profile = findProfileById(profileId);
      if (!profile) {
        return;
      }

      const confirmed = window.confirm(`Remove profile "${profile.name}"?`);
      if (!confirmed) {
        return;
      }

      state.store.profiles = state.store.profiles.filter((entry) => entry.id !== profileId);
      if (state.selectedProfileId === profileId) {
        state.selectedProfileId = state.store.profiles.length > 0 ? state.store.profiles[0].id : '';
      }

      setDirty(true);
      renderAll();
    }
  }

  function onProfileFieldChanged(event) {
    const profile = getSelectedProfile();
    if (!profile) {
      return;
    }

    if (event.target === ui.profileName) {
      profile.name = asString(ui.profileName.value, profile.name);
      setDirty(true);
      renderProfileList();
      return;
    }

    if (event.target === ui.profileTemplate) {
      const previousTemplate = profile.template;
      profile.template = asString(ui.profileTemplate.value, 'daily_agenda');

      if (previousTemplate === 'daily_agenda' && profile.template !== 'daily_agenda') {
        if (state.store.defaultDailyAgendaProfileId === profile.id) {
          const nextDaily = state.store.profiles.find((entry) => entry.template === 'daily_agenda' && entry.id !== profile.id);
          state.store.defaultDailyAgendaProfileId = nextDaily ? nextDaily.id : '';
        }
      }

      if (profile.template === 'daily_agenda' && !state.store.defaultDailyAgendaProfileId) {
        state.store.defaultDailyAgendaProfileId = profile.id;
      }

      setDirty(true);
      renderAll();
      return;
    }

    if (event.target === ui.profileEnabled) {
      profile.enabled = Boolean(ui.profileEnabled.checked);
      setDirty(true);
      renderProfileList();
    }
  }

  function onAddProfile() {
    const profile = createEmptyProfile();
    state.store.profiles.push(profile);
    state.selectedProfileId = profile.id;

    if (profile.template === 'daily_agenda' && !state.store.defaultDailyAgendaProfileId) {
      state.store.defaultDailyAgendaProfileId = profile.id;
    }

    setDirty(true);
    renderAll();
  }

  function onDefaultDailyProfileChanged() {
    state.store.defaultDailyAgendaProfileId = asString(ui.defaultDailyProfile.value, '');
    setDirty(true);
    renderProfileList();
  }

  function onAddItem() {
    const profile = getSelectedProfile();
    if (!profile) {
      return;
    }

    profile.items.push(createEmptyItem());
    setDirty(true);
    renderItemRows(profile);
  }

  function updateItemField(itemId, fieldName, fieldValue) {
    const profile = getSelectedProfile();
    if (!profile) {
      return;
    }

    const item = profile.items.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }

    if (fieldName === 'enabled') {
      item.enabled = Boolean(fieldValue);
      return;
    }

    if (fieldName === 'type') {
      item.type = asString(fieldValue, item.type).toLowerCase();
      return;
    }

    if (fieldName === 'entity') {
      item.entity = asString(fieldValue, '');
      return;
    }

    if (fieldName === 'label') {
      item.label = asString(fieldValue, '');
    }
  }

  function onItemListClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      return;
    }

    if (actionEl.dataset.action !== 'remove-item') {
      return;
    }

    const profile = getSelectedProfile();
    if (!profile) {
      return;
    }

    const itemId = asString(actionEl.dataset.itemId, '');
    profile.items = profile.items.filter((item) => item.id !== itemId);
    setDirty(true);
    renderItemRows(profile);
  }

  function onItemListInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
      return;
    }

    const field = asString(target.dataset.field, '');
    const itemId = asString(target.dataset.itemId, '');
    if (!field || !itemId) {
      return;
    }

    if (field === 'enabled' && target instanceof HTMLInputElement && target.type === 'checkbox') {
      updateItemField(itemId, field, target.checked);
      setDirty(true);
      return;
    }

    updateItemField(itemId, field, target.value);
    setDirty(true);

    if (field === 'type') {
      const profile = getSelectedProfile();
      renderItemRows(profile);
      return;
    }

    if (field === 'entity' && target instanceof HTMLInputElement) {
      const profile = getSelectedProfile();
      const item = profile && profile.items.find((entry) => entry.id === itemId);
      scheduleEntityLookup(target, item ? item.type : '');
    }
  }

  function onItemListFocusIn(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (asString(target.dataset.field, '') !== 'entity') {
      return;
    }

    const profile = getSelectedProfile();
    if (!profile) {
      return;
    }

    const itemId = asString(target.dataset.itemId, '');
    const item = profile.items.find((entry) => entry.id === itemId);
    scheduleEntityLookup(target, item ? item.type : '');
  }

  function clearDragStyles() {
    ui.itemList.querySelectorAll('.item-row').forEach((row) => {
      row.classList.remove('is-dragging');
      row.classList.remove('is-drop-target');
    });
  }

  function onItemDragStart(event) {
    const row = event.target.closest('.item-row');
    if (!row) {
      return;
    }

    state.draggingItemId = asString(row.dataset.itemId, '');
    row.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.draggingItemId);
    }
  }

  function onItemDragOver(event) {
    const row = event.target.closest('.item-row');
    if (!row || !state.draggingItemId) {
      return;
    }

    event.preventDefault();
    const targetItemId = asString(row.dataset.itemId, '');
    if (targetItemId && targetItemId !== state.draggingItemId) {
      row.classList.add('is-drop-target');
    }
  }

  function onItemDragLeave(event) {
    const row = event.target.closest('.item-row');
    if (!row) {
      return;
    }
    row.classList.remove('is-drop-target');
  }

  function onItemDrop(event) {
    const row = event.target.closest('.item-row');
    if (!row || !state.draggingItemId) {
      return;
    }

    event.preventDefault();
    const targetItemId = asString(row.dataset.itemId, '');
    const profile = getSelectedProfile();
    if (!profile || !targetItemId || targetItemId === state.draggingItemId) {
      clearDragStyles();
      return;
    }

    profile.items = reorderItems(profile.items, state.draggingItemId, targetItemId);
    setDirty(true);
    clearDragStyles();
    renderItemRows(profile);
  }

  function onItemDragEnd() {
    state.draggingItemId = '';
    clearDragStyles();
  }

  function bindEvents() {
    ui.reloadBtn.addEventListener('click', async () => {
      try {
        await refreshProfiles();
      } catch (error) {
        setStatus(`Reload failed: ${error.message}`, 'error');
      }
    });

    ui.saveBtn.addEventListener('click', async () => {
      try {
        await saveProfiles();
      } catch (error) {
        setStatus(`Save failed: ${error.message}`, 'error');
      }
    });

    ui.addProfileBtn.addEventListener('click', onAddProfile);
    ui.profileList.addEventListener('click', onProfileListClick);
    ui.profileName.addEventListener('input', onProfileFieldChanged);
    ui.profileTemplate.addEventListener('change', onProfileFieldChanged);
    ui.profileEnabled.addEventListener('change', onProfileFieldChanged);
    ui.defaultDailyProfile.addEventListener('change', onDefaultDailyProfileChanged);
    ui.addItemBtn.addEventListener('click', onAddItem);

    ui.itemList.addEventListener('click', onItemListClick);
    ui.itemList.addEventListener('input', onItemListInput);
    ui.itemList.addEventListener('change', onItemListInput);
    ui.itemList.addEventListener('focusin', onItemListFocusIn);

    ui.itemList.addEventListener('dragstart', onItemDragStart);
    ui.itemList.addEventListener('dragover', onItemDragOver);
    ui.itemList.addEventListener('dragleave', onItemDragLeave);
    ui.itemList.addEventListener('drop', onItemDrop);
    ui.itemList.addEventListener('dragend', onItemDragEnd);
  }

  function cacheDom() {
    ui.profileList = document.getElementById('profile-list');
    ui.addProfileBtn = document.getElementById('add-profile-btn');
    ui.saveBtn = document.getElementById('save-btn');
    ui.reloadBtn = document.getElementById('reload-btn');
    ui.statusBar = document.getElementById('status-bar');
    ui.editor = document.getElementById('editor');
    ui.emptyState = document.getElementById('empty-state');
    ui.profileName = document.getElementById('profile-name');
    ui.profileTemplate = document.getElementById('profile-template');
    ui.profileEnabled = document.getElementById('profile-enabled');
    ui.defaultDailyProfile = document.getElementById('default-daily-profile');
    ui.addItemBtn = document.getElementById('add-item-btn');
    ui.itemList = document.getElementById('item-list');
  }

  async function init() {
    cacheDom();
    bindEvents();
    setDirty(false);

    try {
      await refreshProfiles();
    } catch (error) {
      setStatus(`Initial load failed: ${error.message}`, 'error');
    }
  }

  window.addEventListener('DOMContentLoaded', init);
}());
