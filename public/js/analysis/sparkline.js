// Minimal inline-SVG sparkline for rating history. No dependencies.
export function sparklineSVG(points, { w = 280, h = 60 } = {}) {
  if (!points || points.length < 2) return '';
  const values = points.map((p) => p.rating);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const y = (v) => h - ((v - min) / range) * (h - 8) - 4;

  let d = '';
  points.forEach((p, i) => {
    d += `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p.rating).toFixed(1)} `;
  });
  const area = `${d}L${w},${h} L0,${h} Z`;
  const last = points[points.length - 1];

  return `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark-svg" role="img" aria-label="Rating history">
      <path d="${area}" class="spark-area" />
      <path d="${d}" class="spark-line" fill="none" />
    </svg>
    <div class="spark-meta">
      <span>${min}</span>
      <span class="spark-last">${last.rating}</span>
      <span>${max}</span>
    </div>`;
}
