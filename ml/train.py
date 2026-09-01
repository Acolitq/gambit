"""AlphaZero-style training loop: self-play → train on (policy, value) targets →
repeat. Designed to run on CPU, so the defaults are small. Scale up the flags
(iterations, games, sims) when you have more compute.

Usage:
  python train.py --iterations 10 --games 20 --sims 40 --epochs 4
  python train.py --smoke            # tiny run to verify the pipeline end-to-end
"""

import argparse
import os
import time
from collections import deque

import numpy as np
import torch
import torch.nn.functional as F

from model import ChessNet
from selfplay import play_game

CKPT_DIR = os.path.join(os.path.dirname(__file__), "checkpoints")


def train(args):
    torch.manual_seed(0)
    np.random.seed(0)
    device = "cpu"
    net = ChessNet(channels=args.channels, blocks=args.blocks).to(device)
    if args.resume and os.path.exists(args.resume):
        net.load_state_dict(torch.load(args.resume, map_location=device))
        print(f"resumed from {args.resume}")
    opt = torch.optim.Adam(net.parameters(), lr=args.lr, weight_decay=1e-4)

    os.makedirs(CKPT_DIR, exist_ok=True)
    replay = deque(maxlen=args.buffer)  # (planes, pi, z)

    for it in range(1, args.iterations + 1):
        t0 = time.time()
        net.eval()
        results = {"w": 0, "b": 0, "d": 0}
        new = 0
        for _ in range(args.games):
            data, result = play_game(net, sims=args.sims, max_moves=args.max_moves)
            replay.extend(data)
            new += len(data)
            results["w" if result > 0 else "b" if result < 0 else "d"] += 1

        # Train on random minibatches from the replay buffer.
        net.train()
        losses = _train_epochs(net, opt, replay, args)
        dt = time.time() - t0
        print(
            f"iter {it:>3}/{args.iterations} | games {args.games} "
            f"(W{results['w']} B{results['b']} D{results['d']}) | "
            f"new {new} buf {len(replay)} | loss {losses:.3f} | {dt:.0f}s",
            flush=True,
        )

        ckpt = os.path.join(CKPT_DIR, "latest.pt")
        torch.save(net.state_dict(), ckpt)
    print(f"done — checkpoint at {os.path.join(CKPT_DIR, 'latest.pt')}")


def _train_epochs(net, opt, replay, args):
    if len(replay) < args.batch:
        return 0.0
    data = list(replay)
    total = 0.0
    steps = 0
    for _ in range(args.epochs):
        np.random.shuffle(data)
        for i in range(0, len(data) - args.batch + 1, args.batch):
            batch = data[i : i + args.batch]
            planes = torch.from_numpy(np.stack([b[0] for b in batch]))
            pi = torch.from_numpy(np.stack([b[1] for b in batch]))
            z = torch.from_numpy(np.stack([b[2] for b in batch]))

            logits, value = net(planes)
            logp = F.log_softmax(logits, dim=1)
            policy_loss = -(pi * logp).sum(dim=1).mean()
            value_loss = F.mse_loss(value, z)
            loss = policy_loss + value_loss

            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item()
            steps += 1
    return total / max(steps, 1)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--iterations", type=int, default=10)
    p.add_argument("--games", type=int, default=20)
    p.add_argument("--sims", type=int, default=40)
    p.add_argument("--epochs", type=int, default=4)
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--buffer", type=int, default=20000)
    p.add_argument("--max-moves", type=int, default=120)
    p.add_argument("--channels", type=int, default=64)
    p.add_argument("--blocks", type=int, default=5)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--resume", type=str, default="")
    p.add_argument("--smoke", action="store_true", help="tiny end-to-end test run")
    args = p.parse_args()
    if args.smoke:
        args.iterations, args.games, args.sims, args.epochs, args.batch = 1, 2, 8, 1, 8
        args.channels, args.blocks, args.max_moves = 32, 2, 30
    train(args)


if __name__ == "__main__":
    main()
