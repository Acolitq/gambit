import { navigate, refreshIcons } from '../router.js';
import { store } from '../store.js';
import { api } from '../net/api.js';
import { userReady } from '../authClient.js';
import { escapeHtml, initials, fmtDate, relDay, prefs } from '../tracker/util.js';
import { renderOpponentForm } from '../tracker/opponentForm.js';
import { createDossier } from '../tracker/dossier.js';

// One event's prep workspace: the roster of opponents on the left, the selected
// opponent's dossier on the right (stacked on phones). The URL carries the
// selection — #/tracker/<event>/<opponent> or #/tracker/<event>/new — so a
// refresh or the back button lands in the same place, and the last opponent
// viewed per event is remembered for next time.
let view = null; // live workspace state while mounted
let mounted = 0;

export const trackerScreen = {
  async mount(root, params = {}) {
    const token = ++mounted;
    await userReady();
    if (token !== mounted) return;
    if (!store.get('user')) return navigate('login');

    const trackerId = params.id || prefs.get('lastTrackerId');
    if (!trackerId) return navigate('trackers');

    const wrap = document.createElement('div');
    wrap.className = 'screen prep-screen ws-screen';
    wrap.innerHTML = `
      <header class="prep-head ws-head">
        <div class="ws-head-main">
          <button class="text-link ws-back"><i data-lucide="arrow-left"></i> Events</button>
          <h1 class="prep-title ws-title">Loading…</h1>
          <p class="prep-sub ws-sub"></p>
        </div>
        <button class="btn btn-ghost ws-delete"><i data-lucide="trash-2"></i><span>Delete event</span></button>
      </header>

      <div class="ws-layout" data-view="roster">
        <aside class="ws-roster card">
          <div class="rs-top">
            <div class="rs-search">
              <i data-lucide="search"></i>
              <input class="rs-search-input" type="search" placeholder="Find opponent" aria-label="Find opponent" />
            </div>
            <button class="btn btn-primary rs-add"><i data-lucide="user-plus"></i><span>Add</span></button>
          </div>
          <div class="rs-list" role="list"><div class="prep-loading">Loading…</div></div>
        </aside>
        <section class="ws-main"></section>
      </div>
    `;
    root.appendChild(wrap);
    refreshIcons();

    view = {
      trackerId: String(trackerId),
      wrap,
      opponents: [],
      filter: '',
      selected: null,
      dossier: null,
      layout: wrap.querySelector('.ws-layout'),
      listEl: wrap.querySelector('.rs-list'),
      mainEl: wrap.querySelector('.ws-main'),
    };

    wrap.querySelector('.ws-back').addEventListener('click', () => navigate('trackers'));
    wrap.querySelector('.rs-add').addEventListener('click', () => select('new'));
    wrap.querySelector('.rs-search-input').addEventListener('input', (e) => {
      view.filter = e.target.value.trim().toLowerCase();
      renderRoster();
    });
    wrap.querySelector('.ws-delete').addEventListener('click', async () => {
      if (!confirm('Delete this event and everything in it (opponents, notes, games)?')) return;
      await api(`/trackers/${view.trackerId}`, { method: 'DELETE' });
      prefs.set({ lastTrackerId: null });
      navigate('trackers');
    });

    let data;
    try {
      data = await api(`/trackers/${view.trackerId}`);
    } catch (err) {
      if (token !== mounted) return;
      if (/not found/i.test(err.message)) {
        prefs.set({ lastTrackerId: null });
        return navigate('trackers');
      }
      view.listEl.innerHTML = `<div class="prep-error">${escapeHtml(err.message)}</div>`;
      return;
    }
    if (token !== mounted) return;

    prefs.set({ lastTrackerId: view.trackerId });
    const { tracker, opponents } = data;
    view.opponents = opponents;
    wrap.querySelector('.ws-title').textContent = tracker.name;
    wrap.querySelector('.ws-sub').textContent = [
      tracker.event_date ? `${fmtDate(tracker.event_date)} · ${relDay(tracker.event_date)}` : null,
      `${opponents.length} opponent${opponents.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' · ');

    renderRoster();
    // Explicit selection in the URL wins; otherwise reopen the last one viewed
    // (desktop only — on a phone the roster is the natural landing view).
    const remembered = prefs.lastOpponent(view.trackerId);
    const wide = window.matchMedia('(min-width: 901px)').matches;
    let initial = params.sub;
    if (!initial && wide) initial = remembered && opponents.some((o) => String(o.id) === remembered) ? remembered : opponents[0]?.id;
    if (!opponents.length) initial = 'new';
    select(initial ? String(initial) : null, { replace: true });
  },

  // Same screen, different opponent in the URL (roster click, back button).
  update(params = {}) {
    if (!view) return;
    if (params.id && String(params.id) !== view.trackerId) {
      trackerScreen.unmount();
      const root = document.getElementById('app');
      root.innerHTML = '';
      trackerScreen.mount(root, params);
      return;
    }
    show(params.sub ? String(params.sub) : null);
  },

  unmount() {
    mounted++;
    view?.dossier?.destroy();
    view = null;
  },
};

// Change the selection by updating the URL; hashchange → update() → show().
function select(sub, { replace = false } = {}) {
  const hash = `#/tracker/${view.trackerId}${sub ? `/${sub}` : ''}`;
  if (replace) {
    history.replaceState(null, '', hash);
    show(sub);
  } else if (window.location.hash !== hash) {
    window.location.hash = hash;
  } else {
    show(sub);
  }
}

function show(sub) {
  if (!view) return;
  if (sub === view.selected && sub !== 'new') return;
  view.selected = sub;
  view.dossier?.destroy();
  view.dossier = null;
  view.layout.dataset.view = sub ? 'detail' : 'roster';
  highlightRoster();

  if (!sub) {
    view.mainEl.innerHTML = view.opponents.length
      ? `<div class="prep-empty ws-pick"><i data-lucide="mouse-pointer-click"></i><h3>Pick an opponent</h3><p>Their notes, repertoire and games open here.</p></div>`
      : '';
    refreshIcons();
    return;
  }

  if (sub === 'new') {
    const holder = document.createElement('div');
    holder.className = 'ws-form';
    view.mainEl.innerHTML = '';
    view.mainEl.appendChild(holder);
    renderOpponentForm(holder, {
      title: view.opponents.length ? 'Add an opponent' : 'Add your first opponent',
      submitLabel: 'Add opponent',
      onCancel: view.opponents.length ? () => select(prefs.lastOpponent(view.trackerId) || null) : null,
      onSubmit: async (values) => {
        const { opponent } = await api(`/trackers/${view.trackerId}/opponents`, { method: 'POST', body: values });
        view.opponents.push({ ...opponent, game_count: 0, note_count: 0 });
        renderRoster();
        updateSub();
        select(String(opponent.id));
      },
    });
    return;
  }

  prefs.setLastOpponent(view.trackerId, sub);
  view.mainEl.innerHTML = '';
  const holder = document.createElement('div');
  view.mainEl.appendChild(holder);
  view.dossier = createDossier(holder, {
    opponentId: sub,
    onBack: () => select(null),
    onChanged: (o) => {
      const i = view?.opponents.findIndex((x) => String(x.id) === String(o.id));
      if (i == null || i < 0) return;
      view.opponents[i] = { ...view.opponents[i], ...o };
      renderRoster();
    },
    onRemoved: () => {
      view.opponents = view.opponents.filter((x) => String(x.id) !== sub);
      prefs.setLastOpponent(view.trackerId, null);
      renderRoster();
      updateSub();
      select(view.opponents.length ? null : 'new');
    },
  });
  if (window.matchMedia('(max-width: 900px)').matches) window.scrollTo(0, 0);
}

function updateSub() {
  const sub = view.wrap.querySelector('.ws-sub');
  const n = view.opponents.length;
  sub.textContent = sub.textContent.replace(/\d+ opponents?$/, `${n} opponent${n === 1 ? '' : 's'}`);
}

function renderRoster() {
  const { listEl, opponents, filter } = view;
  if (!opponents.length) {
    listEl.innerHTML = '<div class="rs-empty">No opponents yet. Add the players you might face: pairings, the top seeds, your club rivals.</div>';
    return;
  }
  const shown = opponents
    .filter((o) => !filter || o.name.toLowerCase().includes(filter))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
  if (!shown.length) {
    listEl.innerHTML = `<div class="rs-empty">No one matches “${escapeHtml(filter)}”.</div>`;
    return;
  }
  listEl.innerHTML = '';
  for (const o of shown) {
    const item = document.createElement('a');
    item.className = 'rs-item';
    item.role = 'listitem';
    item.href = `#/tracker/${view.trackerId}/${o.id}`;
    item.dataset.id = o.id;
    const meta = [
      o.game_count ? `${o.game_count} game${o.game_count === 1 ? '' : 's'}` : null,
      o.note_count ? `${o.note_count} note${o.note_count === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ') || (o.chesscom || o.lichess || o.cfc_id ? 'Linked' : 'No accounts yet');
    item.innerHTML = `
      <span class="rs-avatar">${escapeHtml(initials(o.name))}</span>
      <span class="rs-body">
        <span class="rs-name">${escapeHtml(o.name)}</span>
        <span class="rs-meta">${escapeHtml(meta)}</span>
      </span>
      ${o.rating ? `<span class="rs-rating mono">${o.rating}</span>` : ''}
      <i data-lucide="chevron-right" class="rs-go"></i>`;
    listEl.appendChild(item);
  }
  highlightRoster();
  refreshIcons();
}

function highlightRoster() {
  for (const a of view.listEl.querySelectorAll('.rs-item')) {
    const on = a.dataset.id === view.selected;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
}
