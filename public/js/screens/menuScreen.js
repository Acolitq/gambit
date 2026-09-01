import { navigate } from '../router.js';
import { store } from '../store.js';

export const menuScreen = {
  mount(root) {
    const wrap = document.createElement('div');
    wrap.className = 'screen menu-screen';
    wrap.innerHTML = `
      <h1 class="brand">Gambit</h1>
      <p class="tagline">A clean place to play chess — beat the bots or a stranger in the queue.</p>
      <div class="menu-cards">
        <button class="menu-card" data-mode="bot">
          <span class="menu-card-icon">♟</span>
          <span class="menu-card-title">Play vs Computer</span>
          <span class="menu-card-sub">Five levels, from beginner to master</span>
        </button>
        <button class="menu-card menu-card-online" data-mode="online">
          <span class="menu-card-icon">◎</span>
          <span class="menu-card-title">Play Online</span>
          <span class="menu-card-sub">Get matched with a waiting opponent</span>
        </button>
        <button class="menu-card menu-card-study" data-nav="analysis">
          <span class="menu-card-icon">⌕</span>
          <span class="menu-card-title">Analyze a Game</span>
          <span class="menu-card-sub">Engine review with an accuracy report</span>
        </button>
      </div>
      <p class="menu-footer">A portfolio project · open source</p>
    `;

    wrap.querySelector('[data-mode="bot"]').addEventListener('click', () => {
      store.set({ mode: 'bot' });
      navigate('setup');
    });
    wrap.querySelector('[data-mode="online"]').addEventListener('click', () => {
      store.set({ mode: 'online' });
      navigate('queue');
    });
    wrap.querySelector('[data-nav="analysis"]').addEventListener('click', () => {
      store.set({ lastPgn: null }); // open a blank analyzer, not the last game
      navigate('analysis');
    });

    root.appendChild(wrap);
  },
};
