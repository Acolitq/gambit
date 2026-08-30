# ♟ Gambit

A clean, lightweight chess app. Play against bots across five difficulty levels,
or jump into an online queue and get matched against another waiting player.

No framework, no build step — just vanilla JavaScript ES modules on the front
end and a small Node/WebSocket server for matchmaking.

## Features

- **Single-player vs bots** — five levels, from a blundering beginner to a
  deeper-searching "Master". The engine is negamax with alpha-beta pruning and a
  material + piece-square-table evaluation; lower levels play weaker on purpose
  via a tunable blunder chance.
- **Online play** — join the queue and the server pairs you with the next
  waiting opponent (random colors), relays and validates every move, and manages
  clocks, resignations, disconnects and reconnects.
- **Full chess rules** — castling, en passant, promotion, check/checkmate,
  stalemate, and draw detection, courtesy of [`chess.js`](https://github.com/jhlywa/chess.js)
  shared by both client and server.
- **Polished UI** — light/dark themes, move history, captured-piece tracking,
  legal-move hints, last-move and check highlights, and per-side clocks.

## Tech

| Layer | Choice |
| --- | --- |
| Client | Vanilla JS ES modules, CSS custom properties, Unicode chess glyphs |
| Server | Node.js, Express (static hosting), `ws` (WebSockets) |
| Rules | `chess.js` on both ends |
| Bot | Negamax + alpha-beta, piece-square tables |

## Getting started

```bash
npm install
npm start
# open http://localhost:3000
```

For development with auto-restart:

```bash
npm run dev
```

## Project layout

```
server/          Node backend
  index.js         Express static server + WebSocket wiring
  matchmaking.js   FIFO queue + room lifecycle
  gameRoom.js      Authoritative per-match game state
  protocol.js      Shared message types
public/          Front end
  js/engine/       Bot: minimax, evaluation, piece-square tables
  js/game/         Game controller (owns chess.js)
  js/ui/           Board, move list, status bar
  js/screens/      Menu, setup, queue, game, result
  js/net/          WebSocket client
  styles/          Design-token CSS
```

## How online matchmaking works

1. Client opens a WebSocket and sends `queue_join`.
2. The server keeps a FIFO queue; when two players are waiting it creates a
   `GameRoom`, assigns colors randomly, and sends both a `match_found`.
3. Each move is sent to the server, validated against the authoritative board,
   then broadcast to both players with the resulting FEN and clocks.
4. Resignations, timeouts, and disconnects (with a reconnect grace period) all
   resolve to a `game_over` message.

The server is the source of truth — clients pre-validate for responsiveness but
never enforce the rules alone.

## Deployment

The app is a single Node process that serves the static client and the
WebSocket endpoint on the same port, so it deploys anywhere that runs Node and
supports WebSockets (Render, Railway, Fly.io, a VPS). A `render.yaml` is
included for one-click Render deploys.

## License

MIT © Acolitq
