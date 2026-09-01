import { navigate } from '../router.js';
import { store } from '../store.js';
import { api } from '../net/api.js';
import { refreshIcons } from '../router.js';

// A single tracker: its opponents, and each opponent's prep report.
export const trackerScreen = {
  async mount(root, params = {}) {
    if (!store.get('user')) return navigate('login');
    const trackerId = params.id || store.get('currentTrackerId');
    if (!trackerId) return navigate('trackers');
    store.set({ currentTrackerId: trackerId });

    const wrap = document.createElement('div');
    wrap.className = 'screen tracker-screen';
    wrap.innerHTML = `
      <div class="scout-head">
        <div>
          <button class="text-link back-link"><i data-lucide="arrow-left"></i> All trackers</button>
          <h1 class="tk-title">Tracker</h1>
          <p class="tk-sub"></p>
        </div>
        <button class="btn btn-ghost delete-tracker">Delete tracker</button>
      </div>

      <form class="opponent-add card">
        <h3>Add an opponent</h3>
        <div class="oa-grid">
          <input class="oa-name" type="text" placeholder="Name *" required />
          <input class="oa-chesscom" type="text" placeholder="Chess.com username" />
          <input class="oa-lichess" type="text" placeholder="Lichess username" />
          <input class="oa-fide" type="text" placeholder="FIDE id (optional)" />
        </div>
        <button type="submit" class="btn btn-primary">Add opponent</button>
      </form>

      <div class="opponent-list"></div>
    `;
    root.appendChild(wrap);

    wrap.querySelector('.back-link').addEventListener('click', () => navigate('trackers'));

    const listEl = wrap.querySelector('.opponent-list');

    async function load() {
      try {
        const { tracker, opponents } = await api(`/trackers/${trackerId}`);
        wrap.querySelector('.tk-title').textContent = tracker.name;
        wrap.querySelector('.tk-sub').textContent = tracker.event_date
          ? `Event date: ${tracker.event_date.slice(0, 10)}`
          : '';
        renderOpponents(opponents);
      } catch (err) {
        listEl.innerHTML = `<div class="scout-error">${err.message}</div>`;
      }
    }

    wrap.querySelector('.delete-tracker').addEventListener('click', async () => {
      if (!confirm('Delete this tracker and all its opponents?')) return;
      await api(`/trackers/${trackerId}`, { method: 'DELETE' });
      navigate('trackers');
    });

    wrap.querySelector('.opponent-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: wrap.querySelector('.oa-name').value.trim(),
        chesscom: wrap.querySelector('.oa-chesscom').value.trim(),
        lichess: wrap.querySelector('.oa-lichess').value.trim(),
        fideId: wrap.querySelector('.oa-fide').value.trim(),
      };
      if (!body.name) return;
      try {
        await api(`/trackers/${trackerId}/opponents`, { method: 'POST', body });
        e.target.reset();
        load();
      } catch (err) {
        alert(err.message);
      }
    });

    function renderOpponents(opponents) {
      if (!opponents.length) {
        listEl.innerHTML = '<div class="op-empty">No opponents yet — add one above.</div>';
        return;
      }
      listEl.innerHTML = '';
      for (const o of opponents) listEl.appendChild(opponentCard(o, load, trackerId));
      refreshIcons();
    }

    // Fetch the tracker and its opponents on open.
    load();
  },
};

function opponentCard(o, reload, trackerId) {
  const card = document.createElement('div');
  card.className = 'opponent-card card';
  const handles = [
    o.chesscom ? `chess.com/${o.chesscom}` : null,
    o.lichess ? `lichess/${o.lichess}` : null,
    o.fide_id ? `FIDE ${o.fide_id}` : null,
  ].filter(Boolean).join(' · ');

  card.innerHTML = `
    <div class="oc-head">
      <div>
        <button class="oc-name oc-open" title="Review ${escapeHtml(o.name)}'s games">${escapeHtml(o.name)}</button>
        <div class="oc-handles">${escapeHtml(handles) || 'No accounts linked'}</div>
      </div>
      <div class="oc-actions">
        <span class="oc-count mono">${o.game_count} game${o.game_count === 1 ? '' : 's'}</span>
        <button class="btn btn-secondary oc-import">Import online</button>
        <button class="btn btn-secondary oc-upload">Upload PGN</button>
        <button class="btn btn-secondary oc-report-btn">Prep report</button>
        <button class="btn btn-primary oc-games-btn" ${o.game_count ? '' : 'disabled title="No games yet"'}>
          <i data-lucide="swords"></i> Review games
        </button>
        <button class="btn btn-ghost oc-remove" title="Remove"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
    <div class="oc-upload-box" hidden>
      <textarea class="oc-pgn" rows="4" placeholder="Paste one or more games in PGN…"></textarea>
      <button class="btn btn-primary oc-pgn-save">Save games</button>
    </div>
    <div class="oc-status"></div>
    <div class="oc-report-panel" hidden></div>
  `;

  const statusEl = card.querySelector('.oc-status');
  const reportEl = card.querySelector('.oc-report-panel');
  const uploadBox = card.querySelector('.oc-upload-box');

  const openReview = () => navigate('opponent', { id: o.id, trackerId });
  card.querySelector('.oc-open').addEventListener('click', openReview);
  const gamesBtn = card.querySelector('.oc-games-btn');
  if (o.game_count) gamesBtn.addEventListener('click', openReview);

  card.querySelector('.oc-remove').addEventListener('click', async () => {
    if (!confirm(`Remove ${o.name}?`)) return;
    await api(`/opponents/${o.id}`, { method: 'DELETE' });
    reload();
  });

  card.querySelector('.oc-import').addEventListener('click', async () => {
    statusEl.innerHTML = '<div class="scout-loading">Importing online games…</div>';
    try {
      const { imported, errors } = await api(`/opponents/${o.id}/import`, { method: 'POST' });
      statusEl.innerHTML = `<div class="oc-ok">Imported ${imported} new game${imported === 1 ? '' : 's'}.${errors && errors.length ? ' ' + escapeHtml(errors.join('; ')) : ''}</div>`;
      setTimeout(reload, 900);
    } catch (err) {
      statusEl.innerHTML = `<div class="scout-error">${err.message}</div>`;
    }
  });

  card.querySelector('.oc-upload').addEventListener('click', () => {
    uploadBox.hidden = !uploadBox.hidden;
  });
  card.querySelector('.oc-pgn-save').addEventListener('click', async () => {
    const pgn = card.querySelector('.oc-pgn').value.trim();
    if (!pgn) return;
    statusEl.innerHTML = '<div class="scout-loading">Saving…</div>';
    try {
      const { imported } = await api(`/opponents/${o.id}/games`, { method: 'POST', body: { pgn } });
      statusEl.innerHTML = `<div class="oc-ok">Saved ${imported} game${imported === 1 ? '' : 's'}.</div>`;
      card.querySelector('.oc-pgn').value = '';
      uploadBox.hidden = true;
      setTimeout(reload, 900);
    } catch (err) {
      statusEl.innerHTML = `<div class="scout-error">${err.message}</div>`;
    }
  });

  card.querySelector('.oc-report-btn').addEventListener('click', async () => {
    if (!reportEl.hidden) {
      reportEl.hidden = true;
      return;
    }
    reportEl.hidden = false;
    reportEl.innerHTML = '<div class="scout-loading">Building prep report…</div>';
    try {
      const report = await api(`/opponents/${o.id}/report`);
      reportEl.innerHTML = renderReport(report);
      refreshIcons();
    } catch (err) {
      reportEl.innerHTML = `<div class="scout-error">${err.message}</div>`;
    }
  });

  return card;
}

function renderReport(r) {
  if (!r.gameCount) {
    return '<div class="op-empty">No games yet. Import online games or upload PGN to generate a prep report.</div>';
  }
  const openingCol = (title, list) => `
    <div class="op-col">
      <h3 class="op-col-title">${title}</h3>
      ${(list || []).map((o) => {
        const w = o.count ? Math.round((o.win / o.count) * 100) : 0;
        const dr = o.count ? Math.round((o.draw / o.count) * 100) : 0;
        const l = 100 - w - dr;
        return `<div class="op-row">
          <div class="op-top"><span class="op-name">${escapeHtml(o.name)}</span><span class="op-count mono">${o.count}</span></div>
          <div class="op-bar"><span class="op-seg win" style="width:${w}%"></span><span class="op-seg draw" style="width:${dr}%"></span><span class="op-seg loss" style="width:${l}%"></span></div>
        </div>`;
      }).join('') || '<div class="op-empty">—</div>'}
    </div>`;

  return `
    <div class="report-summary">
      <div class="rs-tags">${r.playstyle.tags.map((t) => `<span class="ps-tag">${escapeHtml(t)}</span>`).join('')}</div>
      <p class="rs-text">${escapeHtml(r.playstyle.summary)}</p>
      <div class="rs-stats mono">
        <span class="rec win">${r.totals.win}W</span>
        <span class="rec draw">${r.totals.draw}D</span>
        <span class="rec loss">${r.totals.loss}L</span>
        <span class="rs-sep">·</span>
        <span>${r.drawRate}% draws</span>
        ${r.avgPlies ? `<span class="rs-sep">·</span><span>~${Math.round(r.avgPlies / 2)} moves/game</span>` : ''}
      </div>
    </div>
    <div class="dossier-cols">
      ${openingCol('As White', r.openingsWhite)}
      ${openingCol('As Black', r.openingsBlack)}
    </div>
    <div class="prep-block">
      <h3 class="op-col-title">What to prepare</h3>
      <ul class="prep-list">
        ${r.prep.map((p) => `<li><i data-lucide="check"></i><span>${escapeHtml(p)}</span></li>`).join('')}
      </ul>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
