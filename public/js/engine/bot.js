import { Chess } from 'chess.js';
import { evaluate, scoreMoveForOrdering } from './evaluate.js';

// Five difficulty levels. Higher levels search deeper and blunder less.
// `blunderChance` is the probability of ignoring the search and playing a random
// legal move — the main lever that makes low levels beatable. `timeMs` is a hard
// per-move budget so the search never freezes the UI (chess.js is not fast).
export const LEVELS = {
  1: { label: 'Beginner', maxDepth: 1, timeMs: 250, blunderChance: 0.45, randomness: 60 },
  2: { label: 'Casual', maxDepth: 2, timeMs: 400, blunderChance: 0.28, randomness: 40 },
  3: { label: 'Club Player', maxDepth: 3, timeMs: 600, blunderChance: 0.12, randomness: 20 },
  4: { label: 'Strong', maxDepth: 4, timeMs: 900, blunderChance: 0.03, randomness: 8 },
  5: { label: 'Master', maxDepth: 5, timeMs: 1300, blunderChance: 0.0, randomness: 0 },
};

const MATE = 1e9;

// Search-abort state, checked periodically so a search can bail at its deadline.
let deadline = 0;
let nodes = 0;
let aborted = false;

function timeUp() {
  // Check the clock every 256 nodes. chess.js is slow enough that a whole search
  // depth can be only a few thousand nodes, so a coarser interval would often
  // skip right past the deadline without ever re-checking.
  if ((nodes++ & 255) === 0 && Date.now() >= deadline) aborted = true;
  return aborted;
}

// Negamax with alpha-beta pruning, from the side-to-move's perspective.
function negamax(chess, depth, alpha, beta) {
  if (timeUp()) return 0; // value discarded by the caller on abort

  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    // No legal moves: mate if in check (bad for us), else stalemate.
    // Offset by depth so shallower (faster) mates score higher.
    return chess.inCheck() ? -(MATE - depth) : 0;
  }
  if (depth === 0) {
    const sign = chess.turn() === 'w' ? 1 : -1;
    return sign * evaluate(chess);
  }

  moves.sort((a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a));

  let best = -Infinity;
  for (const move of moves) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (aborted) return 0;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cut-off
  }
  return best;
}

// One full-width search of the root moves at a fixed depth. Returns the best
// move and whether the search was cut short by the deadline.
function searchRoot(chess, depth, randomness) {
  const moves = chess.moves({ verbose: true });
  moves.sort((a, b) => scoreMoveForOrdering(b) - scoreMoveForOrdering(a));

  let alpha = -Infinity;
  let bestMove = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    chess.move(move);
    let score = -negamax(chess, depth - 1, -Infinity, -alpha);
    chess.undo();
    if (aborted) return { move: bestMove, timedOut: true };
    // A little noise so equal-looking moves vary game to game (low levels only).
    if (randomness) score += (Math.random() - 0.5) * randomness;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      if (score > alpha) alpha = score;
    }
  }
  return { move: bestMove, timedOut: false };
}

// Choose a move for the given position. Uses iterative deepening under a time
// budget: it always has a complete result from the last finished depth to fall
// back on if the next depth runs out of time.
export function chooseMove(fen, level = 3) {
  const opts = LEVELS[level] || LEVELS[3];
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) return null;

  // Occasionally throw the game — this is what makes lower levels beatable.
  if (Math.random() < opts.blunderChance) {
    return toMove(pick(legal));
  }

  deadline = Date.now() + opts.timeMs;
  nodes = 0;
  aborted = false;

  let best = pick(legal);
  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    const result = searchRoot(chess, depth, opts.randomness);
    if (result.timedOut) break; // keep the best move from the last full depth
    best = result.move;
    if (Date.now() >= deadline) break;
  }
  return toMove(best);
}

function toMove(m) {
  return { from: m.from, to: m.to, promotion: m.promotion };
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
