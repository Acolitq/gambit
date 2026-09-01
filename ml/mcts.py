"""PUCT Monte Carlo Tree Search guided by the policy-value network.

This is the AlphaZero search: each simulation walks the tree by maximizing
Q + U (U = c_puct * P * sqrt(N_parent) / (1 + N_child)), expands a leaf using the
network's policy priors, and backs up the network's value estimate (negated each
ply because players alternate). Move selection uses visit counts.
"""

import math
import numpy as np
import torch
import chess

from encoding import encode_board, encode_move


class Node:
    __slots__ = ("prior", "visits", "value_sum", "children")

    def __init__(self, prior):
        self.prior = prior
        self.visits = 0
        self.value_sum = 0.0
        self.children = {}  # move -> Node

    def q(self):
        return self.value_sum / self.visits if self.visits else 0.0


@torch.no_grad()
def evaluate(board, net, device="cpu"):
    """Network forward pass → (priors over legal moves, value for side to move)."""
    x = torch.from_numpy(encode_board(board)).unsqueeze(0).to(device)
    logits, value = net(x)
    logits = logits[0].cpu().numpy()

    legal = list(board.legal_moves)
    idxs = np.array([encode_move(board, m) for m in legal])
    masked = logits[idxs]
    masked = masked - masked.max()
    probs = np.exp(masked)
    probs /= probs.sum() + 1e-8
    priors = {m: float(p) for m, p in zip(legal, probs)}
    return priors, float(value.item())


def run_mcts(board, net, sims=100, c_puct=1.5, dirichlet_alpha=0.3, noise_eps=0.0, device="cpu"):
    """Run `sims` simulations from `board`. Returns (visit_counts dict, root_value)."""
    root = Node(1.0)
    priors, _ = evaluate(board, net, device)
    if noise_eps > 0 and priors:
        # Dirichlet noise at the root encourages exploration during self-play.
        noise = np.random.dirichlet([dirichlet_alpha] * len(priors))
        for (m, p), n in zip(list(priors.items()), noise):
            priors[m] = (1 - noise_eps) * p + noise_eps * n
    for m, p in priors.items():
        root.children[m] = Node(p)

    for _ in range(sims):
        node = root
        search_board = board.copy()
        path = [node]

        # Selection — descend to a leaf.
        while node.children:
            move, node = _select(node, c_puct)
            search_board.push(move)
            path.append(node)

        # Expansion + evaluation.
        value = _terminal_value(search_board)
        if value is None:
            priors, value = evaluate(search_board, net, device)
            for m, p in priors.items():
                node.children[m] = Node(p)

        # Backup — value is from the leaf side-to-move's view; negate up the path.
        for n in reversed(path):
            n.visits += 1
            n.value_sum += value
            value = -value

    counts = {m: child.visits for m, child in root.children.items()}
    return counts, root.q()


def _select(node, c_puct):
    total = math.sqrt(node.visits + 1e-8)
    best, best_move, best_child = -1e30, None, None
    for move, child in node.children.items():
        u = c_puct * child.prior * total / (1 + child.visits)
        score = -child.q() + u  # child's Q is from the opponent's view → negate
        if score > best:
            best, best_move, best_child = score, move, child
    return best_move, best_child


def _terminal_value(board):
    """Value from the side-to-move's perspective if the game is over, else None."""
    if board.is_checkmate():
        return -1.0  # side to move has been mated
    if board.is_stalemate() or board.is_insufficient_material() or board.can_claim_draw():
        return 0.0
    if board.is_game_over():
        return 0.0
    return None


def best_move(board, net, sims=200, device="cpu"):
    """Pick the most-visited move (used for actual play, no exploration noise)."""
    counts, _ = run_mcts(board, net, sims=sims, noise_eps=0.0, device=device)
    return max(counts, key=counts.get) if counts else None
