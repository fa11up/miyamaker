(function () {
  'use strict';

  const FORMAT = 'miya-pfp-engine-session';
  const VERSION = 1;
  const DB_NAME = 'miya-pfp-engine';
  const STORE = 'sessions';
  const PREF_KEY = 'miya-pfp-engine.preferences.v1';
  let dbPromise;
  let autosaveTimer;
  let busy = false;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open browser session storage.'));
    });
    return dbPromise;
  }

  async function storeRecord(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error || new Error('Could not save this session in browser storage.'));
      tx.onabort = () => reject(tx.error || new Error('Session storage was aborted.'));
    });
  }

  async function readRecord(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function allRecords() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteRecord(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function safeProjectName(value) {
    return String(value || '').trim().replace(/[\\/:*?"<>|\x00-\x1F]/g, '-').replace(/\s+/g, ' ').slice(0, 100) || 'Untitled project';
  }

  function currentUiState() {
    const form = {};
    document.querySelectorAll('input[id],select[id],textarea[id]').forEach(element => {
      if (element.type === 'file' || element.type === 'password') return;
      form[element.id] = element.type === 'checkbox' || element.type === 'radio'
        ? { checked: element.checked, value: element.value }
        : { value: element.value, selectedIndex: element.tagName === 'SELECT' ? element.selectedIndex : undefined };
    });
    const globals = JSON.parse(JSON.stringify(window.MiyaEngineState?.get?.() || {}));
    const activeTab = document.querySelector('.tab-content.active')?.id || 'tab-layers-mgr';
    return { form, globals, activeTab };
  }

  function applyUiState(state) {
    const form = state?.form || {};
    Object.entries(form).forEach(([id, saved]) => {
      const element = document.getElementById(id);
      if (!element) return;
      if (element.type === 'checkbox' || element.type === 'radio') element.checked = Boolean(saved.checked);
      else if (saved.value !== undefined) element.value = saved.value;
      if (element.tagName === 'SELECT' && Number.isInteger(saved.selectedIndex) && saved.selectedIndex >= 0) element.selectedIndex = saved.selectedIndex;
    });
    const globals = state?.globals || {};
    if (window.MiyaEngineState?.set) window.MiyaEngineState.set(globals);
    if (typeof window.renderGeneralMetadataPreview === 'function') window.renderGeneralMetadataPreview();
    if (typeof window.refreshRaritySetup === 'function') window.refreshRaritySetup();
    if (state?.activeTab && document.getElementById(state.activeTab) && typeof window.switchTabById === 'function') window.switchTabById(state.activeTab);
  }

  function makeThumbnail(workspace) {
    const files = workspace?.files || [];
    const path = workspace?.thumbnailPath;
    const image = files.find(item => item.path === path) || files.find(item => /\.(png|jpe?g|webp|gif)$/i.test(item.path));
    if (!image) return Promise.resolve('');
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 96; canvas.height = 96;
        const ctx = canvas.getContext('2d');
        const scale = Math.min(96 / img.width, 96 / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        ctx.drawImage(img, (96 - w) / 2, (96 - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => resolve('');
      const ext = image.path.toLowerCase().split('.').pop();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
      img.src = `data:${mime};base64,${image.data}`;
    });
  }

  async function capture(name, id) {
    const response = await fetch('/api/session/export');
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || 'Could not read project files.');
    const now = new Date().toISOString();
    const workspace = result.workspace || { files: [] };
    const thumbnail = await makeThumbnail(workspace);
    const preferences = (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } })();
    const projectId = id || crypto.randomUUID();
    return {
      format: FORMAT,
      version: VERSION,
      id: projectId,
      project: { name: safeProjectName(name || document.getElementById('miya-project-name')?.value), updatedAt: now, thumbnail },
      createdAt: id ? (await readRecord(id))?.createdAt || now : now,
      ui: currentUiState(),
      preferences,
      workspace,
    };
  }

  async function saveSession({ download = false, autosave = false } = {}) {
    if (busy) return;
    busy = true;
    try {
      const name = safeProjectName(document.getElementById('miya-project-name')?.value);
      const id = autosave ? 'autosave:last-project' : undefined;
      const session = await capture(name, id);
      await storeRecord(session);
      if (!autosave) localStorage.setItem('miya-pfp-engine.last-session', session.id);
      if (download) downloadSession(session);
      if (window.MiyaRecent) await window.MiyaRecent.render();
      if (typeof window.setStatus === 'function') setStatus(autosave ? 'Autosaved session to this browser' : `Saved session “${session.project.name}” to this browser`);
    } catch (error) {
      console.error(error);
      if (typeof window.setStatus === 'function') setStatus(`Session save failed: ${error.message}`);
      if (!autosave) alert(`Could not save session: ${error.message}`);
    } finally { busy = false; }
  }

  function downloadSession(session) {
    const name = safeProjectName(session.project?.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'miya-project';
    const blob = new Blob([JSON.stringify(session)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.miya-session.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function restoreSession(session, confirmReplace = true) {
    if (!session || session.format !== FORMAT || session.version !== VERSION) throw new Error('This is not a supported Miya pfp engine session.');
    if (confirmReplace && !confirm(`Open “${session.project?.name || 'Untitled project'}” and replace the current workspace? The current project will remain in Open Recent if it was saved.`)) return false;
    busy = true;
    try {
      const response = await fetch('/api/session/restore', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(session) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || 'Could not restore the session files.');
      const nameInput = document.getElementById('miya-project-name');
      if (nameInput) nameInput.value = safeProjectName(session.project?.name);
      localStorage.setItem(PREF_KEY, JSON.stringify(session.preferences || {}));
      applyUiState(session.ui || {});
      if (typeof window.refreshLayers === 'function') await refreshLayers();
      if (typeof window.loadRaritySetup === 'function') await loadRaritySetup();
      if (window.MiyaRecent) await window.MiyaRecent.render();
      if (typeof window.setStatus === 'function') setStatus(`Opened “${safeProjectName(session.project?.name)}”`);
      localStorage.setItem('miya-pfp-engine.last-session', session.id || '');
      return true;
    } finally { busy = false; }
  }

  async function importFile(file) {
    const text = await file.text();
    let session;
    try { session = JSON.parse(text); } catch { throw new Error('The selected file is not valid JSON.'); }
    await restoreSession(session, true);
    if (session?.format === FORMAT) await storeRecord({ ...session, id: crypto.randomUUID(), createdAt: new Date().toISOString(), project: { ...session.project, updatedAt: new Date().toISOString() } });
    if (window.MiyaRecent) await window.MiyaRecent.render();
  }

  async function openRecent(id) {
    const session = await readRecord(id);
    if (!session) { alert('That saved session is no longer in this browser.'); await window.MiyaRecent.render(); return; }
    await restoreSession(session, true);
  }

  async function listRecent() {
    return (await allRecords()).filter(item => !String(item.id).startsWith('autosave:')).sort((a, b) => new Date(b.project?.updatedAt || b.createdAt) - new Date(a.project?.updatedAt || a.createdAt));
  }

  async function newProject() {
    if (!confirm('Start a new empty project? Save the current project first if you want to keep it. This clears the current layer assets and generated output.')) return;
    const response = await fetch('/api/session/new', { method:'POST' });
    const result = await response.json();
    if (!response.ok || result.error) { alert(result.error || 'Could not create a new project.'); return; }
    await deleteRecord('autosave:last-project');
    document.getElementById('miya-project-name').value = 'Untitled project';
    document.querySelectorAll('input[id],textarea[id]').forEach(element => {
      if (element.id === 'miya-project-name' || element.type === 'file' || element.type === 'hidden') return;
      if (element.type === 'checkbox' || element.type === 'radio') element.checked = element.defaultChecked;
      else element.value = element.defaultValue;
    });
    document.querySelectorAll('select[id]').forEach(element => {
      const defaultIndex = Array.from(element.options).findIndex(option => option.defaultSelected);
      element.selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;
    });
    window.MiyaEngineState?.set?.({ raritySetup: { version:1, folders:{} } });
    if (typeof window.refreshLayers === 'function') await refreshLayers();
    if (typeof window.refreshOutput === 'function') await refreshOutput();
    if (typeof window.setStatus === 'function') setStatus('New empty project created');
  }

  function queueAutosave() {
    if (busy) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveSession({ autosave:true }), 2500);
  }

  async function bind() {
    document.getElementById('save-session')?.addEventListener('click', () => saveSession());
    document.getElementById('export-session')?.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      try {
        const session = await capture();
        session.id = crypto.randomUUID();
        await storeRecord(session);
        downloadSession(session);
        if (window.MiyaRecent) await window.MiyaRecent.render();
        setStatus(`Exported ${session.project.name}.miya-session.json`);
      } catch (error) { alert(`Could not export session: ${error.message}`); }
      finally { busy = false; }
    });
    document.getElementById('new-project')?.addEventListener('click', newProject);
    document.getElementById('open-project')?.addEventListener('click', () => document.getElementById('session-file-input').click());
    document.getElementById('import-session')?.addEventListener('click', () => document.getElementById('session-file-input').click());
    document.getElementById('session-file-input')?.addEventListener('change', async event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      try { await importFile(file); } catch (error) { alert(`Could not open session: ${error.message}`); }
    });
    document.getElementById('open-recent')?.addEventListener('click', async event => {
      const menu = document.getElementById('recent-menu');
      menu.hidden = !menu.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden && window.MiyaRecent) await window.MiyaRecent.render();
    });
    document.querySelectorAll('input[id],select[id],textarea[id]').forEach(element => {
      if (element.id !== 'session-file-input') {
        element.addEventListener('change', queueAutosave);
        element.addEventListener('input', queueAutosave);
      }
    });
    window.addEventListener('change', event => {
      if (event.target?.matches?.('input[type=file]') && event.target.id !== 'session-file-input') queueAutosave();
    }, true);
    document.addEventListener('click', event => {
      if (event.target.closest('.tab,.menu-item,button') && !event.target.closest('.session-toolbar,#recent-menu')) {
        queueAutosave();
      }
    });

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(args[1]?.method || input?.method || 'GET').toUpperCase();
      const response = await nativeFetch(...args);
      if (method !== 'GET' && url.startsWith('/api/') && !url.startsWith('/api/session/')) queueAutosave();
      return response;
    };
    window.addEventListener('dragover', event => {
      if (Array.from(event.dataTransfer?.items || []).some(item => item.kind === 'file')) {
        event.preventDefault(); document.body.classList.add('session-dragging');
      }
    });
    window.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('session-dragging'); });
    window.addEventListener('drop', async event => {
      document.body.classList.remove('session-dragging');
      const file = Array.from(event.dataTransfer?.files || []).find(item => /\.json$/i.test(item.name));
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed.format !== FORMAT) return;
        event.preventDefault(); event.stopPropagation();
        await restoreSession(parsed, true);
        await storeRecord({ ...parsed, id: crypto.randomUUID(), createdAt:new Date().toISOString() });
        if (window.MiyaRecent) await window.MiyaRecent.render();
      } catch (error) { alert(`Could not open dropped session: ${error.message}`); }
    }, true);

    try {
      const autosave = await readRecord('autosave:last-project');
      if (autosave?.format === FORMAT && autosave.workspace?.files?.length) await restoreSession(autosave, false);
      if (window.MiyaRecent) await window.MiyaRecent.render();
    } catch (error) { console.warn('Miya session startup restore:', error); }
  }

  window.MiyaSessions = { saveSession, restoreSession, importFile, openRecent, listRecent, newProject, queueAutosave };
  window.addEventListener('load', bind, { once:true });
})();
