import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { wrapConnection } from './connection.js';
import { Matchmaker } from './matchmaking.js';
import { C2S, S2C, decode } from './protocol.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();
app.use(express.static(publicDir));
// Single-page app: unknown routes fall through to index.html.
app.get('*', (_req, res) => res.sendFile(join(publicDir, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const matchmaker = new Matchmaker();

wss.on('connection', (ws) => {
  const conn = wrapConnection(ws);
  ws.__conn = conn;

  ws.on('pong', () => {
    conn.isAlive = true;
  });

  ws.on('message', (raw) => {
    const msg = decode(raw.toString());
    if (!msg) {
      conn.send(S2C.ERROR, { message: 'Malformed message.' });
      return;
    }
    switch (msg.type) {
      case C2S.QUEUE_JOIN:
        matchmaker.join(conn);
        break;
      case C2S.QUEUE_CANCEL:
        matchmaker.cancel(conn);
        break;
      case C2S.MOVE:
        matchmaker.handleMove(conn, msg);
        break;
      case C2S.RESIGN:
        matchmaker.handleResign(conn, msg);
        break;
      case C2S.REJOIN:
        matchmaker.handleRejoin(conn, msg);
        break;
      case C2S.PING:
        conn.send(S2C.PONG);
        break;
      default:
        conn.send(S2C.ERROR, { message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => matchmaker.handleDisconnect(conn));
  ws.on('error', () => matchmaker.handleDisconnect(conn));
});

// Heartbeat: mark each socket dead, then ping; a socket that misses the next
// pong is terminated on the following sweep, which triggers its disconnect path.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const conn = ws.__conn;
    if (conn && conn.isAlive === false) {
      ws.terminate();
      continue;
    }
    if (conn) conn.isAlive = false;
    if (ws.readyState === ws.OPEN) ws.ping();
  }
}, config.heartbeatMs);

wss.on('close', () => clearInterval(heartbeat));

server.listen(config.port, () => {
  console.log(`Gambit server listening on http://localhost:${config.port}`);
});
