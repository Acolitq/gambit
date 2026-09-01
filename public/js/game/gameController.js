import { Chess } from 'chess.js';
import { chooseMove } from '../engine/bot.js';

// Orchestrates a single game. Owns the local chess.js instance and drives the
// board, move list and status bar. Works for both 'bot' and 'online' modes.
export function createGame(opts) {
  const {
    mode, // 'bot' | 'online'
    playerColor, // 'w' | 'b'
    level = 3,
    socket = null,
    gameId = null,
    board,
    moveList,
    statusBar,
    onCaptured = () => {},
    onClock = () => {},
    onGameOver = () => {},
  } = opts;

  const chess = new Chess();
  const captured = { w: [], b: [] }; // pieces each color has captured
  let over = false;

  // Board asks us which squares a piece can legally move to.
  function legalMovesFor(square) {
    if (over) return [];
    const piece = chess.get(square);
    if (!piece || piece.color !== playerColor) return [];
    if (chess.turn() !== playerColor) return [];
    return chess.moves({ square, verbose: true }).map((m) => m.to);
  }

  function refresh() {
    board.setPosition(chess.fen());
    moveList.render(chess.history());
    board.clearCheck();
    if (chess.inCheck()) {
      board.flashCheck(kingSquare(chess.turn()));
    }
    updateStatus();
    onCaptured({ w: [...captured.w], b: [...captured.b] });
  }

  function kingSquare(color) {
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === color) return cell.square;
      }
    }
    return null;
  }

  function updateStatus() {
    if (over) return;
    const turn = chess.turn();
    const side = turn === 'w' ? 'White' : 'Black';
    if (chess.inCheck()) {
      statusBar.set(`${side} is in check`, 'danger');
    } else {
      statusBar.set(`${side} to move`, 'neutral');
    }
  }

  function recordCapture(result) {
    if (result && result.captured) {
      captured[result.color].push(result.captured);
    }
  }

  function finishIfOver() {
    if (!chess.isGameOver()) return false;
    over = true;
    board.setInteractive(false);
    let result, reason;
    if (chess.isCheckmate()) {
      result = chess.turn() === 'w' ? 'b' : 'w';
      reason = 'checkmate';
    } else if (chess.isStalemate()) {
      result = 'draw';
      reason = 'stalemate';
    } else {
      result = 'draw';
      reason = chess.isInsufficientMaterial() ? 'insufficient material' : 'draw';
    }
    onGameOver({ result, reason });
    return true;
  }

  // --- Local (player) move ---
  function handleLocalMove(from, to, promotion) {
    if (over || chess.turn() !== playerColor) return;
    let result;
    try {
      result = chess.move({ from, to, promotion: promotion || undefined });
    } catch {
      result = null;
    }
    if (!result) return; // board only offers legal targets, so this is rare

    recordCapture(result);
    board.highlightLastMove(result.from, result.to);
    refresh();

    if (mode === 'online') {
      socket.send('move', { gameId, from: result.from, to: result.to, promotion });
      board.setInteractive(false); // wait for the opponent
    }
    if (finishIfOver()) return;

    if (mode === 'bot') {
      board.setInteractive(false);
      statusBar.set('Computer is thinking…', 'neutral');
      thinkAndMove();
    }
  }

  // --- Bot move ---
  function thinkAndMove() {
    // Yield a frame so the "thinking" state paints before we block on search.
    setTimeout(() => {
      if (over) return;
      const move = chooseMove(chess.fen(), level);
      if (!move) {
        finishIfOver();
        return;
      }
      const result = chess.move(move);
      recordCapture(result);
      board.highlightLastMove(result.from, result.to);
      refresh();
      board.setInteractive(true);
      finishIfOver();
    }, 220);
  }

  // --- Remote (online) move from the server ---
  function applyRemoteMove(msg) {
    if (over) return;
    const history = chess.history();
    // Skip the echo of our own move (already applied optimistically).
    if (msg.san && history[history.length - 1] === msg.san) return;
    let result;
    try {
      result = chess.move({ from: msg.from, to: msg.to, promotion: msg.promotion });
    } catch {
      result = null;
    }
    if (!result) return;
    recordCapture(result);
    board.highlightLastMove(result.from, result.to);
    refresh();
    board.setInteractive(chess.turn() === playerColor);
    finishIfOver();
  }

  // Server rejected our optimistic move — roll it back to stay in sync.
  function revertLastLocal() {
    const undone = chess.undo();
    if (undone && undone.captured) captured[undone.color].pop();
    board.highlightLastMove(undone?.from, undone?.to);
    refresh();
    board.setInteractive(chess.turn() === playerColor);
  }

  // Rebuild from an authoritative FEN — used when reconnecting to an online
  // game. Move history isn't recoverable from a FEN alone, so the list resets.
  function syncFromFen(fen) {
    chess.load(fen);
    refresh();
    board.setInteractive(!over && chess.turn() === playerColor);
  }

  function start() {
    board.setOrientation(playerColor);
    board.setPosition(chess.fen());
    refresh();
    const myTurn = chess.turn() === playerColor;
    board.setInteractive(myTurn);
    if (mode === 'bot' && !myTurn) {
      // Player chose black: the bot opens.
      statusBar.set('Computer is thinking…', 'neutral');
      thinkAndMove();
    }
  }

  function resign() {
    if (over) return;
    over = true;
    board.setInteractive(false);
    if (mode === 'online') socket.send('resign', { gameId });
    const result = playerColor === 'w' ? 'b' : 'w';
    onGameOver({ result, reason: 'resign' });
  }

  function forceOver(payload) {
    if (over) return;
    over = true;
    board.setInteractive(false);
    onGameOver(payload);
  }

  return {
    legalMovesFor,
    handleLocalMove,
    applyRemoteMove,
    revertLastLocal,
    syncFromFen,
    getPgn: () => chess.pgn(),
    start,
    resign,
    forceOver,
    isOver: () => over,
    playerColor,
    setClock: onClock,
  };
}
