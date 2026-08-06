import { randomUUID } from 'node:crypto';
import { encode } from './protocol.js';

// Wraps a raw ws socket with the small amount of state the game layer needs.
export function wrapConnection(ws) {
  const conn = {
    id: randomUUID(),
    ws,
    state: 'idle', // 'idle' | 'queued' | 'in_game'
    roomId: null,
    color: null, // 'w' | 'b' once in a game
    isAlive: true,

    send(type, payload) {
      if (ws.readyState === ws.OPEN) {
        ws.send(encode(type, payload));
      }
    },
  };
  return conn;
}
