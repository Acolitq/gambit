# Gambit — AlphaZero-style neural chess engine

A from-scratch implementation of the AlphaZero method: a **policy-value neural
network** guided by **PUCT Monte Carlo Tree Search**, trained purely by
**self-play reinforcement learning** — no human games, no handcrafted evaluation.

The trained network is exported to ONNX and runs **in the browser** (via
`onnxruntime-web`) with the MCTS reimplemented in JavaScript, so the neural bot
plays fully client-side alongside the classical alpha-beta engine.

## Honest scope

Real AlphaZero trained on thousands of TPUs over millions of games. This is the
same **method and architecture** at a scale that trains on a laptop CPU — so it
plays real, legal chess but is not a strong engine. Strength is reported from
**measured** self-play/eval results (see `eval.py`), never estimated.

## Pipeline

| File | Role |
| --- | --- |
| `encoding.py` | Board → 17×8×8 planes; moves ↔ AlphaZero 8×8×73 policy index (with a round-trip self-test). |
| `model.py` | Residual policy-value CNN (PyTorch). |
| `mcts.py` | PUCT Monte Carlo Tree Search guided by the network. |
| `selfplay.py` | Generate self-play games, recording MCTS policy + game outcome. |
| `train.py` | The AlphaZero loop: self-play → train on (policy, value) → repeat. |
| `eval.py` | Measure strength vs a random baseline. |
| `export_onnx.py` | Export a checkpoint to ONNX for the browser. |

The JavaScript side (`public/js/engine/neural/`) mirrors `encoding.py`
bit-for-bit (verified against Python) and reimplements MCTS for `onnxruntime-web`.

## Usage

```bash
python -m venv .venv && ./.venv/bin/pip install -r requirements.txt

./.venv/bin/python encoding.py          # verify move encoding round-trips
./.venv/bin/python train.py --smoke     # end-to-end pipeline check
./.venv/bin/python train.py --iterations 12 --games 16 --sims 30   # real run (CPU)
./.venv/bin/python eval.py --games 40 --sims 100                   # measure strength
./.venv/bin/python export_onnx.py --out ../public/vendor/neural/gambit-net.onnx
```

Training is resumable (`--resume checkpoints/latest.pt`); scale up
`--iterations`, `--games`, `--sims`, `--channels`, and `--blocks` with more
compute for a stronger network.
