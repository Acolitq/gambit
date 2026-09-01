# ♟ Gambit

A clean, lightweight chess app. Play against bots across five difficulty levels,
or jump into an online queue and get matched against another waiting player.

No framework, no build step — just vanilla JavaScript ES modules on the front
end and a small Node/WebSocket server for matchmaking.

## Features

### Play
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

### Study
- **Post-game analysis** — every position is evaluated by **Stockfish 16**
  (WASM, in a Web Worker). A vertical **eval bar**, numeric evaluations
  (`+1.4`, `#3`), a live **multi-line engine panel** (top candidate moves), and
  per-move blunder / mistake / inaccuracy / best classification with centipawn
  loss. Each side gets an accuracy percentage and there's an interactive eval
  graph to jump to any moment.
- **Opponent scouting** — two modes:
  - *Online:* a Chess.com or Lichess username → prep dossier of most-played
    openings by colour with W/D/L splits, time-control mix, and recent games you
    can open straight in the analysis board.
  - *Over the board:* search FIDE and the Chess Federation of Canada by name →
    ratings across federations, CFC rating history, and full tournament history,
    with deep links to game databases.
- **Openings trainer** — an explore board that names the current position live
  from a 3,800-line opening database, suggests named continuations, and plays
  out the main lines of the common openings.

- **Polished UI** — the lichess board and piece set, light/dark themes, move
  history, captured-piece tracking, legal-move hints, and per-side clocks.

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

## Credits

- Chess piece images: the **cburnett** SVG set by [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), via [lichess-org/lila](https://github.com/lichess-org/lila), licensed **GPLv2+**.
- Move legality: [`chess.js`](https://github.com/jhlywa/chess.js). Analysis engine: [Stockfish 16](https://stockfishchess.org/) (WASM), GPLv3.
- Opponent scouting and opening data via the public [Chess.com](https://www.chess.com/news/view/published-data-api) and [Lichess](https://lichess.org/api) APIs.

## License

MIT © Acolitq (application code; bundled assets keep their own licenses noted above)
