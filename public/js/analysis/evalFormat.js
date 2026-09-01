// Shared helpers for turning engine evals into display strings and bar fills.

// White-perspective win probability (0..1) — the lichess model. Used to size the
// eval bar so it behaves sensibly near decisive positions.
export function whiteWinProb({ scoreCp, mate }) {
  if (mate != null) return mate > 0 ? 1 : 0;
  const cp = Math.max(-1200, Math.min(1200, scoreCp ?? 0));
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

// A compact numeric label from White's perspective: "+1.4", "-0.7", "#3", "#-2".
export function formatEval({ scoreCp, mate }) {
  if (mate != null) return mate > 0 ? `#${mate}` : `#-${-mate}`;
  const v = (scoreCp ?? 0) / 100;
  const s = Math.abs(v).toFixed(1);
  if (v > 0) return `+${s}`;
  if (v < 0) return `-${s}`;
  return '0.0';
}

// Same value but always from the given side's perspective (for engine lines
// shown to the side to move). Positive = good for that side.
export function formatEvalFor(line, sideToMove) {
  const flip = sideToMove === 'b';
  const scoreCp = line.scoreCp == null ? null : flip ? -line.scoreCp : line.scoreCp;
  const mate = line.mate == null ? null : flip ? -line.mate : line.mate;
  return formatEval({ scoreCp, mate });
}
