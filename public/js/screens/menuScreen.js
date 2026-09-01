import { navigate } from '../router.js';
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
          <div class="home-board-frame"></div>
        </div>
      </div>
    `;
    root.appendChild(wrap);

    // Decorative empty board with faint ghost pieces.
    const frame = wrap.querySelector('.home-board-frame');
    const sb = createStaticBoard(frame, { fen: START_FEN, orientation: 'w' });
    sb.el.classList.add('ghost-board');

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
};
