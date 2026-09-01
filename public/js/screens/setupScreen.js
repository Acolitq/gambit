import { navigate } from '../router.js';
import { store } from '../store.js';
import { LEVELS } from '../engine/bot.js';
import { NEURAL_LEVELS } from '../engine/neural/neuralEngine.js';

export const setupScreen = {
  mount(root) {
    let engine = store.get('engineType') || 'classical'; // 'classical' | 'neural'
    let level = store.get('level') || 3; // classical 1-5
    let neuralLevel = store.get('neuralLevel') || 2; // neural 1-3
    let color = 'w';

    const wrap = document.createElement('div');
    wrap.className = 'screen setup-screen';
    wrap.innerHTML = `
      <div class="card setup-card">
        <button class="text-link back-link"><i data-lucide="arrow-left"></i> Back</button>
        <h2>New Game vs Computer</h2>

        <div class="field">
          <label class="field-label">Engine</label>
          <div class="engine-toggle">
            <button class="engine-opt" data-engine="classical">
              <span class="eo-title">Classical</span>
              <span class="eo-sub">Alpha-beta search</span>
            </button>
            <button class="engine-opt" data-engine="neural">
              <span class="eo-title">Neural · AlphaZero</span>
              <span class="eo-sub">Self-trained net + MCTS</span>
            </button>
          </div>
        </div>

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

    function renderEngine() {
      for (const b of wrap.querySelectorAll('.engine-opt')) {
        b.classList.toggle('active', b.dataset.engine === engine);
      }
      renderPills();
    }
    function renderPills() {
      pillsEl.innerHTML = '';
      const max = engine === 'neural' ? 3 : 5;
      const cur = engine === 'neural' ? neuralLevel : level;
      for (let n = 1; n <= max; n++) {
        const b = document.createElement('button');
        b.className = 'level-pill' + (n === cur ? ' active' : '');
        b.textContent = String(n);
        b.addEventListener('click', () => {
          if (engine === 'neural') neuralLevel = n;
          else level = n;
          renderPills();
        });
        pillsEl.appendChild(b);
      }
      captionEl.textContent =
        engine === 'neural'
          ? NEURAL_LEVELS[neuralLevel].label
          : `Level ${level} — ${LEVELS[level].label}`;
    }

    for (const b of wrap.querySelectorAll('.engine-opt')) {
      b.addEventListener('click', () => {
        engine = b.dataset.engine;
        renderEngine();
      });
    }
    renderEngine();

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
      store.set({
        mode: 'bot',
        engineType: engine,
        level,
        neuralLevel,
        playerColor: resolved,
      });
      navigate('game');
    });

    root.appendChild(wrap);
  },
};
