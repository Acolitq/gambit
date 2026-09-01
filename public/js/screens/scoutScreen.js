import { navigate } from '../router.js';
import { store } from '../store.js';

// Opponent scouting: look up a Chess.com or Lichess player and show a prep
// dossier — their favourite openings by colour with results, plus recent games
// you can open in the analysis board.
export const scoutScreen = {
  mount(root) {
    let platform = 'chesscom';

    const wrap = document.createElement('div');
    wrap.className = 'screen scout-screen';
    wrap.innerHTML = `
      <div class="scout-head">
        <div>
          <h2>Scout an Opponent</h2>
          <p class="scout-tagline">Look up a player's recent games and prep against what they actually play.</p>
        </div>
        <button class="text-link back-link">← Menu</button>
      </div>

      <form class="scout-form">
        <div class="platform-toggle">
          <button type="button" class="plat-btn active" data-plat="chesscom">Chess.com</button>
          <button type="button" class="plat-btn" data-plat="lichess">Lichess</button>
        </div>
        <input class="scout-input" type="text" placeholder="username" autocomplete="off" spellcheck="false" />
        <button type="submit" class="btn btn-primary scout-btn">Scout</button>
      </form>

      <div class="scout-status"></div>
      <div class="scout-result" hidden></div>
    `;
    root.appendChild(wrap);

    const input = wrap.querySelector('.scout-input');
    const statusEl = wrap.querySelector('.scout-status');
    const resultEl = wrap.querySelector('.scout-result');

    for (const btn of wrap.querySelectorAll('.plat-btn')) {
      btn.addEventListener('click', () => {
        platform = btn.dataset.plat;
        for (const b of wrap.querySelectorAll('.plat-btn')) b.classList.toggle('active', b === btn);
        input.placeholder = platform === 'lichess' ? 'lichess username' : 'chess.com username';
      });
    }

    wrap.querySelector('.back-link').addEventListener('click', () => navigate('menu'));

    wrap.querySelector('.scout-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = input.value.trim();
      if (!username) return;
      resultEl.hidden = true;
      statusEl.innerHTML = `<div class="scout-loading">Fetching ${escapeHtml(username)}'s games…</div>`;

      let dossier;
      try {
        const res = await fetch(
          `/api/scout?platform=${platform}&username=${encodeURIComponent(username)}`,
        );
        dossier = await res.json();
        if (!res.ok) throw new Error(dossier.error || 'Lookup failed');
      } catch (err) {
        statusEl.innerHTML = `<div class="scout-error">${escapeHtml(err.message)}</div>`;
        return;
      }
      statusEl.innerHTML = '';
      render(dossier);
    });

    function render(d) {
      resultEl.hidden = false;
      const total = d.totalGames || 0;
      const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
      resultEl.innerHTML = `
        <div class="dossier-header">
          <div class="dossier-id">
            ${d.avatar ? `<img class="dossier-avatar" src="${d.avatar}" alt="" />` : '<span class="dossier-avatar placeholder">♟</span>'}
            <div>
              <div class="dossier-name">
                ${d.title ? `<span class="title-badge">${d.title}</span>` : ''}${escapeHtml(d.username)}
              </div>
              <a class="dossier-link" href="${d.url}" target="_blank" rel="noopener">on ${d.platform === 'lichess' ? 'Lichess' : 'Chess.com'} ↗</a>
            </div>
          </div>
          <div class="dossier-record">
            <div class="record-line">
              <span class="rec win">${d.totals.win}W</span>
              <span class="rec draw">${d.totals.draw}D</span>
              <span class="rec loss">${d.totals.loss}L</span>
            </div>
            <div class="record-sub">across ${total} recent games</div>
          </div>
        </div>

        <div class="dossier-cols">
          ${openingCol('As White', d.openings.white, total)}
          ${openingCol('As Black', d.openings.black, total)}
        </div>

        <h3 class="recent-title">Recent games</h3>
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
    }

    function openingCol(title, list, total) {
      const rows = (list || [])
        .map((o) => {
          const w = o.count ? Math.round((o.win / o.count) * 100) : 0;
          const dr = o.count ? Math.round((o.draw / o.count) * 100) : 0;
          const l = 100 - w - dr;
          return `
            <div class="op-row">
              <div class="op-top"><span class="op-name">${escapeHtml(o.name)}</span><span class="op-count">${o.count}</span></div>
              <div class="op-bar">
                <span class="op-seg win" style="width:${w}%"></span>
                <span class="op-seg draw" style="width:${dr}%"></span>
                <span class="op-seg loss" style="width:${l}%"></span>
              </div>
              <div class="op-splits">${o.win}W · ${o.draw}D · ${o.loss}L</div>
            </div>`;
        })
        .join('');
      return `
        <div class="op-col">
          <h3 class="op-col-title">${title}</h3>
          ${rows || '<div class="op-empty">No games found.</div>'}
        </div>`;
    }
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
