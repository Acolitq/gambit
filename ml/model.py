"""Residual policy-value network — the AlphaZero architecture, scaled down for
CPU training and small enough to run in a browser via ONNX.

Input:  (batch, 17, 8, 8) board planes.
Output: policy logits over 4672 moves, and a scalar value in [-1, 1].
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

from encoding import PLANES, POLICY_SIZE


class ResidualBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x):
        y = F.relu(self.bn1(self.conv1(x)))
        y = self.bn2(self.conv2(y))
        return F.relu(x + y)


class ChessNet(nn.Module):
    def __init__(self, channels=64, blocks=5):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(PLANES, channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(channels),
            nn.ReLU(inplace=True),
        )
        self.tower = nn.Sequential(*[ResidualBlock(channels) for _ in range(blocks)])

        # Policy head
        self.p_conv = nn.Conv2d(channels, 32, 1, bias=False)
        self.p_bn = nn.BatchNorm2d(32)
        self.p_fc = nn.Linear(32 * 8 * 8, POLICY_SIZE)

        # Value head
        self.v_conv = nn.Conv2d(channels, 16, 1, bias=False)
        self.v_bn = nn.BatchNorm2d(16)
        self.v_fc1 = nn.Linear(16 * 8 * 8, 128)
        self.v_fc2 = nn.Linear(128, 1)

    def forward(self, x):
        x = self.stem(x)
        x = self.tower(x)

        p = F.relu(self.p_bn(self.p_conv(x)))
        p = self.p_fc(p.flatten(1))  # logits

        v = F.relu(self.v_bn(self.v_conv(x)))
        v = F.relu(self.v_fc1(v.flatten(1)))
        v = torch.tanh(self.v_fc2(v))  # [-1, 1]
        return p, v.squeeze(-1)


if __name__ == "__main__":
    net = ChessNet()
    n_params = sum(p.numel() for p in net.parameters())
    x = torch.zeros(2, PLANES, 8, 8)
    p, v = net(x)
    print(f"ChessNet params: {n_params:,}")
    print(f"policy shape {tuple(p.shape)}  value shape {tuple(v.shape)}")
