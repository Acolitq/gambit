import { api } from '../net/api.js';
import { navigate, refreshIcons } from '../router.js';
import { escapeHtml, initials, fmtDate, timeAgo, resultView, prefs } from './util.js';
import { renderOpponentForm } from './opponentForm.js';

// Everything about one opponent on one page: header (ratings, accounts, sync),
// then Notes / Repertoire / Games tabs. Online games (Chess.com, Lichess, pasted
// PGN) live in the database and open on the engine board; OTB games come live
// from CFC crosstables (results only — CFC doesn't publish moves).
//
// createDossier(el, { opponentId, onChanged(opponent), onRemoved(), onBack })
const SYNC_AFTER_MS = 12 * 60 * 60 * 1000; // re-pull online games at most twice a day
const TABS = ['notes', 'repertoire', 'games'];
const SAVE_HINT = window.matchMedia('(pointer: coarse)').matches ? '' : '⌘/Ctrl + Enter to save';

export function createDossier(el, { opponentId, onChanged, onRemoved, onBack }) {
  let alive = true;
  let opp = null;
  let notes = [];
  let report = null;
  let games = null; // online games from the DB
  let otb = null; // { linked, profile, events } | { error }
  let syncing = false;
  let tab = TABS.includes(prefs.get('dossierTab')) ? prefs.get('dossierTab') : 'notes';
  // source: null until the user picks one, so the default can follow the data.
  const gameFilter = { source: null, opening: null, color: null };

  el.innerHTML = '<div class="prep-loading">Loading opponent…</div>';

  async function init() {
    try {
      ({ opponent: opp, notes } = await api(`/opponents/${opponentId}`));
    } catch (err) {
      if (alive) el.innerHTML = `<div class="prep-error">${escapeHtml(err.message)}</div>`;
      return;
    }
    if (!alive) return;
    renderShell();
    loadReport();
    loadGames();
    loadOtb();
    maybeSync();
  }

  // --- Data ---------------------------------------------------------------

  async function loadReport() {
    try {
      report = await api(`/opponents/${opponentId}/report`);
    } catch (err) {
      report = { error: err.message };
    }
    if (alive) {
      renderSummary();
      if (tab === 'repertoire') renderTab();
    }
  }

  async function loadGames() {
    try {
      ({ games } = await api(`/opponents/${opponentId}/games`));
    } catch (err) {
      games = [];
    }
    if (alive) {
      renderTabBar();
      if (tab === 'games') renderTab();
    }
  }

  async function loadOtb() {
    if (!opp.cfc_id && !opp.fide_id) {
      otb = { linked: false };
    } else {
      try {
        otb = await api(`/opponents/${opponentId}/otb`);
      } catch (err) {
        otb = { linked: true, error: err.message };
      }
    }
    if (!alive) return;
    if (otb.profile) {
      const rating = pickRating(otb.profile);
      if (rating && rating !== opp.rating) {
        opp.rating = rating;
        onChanged?.({ ...opp, note_count: notes.length });
      }
    }
    renderHeader();
    renderSummary();
    renderTabBar();
    if (tab === 'games') renderTab();
  }

  // Pull fresh online games in the background when they're stale.
  function maybeSync(force = false) {
    if (!opp.chesscom && !opp.lichess) return;
    const last = opp.synced_at ? new Date(opp.synced_at).getTime() : 0;
    if (!force && Date.now() - last < SYNC_AFTER_MS) return;
    sync();
  }

  async function sync() {
    if (syncing) return;
    syncing = true;
    renderSyncState();
    let message = '';
    try {
      const { imported, errors } = await api(`/opponents/${opponentId}/import`, { method: 'POST' });
      opp.synced_at = new Date().toISOString();
      message = errors?.length ? errors.join('; ') : '';
      if (imported) {
        opp.game_count = (opp.game_count || 0) + imported;
        onChanged?.({ ...opp, note_count: notes.length });
        await Promise.all([loadReport(), loadGames()]);
      }
    } catch (err) {
      message = err.message;
    }
    syncing = false;
    if (!alive) return;
    renderSyncState(message);
    if (tab !== 'notes') renderTab();
  }

  // --- Shell --------------------------------------------------------------

  function renderShell() {
    el.innerHTML = `
      <div class="dz">
        <button class="text-link dz-back"><i data-lucide="arrow-left"></i> All opponents</button>
        <header class="dz-head card"></header>
        <div class="dz-summary"></div>
        <nav class="dz-tabs" role="tablist"></nav>
        <section class="dz-panel" role="tabpanel"></section>
      </div>`;
    el.querySelector('.dz-back').addEventListener('click', () => onBack?.());
    renderHeader();
    renderSummary();
    renderTabBar();
    renderTab();
  }

  function renderHeader() {
    const head = el.querySelector('.dz-head');
    if (!head) return;
    const chips = [];
    const rating = opp.rating || (otb?.profile && pickRating(otb.profile));
    if (otb?.profile) {
      for (const r of otb.profile.ratings.filter((x) => x.value)) {
        chips.push(`<span class="dz-rating"><span class="dz-rating-fed">${escapeHtml(r.federation)}${r.label === 'Quick' ? ' quick' : ''}</span>${r.value}</span>`);
      }
    } else if (rating) {
      chips.push(`<span class="dz-rating"><span class="dz-rating-fed">Rating</span>${rating}</span>`);
    }
    const accounts = [
      opp.chesscom && { label: `chess.com/${opp.chesscom}`, url: `https://www.chess.com/member/${encodeURIComponent(opp.chesscom)}` },
      opp.lichess && { label: `lichess/${opp.lichess}`, url: `https://lichess.org/@/${encodeURIComponent(opp.lichess)}` },
      opp.cfc_id && { label: `CFC #${opp.cfc_id}`, url: `https://www.chess.ca/en/ratings/p/?id=${encodeURIComponent(opp.cfc_id)}` },
      opp.fide_id && { label: `FIDE #${opp.fide_id}`, url: `https://ratings.fide.com/profile/${encodeURIComponent(opp.fide_id)}` },
    ].filter(Boolean);
    const place = otb?.profile ? [otb.profile.title, otb.profile.city || otb.profile.country].filter(Boolean).join(' · ') : '';

    head.innerHTML = `
      <span class="dz-avatar">${escapeHtml(initials(opp.name))}</span>
      <div class="dz-id">
        <h2 class="dz-name">${escapeHtml(opp.name)}</h2>
        ${place ? `<div class="dz-place">${escapeHtml(place)}</div>` : ''}
        <div class="dz-ratings">${chips.join('')}</div>
        <div class="dz-accounts">
          ${accounts.length
            ? accounts.map((a) => `<a class="dz-acct" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.label)}<i data-lucide="arrow-up-right"></i></a>`).join('')
            : '<span class="dz-noacct">No accounts linked. Edit to add Chess.com, Lichess or a CFC/FIDE link.</span>'}
        </div>
      </div>
      <div class="dz-actions">
        <button class="btn btn-secondary dz-edit"><i data-lucide="pencil"></i>Edit</button>
        ${opp.chesscom || opp.lichess ? '<button class="btn btn-secondary dz-sync"><i data-lucide="refresh-cw"></i><span>Sync games</span></button>' : ''}
        <span class="dz-sync-state"></span>
      </div>`;
    head.querySelector('.dz-edit').addEventListener('click', openEdit);
    head.querySelector('.dz-sync')?.addEventListener('click', () => maybeSync(true));
    renderSyncState();
    refreshIcons();
  }

  function renderSyncState(message = '') {
    const stateEl = el.querySelector('.dz-sync-state');
    const btn = el.querySelector('.dz-sync');
    if (!stateEl) return;
    if (btn) {
      btn.disabled = syncing;
      btn.classList.toggle('is-spinning', syncing);
      btn.querySelector('span').textContent = syncing ? 'Syncing…' : 'Sync games';
    }
    stateEl.textContent = message || (syncing ? '' : opp.synced_at ? `Synced ${timeAgo(opp.synced_at)}` : '');
    stateEl.classList.toggle('is-error', Boolean(message));
  }

  function openEdit() {
    const head = el.querySelector('.dz-head');
    const holder = document.createElement('div');
    head.replaceWith(holder);
    renderOpponentForm(holder, {
      initial: opp,
      title: 'Edit opponent',
      submitLabel: 'Save changes',
      onCancel: () => {
        holder.replaceWith(head);
      },
      onDelete: async () => {
        if (!confirm(`Remove ${opp.name} from this event? Their notes and games go too.`)) return;
        await api(`/opponents/${opponentId}`, { method: 'DELETE' });
        onRemoved?.();
      },
      onSubmit: async (values) => {
        const linksChanged = values.cfcId !== (opp.cfc_id || '') || values.fideId !== (opp.fide_id || '');
        const { opponent } = await api(`/opponents/${opponentId}`, { method: 'PATCH', body: values });
        opp = { ...opp, ...opponent };
        holder.replaceWith(head);
        onChanged?.({ ...opp, note_count: notes.length });
        renderHeader();
        if (linksChanged) {
          otb = null;
          loadOtb();
        }
        maybeSync();
      },
    });
  }

  // --- Summary strip (record, style) ----------------------------------------

  function renderSummary() {
    const box = el.querySelector('.dz-summary');
    if (!box) return;
    const items = [];
    if (report && !report.error && report.gameCount) {
      const t = report.totals;
      items.push(stat('Online record', `<span class="rec win">${t.win}W</span> <span class="rec draw">${t.draw}D</span> <span class="rec loss">${t.loss}L</span>`, `${report.gameCount} games`));
    }
    const otbRec = otbRecord();
    if (otbRec.games) {
      items.push(stat('OTB record', `<span class="rec win">${otbRec.win}W</span> <span class="rec draw">${otbRec.draw}D</span> <span class="rec loss">${otbRec.loss}L</span>`, `${otbRec.events} CFC events`));
    }
    const last = otb?.events?.[0];
    if (last) {
      const change = last.post != null && last.pre != null ? last.post - last.pre : null;
      items.push(stat('Last event', escapeHtml(last.name), `${fmtDate(last.date)}${last.score != null ? ` · ${last.score}/${last.games}` : ''}${change ? ` · ${change > 0 ? '+' : ''}${change}` : ''}`));
    }
    if (report && !report.error && report.gameCount) {
      items.push(stat('Style', report.playstyle.tags.map((x) => `<span class="ps-tag">${escapeHtml(x)}</span>`).join(' '), ''));
    }
    box.innerHTML = items.join('');
    box.hidden = !items.length;
  }

  function stat(label, value, sub) {
    return `<div class="dz-stat"><span class="dz-stat-label">${label}</span><span class="dz-stat-value">${value}</span>${sub ? `<span class="dz-stat-sub">${escapeHtml(sub)}</span>` : ''}</div>`;
  }

  function otbRecord() {
    const rec = { win: 0, draw: 0, loss: 0, games: 0, events: 0 };
    for (const e of otb?.events || []) {
      if (e.rounds.length) rec.events += 1;
      for (const r of e.rounds) {
        if (r.bye) continue;
        rec[r.result] += 1;
        rec.games += 1;
      }
    }
    return rec;
  }

  // --- Tabs -----------------------------------------------------------------

  function renderTabBar() {
    const bar = el.querySelector('.dz-tabs');
    if (!bar) return;
    const gameCount = (games?.length || 0) + otbRecord().games;
    const labels = {
      notes: `Notes${notes.length ? ` <span class="dz-tab-count">${notes.length}</span>` : ''}`,
      repertoire: 'Repertoire',
      games: `Games${gameCount ? ` <span class="dz-tab-count">${gameCount}</span>` : ''}`,
    };
    bar.innerHTML = TABS.map((t) => `<button class="dz-tab${t === tab ? ' active' : ''}" role="tab" aria-selected="${t === tab}" data-tab="${t}">${labels[t]}</button>`).join('');
    for (const b of bar.querySelectorAll('.dz-tab')) b.addEventListener('click', () => setTab(b.dataset.tab));
  }

  function setTab(next) {
    tab = next;
    prefs.set({ dossierTab: next });
    renderTabBar();
    renderTab();
  }

  function renderTab() {
    const panel = el.querySelector('.dz-panel');
    if (!panel) return;
    if (tab === 'notes') renderNotes(panel);
    else if (tab === 'repertoire') renderRepertoire(panel);
    else renderGames(panel);
    refreshIcons();
  }

  // --- Notes ----------------------------------------------------------------

  function renderNotes(panel) {
    panel.innerHTML = `
      <form class="nt-compose card">
        <textarea class="input nt-input" rows="3" placeholder="Add a note: what they played against you, time-trouble habits, what to aim for…"></textarea>
        <div class="nt-compose-foot">
          <span class="nt-hint">${SAVE_HINT}</span>
          <button type="submit" class="btn btn-primary" disabled>Add note</button>
        </div>
      </form>
      <div class="nt-list"></div>`;
    const form = panel.querySelector('.nt-compose');
    const input = form.querySelector('.nt-input');
    const submit = form.querySelector('button[type="submit"]');
    input.addEventListener('input', () => {
      submit.disabled = !input.value.trim();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      submit.disabled = true;
      try {
        const { note } = await api(`/opponents/${opponentId}/notes`, { method: 'POST', body: { body } });
        notes.unshift(note);
        input.value = '';
        noteCountChanged();
        drawList();
      } catch (err) {
        alert(err.message);
        submit.disabled = false;
      }
    });

    const list = panel.querySelector('.nt-list');
    function drawList() {
      if (!notes.length) {
        list.innerHTML = `<div class="prep-empty small"><i data-lucide="notebook-pen"></i><p>No notes yet. Anything you learn about ${escapeHtml(opp.name.split(' ')[0])} goes here, and it's saved to your account.</p></div>`;
        refreshIcons();
        return;
      }
      list.innerHTML = '';
      for (const n of notes) list.appendChild(noteCard(n, drawList));
      refreshIcons();
    }
    drawList();
  }

  function noteCard(n, redraw) {
    const card = document.createElement('article');
    card.className = 'nt-card card';
    const edited = n.updated_at && new Date(n.updated_at) - new Date(n.created_at) > 60000;
    card.innerHTML = `
      <div class="nt-body">${escapeHtml(n.body)}</div>
      <footer class="nt-foot">
        <span class="nt-date" title="${escapeHtml(new Date(n.created_at).toLocaleString())}">${escapeHtml(fmtDate(n.created_at))}${edited ? ' · edited' : ''}</span>
        <span class="nt-actions">
          <button class="icon-btn nt-edit" aria-label="Edit note"><i data-lucide="pencil"></i></button>
          <button class="icon-btn nt-del" aria-label="Delete note"><i data-lucide="trash-2"></i></button>
        </span>
      </footer>`;
    card.querySelector('.nt-del').addEventListener('click', async () => {
      if (!confirm('Delete this note?')) return;
      await api(`/notes/${n.id}`, { method: 'DELETE' });
      notes = notes.filter((x) => x.id !== n.id);
      noteCountChanged();
      redraw();
    });
    card.querySelector('.nt-edit').addEventListener('click', () => {
      card.innerHTML = `
        <textarea class="input nt-input" rows="4">${escapeHtml(n.body)}</textarea>
        <div class="nt-compose-foot">
          <span class="nt-hint"></span>
          <button class="btn btn-ghost nt-cancel">Cancel</button>
          <button class="btn btn-primary nt-save">Save</button>
        </div>`;
      const ta = card.querySelector('textarea');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      card.querySelector('.nt-cancel').addEventListener('click', redraw);
      const save = async () => {
        const body = ta.value.trim();
        if (!body) return;
        const { note } = await api(`/notes/${n.id}`, { method: 'PATCH', body: { body } });
        Object.assign(n, note);
        redraw();
      };
      card.querySelector('.nt-save').addEventListener('click', save);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
        if (e.key === 'Escape') redraw();
      });
    });
    return card;
  }

  function noteCountChanged() {
    renderTabBar();
    onChanged?.({ ...opp, note_count: notes.length });
  }

  // --- Repertoire -----------------------------------------------------------

  function renderRepertoire(panel) {
    if (!report) {
      panel.innerHTML = '<div class="prep-loading">Building repertoire…</div>';
      return;
    }
    if (report.error) {
      panel.innerHTML = `<div class="prep-error">${escapeHtml(report.error)}</div>`;
      return;
    }
    if (!report.gameCount) {
      panel.innerHTML = emptyGames('Their repertoire is built from their games.');
      wireEmpty(panel);
      return;
    }
    const col = (title, color, list) => `
      <div class="rp-col card">
        <h3 class="rp-col-title"><span class="og-color og-${color === 'white' ? 'w' : 'b'}"></span>${title}</h3>
        ${list.length ? list.map((o) => openingRow(o, color)).join('') : '<div class="prep-empty small"><p>No games with this colour yet.</p></div>'}
      </div>`;
    panel.innerHTML = `
      <div class="rp-prep card">
        <h3 class="rp-col-title"><i data-lucide="target"></i>What to prepare</h3>
        <ul class="prep-list">${report.prep.map((p) => `<li><i data-lucide="check"></i><span>${escapeHtml(p)}</span></li>`).join('')}</ul>
      </div>
      <div class="rp-cols">
        ${col('As White', 'white', report.openingsWhite)}
        ${col('As Black', 'black', report.openingsBlack)}
      </div>
      <p class="rp-foot">Based on ${report.gameCount} online and uploaded game${report.gameCount === 1 ? '' : 's'}. Tap an opening to see those games.</p>`;
    for (const row of panel.querySelectorAll('.rp-row')) {
      row.addEventListener('click', () => {
        gameFilter.source = 'online';
        gameFilter.opening = row.dataset.opening;
        gameFilter.color = row.dataset.color;
        setTab('games');
      });
    }
  }

  function openingRow(o, color) {
    const w = o.count ? Math.round((o.win / o.count) * 100) : 0;
    const d = o.count ? Math.round((o.draw / o.count) * 100) : 0;
    const score = o.count ? Math.round(((o.win + o.draw / 2) / o.count) * 100) : 0;
    return `
      <button class="rp-row" data-opening="${escapeHtml(o.name)}" data-color="${color}">
        <span class="rp-row-top">
          <span class="rp-name">${escapeHtml(o.name)}</span>
          <span class="rp-count mono">${o.count} · ${score}%</span>
        </span>
        <span class="rp-bar" aria-label="${o.win} wins, ${o.draw} draws, ${o.loss} losses">
          <span class="seg win" style="width:${w}%"></span><span class="seg draw" style="width:${d}%"></span><span class="seg loss" style="width:${100 - w - d}%"></span>
        </span>
      </button>`;
  }

  // --- Games ----------------------------------------------------------------

  function renderGames(panel) {
    const online = games || [];
    const otbGames = otbRecord().games;
    const source = gameFilter.source || (!online.length && otbGames ? 'otb' : 'online');
    const seg = (key, label, n) => `<button class="seg-btn${source === key ? ' active' : ''}" data-src="${key}">${label}${n != null ? ` <span class="dz-tab-count">${n}</span>` : ''}</button>`;
    panel.innerHTML = `
      <div class="gm-bar">
        <div class="seg-control">
          ${seg('online', 'Online & PGN', games ? online.length : null)}
          ${seg('otb', 'Over the board', otb ? otbGames : null)}
        </div>
        <button class="btn btn-secondary gm-add"><i data-lucide="file-plus-2"></i>Paste PGN</button>
      </div>
      <form class="gm-upload card" hidden>
        <textarea class="input gm-pgn" rows="5" placeholder="Paste one or more games in PGN (e.g. from your own scoresheets or a tournament bulletin)…"></textarea>
        <div class="nt-compose-foot">
          <span class="nt-hint gm-upload-status"></span>
          <button type="button" class="btn btn-ghost gm-upload-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Save games</button>
        </div>
      </form>
      <div class="gm-body"></div>`;

    for (const b of panel.querySelectorAll('.seg-btn')) {
      b.addEventListener('click', () => {
        gameFilter.source = b.dataset.src;
        renderGames(panel);
        refreshIcons();
      });
    }
    const upload = panel.querySelector('.gm-upload');
    panel.querySelector('.gm-add').addEventListener('click', () => {
      upload.hidden = !upload.hidden;
      if (!upload.hidden) upload.querySelector('textarea').focus();
    });
    panel.querySelector('.gm-upload-cancel').addEventListener('click', () => {
      upload.hidden = true;
    });
    upload.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pgn = upload.querySelector('textarea').value.trim();
      if (!pgn) return;
      const status = upload.querySelector('.gm-upload-status');
      status.textContent = 'Saving…';
      try {
        const { imported } = await api(`/opponents/${opponentId}/games`, { method: 'POST', body: { pgn } });
        opp.game_count = (opp.game_count || 0) + imported;
        onChanged?.({ ...opp, note_count: notes.length });
        gameFilter.source = 'online';
        await Promise.all([loadReport(), loadGames()]);
      } catch (err) {
        status.textContent = err.message;
      }
    });

    const body = panel.querySelector('.gm-body');
    if (source === 'online') renderOnline(body, online);
    else renderOtb(body);
  }

  function renderOnline(body, online) {
    if (!games) {
      body.innerHTML = '<div class="prep-loading">Loading games…</div>';
      return;
    }
    if (!online.length) {
      body.innerHTML = syncing
        ? '<div class="prep-loading">Pulling their online games…</div>'
        : emptyGames('No online games yet.');
      wireEmpty(body);
      return;
    }
    const list = online.filter((g) =>
      (!gameFilter.opening || (g.opening || 'Unknown') === gameFilter.opening) &&
      (!gameFilter.color || g.opp_color === gameFilter.color));
    body.innerHTML = `
      ${gameFilter.opening ? `
        <div class="gm-filter">
          <span>Showing <strong>${escapeHtml(gameFilter.opening)}</strong> as ${gameFilter.color === 'black' ? 'Black' : 'White'}</span>
          <button class="text-link gm-clear"><i data-lucide="x"></i>Show all</button>
        </div>` : ''}
      <div class="gm-list"></div>`;
    body.querySelector('.gm-clear')?.addEventListener('click', () => {
      gameFilter.opening = gameFilter.color = null;
      renderTab();
    });
    const listEl = body.querySelector('.gm-list');
    for (const g of list) {
      const rv = resultView(g.opp_result);
      const vs = g.opp_color === 'white' ? g.black : g.white;
      const row = document.createElement('button');
      row.className = 'gm-row';
      row.innerHTML = `
        <span class="og-color og-${g.opp_color === 'black' ? 'b' : 'w'}" title="${escapeHtml(opp.name)} had ${g.opp_color === 'black' ? 'Black' : 'White'}"></span>
        <span class="gm-main">
          <span class="gm-top"><span class="gm-vs">vs ${escapeHtml(vs || 'Unknown')}</span><span class="gm-result ${rv.cls}">${rv.label}</span></span>
          <span class="gm-meta">${escapeHtml(g.opening || 'Unknown opening')}</span>
        </span>
        <span class="gm-side">
          <span class="gm-date">${escapeHtml(fmtDate(g.played_at))}</span>
          <span class="gm-src">${escapeHtml(sourceLabel(g))}</span>
        </span>
        <i data-lucide="chevron-right" class="gm-go"></i>`;
      row.addEventListener('click', () => navigate('opponent', { id: opponentId, sub: g.id }));
      listEl.appendChild(row);
    }
  }

  function renderOtb(body) {
    if (!otb) {
      body.innerHTML = '<div class="prep-loading">Fetching their CFC record…</div>';
      return;
    }
    if (!otb.linked) {
      body.innerHTML = `
        <div class="prep-empty small">
          <i data-lucide="link"></i>
          <p>Link ${escapeHtml(opp.name)} to their CFC profile to pull every rated game they've played: opponent, rating and result, event by event.</p>
          <button class="btn btn-primary gm-link"><i data-lucide="search"></i>Find on CFC</button>
        </div>`;
      body.querySelector('.gm-link').addEventListener('click', openEdit);
      return;
    }
    if (otb.error) {
      body.innerHTML = `<div class="prep-error">Couldn't reach CFC: ${escapeHtml(otb.error)}</div>`;
      return;
    }
    const events = otb.events || [];
    if (!events.length) {
      body.innerHTML = `<div class="prep-empty small"><p>${opp.cfc_id ? 'No CFC-rated events on record.' : 'Only a FIDE id is linked. Add their CFC id to see their OTB game log.'}</p></div>`;
      return;
    }
    body.innerHTML = `<p class="gm-note">From CFC crosstables. Results only: moves aren't published, so paste PGN if you have their scoresheets.</p><div class="ev-log"></div>`;
    const log = body.querySelector('.ev-log');
    for (const e of events) {
      const change = e.post != null && e.pre != null ? e.post - e.pre : null;
      const details = document.createElement('details');
      details.className = 'evl card';
      details.open = events.indexOf(e) < 3;
      details.innerHTML = `
        <summary class="evl-head">
          <span class="evl-title">
            <span class="evl-name">${escapeHtml(e.name)}</span>
            <span class="evl-meta">${escapeHtml(fmtDate(e.date))} · ${e.type}${e.perf ? ` · perf ${e.perf}` : ''}</span>
          </span>
          <span class="evl-score mono">${e.score ?? '–'}/${e.games ?? '–'}</span>
          ${change != null ? `<span class="evl-delta mono ${change > 0 ? 'up' : change < 0 ? 'down' : ''}">${change > 0 ? '+' : ''}${change}</span>` : '<span class="evl-delta"></span>'}
        </summary>
        <div class="evl-rounds">
          ${e.unavailable ? '<div class="evl-empty">Crosstable unavailable for this event.</div>' : ''}
          ${e.rounds.map((r) => {
            const rv = resultView(r.result);
            return r.bye
              ? `<div class="evl-round bye"><span class="evl-rnd mono">R${r.round}</span><span class="evl-opp">Bye / forfeit</span><span class="gm-result ${rv.cls}">${rv.short}</span></div>`
              : `<div class="evl-round"><span class="evl-rnd mono">${r.round ? `R${r.round}` : 'RR'}</span><span class="evl-opp">${escapeHtml(r.opponent)}${r.opponentRating ? ` <span class="evl-opp-rating mono">${r.opponentRating}</span>` : ''}</span><span class="gm-result ${rv.cls}">${rv.short}</span></div>`;
          }).join('')}
        </div>`;
      log.appendChild(details);
    }
  }

  function emptyGames(lead) {
    const hasOnline = opp.chesscom || opp.lichess;
    return `
      <div class="prep-empty small">
        <i data-lucide="swords"></i>
        <p>${escapeHtml(lead)} ${hasOnline ? 'Sync to pull their latest games, or paste PGN.' : 'Add their Chess.com or Lichess username to pull games automatically, or paste PGN.'}</p>
        ${hasOnline ? '<button class="btn btn-primary gm-empty-sync"><i data-lucide="refresh-cw"></i>Sync games</button>' : '<button class="btn btn-primary gm-empty-edit"><i data-lucide="link"></i>Link accounts</button>'}
      </div>`;
  }

  function wireEmpty(root) {
    root.querySelector('.gm-empty-sync')?.addEventListener('click', () => {
      maybeSync(true);
      renderTab();
    });
    root.querySelector('.gm-empty-edit')?.addEventListener('click', openEdit);
    refreshIcons();
  }

  init();

  return {
    destroy() {
      alive = false;
    },
  };
}

function pickRating(profile) {
  return profile.ratings.find((r) => r.federation === 'CFC' && r.label === 'Regular')?.value
    ?? profile.ratings.find((r) => r.federation === 'FIDE')?.value
    ?? null;
}

function sourceLabel(g) {
  if (g.source === 'upload') return 'PGN';
  if (g.source === 'chesscom') return `Chess.com${g.time_class ? ` · ${g.time_class}` : ''}`;
  if (g.source === 'lichess') return `Lichess${g.time_class ? ` · ${g.time_class}` : ''}`;
  return g.source || '';
}
