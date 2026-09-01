"""Board and move encoding for the AlphaZero-style network.

Two jobs:
  1. Encode a position into a stack of 8x8 planes the CNN reads.
  2. Encode/decode moves to/from the 8x8x73 = 4672 AlphaZero policy index.

Everything is done from the side-to-move's perspective: if it is Black's turn we
mirror the board (colors swapped, ranks flipped) so the network always sees
"White to move, moving up the board". Moves are mirrored the same way, so the
policy head is colour-agnostic. `decode_index` mirrors the move back to the real
board frame.
"""

import numpy as np
import chess

# --- Board planes ---
# 12 piece planes (6 ours, 6 theirs) + side-to-move colour + 4 castling = 17.
PLANES = 17
PIECE_ORDER = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN, chess.KING]


def canonical(board: chess.Board) -> chess.Board:
    """Return the board from the side-to-move's perspective (White to move)."""
    return board if board.turn == chess.WHITE else board.mirror()


def encode_board(board: chess.Board) -> np.ndarray:
    """(PLANES, 8, 8) float32 tensor from the side-to-move's perspective."""
    b = canonical(board)
    planes = np.zeros((PLANES, 8, 8), dtype=np.float32)
    for sq in chess.SQUARES:
        piece = b.piece_at(sq)
        if piece is None:
            continue
        idx = PIECE_ORDER.index(piece.piece_type)
        if piece.color == chess.BLACK:
            idx += 6  # their pieces
        r = chess.square_rank(sq)
        f = chess.square_file(sq)
        planes[idx, r, f] = 1.0
    # Colour plane: 1 if the real side to move is White (before canonicalizing).
    if board.turn == chess.WHITE:
        planes[12, :, :] = 1.0
    # Castling rights, from the canonical board (our K/Q side, their K/Q side).
    if b.has_kingside_castling_rights(chess.WHITE):
        planes[13, :, :] = 1.0
    if b.has_queenside_castling_rights(chess.WHITE):
        planes[14, :, :] = 1.0
    if b.has_kingside_castling_rights(chess.BLACK):
        planes[15, :, :] = 1.0
    if b.has_queenside_castling_rights(chess.BLACK):
        planes[16, :, :] = 1.0
    return planes


# --- Move policy (8x8x73) ---
POLICY_SIZE = 64 * 73

# Queen-like directions (file_delta, rank_delta): N, NE, E, SE, S, SW, W, NW.
QUEEN_DIRS = [(0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)]
KNIGHT_DELTAS = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
UNDER_PIECES = [chess.KNIGHT, chess.BISHOP, chess.ROOK]  # queen handled as a queen move


def _sign(x):
    return (x > 0) - (x < 0)


def _mirror_move(move: chess.Move) -> chess.Move:
    return chess.Move(
        chess.square_mirror(move.from_square),
        chess.square_mirror(move.to_square),
        promotion=move.promotion,
    )


def encode_move(board: chess.Board, move: chess.Move) -> int:
    """Policy index for a move played on `board` (mirrored if Black to move)."""
    if board.turn == chess.BLACK:
        move = _mirror_move(move)
    frm, to = move.from_square, move.to_square
    ff, fr = chess.square_file(frm), chess.square_rank(frm)
    tf, tr = chess.square_file(to), chess.square_rank(to)
    df, dr = tf - ff, tr - fr

    plane = None
    # Underpromotion (knight/bishop/rook). Queen promotion falls through to queen move.
    if move.promotion and move.promotion != chess.QUEEN:
        dir_idx = df + 1  # -1,0,1 -> 0,1,2 (capture-left, push, capture-right)
        piece_idx = UNDER_PIECES.index(move.promotion)
        plane = 64 + dir_idx * 3 + piece_idx
    elif (df, dr) in KNIGHT_DELTAS:
        plane = 56 + KNIGHT_DELTAS.index((df, dr))
    else:
        direction = (_sign(df), _sign(dr))
        dist = max(abs(df), abs(dr))
        plane = QUEEN_DIRS.index(direction) * 7 + (dist - 1)
    return frm * 73 + plane


def decode_index(board: chess.Board, index: int):
    """Turn a policy index into a legal chess.Move on `board`, or None."""
    flip = board.turn == chess.BLACK
    frm = index // 73
    plane = index % 73
    ff, fr = chess.square_file(frm), chess.square_rank(frm)
    promotion = None

    if plane < 56:
        dir_idx, dist = plane // 7, plane % 7 + 1
        fd, rd = QUEEN_DIRS[dir_idx]
        tf, tr = ff + fd * dist, fr + rd * dist
    elif plane < 64:
        fd, rd = KNIGHT_DELTAS[plane - 56]
        tf, tr = ff + fd, fr + rd
    else:
        u = plane - 64
        dir_idx, piece_idx = u // 3, u % 3
        fd, rd = dir_idx - 1, 1
        tf, tr = ff + fd, fr + rd
        promotion = UNDER_PIECES[piece_idx]

    if not (0 <= tf < 8 and 0 <= tr < 8):
        return None
    to = chess.square(tf, tr)

    # A pawn reaching the last rank via a queen-move plane is a queen promotion.
    if promotion is None:
        b = canonical(board)
        piece = b.piece_at(frm)
        if piece and piece.piece_type == chess.PAWN and tr == 7:
            promotion = chess.QUEEN

    move = chess.Move(frm, to, promotion=promotion)
    if flip:
        move = _mirror_move(move)
    return move if move in board.legal_moves else None


def legal_move_indices(board: chess.Board):
    """List of (policy_index, move) for every legal move."""
    return [(encode_move(board, m), m) for m in board.legal_moves]


if __name__ == "__main__":
    # Round-trip self-test: every legal move must encode then decode back to itself.
    import random

    rng = random.Random(0)
    checked = 0
    for _ in range(300):
        board = chess.Board()
        for _ in range(rng.randint(0, 40)):
            moves = list(board.legal_moves)
            if not moves:
                break
            board.push(rng.choice(moves))
        for move in board.legal_moves:
            idx = encode_move(board, move)
            back = decode_index(board, idx)
            assert back == move, f"round-trip failed: {move} -> {idx} -> {back}\n{board.fen()}"
            checked += 1
    print(f"encoding round-trip OK — {checked} legal moves across random positions")
    print(f"PLANES={PLANES}  POLICY_SIZE={POLICY_SIZE}")
