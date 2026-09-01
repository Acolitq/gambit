// Renders the evaluation over a game as an inline-SVG area chart. White's
// advantage fills above the midline, Black's below. Clicking jumps to that ply.
const CLAMP = 800; // centipawns mapped to the top/bottom of the chart

function toY(evalObj, height) {
  let cp;
  if (evalObj.mate != null) cp = evalObj.mate > 0 ? CLAMP : -CLAMP;
  else cp = Math.max(-CLAMP, Math.min(CLAMP, evalObj.scoreCp ?? 0));
  // +CLAMP -> y=0 (top), -CLAMP -> y=height (bottom)
  return ((CLAMP - cp) / (2 * CLAMP)) * height;
}

export function createEvalGraph(mount, onSeek) {
  const el = document.createElement('div');
  el.className = 'eval-graph';
  mount.appendChild(el);

  let series = [];
  const W = 320;
  const H = 96;
  const uid = `eg${Math.random().toString(36).slice(2, 8)}`;

  function render(activePly = 0) {
    if (!series.length) {
      el.innerHTML = '';
      return;
    }
    const n = series.length;
    const step = n > 1 ? W / (n - 1) : W;
    const mid = H / 2;

    // Line following the eval, then an area closed along the midline. Two copies
    // of the area are clipped to above / below the midline so the White and
    // Black fills split exactly at 0.00.
    let line = '';
    series.forEach((e, i) => {
      const x = i * step;
      const y = toY(e, H);
      line += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    });
    const area = `${line}L${W},${mid} L0,${mid} Z`;
    const activeX = (activePly * step).toFixed(1);

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="eval-svg" role="img" aria-label="Evaluation graph">
        <defs>
          <clipPath id="${uid}-above"><rect x="0" y="0" width="${W}" height="${mid}" /></clipPath>
          <clipPath id="${uid}-below"><rect x="0" y="${mid}" width="${W}" height="${mid}" /></clipPath>
        </defs>
        <rect x="0" y="0" width="${W}" height="${mid}" class="eg-bg-white" />
        <rect x="0" y="${mid}" width="${W}" height="${mid}" class="eg-bg-black" />
        <path d="${area}" class="eg-area-white" clip-path="url(#${uid}-above)" />
        <path d="${area}" class="eg-area-black" clip-path="url(#${uid}-below)" />
        <path d="${line}" class="eg-line" fill="none" />
        <line x1="0" y1="${mid}" x2="${W}" y2="${mid}" class="eg-mid" />
        <line x1="${activeX}" y1="0" x2="${activeX}" y2="${H}" class="eg-cursor" />
      </svg>
    `;

    el.querySelector('svg').addEventListener('click', (ev) => {
      const rect = el.getBoundingClientRect();
      const frac = (ev.clientX - rect.left) / rect.width;
      const ply = Math.round(frac * (n - 1));
      onSeek(Math.max(0, Math.min(n - 1, ply)));
    });
  }

  return {
    // series: array of { scoreCp, mate } including index 0 = start position.
    setSeries(s) {
      series = s;
      render(0);
    },
    setActive(ply) {
      render(ply);
    },
  };
}
