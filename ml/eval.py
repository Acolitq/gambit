"""Measure the trained engine's strength honestly, against a random-move baseline.
Reports win/draw/loss from the neural engine's side over N games (alternating
colors). This is a real, reproducible number — not an estimate."""

import argparse
import os
import random

import chess
import torch

from model import ChessNet
from mcts import best_move


def play(net, sims, neural_is_white, max_moves=160):
    board = chess.Board()
    while not board.is_game_over(claim_draw=True) and board.fullmove_number < max_moves:
        neural_turn = board.turn == (chess.WHITE if neural_is_white else chess.BLACK)
        if neural_turn:
            move = best_move(board, net, sims=sims)
        else:
            move = random.choice(list(board.legal_moves))
        if move is None:
            break
        board.push(move)

    if board.is_checkmate():
        winner_white = board.turn == chess.BLACK
        if winner_white == neural_is_white:
            return "win"
        return "loss"
    return "draw"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt", default="checkpoints/latest.pt")
    p.add_argument("--games", type=int, default=40)
    p.add_argument("--sims", type=int, default=100)
    p.add_argument("--channels", type=int, default=32)
    p.add_argument("--blocks", type=int, default=4)
    args = p.parse_args()

    random.seed(0)
    net = ChessNet(channels=args.channels, blocks=args.blocks)
    net.load_state_dict(torch.load(args.ckpt, map_location="cpu"))
    net.eval()

    tally = {"win": 0, "draw": 0, "loss": 0}
    for i in range(args.games):
        res = play(net, args.sims, neural_is_white=(i % 2 == 0))
        tally[res] += 1
        print(f"game {i+1}/{args.games}: {res}  {tally}", flush=True)

    score = (tally["win"] + 0.5 * tally["draw"]) / args.games
    print(f"\nvs random — {tally['win']}W {tally['draw']}D {tally['loss']}L "
          f"over {args.games} games | score {score*100:.0f}%")


if __name__ == "__main__":
    main()
