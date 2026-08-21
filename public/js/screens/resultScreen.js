import { navigate } from '../router.js';
import { store } from '../store.js';

const REASON_TEXT = {
  checkmate: 'by checkmate',
  resign: 'by resignation',
  timeout: 'on time',
  stalemate: 'stalemate',
  disconnect: 'opponent disconnected',
  draw: 'draw',
  'insufficient material': 'insufficient material',
};

export const resultScreen = {
  mount(root) {
    const { result, reason } = store.get('lastResult') || {};
    const mode = store.get('mode');
    const playerColor = store.get('playerColor') || 'w';

    let title, tone;
    if (result === 'draw') {
      title = 'Draw';
      tone = 'neutral';
    } else if (result === playerColor) {
      title = 'You won';
      tone = 'success';
    } else {
      title = 'You lost';
      tone = 'danger';
    }

    const wrap = document.createElement('div');
    wrap.className = 'screen result-screen';
    wrap.innerHTML = `
      <div class="card result-card tone-${tone}">
        <h2 class="result-title">${title}</h2>
        <p class="result-reason">${REASON_TEXT[reason] || ''}</p>
        <div class="result-actions">
          <button class="btn btn-primary again-btn">${mode === 'bot' ? 'Play again' : 'New opponent'}</button>
          <button class="btn btn-ghost menu-btn">Main menu</button>
        </div>
      </div>
    `;

    wrap.querySelector('.again-btn').addEventListener('click', () => {
      navigate(mode === 'bot' ? 'setup' : 'queue');
    });
    wrap.querySelector('.menu-btn').addEventListener('click', () => navigate('menu'));

    root.appendChild(wrap);
  },
};
