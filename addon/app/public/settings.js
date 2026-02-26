'use strict';

(function bootstrap() {
  const state = {
    store: {
      version: 1,
      updatedAt: '',
      defaultDailyAgendaProfileId: '',
      profiles: []
    },
    itemTypes: ['weather', 'sleep', 'calendar', 'battery', 'alert', 'notes'],
    dailyProfileId: '',
    messageProfileId: '',
    customCss: '',
    dirty: false,
    previewUrl: ''
  };

  const ui = {};
  const THEME_VARIABLES = [
    '--primary-background-color',
    '--secondary-background-color',
    '--card-background-color',
    '--ha-card-background',
    '--primary-text-color',
    '--secondary-text-color',
    '--text-primary-color',
    '--divider-color',
    '--primary-color',
    '--error-color',
    '--ha-card-border-radius',
    '--ha-card-box-shadow',
    '--input-fill-color',
    '--input-outlined-idle-border-color',
    '--input-outlined-border-color',
    '--ha-text-field-border-radius'
  ];

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

  async function fetchImageBlob(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Preview failed (${response.status})`);
    }

    return response.blob();
  }

  function setStatus(message, kind = 'info') {
    ui.statusBar.textContent = message;
    ui.statusBar.dataset.kind = kind;
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    ui.saveBtn.disabled = !state.dirty;
  }

  function parseColorChannels(value) {
    const raw = asRawString(value, '').trim();
    if (!raw) {
      return null;
    }

    const rgbMatch = raw.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (rgbMatch) {
      return [
        Math.max(0, Math.min(255, Number(rgbMatch[1]))),
        Math.max(0, Math.min(255, Number(rgbMatch[2]))),
        Math.max(0, Math.min(255, Number(rgbMatch[3])))
      ];
    }

    const hexMatch = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      if (hex.length === 3) {
        return [
          Number.parseInt(`${hex[0]}${hex[0]}`, 16),
          Number.parseInt(`${hex[1]}${hex[1]}`, 16),
          Number.parseInt(`${hex[2]}${hex[2]}`, 16)
        ];
      }

      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16)
      ];
    }

    return null;
  }

  function calculateLuminance(channels) {
    if (!Array.isArray(channels) || channels.length < 3) {
      return null;
    }

    const transform = (channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };

    const [r, g, b] = channels;
    return (0.2126 * transform(r)) + (0.7152 * transform(g)) + (0.0722 * transform(b));
  }

  function detectDarkFromColors(backgroundColor, textColor) {
    const bgLuminance = calculateLuminance(parseColorChannels(backgroundColor));
    const textLuminance = calculateLuminance(parseColorChannels(textColor));

    if (!Number.isFinite(bgLuminance) || !Number.isFinite(textLuminance)) {
      return null;
    }

    return bgLuminance < textLuminance;
  }

  function buildThemeSources(sourceWindow) {
    const sources = [];
    const doc = sourceWindow.document;
    if (!doc) {
      return sources;
    }

    if (doc.documentElement) {
      sources.push(doc.documentElement);
    }
    if (doc.body) {
      sources.push(doc.body);
    }

    const haRoot = doc.querySelector('home-assistant');
    if (haRoot) {
      sources.push(haRoot);
    }

    return sources;
  }

  function applyFallbackThemeMode(sourceWindow) {
    const win = sourceWindow || window;
    const prefersDark = Boolean(
      win.matchMedia &&
      win.matchMedia('(prefers-color-scheme: dark)').matches
    );
    document.documentElement.dataset.rpTheme = prefersDark ? 'dark' : 'light';
  }

  function syncThemeVariablesFromParent(sourceWindow) {
    const sources = buildThemeSources(sourceWindow);
    if (sources.length === 0) {
      applyFallbackThemeMode(sourceWindow);
      return;
    }

    const themeValues = {};
    for (const variable of THEME_VARIABLES) {
      for (const source of sources) {
        const value = sourceWindow.getComputedStyle(source).getPropertyValue(variable).trim();
        if (value) {
          themeValues[variable] = value;
          break;
        }
      }
    }

    const rootStyle = document.documentElement.style;
    Object.entries(themeValues).forEach(([name, value]) => {
      rootStyle.setProperty(name, value);
    });

    const isDark = detectDarkFromColors(
      themeValues['--primary-background-color'] || '',
      themeValues['--primary-text-color'] || ''
    );

    if (isDark === null) {
      applyFallbackThemeMode(sourceWindow);
      return;
    }

    document.documentElement.dataset.rpTheme = isDark ? 'dark' : 'light';
  }

  function setupThemeSync() {
    const parentWindow = window.parent && window.parent !== window ? window.parent : null;
    if (!parentWindow) {
      applyFallbackThemeMode(window);
      return;
    }

    try {
      const syncTheme = () => syncThemeVariablesFromParent(parentWindow);
      syncTheme();

      const observer = new MutationObserver(syncTheme);
      const doc = parentWindow.document;
      if (doc.documentElement) {
        observer.observe(doc.documentElement, { attributes: true, childList: false, subtree: false });
      }
      if (doc.body) {
        observer.observe(doc.body, { attributes: true, childList: true, subtree: true });
      }

      if (parentWindow.matchMedia) {
        const media = parentWindow.matchMedia('(prefers-color-scheme: dark)');
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', syncTheme);
        } else if (typeof media.addListener === 'function') {
          media.addListener(syncTheme);
        }
      }

      window.addEventListener('focus', syncTheme);
      setInterval(syncTheme, 3000);
    } catch (_error) {
      applyFallbackThemeMode(parentWindow);
    }
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

  function createDailyProfile() {
    return {
      id: createId('daily'),
      name: 'Daily Agenda',
      template: 'daily_agenda',
      enabled: true,
      items: []
    };
  }

  function createMessageProfile() {
    return {
      id: createId('message'),
      name: 'Message',
      template: 'message',
      enabled: true,
      items: [],
      messageBody: ''
    };
  }

  function ensureSimpleProfiles() {
    if (!Array.isArray(state.store.profiles)) {
      state.store.profiles = [];
    }

    state.store.profiles = state.store.profiles.map((profile) => ({
      ...profile,
      items: Array.isArray(profile.items) ? profile.items.map(sanitizeItem) : [],
      messageBody: asRawString(profile.messageBody, '')
    }));

    let dailyProfile = null;
    const byDefault = state.store.profiles.find((profile) => {
      return profile.id === state.store.defaultDailyAgendaProfileId && profile.template === 'daily_agenda';
    });
    if (byDefault) {
      dailyProfile = byDefault;
    }

    if (!dailyProfile) {
      dailyProfile = state.store.profiles.find((profile) => profile.template === 'daily_agenda') || null;
    }

    if (!dailyProfile) {
      dailyProfile = createDailyProfile();
      state.store.profiles.push(dailyProfile);
    }

    state.store.defaultDailyAgendaProfileId = dailyProfile.id;
    state.dailyProfileId = dailyProfile.id;

    let messageProfile = state.store.profiles.find((profile) => profile.template === 'message') || null;
    if (!messageProfile) {
      messageProfile = createMessageProfile();
      state.store.profiles.push(messageProfile);
    }

    if (!Object.prototype.hasOwnProperty.call(messageProfile, 'messageBody')) {
      messageProfile.messageBody = '';
    }

    state.messageProfileId = messageProfile.id;
  }

  function getDailyProfile() {
    return state.store.profiles.find((profile) => profile.id === state.dailyProfileId) || null;
  }

  function getMessageProfile() {
    return state.store.profiles.find((profile) => profile.id === state.messageProfileId) || null;
  }

  function createEmptyItem() {
    return {
      id: createId('item'),
      type: state.itemTypes[0] || 'weather',
      entity: '',
      label: '',
      enabled: true
    };
  }

  function renderDailyRows() {
    const dailyProfile = getDailyProfile();
    if (!dailyProfile || !Array.isArray(dailyProfile.items) || dailyProfile.items.length === 0) {
      ui.itemList.innerHTML = '<div class="item-empty">No agenda rows configured.</div>';
      return;
    }

    ui.itemList.innerHTML = dailyProfile.items.map((item, index) => {
      const typeOptions = state.itemTypes.map((type) => {
        const selected = type === item.type ? ' selected' : '';
        return `<option value="${escapeHtml(type)}"${selected}>${escapeHtml(type)}</option>`;
      }).join('');
      const checked = item.enabled ? ' checked' : '';

      return [
        `<div class="item-row" data-item-id="${escapeHtml(item.id)}">`,
        `<select data-field="type" data-item-id="${escapeHtml(item.id)}">${typeOptions}</select>`,
        `<input type="text" data-field="entity" data-item-id="${escapeHtml(item.id)}" value="${escapeHtml(item.entity)}" placeholder="entity_id (example: weather.ksgf)">`,
        `<input type="text" data-field="label" data-item-id="${escapeHtml(item.id)}" value="${escapeHtml(item.label)}" placeholder="Optional label">`,
        '<label class="item-enabled">',
        `<input type="checkbox" data-field="enabled" data-item-id="${escapeHtml(item.id)}"${checked}>`,
        'Use',
        '</label>',
        '<div class="row-actions">',
        `<button class="btn" data-action="move-up" data-item-id="${escapeHtml(item.id)}" ${index === 0 ? 'disabled' : ''}>↑</button>`,
        `<button class="btn" data-action="move-down" data-item-id="${escapeHtml(item.id)}" ${index === dailyProfile.items.length - 1 ? 'disabled' : ''}>↓</button>`,
        `<button class="btn btn-danger" data-action="remove-item" data-item-id="${escapeHtml(item.id)}">Remove</button>`,
        '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function renderMessageSection() {
    const messageProfile = getMessageProfile();
    if (!messageProfile) {
      ui.messageHeadline.value = '';
      ui.messageBody.value = '';
      return;
    }

    ui.messageHeadline.value = asString(messageProfile.name, 'Message');
    ui.messageBody.value = asRawString(messageProfile.messageBody, '');
  }

  function renderAll() {
    ensureSimpleProfiles();
    renderDailyRows();
    renderMessageSection();
    ui.customCss.value = asRawString(state.customCss, '');
    ui.saveBtn.disabled = !state.dirty;
  }

  function moveItem(items, itemId, direction) {
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return items;
    }

    const target = index + direction;
    if (target < 0 || target >= items.length) {
      return items;
    }

    const reordered = [...items];
    const [item] = reordered.splice(index, 1);
    reordered.splice(target, 0, item);
    return reordered;
  }

  function showPreview(blob) {
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = '';
    }

    const url = URL.createObjectURL(blob);
    state.previewUrl = url;
    ui.previewImage.src = url;
    ui.previewImage.hidden = false;
    ui.previewEmpty.hidden = true;
  }

  async function previewDailyAgenda() {
    const dailyProfile = getDailyProfile();
    if (!dailyProfile) {
      throw new Error('No daily agenda profile configured');
    }

    const blob = await fetchImageBlob(buildApiUrl('/preview/daily-agenda'), {
      profileId: dailyProfile.id,
      title: 'Daily Agenda Preview',
      subtitle: 'Today',
      source: 'auto'
    });
    showPreview(blob);
  }

  async function previewMessage() {
    const messageProfile = getMessageProfile();
    if (!messageProfile) {
      throw new Error('No message profile configured');
    }

    const blob = await fetchImageBlob(buildApiUrl('/preview/message'), {
      profileId: messageProfile.id
    });
    showPreview(blob);
  }

  async function saveIfDirty() {
    if (!state.dirty) {
      return;
    }

    await saveSettings();
  }

  async function printDailyAgenda() {
    const dailyProfile = getDailyProfile();
    if (!dailyProfile) {
      throw new Error('No daily agenda profile configured');
    }

    await saveIfDirty();
    const response = await fetchJson(buildApiUrl('/print/daily-agenda'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        profileId: dailyProfile.id,
        title: 'Daily Agenda',
        subtitle: 'Today',
        source: 'auto',
        print: {
          feedLines: 3,
          cut: true
        }
      })
    });

    const jobId = response && response.job && response.job.id ? response.job.id : 'unknown-job';
    setStatus(`Daily agenda sent to printer (${jobId}).`, 'success');
  }

  async function printMessage() {
    const messageProfile = getMessageProfile();
    if (!messageProfile) {
      throw new Error('No message profile configured');
    }

    await saveIfDirty();
    const response = await fetchJson(buildApiUrl('/print/message'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        profileId: messageProfile.id,
        print: {
          feedLines: 3,
          cut: true
        }
      })
    });

    const jobId = response && response.job && response.job.id ? response.job.id : 'unknown-job';
    setStatus(`Message sent to printer (${jobId}).`, 'success');
  }

  async function loadSettings() {
    setStatus('Loading settings...', 'info');

    const [profilesPayload, cssPayload] = await Promise.all([
      fetchJson(buildApiUrl('/api/profiles')),
      fetchJson(buildApiUrl('/template/css'))
    ]);

    state.itemTypes = Array.isArray(profilesPayload.itemTypes) && profilesPayload.itemTypes.length > 0
      ? profilesPayload.itemTypes
      : ['weather', 'sleep', 'calendar', 'battery', 'alert', 'notes'];

    state.store = {
      version: Number.isFinite(Number(profilesPayload.version)) ? Number(profilesPayload.version) : 1,
      updatedAt: asString(profilesPayload.updatedAt, ''),
      defaultDailyAgendaProfileId: asString(profilesPayload.defaultDailyAgendaProfileId, ''),
      profiles: Array.isArray(profilesPayload.profiles) ? profilesPayload.profiles : []
    };

    state.customCss = asRawString(cssPayload.css, '');
    ensureSimpleProfiles();
    setDirty(false);
    renderAll();
    setStatus('Settings loaded.', 'success');
  }

  async function saveSettings() {
    ensureSimpleProfiles();
    setStatus('Saving settings...', 'info');

    await fetchJson(buildApiUrl('/api/profiles'), {
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

    const cssValue = asRawString(ui.customCss.value, '');
    state.customCss = cssValue;
    await fetchJson(buildApiUrl('/template/css'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        css: cssValue
      })
    });

    setDirty(false);
    setStatus('Settings saved.', 'success');
  }

  function onAddItem() {
    const dailyProfile = getDailyProfile();
    if (!dailyProfile) {
      return;
    }

    dailyProfile.items.push(createEmptyItem());
    setDirty(true);
    renderDailyRows();
  }

  function onItemListInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
      return;
    }

    const itemId = asString(target.dataset.itemId, '');
    const field = asString(target.dataset.field, '');
    if (!itemId || !field) {
      return;
    }

    const dailyProfile = getDailyProfile();
    if (!dailyProfile) {
      return;
    }

    const item = dailyProfile.items.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }

    if (field === 'enabled' && target instanceof HTMLInputElement && target.type === 'checkbox') {
      item.enabled = target.checked;
    } else if (field === 'type') {
      item.type = asString(target.value, item.type).toLowerCase();
    } else if (field === 'entity') {
      item.entity = asString(target.value, '');
    } else if (field === 'label') {
      item.label = asString(target.value, '');
    }

    setDirty(true);
  }

  function onItemListClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) {
      return;
    }

    const itemId = asString(actionEl.dataset.itemId, '');
    if (!itemId) {
      return;
    }

    const dailyProfile = getDailyProfile();
    if (!dailyProfile) {
      return;
    }

    const action = asString(actionEl.dataset.action, '');
    if (action === 'remove-item') {
      dailyProfile.items = dailyProfile.items.filter((item) => item.id !== itemId);
      setDirty(true);
      renderDailyRows();
      return;
    }

    if (action === 'move-up') {
      dailyProfile.items = moveItem(dailyProfile.items, itemId, -1);
      setDirty(true);
      renderDailyRows();
      return;
    }

    if (action === 'move-down') {
      dailyProfile.items = moveItem(dailyProfile.items, itemId, 1);
      setDirty(true);
      renderDailyRows();
    }
  }

  function onMessageInput() {
    const messageProfile = getMessageProfile();
    if (!messageProfile) {
      return;
    }

    messageProfile.name = asString(ui.messageHeadline.value, 'Message');
    messageProfile.messageBody = asRawString(ui.messageBody.value, '');
    setDirty(true);
  }

  function onCustomCssInput() {
    state.customCss = asRawString(ui.customCss.value, '');
    setDirty(true);
  }

  function cacheDom() {
    ui.reloadBtn = document.getElementById('reload-btn');
    ui.saveBtn = document.getElementById('save-btn');
    ui.addItemBtn = document.getElementById('add-item-btn');
    ui.itemList = document.getElementById('item-list');
    ui.messageHeadline = document.getElementById('message-headline');
    ui.messageBody = document.getElementById('message-body');
    ui.customCss = document.getElementById('custom-css');
    ui.previewDailyBtn = document.getElementById('preview-daily-btn');
    ui.printDailyBtn = document.getElementById('print-daily-btn');
    ui.previewMessageBtn = document.getElementById('preview-message-btn');
    ui.printMessageBtn = document.getElementById('print-message-btn');
    ui.previewImage = document.getElementById('preview-image');
    ui.previewEmpty = document.getElementById('preview-empty');
    ui.statusBar = document.getElementById('status-bar');
  }

  function bindEvents() {
    ui.reloadBtn.addEventListener('click', async () => {
      try {
        await loadSettings();
      } catch (error) {
        setStatus(`Reload failed: ${error.message}`, 'error');
      }
    });

    ui.saveBtn.addEventListener('click', async () => {
      try {
        await saveSettings();
      } catch (error) {
        setStatus(`Save failed: ${error.message}`, 'error');
      }
    });

    ui.addItemBtn.addEventListener('click', onAddItem);
    ui.itemList.addEventListener('input', onItemListInput);
    ui.itemList.addEventListener('change', onItemListInput);
    ui.itemList.addEventListener('click', onItemListClick);

    ui.messageHeadline.addEventListener('input', onMessageInput);
    ui.messageBody.addEventListener('input', onMessageInput);
    ui.customCss.addEventListener('input', onCustomCssInput);

    ui.previewDailyBtn.addEventListener('click', async () => {
      try {
        setStatus('Generating daily agenda preview...', 'info');
        await previewDailyAgenda();
        setStatus('Daily agenda preview updated.', 'success');
      } catch (error) {
        setStatus(`Preview failed: ${error.message}`, 'error');
      }
    });

    ui.previewMessageBtn.addEventListener('click', async () => {
      try {
        setStatus('Generating message preview...', 'info');
        await previewMessage();
        setStatus('Message preview updated.', 'success');
      } catch (error) {
        setStatus(`Preview failed: ${error.message}`, 'error');
      }
    });

    ui.printDailyBtn.addEventListener('click', async () => {
      try {
        setStatus('Sending daily agenda to printer...', 'info');
        await printDailyAgenda();
      } catch (error) {
        setStatus(`Print failed: ${error.message}`, 'error');
      }
    });

    ui.printMessageBtn.addEventListener('click', async () => {
      try {
        setStatus('Sending message to printer...', 'info');
        await printMessage();
      } catch (error) {
        setStatus(`Print failed: ${error.message}`, 'error');
      }
    });
  }

  async function init() {
    cacheDom();
    setupThemeSync();
    bindEvents();
    setDirty(false);

    try {
      await loadSettings();
    } catch (error) {
      setStatus(`Initial load failed: ${error.message}`, 'error');
    }
  }

  window.addEventListener('DOMContentLoaded', init);
}());
