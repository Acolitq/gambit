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

// Format a principal variation (array of SAN strings) with move numbers, the way
// chess.com/lichess show engine lines, e.g. "4. c5 Bxa6 5. Bb7". Numbering is
// derived from the FEN the line is played from (side to move + fullmove number).
export function numberedLine(fen, sans) {
  const parts = String(fen).split(' ');
  let n = Number(parts[5]) || 1;
  let white = parts[1] !== 'b';
  const out = [];
  for (let i = 0; i < sans.length; i++) {
    if (white) out.push(`${n}.`);
    else if (i === 0) out.push(`${n}...`);
    out.push(sans[i]);
    if (!white) n += 1;
    white = !white;
  }
  return out.join(' ');
}

// Same value but always from the given side's perspective (for engine lines
// shown to the side to move). Positive = good for that side.
export function formatEvalFor(line, sideToMove) {
  const flip = sideToMove === 'b';
  const scoreCp = line.scoreCp == null ? null : flip ? -line.scoreCp : line.scoreCp;
  const mate = line.mate == null ? null : flip ? -line.mate : line.mate;
  return formatEval({ scoreCp, mate });
}
