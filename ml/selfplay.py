"""Self-play game generation. Each move is chosen by MCTS; we record the board,
the MCTS visit-count policy (the training target for the policy head), and later
the game result (the target for the value head)."""

import numpy as np
import chess

from encoding import encode_board, encode_move, POLICY_SIZE
from mcts import run_mcts


def play_game(net, sims=40, max_moves=120, temp_moves=15, device="cpu"):
    """Play one self-play game. Returns a list of (planes, pi_vector, turn)
    examples plus the game result, ready to be labelled with the value target."""
    board = chess.Board()
    examples = []  # (planes, pi_vector, turn_is_white)
    move_count = 0

    while not board.is_game_over(claim_draw=True) and move_count < max_moves:
        counts, _ = run_mcts(board, net, sims=sims, noise_eps=0.25, device=device)
        if not counts:
            break

        # Build the policy target vector over the full move space.
        pi = np.zeros(POLICY_SIZE, dtype=np.float32)
        total = sum(counts.values())
        for m, n in counts.items():
            pi[encode_move(board, m)] = n / total
        examples.append((encode_board(board), pi, board.turn))

        # Choose the move: sample by visit count early (exploration), then greedy.
        moves = list(counts.keys())
        visits = np.array([counts[m] for m in moves], dtype=np.float64)
        if move_count < temp_moves:
            probs = visits / visits.sum()
            move = moves[np.random.choice(len(moves), p=probs)]
        else:
            move = moves[int(visits.argmax())]
        board.push(move)
        move_count += 1

    result = _game_result(board)  # +1 White win, -1 Black win, 0 draw
    data = []
    for planes, pi, turn in examples:
        # Value target from that position's side-to-move perspective.
        z = result if turn == chess.WHITE else -result
        data.append((planes, pi, np.float32(z)))
    return data, result


def _game_result(board):
    if board.is_checkmate():
        # Side to move is mated → the other side won.
        return -1.0 if board.turn == chess.WHITE else 1.0
    return 0.0
