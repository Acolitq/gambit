import { navigate, refreshIcons } from '../router.js';
import { store } from '../store.js';
import { createStaticBoard } from '../ui/staticBoard.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const CARDS = [
  { nav: 'setup', mode: 'bot', icon: 'cpu', title: 'Play vs Computer', sub: 'Five levels, beginner to master' },
  { nav: 'queue', mode: 'online', icon: 'globe', title: 'Play Online', sub: 'Get matched with a waiting opponent' },
  { nav: 'analysis', icon: 'line-chart', title: 'Analyze a Game', sub: 'Engine review, eval bar, accuracy' },
  { nav: 'scout', icon: 'target', title: 'Scout Opponent', sub: "Prep against a player's real games" },
  { nav: 'openings', icon: 'book-open', title: 'Openings', sub: 'Learn and explore the main lines' },
  { nav: 'trackers', icon: 'trophy', title: 'Tournament Trackers', sub: 'Save opponents and prep per event' },
];

let board3d = null;
let mountId = 0; // guards the lazy 3D import against a mount/unmount race
const ZOOM_HINT = window.matchMedia('(pointer: coarse)').matches ? 'pinch to zoom' : 'scroll to zoom';

export const menuScreen = {
  mount(root) {
    const wrap = document.createElement('div');
    wrap.className = 'screen home-screen';
    wrap.innerHTML = `
      <div class="home-hero">
        <div class="home-content">
          <h1 class="home-title">Gambit</h1>
          <p class="home-tagline">Play, review your games with a real engine, and scout your next opponent.</p>
          <div class="home-cards"></div>
        </div>
        <div class="home-visual">
          <div class="home-board-glow"></div>
          <div class="home-board-3d"></div>
          <div class="home-board-hud" hidden>
            <span class="home-board-status" aria-live="polite"></span>
            <span class="home-board-actions">
              <button class="btn btn-ghost" data-act="undo"><i data-lucide="undo-2"></i>Undo</button>
              <button class="btn btn-ghost" data-act="reset"><i data-lucide="rotate-ccw"></i>New game</button>
            </span>
            <span class="home-board-hint">Drag to orbit · ${ZOOM_HINT}</span>
          </div>
        </div>
      </div>
    `;
    root.appendChild(wrap);

    // Playable 3D board vs the bot. three.js is loaded lazily so the rest of the
    // app never waits on it; without WebGL (or the CDN) the flat ghost board shows.
    const stage = wrap.querySelector('.home-board-3d');
    const hud = wrap.querySelector('.home-board-hud');
    const statusEl = hud.querySelector('.home-board-status');
    const undoBtn = hud.querySelector('[data-act="undo"]');
    const id = ++mountId;
    const fallback = () => {
      stage.className = 'home-board-frame';
      const sb = createStaticBoard(stage, { fen: START_FEN, orientation: 'w' });
      sb.el.classList.add('ghost-board');
    };
    import('../ui/board3d.js')
      .then(({ createBoard3D }) => {
        if (id !== mountId) return;
        board3d = createBoard3D(stage, {
          onStatus({ text, canUndo }) {
            statusEl.textContent = text;
            undoBtn.disabled = !canUndo;
          },
        });
        if (!board3d) return fallback();
        hud.hidden = false;
        undoBtn.addEventListener('click', () => board3d.undo());
        hud.querySelector('[data-act="reset"]').addEventListener('click', () => board3d.reset());
        refreshIcons();
      })
      .catch(() => id === mountId && fallback());

    // Cards
    const cardsEl = wrap.querySelector('.home-cards');
    for (const c of CARDS) {
      const btn = document.createElement('button');
      btn.className = 'home-card';
      btn.innerHTML = `
        <span class="home-card-icon"><i data-lucide="${c.icon}"></i></span>
        <span class="home-card-text">
          <span class="home-card-title">${c.title}</span>
          <span class="home-card-sub">${c.sub}</span>
        </span>
      `;
      btn.addEventListener('click', () => {
        if (c.mode) store.set({ mode: c.mode });
        if (c.nav === 'analysis') store.set({ lastPgn: null });
        navigate(c.nav);
      });
      cardsEl.appendChild(btn);
    }
  },

  unmount() {
    mountId++;
    board3d?.destroy();
    board3d = null;
  },
};
