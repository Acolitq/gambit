"""Export a trained checkpoint to ONNX for in-browser inference (onnxruntime-web).

Usage:
  python export_onnx.py --ckpt checkpoints/latest.pt --channels 32 --blocks 4 \
      --out ../public/vendor/neural/gambit-net.onnx
"""

import argparse
import os

import numpy as np
import torch

from model import ChessNet
from encoding import PLANES


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ckpt", default="checkpoints/latest.pt")
    p.add_argument("--channels", type=int, default=32)
    p.add_argument("--blocks", type=int, default=4)
    p.add_argument("--out", default="../public/vendor/neural/gambit-net.onnx")
    args = p.parse_args()

    net = ChessNet(channels=args.channels, blocks=args.blocks)
    net.load_state_dict(torch.load(args.ckpt, map_location="cpu"))
    net.eval()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    dummy = torch.zeros(1, PLANES, 8, 8)
    torch.onnx.export(
        net,
        dummy,
        args.out,
        input_names=["board"],
        output_names=["policy", "value"],
        dynamic_axes={"board": {0: "batch"}, "policy": {0: "batch"}, "value": {0: "batch"}},
        opset_version=17,
    )
    size_mb = os.path.getsize(args.out) / 1e6
    print(f"exported {args.out}  ({size_mb:.1f} MB)")

    # Sanity-check with onnxruntime that outputs match PyTorch.
    try:
        import onnxruntime as ort

        sess = ort.InferenceSession(args.out, providers=["CPUExecutionProvider"])
        x = np.random.randn(1, PLANES, 8, 8).astype(np.float32)
        onnx_p, onnx_v = sess.run(None, {"board": x})
        with torch.no_grad():
            torch_p, torch_v = net(torch.from_numpy(x))
        dp = np.abs(onnx_p - torch_p.numpy()).max()
        dv = np.abs(onnx_v - torch_v.numpy()).max()
        print(f"onnx vs torch — max policy diff {dp:.2e}, value diff {dv:.2e}")
    except Exception as e:
        print("onnxruntime check skipped:", e)


if __name__ == "__main__":
    main()
