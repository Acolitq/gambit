// JS port of ml/encoding.py — MUST stay bit-for-bit compatible with the Python
// encoding the network was trained on. Board planes and the 8x8x73 move-policy
// index are computed from the side-to-move's perspective (mirrored if Black to
// move). Only encode is needed here: MCTS enumerates legal moves via chess.js
// and looks up each move's prior by its policy index.

export const PLANES = 17;
export const POLICY_SIZE = 64 * 73;

// PAWN,KNIGHT,BISHOP,ROOK,QUEEN,KING
const TYPE_INDEX = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };
const QUEEN_DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const UNDER_PIECES = { n: 0, b: 1, r: 2 };

// python-chess square index: rank*8 + file, with rank 0 = rank 1 (a1 = 0).
function sq(file, rank) {
  return rank * 8 + file;
}
function squareFromAlgebraic(a) {
  return sq(a.charCodeAt(0) - 97, Number(a[1]) - 1);
}
const mirrorSq = (s) => s ^ 56; // vertical flip (rank r -> 7-r)
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

// Encode a chess.js position into (17*8*8) planes, flattened as plane*64 + rank*8 + file.
export function encodeBoard(game) {
  const turnWhite = game.turn() === 'w';
  const planes = new Float32Array(PLANES * 64);
  const board = game.board(); // board[0] = rank 8

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (!cell) continue;
      let square = sq(f, 7 - r); // chess.js row r -> python rank (7-r)
      let color = cell.color; // 'w' | 'b'
      if (!turnWhite) {
        square = mirrorSq(square);
        color = color === 'w' ? 'b' : 'w';
      }
      let idx = TYPE_INDEX[cell.type];
      if (color === 'b') idx += 6; // theirs (canonical black)
      const rr = square >> 3;
      const ff = square & 7;
      planes[idx * 64 + rr * 8 + ff] = 1;
    }
  }

  // Colour plane: original side to move is White.
  if (turnWhite) planes.fill(1, 12 * 64, 13 * 64);

  // Castling rights (canonical: our K/Q, their K/Q).
  const rights = game.fen().split(' ')[2] || '-';
  const K = rights.includes('K'), Q = rights.includes('Q');
  const k = rights.includes('k'), q = rights.includes('q');
  const [cwK, cwQ, cbK, cbQ] = turnWhite ? [K, Q, k, q] : [k, q, K, Q];
  if (cwK) planes.fill(1, 13 * 64, 14 * 64);
  if (cwQ) planes.fill(1, 14 * 64, 15 * 64);
  if (cbK) planes.fill(1, 15 * 64, 16 * 64);
  if (cbQ) planes.fill(1, 16 * 64, 17 * 64);
  return planes;
}

// Policy index for a legal move (chess.js verbose move: {from,to,promotion}).
export function encodeMove(game, move) {
  const turnWhite = game.turn() === 'w';
  let frm = squareFromAlgebraic(move.from);
  let to = squareFromAlgebraic(move.to);
  let promo = move.promotion || null;
  if (!turnWhite) {
    frm = mirrorSq(frm);
    to = mirrorSq(to);
  }
  const ff = frm & 7, fr = frm >> 3;
  const tf = to & 7, tr = to >> 3;
  const df = tf - ff, dr = tr - fr;

  let plane;
  if (promo && promo !== 'q') {
    const dirIdx = df + 1; // -1,0,1 -> 0,1,2
    plane = 64 + dirIdx * 3 + UNDER_PIECES[promo];
  } else {
    const kIdx = KNIGHT_DELTAS.findIndex(([a, b]) => a === df && b === dr);
    if (kIdx !== -1) {
      plane = 56 + kIdx;
    } else {
      const dirIdx = QUEEN_DIRS.findIndex(([a, b]) => a === sign(df) && b === sign(dr));
      const dist = Math.max(Math.abs(df), Math.abs(dr));
      plane = dirIdx * 7 + (dist - 1);
    }
  }
  return frm * 73 + plane;
}
