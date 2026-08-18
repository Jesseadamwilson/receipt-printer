'use strict';

(function bootstrap() {
  const SOURCE_TYPES = [
    { type: 'weather', name: 'Weather', icon: '☁', description: 'Current conditions and forecast', multiple: false },
    { type: 'sleep', name: 'Sleep', icon: '☾', description: 'Health Connect sleep duration', multiple: false },
    { type: 'calendar', name: 'Calendars', icon: '▣', description: 'Events for the agenda timeline', multiple: true },
    { type: 'battery', name: 'Batteries', icon: '▰', description: 'Device battery levels', multiple: true },
    { type: 'alert', name: 'Alerts', icon: '!', description: 'Active alerts and binary sensors', multiple: true },
    { type: 'notes', name: 'Notes', icon: '≡', description: 'Text or input_text notes', multiple: false }
  ];

  const THEME_VARIABLES = [
    '--primary-background-color', '--secondary-background-color', '--card-background-color',
    '--ha-card-background', '--primary-text-color', '--secondary-text-color',
    '--text-primary-color', '--divider-color', '--primary-color', '--error-color',
    '--ha-card-border-radius', '--ha-card-box-shadow', '--input-fill-color',
    '--input-outlined-idle-border-color', '--input-outlined-border-color'
  ];

  const state = {
    store: { version: 1, defaultDailyAgendaProfileId: '', profiles: [] },
    printers: [],
    defaultPrinterId: '',
    customCss: '',
    dirty: false,
    previewUrl: '',
    searchTimers: new Map()
  };
  const ui = {};

  function asString(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    const result = String(value).trim();
    return result || fallback;
  }

  function asRawString(value, fallback = '') {
    return value === undefined || value === null ? fallback : String(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function createId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function normalizePrinterId(value) {
    return asString(value, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function normalizePath(value) {
    return value.replace(/\/{2,}/g, '/');
  }

  function buildApiUrl(apiPath) {
    let basePath = window.location.pathname.replace(/\/+$/, '');
    if (basePath.endsWith('/ui')) basePath = basePath.slice(0, -3);
    const prefix = !basePath || basePath === '/' ? '' : basePath;
    return `${window.location.origin}${normalizePath(`${prefix}${apiPath}`)}`;
  }

  async function fetchJson(apiPath, options = {}) {
    const response = await fetch(buildApiUrl(apiPath), options);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Expected JSON but received ${response.status}`);
    }
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `Request failed (${response.status})`);
    }
    return payload;
  }

  async function fetchPreview(apiPath, body) {
    const response = await fetch(buildApiUrl(apiPath), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      let message = `Preview failed (${response.status})`;
      try {
        const payload = await response.json();
        message = payload.error || message;
      } catch (_error) {}
      throw new Error(message);
    }
    return response.blob();
  }

  function setStatus(message, kind = 'info') {
    ui.statusBar.textContent = message;
    ui.statusBar.dataset.kind = kind;
  }

  function setDirty(value = true) {
    state.dirty = Boolean(value);
    ui.saveBtn.disabled = !state.dirty;
    document.body.dataset.dirty = state.dirty ? 'true' : 'false';
  }

  function getProfile(template) {
    return state.store.profiles.find((profile) => profile.template === template) || null;
  }

  function ensureProfiles() {
    if (!Array.isArray(state.store.profiles)) state.store.profiles = [];
    let daily = getProfile('daily_agenda');
    if (!daily) {
      daily = { id: 'daily_agenda_main', name: 'Daily Agenda', template: 'daily_agenda', enabled: true, printerId: state.defaultPrinterId, scriptEntity: '', items: [], ganttDayStartTime: '06:00', ganttDayEndTime: '00:00' };
      state.store.profiles.push(daily);
    }
    daily.items = Array.isArray(daily.items) ? daily.items : [];
    daily.printerId = state.printers.some((printer) => printer.id === daily.printerId) ? daily.printerId : state.defaultPrinterId;
    daily.scriptEntity = asString(daily.scriptEntity, '');
    if (!Object.prototype.hasOwnProperty.call(daily, 'ganttDayStartTime')) daily.ganttDayStartTime = '06:00';
    if (!Object.prototype.hasOwnProperty.call(daily, 'ganttDayEndTime')) daily.ganttDayEndTime = '00:00';
    state.store.defaultDailyAgendaProfileId = daily.id;

    let message = getProfile('message');
    if (!message) {
      message = { id: 'message_main', name: 'Send Message', template: 'message', enabled: true, printerId: state.defaultPrinterId, scriptEntity: '', messageEntity: '', messageBody: '', items: [] };
      state.store.profiles.push(message);
    }
    message.items = Array.isArray(message.items) ? message.items : [];
    message.printerId = state.printers.some((printer) => printer.id === message.printerId) ? message.printerId : state.defaultPrinterId;
    message.scriptEntity = asString(message.scriptEntity, '');
    message.messageEntity = asString(message.messageEntity, '');
    message.messageBody = asRawString(message.messageBody, '');
  }

  function printerOptions(selectedId) {
    return state.printers.map((printer) => {
      const selected = printer.id === selectedId ? ' selected' : '';
      return `<option value="${escapeHtml(printer.id)}"${selected}>${escapeHtml(printer.name)} · ${escapeHtml(printer.host)}:${printer.port}</option>`;
    }).join('');
  }

  function renderPrinters() {
    ui.printerCount.textContent = String(state.printers.length);
    ui.printerList.innerHTML = state.printers.map((printer, index) => {
      const isDefault = printer.id === state.defaultPrinterId;
      return `
        <article class="printer-card${isDefault ? ' is-default' : ''}">
          <header class="printer-header">
            <div class="printer-title"><span class="printer-icon" aria-hidden="true">▤</span><div><strong>${escapeHtml(printer.name || 'New printer')}</strong><span>${escapeHtml(printer.host || 'Host required')}:${printer.port || '—'}</span></div></div>
            <div class="printer-header-actions">
              ${isDefault ? '<span class="default-badge">Default</span>' : `<button class="text-btn" data-action="make-default" data-printer-index="${index}">Make default</button>`}
              <button class="icon-btn danger" data-action="remove-printer" data-printer-index="${index}" aria-label="Remove ${escapeHtml(printer.name)}">×</button>
            </div>
          </header>
          <div class="printer-fields">
            <label class="field"><span>Name</span><input type="text" value="${escapeHtml(printer.name)}" data-printer-index="${index}" data-printer-field="name" placeholder="Kitchen printer"></label>
            <label class="field"><span>Stable ID</span><input type="text" value="${escapeHtml(printer.id)}" data-printer-index="${index}" data-printer-field="id" placeholder="kitchen"></label>
            <label class="field field-host"><span>IP address or host</span><input type="text" value="${escapeHtml(printer.host)}" data-printer-index="${index}" data-printer-field="host" placeholder="192.168.1.50"></label>
            <label class="field"><span>Port</span><input type="number" min="1" max="65535" value="${printer.port}" data-printer-index="${index}" data-printer-field="port"></label>
            <label class="field"><span>Protocol</span><select data-printer-index="${index}" data-printer-field="language"><option value="star-prnt"${printer.language === 'star-prnt' ? ' selected' : ''}>StarPRNT</option><option value="esc-pos"${printer.language === 'esc-pos' ? ' selected' : ''}>ESC/POS</option></select></label>
            <label class="field"><span>Model <small>Optional</small></span><input type="text" value="${escapeHtml(printer.model || '')}" data-printer-index="${index}" data-printer-field="model" placeholder="TSP100"></label>
            <label class="field"><span>Paper width</span><select data-printer-index="${index}" data-printer-field="paperWidth"><option value="384"${Number(printer.paperWidth) === 384 ? ' selected' : ''}>58 mm · 384 px</option><option value="576"${Number(printer.paperWidth) === 576 ? ' selected' : ''}>80 mm · 576 px</option></select></label>
            <label class="field"><span>Cut mode</span><select data-printer-index="${index}" data-printer-field="cutMode"><option value="full"${printer.cutMode === 'full' ? ' selected' : ''}>Full cut</option><option value="partial"${printer.cutMode === 'partial' ? ' selected' : ''}>Partial cut</option><option value="none"${printer.cutMode === 'none' ? ' selected' : ''}>No cut</option></select></label>
          </div>
        </article>`;
    }).join('');
  }

  function sourceRow(item, sourceType) {
    const listId = `entity-options-${item.id}`;
    return `
      <div class="source-row" data-item-id="${escapeHtml(item.id)}">
        <label class="source-enabled" title="Include this source"><input type="checkbox" data-item-id="${escapeHtml(item.id)}" data-item-field="enabled"${item.enabled !== false ? ' checked' : ''}><span></span></label>
        <label class="field entity-field"><span>Home Assistant entity</span><input type="text" role="combobox" autocomplete="off" value="${escapeHtml(item.entity || '')}" data-item-id="${escapeHtml(item.id)}" data-item-field="entity" data-entity-type="${sourceType.type}" list="${listId}" placeholder="Search ${escapeHtml(sourceType.name.toLowerCase())}…"><datalist id="${listId}"></datalist></label>
        <label class="field source-label"><span>Receipt label <small>Optional</small></span><input type="text" value="${escapeHtml(item.label || '')}" data-item-id="${escapeHtml(item.id)}" data-item-field="label" placeholder="Friendly label"></label>
        <button class="icon-btn danger source-remove" data-action="remove-source" data-item-id="${escapeHtml(item.id)}" aria-label="Remove source">×</button>
      </div>`;
  }

  function renderSources() {
    const daily = getProfile('daily_agenda');
    const items = daily ? daily.items : [];
    ui.sourceGroups.innerHTML = SOURCE_TYPES.map((sourceType) => {
      const matching = items.filter((item) => item.type === sourceType.type);
      const canAdd = sourceType.multiple || matching.length === 0;
      return `
        <section class="source-group">
          <header class="source-header"><div class="source-identity"><span class="source-icon">${sourceType.icon}</span><div><strong>${sourceType.name}</strong><span>${sourceType.description}</span></div></div>${canAdd ? `<button class="text-btn" data-action="add-source" data-source-type="${sourceType.type}">＋ Add${sourceType.multiple ? ' entity' : ''}</button>` : ''}</header>
          <div class="source-list">${matching.length ? matching.map((item) => sourceRow(item, sourceType)).join('') : '<p class="empty-source">No entity selected. This section will be omitted.</p>'}</div>
        </section>`;
    }).join('');
    const enabledCount = items.filter((item) => item.enabled !== false && asString(item.entity, '')).length;
    ui.dailySourceCount.textContent = String(enabledCount);
  }

  function renderJobs() {
    ensureProfiles();
    const daily = getProfile('daily_agenda');
    const message = getProfile('message');
    ui.jobCount.textContent = String([daily, message].filter(Boolean).length);

    ui.dailyName.value = daily.name;
    ui.dailyEnabled.checked = daily.enabled !== false;
    ui.dailyPrinter.innerHTML = printerOptions(daily.printerId);
    ui.dailyScript.value = daily.scriptEntity || '';
    ui.ganttStart.value = daily.ganttDayStartTime || '';
    ui.ganttEnd.value = daily.ganttDayEndTime || '';
    const dailyPrinter = state.printers.find((printer) => printer.id === daily.printerId);
    const enabledSources = daily.items.filter((item) => item.enabled !== false && item.entity).length;
    ui.dailySummary.textContent = `${dailyPrinter ? dailyPrinter.name : 'No printer'} · ${enabledSources} data source${enabledSources === 1 ? '' : 's'}${daily.scriptEntity ? ` · ${daily.scriptEntity}` : ''}`;

    ui.messageName.value = message.name;
    ui.messageEnabled.checked = message.enabled !== false;
    ui.messagePrinter.innerHTML = printerOptions(message.printerId);
    ui.messageScript.value = message.scriptEntity || '';
    ui.messageEntity.value = message.messageEntity || '';
    ui.messageBody.value = message.messageBody || '';
    const messagePrinter = state.printers.find((printer) => printer.id === message.printerId);
    const sourceLabel = message.messageEntity || (message.messageBody ? 'Saved message text' : 'No message content');
    ui.messageSummary.textContent = `${messagePrinter ? messagePrinter.name : 'No printer'} · ${sourceLabel}${message.scriptEntity ? ` · ${message.scriptEntity}` : ''}`;
    renderSources();
  }

  function renderConnection(ok, entityCount = null) {
    ui.connectionDot.classList.toggle('is-ready', ok);
    ui.connectionTitle.textContent = ok ? 'Home Assistant connected' : 'Home Assistant unavailable';
    ui.connectionDetail.textContent = ok
      ? (Number.isFinite(entityCount) ? `${entityCount} entities available to search` : 'Entity search is ready')
      : 'Saved settings remain available';
  }

  function renderAll() {
    renderPrinters();
    renderJobs();
    ui.customCss.value = state.customCss;
    ui.saveBtn.disabled = !state.dirty;
  }

  function validateSettings() {
    if (!state.printers.length) throw new Error('Add at least one printer');
    const ids = new Set();
    for (const printer of state.printers) {
      printer.id = normalizePrinterId(printer.id || printer.name);
      printer.name = asString(printer.name, 'Receipt Printer');
      printer.host = asString(printer.host, '');
      printer.port = Number.parseInt(printer.port, 10);
      printer.paperWidth = Number.parseInt(printer.paperWidth, 10) || 576;
      if (!printer.id) throw new Error(`Enter a stable ID for ${printer.name}`);
      if (ids.has(printer.id)) throw new Error(`Printer ID “${printer.id}” is duplicated`);
      if (!printer.host) throw new Error(`Enter an IP address or host for ${printer.name}`);
      if (!Number.isFinite(printer.port) || printer.port < 1 || printer.port > 65535) throw new Error(`Enter a valid port for ${printer.name}`);
      ids.add(printer.id);
    }
    if (!ids.has(state.defaultPrinterId)) state.defaultPrinterId = state.printers[0].id;
    for (const profile of state.store.profiles) {
      if (!ids.has(profile.printerId)) profile.printerId = state.defaultPrinterId;
    }
  }

  async function saveSettings() {
    validateSettings();
    setStatus('Saving printers and jobs…');
    const printerPayload = await fetchJson('/api/printers', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, defaultPrinterId: state.defaultPrinterId, printers: state.printers })
    });
    state.printers = printerPayload.printers;
    state.defaultPrinterId = printerPayload.defaultPrinterId;
    ensureProfiles();
    const profilePayload = await fetchJson('/api/profiles', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.store)
    });
    state.store = { version: profilePayload.version, updatedAt: profilePayload.updatedAt, defaultDailyAgendaProfileId: profilePayload.defaultDailyAgendaProfileId, profiles: profilePayload.profiles };
    state.customCss = asRawString(ui.customCss.value, '');
    await fetchJson('/template/css', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ css: state.customCss })
    });
    setDirty(false);
    renderAll();
    setStatus('Printers and jobs saved.', 'success');
  }

  async function loadSettings() {
    setStatus('Loading printers, jobs, and entities…');
    const [profiles, printers, css] = await Promise.all([
      fetchJson('/api/profiles'), fetchJson('/api/printers'), fetchJson('/template/css')
    ]);
    state.store = { version: profiles.version || 1, updatedAt: profiles.updatedAt || '', defaultDailyAgendaProfileId: profiles.defaultDailyAgendaProfileId || '', profiles: Array.isArray(profiles.profiles) ? profiles.profiles : [] };
    state.printers = Array.isArray(printers.printers) ? printers.printers : [];
    state.defaultPrinterId = printers.defaultPrinterId || (state.printers[0] && state.printers[0].id) || '';
    state.customCss = asRawString(css.css, '');
    ensureProfiles();
    setDirty(false);
    renderAll();
    setStatus('Configuration loaded.', 'success');
    try {
      const entities = await fetchJson('/api/entities?limit=1');
      renderConnection(true, Array.isArray(entities.entities) && entities.entities.length === 0 ? 0 : null);
    } catch (_error) {
      renderConnection(false);
    }
  }

  async function populateEntityOptions(input) {
    const type = asString(input.dataset.entityType, '');
    const listId = input.getAttribute('list');
    const datalist = listId ? document.getElementById(listId) : null;
    if (!type || !datalist) return;
    try {
      const payload = await fetchJson(`/api/entities?type=${encodeURIComponent(type)}&q=${encodeURIComponent(input.value)}&limit=100`);
      datalist.innerHTML = (payload.entities || []).map((entity) => `<option value="${escapeHtml(entity.entity_id)}">${escapeHtml(entity.friendly_name)} · ${escapeHtml(entity.state || '')}</option>`).join('');
      renderConnection(true);
    } catch (_error) {
      renderConnection(false);
    }
  }

  function scheduleEntitySearch(input, immediate = false) {
    const previous = state.searchTimers.get(input);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => populateEntityOptions(input), immediate ? 0 : 180);
    state.searchTimers.set(input, timer);
  }

  function showPreview(blob) {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(blob);
    ui.previewImage.src = state.previewUrl;
    ui.previewImage.hidden = false;
    ui.previewEmpty.hidden = true;
    ui.previewImage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function ensureSaved() {
    if (state.dirty) await saveSettings();
  }

  async function previewDaily() {
    await ensureSaved();
    const profile = getProfile('daily_agenda');
    showPreview(await fetchPreview('/preview/daily-agenda', { profileId: profile.id, title: profile.name, subtitle: 'Today', source: 'auto' }));
    setStatus('Daily Agenda preview generated.', 'success');
  }

  async function previewMessage() {
    await ensureSaved();
    const profile = getProfile('message');
    showPreview(await fetchPreview('/preview/message', { profileId: profile.id }));
    setStatus('Message preview generated.', 'success');
  }

  async function runJob(template) {
    await ensureSaved();
    const profile = getProfile(template);
    const endpoint = template === 'daily_agenda' ? '/print/daily-agenda' : '/print/message';
    setStatus(`Running ${profile.name}…`);
    const payload = await fetchJson(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerId: profile.printerId, profileId: profile.id, title: profile.name, source: 'auto', print: { feedLines: 3, cut: true } })
    });
    const jobId = payload.job && payload.job.id ? payload.job.id : 'queued';
    setStatus(`${profile.name} completed (${jobId}).`, 'success');
  }

  async function perform(action) {
    try {
      await action();
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  }

  function handlePrinterInput(target) {
    const index = Number.parseInt(target.dataset.printerIndex, 10);
    const field = target.dataset.printerField;
    const printer = state.printers[index];
    if (!printer || !field) return false;
    const oldId = printer.id;
    printer[field] = ['port', 'paperWidth'].includes(field) ? Number.parseInt(target.value, 10) : target.value;
    if (field === 'id') {
      const newId = normalizePrinterId(target.value);
      printer.id = newId;
      if (state.defaultPrinterId === oldId) state.defaultPrinterId = newId;
      for (const profile of state.store.profiles) if (profile.printerId === oldId) profile.printerId = newId;
    }
    setDirty();
    return true;
  }

  function handleProfileInput(target) {
    const template = target.dataset.profileTemplate;
    const field = target.dataset.profileField;
    if (!template || !field) return false;
    const profile = getProfile(template);
    if (!profile) return false;
    profile[field] = target.type === 'checkbox' ? target.checked : target.value;
    setDirty();
    if (['printerId', 'scriptEntity', 'messageEntity', 'messageBody', 'name'].includes(field)) renderJobSummaries();
    return true;
  }

  function handleItemInput(target) {
    const itemId = target.dataset.itemId;
    const field = target.dataset.itemField;
    if (!itemId || !field) return false;
    const daily = getProfile('daily_agenda');
    const item = daily.items.find((entry) => entry.id === itemId);
    if (!item) return false;
    item[field] = target.type === 'checkbox' ? target.checked : target.value;
    setDirty();
    renderJobSummaries();
    return true;
  }

  function renderJobSummaries() {
    const daily = getProfile('daily_agenda');
    const message = getProfile('message');
    const dailyPrinter = state.printers.find((printer) => printer.id === daily.printerId);
    const count = daily.items.filter((item) => item.enabled !== false && item.entity).length;
    ui.dailySummary.textContent = `${dailyPrinter ? dailyPrinter.name : 'No printer'} · ${count} data source${count === 1 ? '' : 's'}${daily.scriptEntity ? ` · ${daily.scriptEntity}` : ''}`;
    ui.dailySourceCount.textContent = String(count);
    const messagePrinter = state.printers.find((printer) => printer.id === message.printerId);
    ui.messageSummary.textContent = `${messagePrinter ? messagePrinter.name : 'No printer'} · ${message.messageEntity || (message.messageBody ? 'Saved message text' : 'No message content')}${message.scriptEntity ? ` · ${message.scriptEntity}` : ''}`;
  }

  function handleInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement) && !(target instanceof HTMLTextAreaElement)) return;
    if (target === ui.customCss) {
      state.customCss = target.value;
      setDirty();
    } else if (!handlePrinterInput(target) && !handleProfileInput(target)) {
      handleItemInput(target);
    }
    if (target.dataset.entityType) scheduleEntitySearch(target);
  }

  function handleFocusIn(event) {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.entityType) scheduleEntitySearch(target, true);
  }

  function handleClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'add-source') {
      const type = button.dataset.sourceType;
      getProfile('daily_agenda').items.push({ id: createId(type), type, entity: '', label: '', enabled: true });
      setDirty(); renderSources();
    } else if (action === 'remove-source') {
      const daily = getProfile('daily_agenda');
      daily.items = daily.items.filter((item) => item.id !== button.dataset.itemId);
      setDirty(); renderSources(); renderJobSummaries();
    } else if (action === 'remove-printer') {
      if (state.printers.length === 1) { setStatus('At least one printer is required.', 'warning'); return; }
      const index = Number.parseInt(button.dataset.printerIndex, 10);
      const removed = state.printers.splice(index, 1)[0];
      if (removed && removed.id === state.defaultPrinterId) state.defaultPrinterId = state.printers[0].id;
      for (const profile of state.store.profiles) if (profile.printerId === (removed && removed.id)) profile.printerId = state.defaultPrinterId;
      setDirty(); renderAll();
    } else if (action === 'make-default') {
      const printer = state.printers[Number.parseInt(button.dataset.printerIndex, 10)];
      if (printer) { state.defaultPrinterId = printer.id; setDirty(); renderAll(); }
    } else if (action === 'preview-daily') perform(previewDaily);
    else if (action === 'preview-message') perform(previewMessage);
    else if (action === 'run-daily') perform(() => runJob('daily_agenda'));
    else if (action === 'run-message') perform(() => runJob('message'));
  }

  function addPrinter() {
    let number = state.printers.length + 1;
    let id = `printer_${number}`;
    while (state.printers.some((printer) => printer.id === id)) { number += 1; id = `printer_${number}`; }
    const source = state.printers.find((printer) => printer.id === state.defaultPrinterId) || state.printers[0] || {};
    state.printers.push({ id, name: `Receipt Printer ${number}`, host: '', port: 9100, language: source.language || 'star-prnt', model: '', cutMode: source.cutMode || 'full', paperWidth: source.paperWidth || 576 });
    setDirty(); renderAll();
    const fields = ui.printerList.querySelectorAll('[data-printer-field="host"]');
    if (fields.length) fields[fields.length - 1].focus();
  }

  function cacheUi() {
    const ids = ['reload-btn', 'save-btn', 'add-printer-btn', 'printer-list', 'printer-count', 'job-count', 'connection-dot', 'connection-title', 'connection-detail', 'daily-name', 'daily-enabled', 'daily-printer', 'daily-script', 'daily-summary', 'daily-source-count', 'gantt-day-start-time', 'gantt-day-end-time', 'source-groups', 'message-name', 'message-enabled', 'message-printer', 'message-script', 'message-entity', 'message-body', 'message-summary', 'custom-css', 'preview-image', 'preview-empty', 'status-bar'];
    const aliases = { 'reload-btn': 'reloadBtn', 'save-btn': 'saveBtn', 'add-printer-btn': 'addPrinterBtn', 'printer-list': 'printerList', 'printer-count': 'printerCount', 'job-count': 'jobCount', 'connection-dot': 'connectionDot', 'connection-title': 'connectionTitle', 'connection-detail': 'connectionDetail', 'daily-name': 'dailyName', 'daily-enabled': 'dailyEnabled', 'daily-printer': 'dailyPrinter', 'daily-script': 'dailyScript', 'daily-summary': 'dailySummary', 'daily-source-count': 'dailySourceCount', 'gantt-day-start-time': 'ganttStart', 'gantt-day-end-time': 'ganttEnd', 'source-groups': 'sourceGroups', 'message-name': 'messageName', 'message-enabled': 'messageEnabled', 'message-printer': 'messagePrinter', 'message-script': 'messageScript', 'message-entity': 'messageEntity', 'message-body': 'messageBody', 'message-summary': 'messageSummary', 'custom-css': 'customCss', 'preview-image': 'previewImage', 'preview-empty': 'previewEmpty', 'status-bar': 'statusBar' };
    for (const id of ids) ui[aliases[id]] = document.getElementById(id);
  }

  function syncTheme() {
    try {
      if (!window.parent || window.parent === window) return;
      const parentRoot = window.parent.document.documentElement;
      const computed = window.parent.getComputedStyle(parentRoot);
      for (const variable of THEME_VARIABLES) {
        const value = computed.getPropertyValue(variable).trim();
        if (value) document.documentElement.style.setProperty(variable, value);
      }
    } catch (_error) {}
  }

  function init() {
    cacheUi();
    syncTheme();
    ui.reloadBtn.addEventListener('click', () => perform(loadSettings));
    ui.saveBtn.addEventListener('click', () => perform(saveSettings));
    ui.addPrinterBtn.addEventListener('click', addPrinter);
    document.addEventListener('input', handleInput);
    document.addEventListener('change', handleInput);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('click', handleClick);
    window.addEventListener('beforeunload', (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
    perform(loadSettings);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
