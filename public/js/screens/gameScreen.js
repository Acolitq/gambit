import { navigate } from '../router.js';
import { store } from '../store.js';
import { getSocket } from '../net/socket.js';
import { createBoard } from '../ui/board.js';
import { createMoveList } from '../ui/moveList.js';
import { createStatusBar } from '../ui/statusBar.js';
import { createGame } from '../game/gameController.js';
import { LEVELS } from '../engine/bot.js';

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const pieceUrl = (color, type) => `/assets/pieces/cburnett/${color}${type.toUpperCase()}.svg`;

export const gameScreen = {
  mount(root, params = {}) {
    const mode = store.get('mode');
    const playerColor = store.get('playerColor') || 'w';
    const level = store.get('level') || 3;
    const gameId = store.get('gameId');
    const socket = mode === 'online' ? getSocket() : null;

    if (mode === 'bot' && !store.get('playerColor')) {
      navigate('menu');
      return;
    }

    const opponentName = mode === 'bot' ? `Computer · Lv ${level} ${LEVELS[level].label}` : 'Opponent';

    const wrap = document.createElement('div');
    wrap.className = 'screen game-screen';
    wrap.innerHTML = `
      <div class="game-main">
        <div class="player-panel" data-slot="top">
          <div class="player-id"><span class="avatar"></span><div><div class="player-name"></div><div class="player-rating">rating —</div></div></div>
          <div class="panel-right"><div class="captured"></div><div class="clock" hidden>5:00</div></div>
        </div>
        <div class="board-host"></div>
        <div class="player-panel" data-slot="bottom">
          <div class="player-id"><span class="avatar"></span><div><div class="player-name"></div><div class="player-rating">rating —</div></div></div>
          <div class="panel-right"><div class="captured"></div><div class="clock" hidden>5:00</div></div>
        </div>
      </div>
      <aside class="game-side">
        <div class="status-host"></div>
        <div class="move-list-host"></div>
        <div class="game-actions">
          <button class="btn btn-danger-outline resign-btn">Resign</button>
          <button class="btn btn-primary newgame-btn">New Game</button>
        </div>
      </aside>
    `;
    root.appendChild(wrap);

    const topPanel = wrap.querySelector('[data-slot="top"]');
    const bottomPanel = wrap.querySelector('[data-slot="bottom"]');
    topPanel.querySelector('.player-name').textContent = opponentName;
    bottomPanel.querySelector('.player-name').textContent = 'You';
    topPanel.querySelector('.avatar').textContent = mode === 'bot' ? '🤖' : '?';
    bottomPanel.querySelector('.avatar').textContent = '🙂';

    const boardHost = wrap.querySelector('.board-host');
    const board = createBoard({
      mount: boardHost,
      orientation: playerColor,
      onMove: (from, to, promo) => controller.handleLocalMove(from, to, promo),
      legalMovesFor: (sq) => controller.legalMovesFor(sq),
    });
    const moveList = createMoveList(wrap.querySelector('.move-list-host'));
    const statusBar = createStatusBar(wrap.querySelector('.status-host'));

    // Captured pieces + material advantage rendering.
    function renderCaptured(cap) {
      // cap.w = the black pieces White has captured; shown in White's panel.
      const whitePanel = playerColor === 'w' ? bottomPanel : topPanel;
      const blackPanel = playerColor === 'w' ? topPanel : bottomPanel;
      paint(whitePanel, cap.w, 'b', score(cap.w) - score(cap.b));
      paint(blackPanel, cap.b, 'w', score(cap.b) - score(cap.w));
    }
    function score(list) {
      return list.reduce((s, t) => s + (VALUES[t] || 0), 0);
    }
    function paint(panel, pieces, color, advantage) {
      const el = panel.querySelector('.captured');
      el.innerHTML = pieces
        .map((t) => `<span class="cap-piece" style="background-image:url('${pieceUrl(color, t)}')"></span>`)
        .join('');
      if (advantage > 0) {
        el.innerHTML += `<span class="material-adv">+${advantage}</span>`;
      }
    }

    const controller = createGame({
      mode,
      playerColor,
      level,
      socket,
      gameId,
      board,
      moveList,
      statusBar,
      onCaptured: renderCaptured,
      onGameOver: (payload) => {
        stopClock();
        // Stash the game PGN so the result screen can offer post-game analysis.
        store.set({ lastResult: payload, lastPgn: controller.getPgn() });
        setTimeout(() => navigate('result'), 600);
      },
    });
    store.set({ controller });

    // --- Clocks (online only) ---
    let clock = params.clock || null;
    let activeColor = 'w';
    let tickHandle = null;
    let lastTick = Date.now();
    if (mode === 'online') {
      for (const p of [topPanel, bottomPanel]) p.querySelector('.clock').hidden = false;
      startClock();
    }
    function startClock() {
      lastTick = Date.now();
      tickHandle = setInterval(() => {
        if (!clock) return;
        const now = Date.now();
        clock[activeColor] = Math.max(0, clock[activeColor] - (now - lastTick));
        lastTick = now;
        renderClocks();
      }, 250);
    }
    function stopClock() {
      if (tickHandle) clearInterval(tickHandle);
      tickHandle = null;
    }
    function renderClocks() {
      if (!clock) return;
      const whitePanel = playerColor === 'w' ? bottomPanel : topPanel;
      const blackPanel = playerColor === 'w' ? topPanel : bottomPanel;
      setClock(whitePanel, clock.w, activeColor === 'w');
      setClock(blackPanel, clock.b, activeColor === 'b');
    }
    function setClock(panel, ms, active) {
      const el = panel.querySelector('.clock');
      el.textContent = fmt(ms);
      el.classList.toggle('active', active);
    }
    function fmt(ms) {
      const total = Math.ceil(ms / 1000);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    }

    // --- Online socket wiring ---
    const offs = [];
    if (mode === 'online') {
      offs.push(
        socket.on('move_made', (msg) => {
          controller.applyRemoteMove(msg);
          clock = msg.clock;
          activeColor = msg.turn;
          lastTick = Date.now();
          renderClocks();
        }),
        socket.on('illegal_move', () => controller.revertLastLocal()),
        socket.on('game_over', (msg) => {
          controller.forceOver({ result: msg.result, reason: msg.reason });
        }),
        socket.on('opponent_disconnected', (msg) => {
          statusBar.set(`Opponent disconnected — ${Math.round(msg.graceMs / 1000)}s to reconnect`, 'danger');
        }),
        socket.on('opponent_reconnected', () => statusBar.set('Opponent reconnected', 'success')),
        // On reconnect the server replays authoritative state via match_found;
        // rebuild the board from its FEN and clocks.
        socket.on('match_found', (msg) => {
          controller.syncFromFen(msg.fen);
          clock = msg.clock;
          activeColor = msg.fen.split(' ')[1];
          lastTick = Date.now();
          renderClocks();
        }),
        // If the socket drops and comes back, ask to rejoin the game in progress.
        socket.onOpen(() => socket.send('rejoin', { gameId, color: playerColor })),
      );
      if (clock) renderClocks();
    }

    wrap.querySelector('.resign-btn').addEventListener('click', () => controller.resign());
    wrap.querySelector('.newgame-btn').addEventListener('click', () => {
      if (mode === 'online' && !controller.isOver()) controller.resign();
      navigate(mode === 'bot' ? 'setup' : 'menu');
    });

    controller.start();

    this._cleanup = () => {
      stopClock();
      for (const off of offs) off();
    };
  },

  unmount() {
    if (this._cleanup) this._cleanup();
  },
};
