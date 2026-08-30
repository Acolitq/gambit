# WebSocket Protocol

Gambit's online play runs over a single WebSocket connection. Every frame is a
JSON object with a `type` field plus a type-specific payload. The server is the
authoritative source of truth for online games — clients pre-validate moves for
responsiveness but never enforce the rules on their own.

## Client → Server

| Type | Payload | Meaning |
| --- | --- | --- |
| `queue_join` | — | Enter matchmaking. |
| `queue_cancel` | — | Leave the queue. |
| `move` | `gameId, from, to, promotion?` | Attempt a move. |
| `resign` | `gameId` | Resign the current game. |
| `rejoin` | `gameId, color` | Reconnect to a game in progress. |
| `ping` | — | Heartbeat. |

## Server → Client

| Type | Payload | Meaning |
| --- | --- | --- |
| `queued` | `position` | Ack; your place in the queue. |
| `match_found` | `gameId, color, opponentId, fen, clock` | Paired with an opponent. |
| `move_made` | `gameId, from, to, promotion?, san, fen, turn, clock` | A legal move was applied. |
| `illegal_move` | `gameId, reason` | Your move was rejected (sender only). |
| `game_over` | `gameId, result, reason` | The game ended. `result` is `w`, `b`, or `draw`. |
| `opponent_disconnected` | `gameId, graceMs` | Opponent dropped; reconnect timer running. |
| `opponent_reconnected` | `gameId` | Opponent is back. |
| `pong` | — | Heartbeat reply. |
| `error` | `message` | Malformed message or invalid state. |

## Lifecycle

```
join queue ──▶ queued ──▶ match_found ──▶ [ move_made … ] ──▶ game_over
                                              │
                          illegal_move ◀──────┤ (rejected move, sender only)
                                              │
              opponent_disconnected ◀─────────┤ (drop; grace window)
              opponent_reconnected  ◀─────────┘ (rejoin within grace)
```

Move validation, checkmate/stalemate/draw detection and clock accounting all
happen server-side in `server/gameRoom.js`; `server/matchmaking.js` owns the
queue and room lifecycle.
