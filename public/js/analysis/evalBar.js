import { whiteWinProb, formatEval } from './evalFormat.js';

// A vertical evaluation bar shown beside the board: White fills from the side
// White is playing from, proportional to the engine's assessment, with the
// numeric eval in a small always-legible chip at the top. Orientation-aware.
export function createEvalBar(mount) {
  const el = document.createElement('div');
  el.className = 'eval-bar';
  el.innerHTML = `
    <div class="eb-track">
      <div class="eb-white"></div>
      <div class="eb-label"></div>
    </div>
  `;
  mount.appendChild(el);

  const track = el.querySelector('.eb-track');
  const whiteEl = el.querySelector('.eb-white');
  const label = el.querySelector('.eb-label');
  let orientation = 'w';
  let current = { scoreCp: 0, mate: null };

  function paint() {
    const p = whiteWinProb(current); // White's share, 0..1
    whiteEl.style.height = `${(p * 100).toFixed(1)}%`;
    // White fills from the bottom when the board shows White at the bottom.
    track.style.flexDirection = orientation === 'w' ? 'column-reverse' : 'column';
    const whiteAhead = p >= 0.5;
    label.textContent = formatEval(current);
    label.classList.toggle('dark-chip', whiteAhead); // dark text chip over the winning fill
    el.classList.toggle('white-ahead', whiteAhead);
  }

  return {
    setEval(evalObj) {
      current = evalObj || { scoreCp: 0, mate: null };
      paint();
    },
    setOrientation(color) {
      orientation = color;
      paint();
    },
  };
}
