import { navigate } from '../router.js';
import { store } from '../store.js';
import { api } from '../net/api.js';
import { refreshIcons } from '../router.js';

// Lists the signed-in user's tournament trackers and lets them create new ones.
export const trackersScreen = {
  async mount(root) {
    if (!store.get('user')) {
      renderSignedOut(root);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'screen trackers-screen';
    wrap.innerHTML = `
      <div class="scout-head">
        <div>
          <h1>Tournament Trackers</h1>
          <p class="scout-tagline">A prep board for each event — add opponents and everything you need to know about them.</p>
        </div>
        <button class="text-link back-link"><i data-lucide="arrow-left"></i> Menu</button>
      </div>

      <form class="tracker-create card">
        <input class="tc-name" type="text" placeholder="Tracker name (e.g. Canadian Open 2026)" required />
        <input class="tc-date" type="date" />
        <button type="submit" class="btn btn-primary">Create</button>
      </form>

      <div class="tracker-list"></div>
    `;
    root.appendChild(wrap);

    wrap.querySelector('.back-link').addEventListener('click', () => navigate('menu'));
    const listEl = wrap.querySelector('.tracker-list');

    async function load() {
      listEl.innerHTML = '<div class="scout-loading">Loading…</div>';
      try {
        const { trackers } = await api('/trackers');
        render(trackers);
      } catch (err) {
        listEl.innerHTML = `<div class="scout-error">${err.message}</div>`;
      }
    }

    function render(trackers) {
      if (!trackers.length) {
        listEl.innerHTML = '<div class="op-empty">No trackers yet — create one above.</div>';
        return;
      }
      listEl.innerHTML = '';
      for (const t of trackers) {
        const card = document.createElement('button');
        card.className = 'tracker-card';
        card.innerHTML = `
          <span class="tk-icon"><i data-lucide="trophy"></i></span>
          <span class="tk-body">
            <span class="tk-name">${escapeHtml(t.name)}</span>
            <span class="tk-meta">${t.opponent_count} opponent${t.opponent_count === 1 ? '' : 's'}${t.event_date ? ` · ${t.event_date.slice(0, 10)}` : ''}</span>
          </span>
          <span class="tk-arrow"><i data-lucide="chevron-right"></i></span>
        `;
        card.addEventListener('click', () => navigate('tracker', { id: t.id }));
        listEl.appendChild(card);
      }
      refreshIcons();
    }

    wrap.querySelector('.tracker-create').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = wrap.querySelector('.tc-name').value.trim();
      const eventDate = wrap.querySelector('.tc-date').value || null;
      if (!name) return;
      try {
        await api('/trackers', { method: 'POST', body: { name, eventDate } });
        wrap.querySelector('.tc-name').value = '';
        wrap.querySelector('.tc-date').value = '';
        load();
      } catch (err) {
        alert(err.message);
      }
    });

    load();
  },
};

function renderSignedOut(root) {
  const wrap = document.createElement('div');
  wrap.className = 'screen trackers-screen';
  wrap.innerHTML = `
    <div class="signed-out card">
      <h2>Sign in to use trackers</h2>
      <p>Create an account to save tournament prep and opponent scouting across sessions.</p>
      <button class="btn btn-primary go-login">Sign in</button>
    </div>
  `;
  root.appendChild(wrap);
  wrap.querySelector('.go-login').addEventListener('click', () => navigate('login'));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
