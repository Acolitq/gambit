// Shared message-type constants for the WebSocket protocol.
// Keeping these in one place avoids typos drifting between client and server.

// Client -> Server
export const C2S = {
  QUEUE_JOIN: 'queue_join',
  QUEUE_CANCEL: 'queue_cancel',
  MOVE: 'move',
  RESIGN: 'resign',
  REJOIN: 'rejoin',
  PING: 'ping',
};

// Server -> Client
export const S2C = {
  QUEUED: 'queued',
  MATCH_FOUND: 'match_found',
  MOVE_MADE: 'move_made',
  ILLEGAL_MOVE: 'illegal_move',
  GAME_OVER: 'game_over',
  OPPONENT_DISCONNECTED: 'opponent_disconnected',
  OPPONENT_RECONNECTED: 'opponent_reconnected',
  PONG: 'pong',
  ERROR: 'error',
};

// Build a serialized message. Kept tiny on purpose.
export function encode(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

// Parse an incoming frame, returning null on malformed input instead of throwing.
export function decode(raw) {
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg.type !== 'string') return null;
    return msg;
  } catch {
    return null;
  }
}
