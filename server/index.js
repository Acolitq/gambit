import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { wrapConnection } from './connection.js';
import { Matchmaker } from './matchmaking.js';
import { C2S, S2C, decode } from './protocol.js';
import { scout } from './scout.js';
import { otbSearch, otbPlayer } from './federation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();
app.use(express.static(publicDir));

// Opponent scouting proxy. GET /api/scout?platform=chesscom|lichess&username=...
app.get('/api/scout', async (req, res) => {
  const platform = req.query.platform === 'lichess' ? 'lichess' : 'chesscom';
  const username = String(req.query.username || '').trim();
  if (!username || !/^[\w-]{1,40}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username.' });
  }
  try {
    const dossier = await scout(platform, username);
    res.json(dossier);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not fetch games.' });
  }
});

// OTB / federation scouting. Name search → candidates.
app.get('/api/otb/search', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Enter at least 2 characters.' });
  try {
    res.json({ candidates: await otbSearch(name) });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Search failed.' });
  }
});

// OTB player profile by CFC id and/or FIDE id.
app.get('/api/otb/player', async (req, res) => {
  const cfc = req.query.cfc ? String(req.query.cfc).replace(/\D/g, '') : null;
  const fide = req.query.fide ? String(req.query.fide).replace(/\D/g, '') : null;
  if (!cfc && !fide) return res.status(400).json({ error: 'Provide a CFC or FIDE id.' });
  try {
    res.json(await otbPlayer({ cfc, fide }));
  } catch (err) {
    res.status(502).json({ error: err.message || 'Lookup failed.' });
  }
});

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
