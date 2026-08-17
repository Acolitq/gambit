import { navigate } from '../router.js';
import { store } from '../store.js';
import { LEVELS } from '../engine/bot.js';

export const setupScreen = {
  mount(root) {
    let level = store.get('level') || 3;
    let color = 'w'; // 'w' | 'b' | 'random'

    const wrap = document.createElement('div');
    wrap.className = 'screen setup-screen';
    wrap.innerHTML = `
      <div class="card setup-card">
        <button class="text-link back-link">← Back</button>
        <h2>New Game vs Computer</h2>

        <div class="field">
          <label class="field-label">Difficulty</label>
          <div class="level-pills"></div>
          <p class="level-caption"></p>
        </div>

        <div class="field">
          <label class="field-label">Play as</label>
          <div class="color-choices">
            <button class="color-choice" data-color="w"><span class="swatch swatch-white"></span>White</button>
            <button class="color-choice" data-color="random"><span class="swatch swatch-random"></span>Random</button>
            <button class="color-choice" data-color="b"><span class="swatch swatch-black"></span>Black</button>
          </div>
        </div>

        <button class="btn btn-primary btn-block start-btn">Start Game</button>
      </div>
    `;

    const pillsEl = wrap.querySelector('.level-pills');
    const captionEl = wrap.querySelector('.level-caption');
    function renderPills() {
      pillsEl.innerHTML = '';
      for (let n = 1; n <= 5; n++) {
        const b = document.createElement('button');
        b.className = 'level-pill' + (n === level ? ' active' : '');
        b.textContent = String(n);
        b.addEventListener('click', () => {
          level = n;
          renderPills();
        });
        pillsEl.appendChild(b);
      }
      captionEl.textContent = `Level ${level} — ${LEVELS[level].label}`;
    }
    renderPills();

    function renderColors() {
      for (const btn of wrap.querySelectorAll('.color-choice')) {
        btn.classList.toggle('active', btn.dataset.color === color);
      }
    }
    for (const btn of wrap.querySelectorAll('.color-choice')) {
      btn.addEventListener('click', () => {
        color = btn.dataset.color;
        renderColors();
      });
    }
    renderColors();

    wrap.querySelector('.back-link').addEventListener('click', () => navigate('menu'));
    wrap.querySelector('.start-btn').addEventListener('click', () => {
      const resolved = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
      store.set({ mode: 'bot', level, playerColor: resolved });
      navigate('game');
    });

    root.appendChild(wrap);
  },
};
