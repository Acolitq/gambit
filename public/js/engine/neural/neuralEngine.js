// The neural engine: PUCT MCTS guided by the ONNX policy-value network. This is
// the AlphaZero search, mirroring ml/mcts.py. It is parameterized by `runNet`
// (planes -> { policy, value }) so the same code runs in the browser (via
// onnxruntime-web) and in a Node test (via onnxruntime-node).

import { Chess } from 'chess.js';
import { encodeBoard, encodeMove } from './encoding.js';

const C_PUCT = 1.5;

class Node {
  constructor(prior) {
    this.prior = prior;
    this.visits = 0;
    this.valueSum = 0;
    this.children = null; // Map<uci, Node>
  }
  q() {
    return this.visits ? this.valueSum / this.visits : 0;
  }
}

// Difficulty presets: more simulations = stronger, slower.
export const NEURAL_LEVELS = {
  1: { label: 'Neural · Fast', sims: 48 },
  2: { label: 'Neural · Balanced', sims: 120 },
  3: { label: 'Neural · Strong', sims: 300 },
};

export function createNeuralEngine(runNet) {
  // Evaluate a position: priors over legal moves + value for side to move.
  async function evaluate(game) {
    const planes = encodeBoard(game);
    const { policy, value } = await runNet(planes);
    const legal = game.moves({ verbose: true });
    if (!legal.length) return { legal, priors: [], value };
    const idxs = legal.map((m) => encodeMove(game, m));
    let max = -Infinity;
    for (const i of idxs) if (policy[i] > max) max = policy[i];
    let sum = 0;
    const exps = idxs.map((i) => {
      const e = Math.exp(policy[i] - max);
      sum += e;
      return e;
    });
    const priors = legal.map((m, k) => ({ move: m, prob: exps[k] / (sum || 1) }));
    return { legal, priors, value };
  }

  function terminalValue(game) {
    if (game.isCheckmate()) return -1; // side to move is mated
    if (game.isDraw() || game.isStalemate() || game.isInsufficientMaterial() || game.isThreefoldRepetition()) {
      return 0;
    }
    if (game.isGameOver()) return 0;
    return null;
  }

  async function runMcts(fen, sims, onProgress) {
    const root = new Node(1);
    const rootGame = new Chess(fen);
    const { priors } = await evaluate(rootGame);
    root.children = new Map();
    for (const { move, prob } of priors) root.children.set(uci(move), new Node(prob));

    for (let s = 0; s < sims; s++) {
      const game = new Chess(fen);
      let node = root;
      const path = [node];

      // Selection
      while (node.children && node.children.size) {
        const [moveUci, child] = select(node);
        game.move(fromUci(moveUci));
        node = child;
        path.push(node);
      }

      // Expansion + evaluation
      let value = terminalValue(game);
      if (value === null) {
        const res = await evaluate(game);
        node.children = new Map();
        for (const { move, prob } of res.priors) node.children.set(uci(move), new Node(prob));
        value = res.value;
      }

      // Backup (negate each ply)
      for (let i = path.length - 1; i >= 0; i--) {
        path[i].visits += 1;
        path[i].valueSum += value;
        value = -value;
      }
      if (onProgress && (s & 15) === 0) onProgress(s, sims);
    }

    const counts = [];
    for (const [moveUci, child] of root.children) counts.push({ uci: moveUci, visits: child.visits });
    return counts;
  }

  function select(node) {
    const total = Math.sqrt(node.visits + 1e-8);
    let best = -Infinity;
    let bestEntry = null;
    for (const [moveUci, child] of node.children) {
      const u = C_PUCT * child.prior * total / (1 + child.visits);
      const score = -child.q() + u;
      if (score > best) {
        best = score;
        bestEntry = [moveUci, child];
      }
    }
    return bestEntry;
  }

  // Public: choose a move for a FEN. Returns { from, to, promotion }.
  async function chooseMove(fen, sims = 120, onProgress) {
    const counts = await runMcts(fen, sims, onProgress);
    if (!counts.length) return null;
    counts.sort((a, b) => b.visits - a.visits);
    return fromUci(counts[0].uci);
  }

  return { chooseMove, evaluate, runMcts };
}

function uci(move) {
  return move.from + move.to + (move.promotion || '');
}
function fromUci(u) {
  return { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u.slice(4, 5) : undefined };
}
