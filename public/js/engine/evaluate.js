import { PST, PIECE_VALUES } from './pst.js';

// Static evaluation from White's perspective, in centipawns.
// Positive favors White, negative favors Black. This is deliberately cheap —
// pure material + piece-square tables, with no rule checks — because it runs at
// every leaf of the search. Terminal positions (mate/stalemate) are detected in
// the search itself, not here.
export function evaluate(chess) {
  let score = 0;
  const board = chess.board(); // 8x8 array, board[0] is rank 8
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece) continue;
      const index = r * 8 + f;
      const base = PIECE_VALUES[piece.type];
      // White reads the table directly; Black reads it vertically mirrored.
      const table = PST[piece.type];
      const positional = piece.color === 'w' ? table[index] : table[(7 - r) * 8 + f];
      const value = base + positional;
      score += piece.color === 'w' ? value : -value;
    }
  }
  return score;
}

// Cheap move-ordering heuristic: try captures first (most-valuable-victim
// least-valuable-attacker), which makes alpha-beta pruning far more effective.
export function scoreMoveForOrdering(move) {
  if (!move.captured) return 0;
  return 10 * PIECE_VALUES[move.captured] - PIECE_VALUES[move.piece];
}
