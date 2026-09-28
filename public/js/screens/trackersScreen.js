import { navigate, refreshIcons } from '../router.js';
import { store } from '../store.js';
import { api } from '../net/api.js';
import { userReady } from '../authClient.js';
import { escapeHtml, fmtDate, relDay, prefs } from '../tracker/util.js';

let mounted = 0; // bumps on unmount so a late async mount bails out

// Events: every tournament you're prepping for. The last event you had open is
// pinned at the top so coming back is one click.
export const trackersScreen = {
  async mount(root) {
    const token = ++mounted;
    await userReady();
    if (token !== mounted) return;
    if (!store.get('user')) {
      renderSignedOut(root);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'screen prep-screen events-screen';
    wrap.innerHTML = `
      <header class="prep-head">
        <div>
          <h1 class="prep-title">Events</h1>
          <p class="prep-sub">One prep board per tournament: your opponents, their openings, their games, and your notes.</p>
        </div>
      </header>

      <div class="ev-resume" hidden></div>

      <form class="ev-create card">
        <span class="ev-create-icon"><i data-lucide="calendar-plus"></i></span>
        <input class="input ev-name" type="text" placeholder="New event, e.g. Canadian Open 2026" aria-label="Event name" required />
        <input class="input ev-date" type="date" aria-label="Event date" />
        <button type="submit" class="btn btn-primary">Create event</button>
      </form>

      <div class="ev-lists"><div class="prep-loading">Loading your events…</div></div>
    `;
    root.appendChild(wrap);
    refreshIcons();

    const listsEl = wrap.querySelector('.ev-lists');
    const resumeEl = wrap.querySelector('.ev-resume');

    async function load() {
      try {
        const { trackers } = await api('/trackers');
        render(trackers);
      } catch (err) {
        listsEl.innerHTML = `<div class="prep-error">${escapeHtml(err.message)}</div>`;
      }
    }

    function render(trackers) {
      renderResume(trackers);
      if (!trackers.length) {
        listsEl.innerHTML = `
          <div class="prep-empty">
            <i data-lucide="trophy"></i>
            <h3>No events yet</h3>
            <p>Create one above, then add the players you might face.</p>
          </div>`;
        refreshIcons();
        return;
      }
      // Upcoming soonest-first, then past and undated most-recent-first.
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = trackers
        .filter((t) => t.event_date && t.event_date.slice(0, 10) >= today)
        .sort((a, b) => (a.event_date < b.event_date ? -1 : 1));
      const rest = trackers.filter((t) => !upcoming.includes(t));

      listsEl.innerHTML = '';
      if (upcoming.length) listsEl.appendChild(section('Upcoming', upcoming));
      if (rest.length) listsEl.appendChild(section(upcoming.length ? 'Past & undated' : 'Your events', rest));
      refreshIcons();
    }

    function renderResume(trackers) {
      const lastId = prefs.get('lastTrackerId');
      const t = lastId && trackers.find((x) => String(x.id) === String(lastId));
      resumeEl.hidden = !t;
      if (!t) return;
      const oppId = prefs.lastOpponent(t.id);
      resumeEl.innerHTML = `
        <button class="ev-resume-card">
          <span class="ev-resume-icon"><i data-lucide="history"></i></span>
          <span class="ev-resume-body">
            <span class="eyebrow">Pick up where you left off</span>
            <span class="ev-resume-name">${escapeHtml(t.name)}</span>
            <span class="ev-resume-meta">${t.opponent_count} opponent${t.opponent_count === 1 ? '' : 's'}${t.event_date ? ` · ${escapeHtml(relDay(t.event_date))}` : ''}</span>
          </span>
          <span class="ev-resume-go">Continue <i data-lucide="arrow-right"></i></span>
        </button>`;
      resumeEl.querySelector('button').addEventListener('click', () => navigate('tracker', { id: t.id, sub: oppId }));
    }

    function section(title, items) {
      const el = document.createElement('section');
      el.className = 'ev-section';
      el.innerHTML = `<h2 class="section-label">${title}</h2><div class="ev-grid"></div>`;
      const grid = el.querySelector('.ev-grid');
      for (const t of items) {
        const card = document.createElement('button');
        card.className = 'ev-card';
        const when = t.event_date ? `${fmtDate(t.event_date)} · ${relDay(t.event_date)}` : 'No date set';
        card.innerHTML = `
          <span class="ev-card-top">
            <span class="ev-card-icon"><i data-lucide="trophy"></i></span>
            <i data-lucide="chevron-right" class="ev-card-arrow"></i>
          </span>
          <span class="ev-card-name">${escapeHtml(t.name)}</span>
          <span class="ev-card-meta">${escapeHtml(when)}</span>
          <span class="ev-card-count">${t.opponent_count} opponent${t.opponent_count === 1 ? '' : 's'}</span>
        `;
        card.addEventListener('click', () => navigate('tracker', { id: t.id, sub: prefs.lastOpponent(t.id) }));
        grid.appendChild(card);
      }
      return el;
    }

    wrap.querySelector('.ev-create').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = wrap.querySelector('.ev-name').value.trim();
      const eventDate = wrap.querySelector('.ev-date').value || null;
      if (!name) return;
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        const { tracker } = await api('/trackers', { method: 'POST', body: { name, eventDate } });
        navigate('tracker', { id: tracker.id });
      } catch (err) {
        btn.disabled = false;
        listsEl.insertAdjacentHTML('afterbegin', `<div class="prep-error">${escapeHtml(err.message)}</div>`);
      }
    });

    load();
  },

  unmount() {
    mounted++;
  },
};

function renderSignedOut(root) {
  const wrap = document.createElement('div');
  wrap.className = 'screen prep-screen';
  wrap.innerHTML = `
    <div class="prep-empty prep-signed-out card">
      <i data-lucide="lock"></i>
      <h3>Sign in to prep for events</h3>
      <p>Your events, opponents, notes and imported games are saved to your account so they're here next time.</p>
      <button class="btn btn-primary go-login">Sign in</button>
    </div>
  `;
  root.appendChild(wrap);
  refreshIcons();
  wrap.querySelector('.go-login').addEventListener('click', () => navigate('login'));
}
