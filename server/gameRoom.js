import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import { config } from './config.js';
import { S2C } from './protocol.js';

// A GameRoom owns the authoritative board for one online match. The server
// validates every move here; clients are never trusted to enforce the rules.
export class GameRoom {
  constructor(connA, connB, onEnd) {
    this.id = randomUUID();
    this.chess = new Chess();
    this.onEnd = onEnd; // callback(room) so matchmaking can clean up
    this.over = false;
    this.disconnectTimer = null;

    // Randomly assign colors so neither queue position guarantees white.
    const aIsWhite = Math.random() < 0.5;
    this.white = aIsWhite ? connA : connB;
    this.black = aIsWhite ? connB : connA;
    this.white.color = 'w';
    this.black.color = 'b';

    // Simple per-side clock. The active side's time is decremented lazily
    // (on each move) and also swept by an interval to catch flag-falls.
    this.clock = { w: config.initialClockMs, b: config.initialClockMs };
    this.turnStartedAt = Date.now();

    for (const conn of [this.white, this.black]) {
      conn.state = 'in_game';
      conn.roomId = this.id;
    }

    this.timeoutSweep = setInterval(() => this._checkTimeout(), 1000);
  }

  connFor(color) {
    return color === 'w' ? this.white : this.black;
  }

  opponentOf(conn) {
    return conn === this.white ? this.black : this.white;
  }

  start() {
    for (const conn of [this.white, this.black]) {
      conn.send(S2C.MATCH_FOUND, {
        gameId: this.id,
        color: conn.color,
        opponentId: this.opponentOf(conn).id,
        fen: this.chess.fen(),
        clock: { ...this.clock },
      });
    }
  }

  // Deduct the time the moving side spent thinking, then hand the clock over.
  _tickClock() {
    const now = Date.now();
    const turn = this.chess.turn();
    this.clock[turn] -= now - this.turnStartedAt;
    this.turnStartedAt = now;
  }

  _checkTimeout() {
    if (this.over) return;
    const turn = this.chess.turn();
    const remaining = this.clock[turn] - (Date.now() - this.turnStartedAt);
    if (remaining <= 0) {
      this.clock[turn] = 0;
      const winner = turn === 'w' ? 'b' : 'w';
      this.end(winner, 'timeout');
    }
  }

  handleMove(conn, { from, to, promotion }) {
    if (this.over) return;
    // Reject moves made out of turn before touching the board.
    if (conn.color !== this.chess.turn()) {
      conn.send(S2C.ILLEGAL_MOVE, { gameId: this.id, reason: 'not_your_turn' });
      return;
    }

    let result;
    try {
      result = this.chess.move({ from, to, promotion: promotion || undefined });
    } catch {
      result = null;
    }
    if (!result) {
      conn.send(S2C.ILLEGAL_MOVE, { gameId: this.id, reason: 'illegal' });
      return;
    }

    this._tickClock();

    const payload = {
      gameId: this.id,
      from: result.from,
      to: result.to,
      promotion: result.promotion || undefined,
      san: result.san,
      fen: this.chess.fen(),
      turn: this.chess.turn(),
      clock: { ...this.clock },
    };
    this.white.send(S2C.MOVE_MADE, payload);
    this.black.send(S2C.MOVE_MADE, payload);

    this._checkGameOver();
  }

  _checkGameOver() {
    if (!this.chess.isGameOver()) return;
    if (this.chess.isCheckmate()) {
      // The side that just moved delivered mate; it's now the loser's turn.
      const winner = this.chess.turn() === 'w' ? 'b' : 'w';
      this.end(winner, 'checkmate');
    } else if (this.chess.isStalemate()) {
      this.end('draw', 'stalemate');
    } else {
      this.end('draw', 'draw');
    }
  }

  handleResign(conn) {
    if (this.over) return;
    const winner = conn.color === 'w' ? 'b' : 'w';
    this.end(winner, 'resign');
  }

  // Opponent dropped: give them a grace window to reconnect before forfeiting.
  handleDisconnect(conn) {
    if (this.over) return;
    const opponent = this.opponentOf(conn);
    opponent.send(S2C.OPPONENT_DISCONNECTED, {
      gameId: this.id,
      graceMs: config.disconnectGraceMs,
    });
    this.disconnectTimer = setTimeout(() => {
      const winner = opponent.color;
      this.end(winner, 'disconnect');
    }, config.disconnectGraceMs);
  }

  handleRejoin(conn) {
    if (this.over) return;
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    conn.state = 'in_game';
    conn.roomId = this.id;
    // Replay authoritative state so the reconnecting client rebuilds the board.
    conn.send(S2C.MATCH_FOUND, {
      gameId: this.id,
      color: conn.color,
      opponentId: this.opponentOf(conn).id,
      fen: this.chess.fen(),
      clock: { ...this.clock },
    });
    this.opponentOf(conn).send(S2C.OPPONENT_RECONNECTED, { gameId: this.id });
  }

  end(result, reason) {
    if (this.over) return;
    this.over = true;
    clearInterval(this.timeoutSweep);
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    for (const conn of [this.white, this.black]) {
      conn.send(S2C.GAME_OVER, { gameId: this.id, result, reason });
      conn.state = 'idle';
      conn.roomId = null;
      conn.color = null;
    }
    this.onEnd(this);
  }
}
