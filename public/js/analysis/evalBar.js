import { whiteWinProb, formatEval } from './evalFormat.js';

// A vertical evaluation bar shown beside the board: White fills from the side
// White is playing from, proportional to the engine's assessment, with the
// numeric eval in a small always-legible chip at the top. Orientation-aware.
// With no eval (nothing loaded, or cleared) it sits idle: an even, muted bar
// with no number, so it never reads as a live assessment.
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
  let current = null; // null = idle

  function paint() {
    const idle = !current;
    const p = idle ? 0.5 : whiteWinProb(current); // White's share, 0..1
    whiteEl.style.height = `${(p * 100).toFixed(1)}%`;
    // White fills from the bottom when the board shows White at the bottom.
    track.style.flexDirection = orientation === 'w' ? 'column-reverse' : 'column';
    const whiteAhead = p >= 0.5;
    label.textContent = idle ? '' : formatEval(current);
    label.classList.toggle('dark-chip', whiteAhead); // dark text chip over the winning fill
    el.classList.toggle('white-ahead', whiteAhead);
    el.classList.toggle('idle', idle);
  }
  paint();

  return {
    setEval(evalObj) {
      current = evalObj || { scoreCp: 0, mate: null };
      paint();
    },
    clear() {
      current = null;
      paint();
    },
    setOrientation(color) {
      orientation = color;
      paint();
    },
  };
}
