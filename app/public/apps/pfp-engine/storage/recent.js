(function () {
  'use strict';

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  function close() {
    const menu = document.getElementById('recent-menu');
    if (menu) menu.hidden = true;
  }

  async function render() {
    const menu = document.getElementById('recent-menu');
    if (!menu || !window.MiyaSessions) return;
    const sessions = await window.MiyaSessions.listRecent();
    if (!sessions.length) {
      menu.innerHTML = '<div class="recent-empty">No saved sessions yet.</div>';
      return;
    }
    menu.innerHTML = sessions.map(item => `
      <button class="recent-session" type="button" data-session-id="${escapeAttr(item.id)}">
        ${item.project?.thumbnail ? `<img src="${item.project.thumbnail}" alt="">` : '<span class="recent-placeholder">▧</span>'}
        <span class="recent-session-copy"><b>${escapeHtml(item.project?.name || 'Untitled project')}</b><small>${escapeHtml(formatDate(item.project?.updatedAt || item.createdAt))}</small><small>Location: Browser storage</small></span>
      </button>`).join('');
    menu.querySelectorAll('[data-session-id]').forEach(button => button.addEventListener('click', async () => {
      close();
      await window.MiyaSessions.openRecent(button.dataset.sessionId);
    }));
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }
  function escapeAttr(value) { return escapeHtml(value); }

  window.MiyaRecent = { render, close };
  window.addEventListener('click', event => {
    if (!event.target.closest('.recent-dropdown')) close();
  });
})();
