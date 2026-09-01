import { navigate } from '../router.js';
import { store } from '../store.js';
import { refreshIcons } from '../router.js';
import { sparklineSVG } from '../analysis/sparkline.js';

// Opponent scouting with two modes:
//   Online — Chess.com / Lichess username → openings + recent games dossier.
//   Over the Board — federation search (CFC / FIDE) → ratings, rating history,
//   full tournament history, and deep links to game databases.
export const scoutScreen = {
  mount(root) {
    const wrap = document.createElement('div');
    wrap.className = 'screen scout-screen';
    wrap.innerHTML = `
      <div class="scout-head">
        <div>
          <h1>Scout an Opponent</h1>
          <p class="scout-tagline">Know what they play before you sit down across the board.</p>
        </div>
        <button class="text-link back-link">← Menu</button>
      </div>

      <div class="scout-tabs">
        <button class="scout-tab active" data-tab="online">Online</button>
        <button class="scout-tab" data-tab="otb">Over the Board</button>
      </div>

      <section class="tab-panel" data-panel="online"></section>
      <section class="tab-panel" data-panel="otb" hidden></section>
    `;
    root.appendChild(wrap);

    wrap.querySelector('.back-link').addEventListener('click', () => navigate('menu'));

    const tabs = wrap.querySelectorAll('.scout-tab');
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        for (const t of tabs) t.classList.toggle('active', t === tab);
        for (const p of wrap.querySelectorAll('.tab-panel')) {
          p.hidden = p.dataset.panel !== tab.dataset.tab;
        }
      });
    }

    mountOnline(wrap.querySelector('[data-panel="online"]'));
    mountOtb(wrap.querySelector('[data-panel="otb"]'));
  },
};

// ---------------- Online mode ----------------
function mountOnline(panel) {
  let platform = 'chesscom';
  panel.innerHTML = `
    <form class="scout-form">
      <div class="platform-toggle">
        <button type="button" class="plat-btn active" data-plat="chesscom">Chess.com</button>
        <button type="button" class="plat-btn" data-plat="lichess">Lichess</button>
      </div>
      <input class="scout-input" type="text" placeholder="chess.com username" autocomplete="off" spellcheck="false" />
      <button type="submit" class="btn btn-primary">Scout</button>
    </form>
    <div class="scout-status"></div>
    <div class="scout-result" hidden></div>
  `;
  const input = panel.querySelector('.scout-input');
  const statusEl = panel.querySelector('.scout-status');
  const resultEl = panel.querySelector('.scout-result');

  for (const btn of panel.querySelectorAll('.plat-btn')) {
    btn.addEventListener('click', () => {
      platform = btn.dataset.plat;
      for (const b of panel.querySelectorAll('.plat-btn')) b.classList.toggle('active', b === btn);
      input.placeholder = platform === 'lichess' ? 'lichess username' : 'chess.com username';
    });
  }

  panel.querySelector('.scout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = input.value.trim();
    if (!username) return;
    resultEl.hidden = true;
    statusEl.innerHTML = `<div class="scout-loading">Fetching ${escapeHtml(username)}'s games…</div>`;
    let d;
    try {
      const res = await fetch(`/api/scout?platform=${platform}&username=${encodeURIComponent(username)}`);
      d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Lookup failed');
    } catch (err) {
      statusEl.innerHTML = `<div class="scout-error">${escapeHtml(err.message)}</div>`;
      return;
    }
    statusEl.innerHTML = '';
    renderOnline(resultEl, d);
  });
}

function renderOnline(resultEl, d) {
  resultEl.hidden = false;
  const total = d.totalGames || 0;
  resultEl.innerHTML = `
    <div class="dossier-header">
      <div class="dossier-id">
        ${d.avatar ? `<img class="dossier-avatar" src="${d.avatar}" alt="" />` : '<span class="dossier-avatar placeholder"><i data-lucide="user"></i></span>'}
        <div>
          <div class="dossier-name">${d.title ? `<span class="title-badge">${d.title}</span>` : ''}${escapeHtml(d.username)}</div>
          <a class="dossier-link" href="${d.url}" target="_blank" rel="noopener">on ${d.platform === 'lichess' ? 'Lichess' : 'Chess.com'} ↗</a>
        </div>
      </div>
      <div class="dossier-record">
        <div class="record-line"><span class="rec win">${d.totals.win}W</span><span class="rec draw">${d.totals.draw}D</span><span class="rec loss">${d.totals.loss}L</span></div>
        <div class="record-sub">across ${total} recent games</div>
      </div>
    </div>
    <div class="dossier-cols">
      ${openingCol('As White', d.openings.white)}
      ${openingCol('As Black', d.openings.black)}
    </div>
    <h2 class="recent-title">Recent games</h2>
    <div class="recent-games"></div>
  `;
  const rg = resultEl.querySelector('.recent-games');
  for (const g of d.recentGames || []) {
    const row = document.createElement('div');
    row.className = 'recent-row';
    const resClass = g.result === 'win' ? 'win' : g.result === 'loss' ? 'loss' : 'draw';
    row.innerHTML = `
      <span class="rg-color rg-${g.color}" title="${g.color}"></span>
      <span class="rg-result ${resClass}">${g.result[0].toUpperCase()}</span>
      <span class="rg-opening">${escapeHtml(g.opening || 'Unknown')}</span>
      <span class="rg-opp">vs ${escapeHtml(g.opponent || '?')}${g.opponentRating ? ` (${g.opponentRating})` : ''}</span>
      <span class="rg-tc">${escapeHtml(g.timeClass)}</span>
    `;
    if (g.pgn) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost rg-analyze';
      btn.textContent = 'Analyze';
      btn.addEventListener('click', () => {
        store.set({ lastPgn: g.pgn });
        navigate('analysis');
      });
      row.appendChild(btn);
    }
    rg.appendChild(row);
  }
  refreshIcons();
}

function openingCol(title, list) {
  const rows = (list || [])
    .map((o) => {
      const w = o.count ? Math.round((o.win / o.count) * 100) : 0;
      const dr = o.count ? Math.round((o.draw / o.count) * 100) : 0;
      const l = 100 - w - dr;
      return `
        <div class="op-row">
          <div class="op-top"><span class="op-name">${escapeHtml(o.name)}</span><span class="op-count mono">${o.count}</span></div>
          <div class="op-bar">
            <span class="op-seg win" style="width:${w}%"></span>
            <span class="op-seg draw" style="width:${dr}%"></span>
            <span class="op-seg loss" style="width:${l}%"></span>
          </div>
          <div class="op-splits mono">${o.win}W · ${o.draw}D · ${o.loss}L</div>
        </div>`;
    })
    .join('');
  return `<div class="op-col"><h3 class="op-col-title">${title}</h3>${rows || '<div class="op-empty">No games found.</div>'}</div>`;
}

// ---------------- Over-the-board mode ----------------
function mountOtb(panel) {
  panel.innerHTML = `
    <form class="scout-form">
      <input class="otb-input" type="text" placeholder="player name (e.g. Nikolay Noritsyn)" autocomplete="off" />
      <button type="submit" class="btn btn-primary">Search</button>
    </form>
    <p class="otb-hint">Searches FIDE and the Chess Federation of Canada. Best coverage for rated tournament players.</p>
    <div class="otb-status"></div>
    <div class="otb-candidates"></div>
    <div class="otb-profile" hidden></div>
  `;
  const input = panel.querySelector('.otb-input');
  const statusEl = panel.querySelector('.otb-status');
  const candEl = panel.querySelector('.otb-candidates');
  const profileEl = panel.querySelector('.otb-profile');

  panel.querySelector('.scout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (name.length < 2) return;
    profileEl.hidden = true;
    candEl.innerHTML = '';
    statusEl.innerHTML = `<div class="scout-loading">Searching federations…</div>`;
    let data;
    try {
      const res = await fetch(`/api/otb/search?name=${encodeURIComponent(name)}`);
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
    } catch (err) {
      statusEl.innerHTML = `<div class="scout-error">${escapeHtml(err.message)}</div>`;
      return;
    }
    statusEl.innerHTML = '';
    renderCandidates(data.candidates || []);
  });

  function renderCandidates(candidates) {
    if (!candidates.length) {
      candEl.innerHTML = '<div class="op-empty">No players found. Try a different spelling.</div>';
      return;
    }
    candEl.innerHTML = '<h3 class="otb-sub">Select a player</h3>';
    for (const c of candidates) {
      const btn = document.createElement('button');
      btn.className = 'otb-candidate';
      btn.innerHTML = `
        <span class="cand-main">
          ${c.title ? `<span class="title-badge">${c.title}</span>` : ''}
          <span class="cand-name">${escapeHtml(c.name)}</span>
        </span>
        <span class="cand-meta mono">${c.rating ? `${c.rating}` : '—'} · ${escapeHtml(c.country || '')} · ${c.source.toUpperCase()}</span>
      `;
      btn.addEventListener('click', () => loadProfile(c));
      candEl.appendChild(btn);
    }
  }

  async function loadProfile(c) {
    candEl.innerHTML = '';
    statusEl.innerHTML = `<div class="scout-loading">Building profile for ${escapeHtml(c.name)}…</div>`;
    const params = new URLSearchParams();
    if (c.cfcId) params.set('cfc', c.cfcId);
    if (c.fideId) params.set('fide', c.fideId);
    let p;
    try {
      const res = await fetch(`/api/otb/player?${params.toString()}`);
      p = await res.json();
      if (!res.ok) throw new Error(p.error || 'Lookup failed');
    } catch (err) {
      statusEl.innerHTML = `<div class="scout-error">${escapeHtml(err.message)}</div>`;
      return;
    }
    statusEl.innerHTML = '';
    renderProfile(p);
  }

  function renderProfile(p) {
    profileEl.hidden = false;
    const ratingCards = p.ratings
      .map(
        (r) => `
        <div class="rating-card">
          <div class="rc-fed">${r.federation} ${r.label}</div>
          <div class="rc-value mono">${r.value ?? '—'}</div>
          ${r.extra ? `<div class="rc-extra">${r.extra}</div>` : ''}
        </div>`,
      )
      .join('');

    const spark = p.ratingHistory && p.ratingHistory.length > 1
      ? `<div class="rating-history"><h3 class="otb-sub">CFC rating history</h3><div class="spark">${sparklineSVG(p.ratingHistory)}</div></div>`
      : '';

    const tourneys = (p.tournaments || [])
      .slice(0, 25)
      .map((t) => {
        const ch = t.change;
        const chClass = ch == null ? '' : ch > 0 ? 'up' : ch < 0 ? 'down' : '';
        const chStr = ch == null ? '' : `${ch > 0 ? '+' : ''}${ch}`;
        return `
          <div class="tourney-row">
            <span class="tr-date mono">${t.date}</span>
            <span class="tr-name">${escapeHtml(t.name)}</span>
            <span class="tr-score mono">${t.score}/${t.games}</span>
            <span class="tr-change mono ${chClass}">${chStr}</span>
          </div>`;
      })
      .join('');

    profileEl.innerHTML = `
      <div class="dossier-header">
        <div class="dossier-id">
          <span class="dossier-avatar placeholder"><i data-lucide="user"></i></span>
          <div>
            <div class="dossier-name">${p.title ? `<span class="title-badge">${p.title}</span>` : ''}${escapeHtml(p.name)}</div>
            <div class="dossier-sub">${[p.country, p.city, p.birthYear ? `b. ${p.birthYear}` : ''].filter(Boolean).map(escapeHtml).join(' · ')}</div>
          </div>
        </div>
        <div class="dossier-ids mono">
          ${p.ids.fide ? `<span>FIDE ${p.ids.fide}</span>` : ''}
          ${p.ids.cfc ? `<span>CFC ${p.ids.cfc}</span>` : ''}
        </div>
      </div>

      <div class="rating-cards">${ratingCards}</div>
      ${spark}

      ${p.hasCfc ? `<h2 class="recent-title">Tournament history <span class="tr-count">(${p.tournaments.length})</span></h2><div class="tourney-list">${tourneys}</div>` : '<div class="op-empty">No detailed tournament history available for this player.</div>'}

      <div class="otb-note">
        <i data-lucide="info"></i>
        <span>Game moves aren't available by name from public federation data — use the links below to browse this player's games.</span>
      </div>
      <div class="otb-links">
        ${p.links.map((l) => `<a class="btn btn-secondary" href="${l.url}" target="_blank" rel="noopener">${escapeHtml(l.label)} ↗</a>`).join('')}
      </div>
    `;
    refreshIcons();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
