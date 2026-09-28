import { navigate, replaceHash, refreshIcons } from '../router.js';
import { store } from '../store.js';
import { api } from '../net/api.js';
import { userReady } from '../authClient.js';
import { createReviewBoard } from '../analysis/reviewBoard.js';
import { fmtDate } from '../tracker/util.js';

let mounted = 0;

// Review a single opponent's real games on an engine board: pick a game from the
// list and it plays out on the board with Stockfish evaluating every position,
// live candidate lines, and the best move they (or their opponent) should have
// played at each turn. URL: #/opponent/<opponent id>/<game id>, so a refresh
// reopens the same game.
export const opponentScreen = {
  async mount(root, params = {}) {
    const token = ++mounted;
    await userReady();
    if (token !== mounted) return;
    if (!store.get('user')) return navigate('login');
    const opponentId = params.id;
    if (!opponentId) return navigate('trackers');
    let trackerId = null;

    const wrap = document.createElement('div');
    wrap.className = 'screen opponent-screen';
    wrap.innerHTML = `
      <div class="scout-head">
        <div>
          <button class="text-link back-link"><i data-lucide="arrow-left"></i> Back to dossier</button>
          <h1 class="opp-title">Games</h1>
          <p class="opp-sub">Replay any game with the engine — eval, best moves, and where it turned.</p>
        </div>
        <label class="depth-label">Depth
          <select class="depth-select">
            <option value="10">10 (fast)</option>
            <option value="12" selected>12</option>
            <option value="14">14</option>
            <option value="16">16 (deep)</option>
          </select>
        </label>
      </div>

      <div class="opp-layout">
        <aside class="opp-games">
          <div class="opp-games-head">
            <span class="opp-games-title">Games</span>
            <span class="opp-games-count mono"></span>
          </div>
          <div class="opp-games-list"><div class="scout-loading">Loading games…</div></div>
        </aside>
        <section class="opp-review">
          <div class="opp-review-empty">
            <i data-lucide="mouse-pointer-click"></i>
            <p>Pick a game to replay it with the engine.</p>
          </div>
        </section>
      </div>
    `;
    root.appendChild(wrap);
    refreshIcons();

    wrap.querySelector('.back-link').addEventListener('click', () =>
      trackerId ? navigate('tracker', { id: trackerId, sub: opponentId }) : navigate('trackers'),
    );

    const listEl = wrap.querySelector('.opp-games-list');
    const countEl = wrap.querySelector('.opp-games-count');
    const reviewEl = wrap.querySelector('.opp-review');
    const depthSelect = wrap.querySelector('.depth-select');

    let reviewBoard = null;
    let activeGameId = null;
    this._getBoard = () => reviewBoard;

    let games = [];
    let oppName = 'Opponent';
    try {
      const data = await api(`/opponents/${opponentId}/games`);
      games = data.games;
      oppName = data.opponent.name;
      trackerId = data.opponent.tracker_id;
    } catch (err) {
      if (token === mounted) listEl.innerHTML = `<div class="scout-error">${escapeHtml(err.message)}</div>`;
      return;
    }
    if (token !== mounted) return;

    wrap.querySelector('.opp-title').textContent = oppName;
    countEl.textContent = games.length ? `${games.length}` : '';

    if (!games.length) {
      listEl.innerHTML =
        '<div class="op-empty">No games stored yet. Sync their online games or paste PGN from their dossier.</div>';
      return;
    }

    renderGameList();
    const wanted = params.sub && games.find((g) => String(g.id) === String(params.sub));
    if (wanted) openGame(wanted, listEl.querySelector(`.opp-game[data-id="${wanted.id}"]`));

    function renderGameList() {
      listEl.innerHTML = '';
      const lname = oppName.toLowerCase();
      for (const g of games) {
        const item = document.createElement('button');
        item.className = 'opp-game';
        item.dataset.id = g.id;
        const opp = otherPlayer(g, lname);
        const rv = resultView(g.opp_result);
        const date = fmtDate(g.played_at);
        const colorDot = g.opp_color === 'black' ? 'b' : 'w';
        item.innerHTML = `
          <span class="og-color og-${colorDot}" title="Played as ${colorDot === 'w' ? 'White' : 'Black'}"></span>
          <span class="og-body">
            <span class="og-top">
              <span class="og-vs">vs ${escapeHtml(opp || 'Unknown')}</span>
              <span class="og-result ${rv.cls}">${rv.label}</span>
            </span>
            <span class="og-meta">${escapeHtml(g.opening || 'Unknown opening')}${date ? ` · ${date}` : ''}${g.time_class ? ` · ${escapeHtml(g.time_class)}` : ''}</span>
          </span>
        `;
        item.addEventListener('click', () => openGame(g, item));
        listEl.appendChild(item);
      }
      refreshIcons();
    }

    async function openGame(g, itemEl) {
      if (activeGameId === g.id) return;
      activeGameId = g.id;
      replaceHash('opponent', { id: opponentId, sub: g.id });
      itemEl?.scrollIntoView({ block: 'nearest' });
      for (const b of listEl.querySelectorAll('.opp-game')) {
        b.classList.toggle('active', b === itemEl);
      }

      // Fresh review board per game (tears down the previous engine listeners).
      if (reviewBoard) reviewBoard.destroy();
      reviewEl.innerHTML = `
        <div class="opp-review-header">
          <div class="orh-players mono">
            <span class="orh-w">${escapeHtml(g.white || 'White')}</span>
            <span class="orh-sep">vs</span>
            <span class="orh-b">${escapeHtml(g.black || 'Black')}</span>
            <span class="orh-result">${escapeHtml(g.result || '')}</span>
          </div>
          ${g.url ? `<a class="text-link" href="${escapeAttr(g.url)}" target="_blank" rel="noopener">Open source <i data-lucide="arrow-up-right"></i></a>` : ''}
        </div>
      `;
      reviewBoard = createReviewBoard({ mount: reviewEl });
      // Stacked layout (phones): the board is below the list, so bring it into view.
      if (itemEl && window.matchMedia('(max-width: 820px)').matches) {
        reviewEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      let pgn;
      try {
        const { game } = await api(`/games/${g.id}`);
        pgn = game.pgn;
      } catch (err) {
        reviewEl.insertAdjacentHTML('beforeend', `<div class="scout-error">${escapeHtml(err.message)}</div>`);
        return;
      }
      if (!pgn) {
        reviewEl.insertAdjacentHTML('beforeend', '<div class="scout-error">This game has no PGN to analyze.</div>');
        return;
      }

      try {
        await reviewBoard.analyze(pgn, { depth: Number(depthSelect.value) });
        // View the board from the opponent's side by default.
        reviewBoard.setOrientation(g.opp_color === 'black' ? 'b' : 'w');
      } catch {
        /* analyze() already surfaced the error in the progress line */
      }
    }
  },

  unmount() {
    mounted++;
    const board = this._getBoard && this._getBoard();
    if (board) board.destroy();
  },
};

function otherPlayer(g, lname) {
  const w = (g.white || '').toLowerCase();
  const oppIsWhite = g.opp_color ? g.opp_color === 'white' : w.includes(lname.split(' ').pop());
  return oppIsWhite ? g.black : g.white;
}

function resultView(oppResult) {
  if (oppResult === 'win') return { label: 'Win', cls: 'win' };
  if (oppResult === 'loss') return { label: 'Loss', cls: 'loss' };
  if (oppResult === 'draw') return { label: 'Draw', cls: 'draw' };
  return { label: '—', cls: 'unknown' };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
