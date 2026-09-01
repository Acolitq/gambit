import { Chess } from 'chess.js';

// Move-quality thresholds in centipawns of lost advantage (from the mover's
// perspective). These mirror the conventions used by lichess/chess.com closely
// enough to be trustworthy for study.
const THRESHOLDS = [
  { key: 'blunder', label: 'Blunder', symbol: '??', minLoss: 300 },
  { key: 'mistake', label: 'Mistake', symbol: '?', minLoss: 150 },
  { key: 'inaccuracy', label: 'Inaccuracy', symbol: '?!', minLoss: 75 },
];

// Convert a White-perspective centipawn/mate eval into a "win percentage for
// White" (0..100). This is the lichess model and gives accuracy a sane shape
// near decisive positions instead of exploding with raw centipawns.
function winPercent({ scoreCp, mate }) {
  if (mate != null) return mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, scoreCp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// Per-move accuracy from the drop in win% caused by the move (mover's side).
function moveAccuracy(winBefore, winAfter) {
  const drop = Math.max(0, winBefore - winAfter);
  const acc = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

function classify(cpLoss, wasBest) {
  if (wasBest) return { key: 'best', label: 'Best', symbol: '' };
  for (const t of THRESHOLDS) {
    if (cpLoss >= t.minLoss) return { key: t.key, label: t.label, symbol: t.symbol };
  }
  if (cpLoss <= 20) return { key: 'good', label: 'Good', symbol: '' };
  return { key: 'ok', label: '', symbol: '' };
}

// Analyze a full game given as PGN. Evaluates every position with the engine and
// annotates each move. `onProgress(done, total)` is called as it works so the UI
// can show a progress bar. Returns a structured report.
export async function analyzeGame(pgn, engine, { depth = 12, onProgress } = {}) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true }); // moves in order

  // Rebuild the sequence of FENs: position[0] is the start, position[i] is after
  // move i-1. We evaluate each position once.
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const mv of history) {
    replay.move(mv);
    fens.push(replay.fen());
  }

  const total = fens.length;
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    const r = await engine.evaluate(fens[i], depth);
    evals.push(r);
    if (onProgress) onProgress(i + 1, total);
  }

  // Annotate each move using the eval before and after it.
  const moves = [];
  const accSum = { w: 0, b: 0 };
  const accCount = { w: 0, b: 0 };
  for (let i = 0; i < history.length; i++) {
    const mv = history[i];
    const before = evals[i]; // position the mover faced
    const after = evals[i + 1]; // position after the move
    const mover = mv.color; // 'w' | 'b'

    // Win% from the mover's perspective before vs after their move.
    const wBefore = mover === 'w' ? winPercent(before) : 100 - winPercent(before);
    const wAfter = mover === 'w' ? winPercent(after) : 100 - winPercent(after);
    const cpLoss = centipawnLoss(before, after, mover);

    const playedUci = mv.from + mv.to + (mv.promotion || '');
    const wasBest = before.bestMove && before.bestMove === playedUci;
    const quality = classify(cpLoss, wasBest);

    const acc = moveAccuracy(wBefore, wAfter);
    accSum[mover] += acc;
    accCount[mover] += 1;

    moves.push({
      ply: i + 1,
      color: mover,
      san: mv.san,
      uci: playedUci,
      fenBefore: fens[i],
      fenAfter: fens[i + 1],
      evalCp: after.scoreCp,
      mate: after.mate,
      cpLoss,
      accuracy: acc,
      quality,
      bestMove: before.bestMove,
      bestPv: before.pv,
    });
  }

  return {
    moves,
    // White-perspective eval after each move, for the graph.
    evalSeries: evals.map((e) => ({ scoreCp: e.scoreCp, mate: e.mate })),
    accuracy: {
      w: accCount.w ? Math.round((accSum.w / accCount.w) * 10) / 10 : null,
      b: accCount.b ? Math.round((accSum.b / accCount.b) * 10) / 10 : null,
    },
    summary: summarize(moves),
    headers: chess.header(),
  };
}

// Centipawn loss for a move, from the mover's perspective, clamped at 0.
function centipawnLoss(before, after, mover) {
  const toMover = (e) => {
    let v;
    if (e.mate != null) v = e.mate > 0 ? 100000 : -100000;
    else v = e.scoreCp ?? 0;
    return mover === 'w' ? v : -v;
  };
  const loss = toMover(before) - toMover(after);
  return Math.max(0, Math.round(loss));
}

function summarize(moves) {
  const counts = { w: {}, b: {} };
  for (const m of moves) {
    const bucket = counts[m.color];
    bucket[m.quality.key] = (bucket[m.quality.key] || 0) + 1;
  }
  return counts;
}

export { winPercent, classify, centipawnLoss, moveAccuracy };
