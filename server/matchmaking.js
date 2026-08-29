import { GameRoom } from './gameRoom.js';
import { S2C } from './protocol.js';

// Holds the FIFO waiting queue and all live rooms. One instance per server.
export class Matchmaker {
  constructor() {
    this.queue = []; // conns waiting for an opponent
    this.rooms = new Map(); // gameId -> GameRoom
  }

  join(conn) {
    if (conn.state !== 'idle') {
      conn.send(S2C.ERROR, { message: 'Already queued or in a game.' });
      return;
    }
    conn.state = 'queued';
    this.queue.push(conn);
    conn.send(S2C.QUEUED, { position: this.queue.length });
    this._tryPair();
  }

  cancel(conn) {
    this._removeFromQueue(conn);
    if (conn.state === 'queued') conn.state = 'idle';
  }

  _removeFromQueue(conn) {
    const i = this.queue.indexOf(conn);
    if (i !== -1) this.queue.splice(i, 1);
  }

  _tryPair() {
    // Drop any dead sockets first, then pair the two oldest waiters.
    while (this.queue.length >= 2) {
      const a = this.queue.shift();
      const b = this.queue.shift();
      if (a.ws.readyState !== a.ws.OPEN) {
        if (b.ws.readyState === b.ws.OPEN) this.queue.unshift(b);
        continue;
      }
      if (b.ws.readyState !== b.ws.OPEN) {
        this.queue.unshift(a);
        continue;
      }
      const room = new GameRoom(a, b, (r) => this.rooms.delete(r.id));
      this.rooms.set(room.id, room);
      room.start();
    }
  }

  handleMove(conn, msg) {
    const room = this.rooms.get(msg.gameId);
    if (room) room.handleMove(conn, msg);
  }

  handleResign(conn, msg) {
    const room = this.rooms.get(msg.gameId);
    if (room) room.handleResign(conn);
  }

  handleRejoin(conn, msg) {
    const room = this.rooms.get(msg.gameId);
    if (room) {
      conn.color = msg.color;
      room.handleRejoin(conn);
    }
  }

  handleDisconnect(conn) {
    if (conn.state === 'queued') {
      this._removeFromQueue(conn);
      return;
    }
    if (conn.state === 'in_game' && conn.roomId) {
      const room = this.rooms.get(conn.roomId);
      if (room) room.handleDisconnect(conn);
    }
  }
}
