import { Chess } from 'chess.js';
import { query } from './db.js';
import { collectGames, openingName } from './scout.js';

// All handlers assume requireAuth has set req.user.

// --- Ownership guards ---
async function ownTracker(userId, trackerId) {
  const { rows } = await query('SELECT * FROM trackers WHERE id = $1 AND user_id = $2', [trackerId, userId]);
  return rows[0] || null;
}
async function ownOpponent(userId, opponentId) {
  const { rows } = await query(
    `SELECT o.* FROM opponents o
     JOIN trackers t ON t.id = o.tracker_id
     WHERE o.id = $1 AND t.user_id = $2`,
    [opponentId, userId],
  );
  return rows[0] || null;
}
async function ownGame(userId, gameId) {
  const { rows } = await query(
    `SELECT g.* FROM games g
     JOIN opponents o ON o.id = g.opponent_id
     JOIN trackers t ON t.id = o.tracker_id
     WHERE g.id = $1 AND t.user_id = $2`,
    [gameId, userId],
  );
  return rows[0] || null;
}

// --- Trackers ---
export async function listTrackers(req, res) {
  const { rows } = await query(
    `SELECT t.*, COUNT(o.id)::int AS opponent_count
     FROM trackers t LEFT JOIN opponents o ON o.tracker_id = t.id
     WHERE t.user_id = $1
     GROUP BY t.id ORDER BY t.created_at DESC`,
    [req.user.id],
  );
  res.json({ trackers: rows });
}

export async function createTracker(req, res) {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const eventDate = req.body?.eventDate || null;
  const notes = req.body?.notes ? String(req.body.notes) : null;
  const { rows } = await query(
    'INSERT INTO trackers (user_id, name, event_date, notes) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, name, eventDate, notes],
  );
  res.json({ tracker: rows[0] });
}

export async function getTracker(req, res) {
  const tracker = await ownTracker(req.user.id, req.params.id);
  if (!tracker) return res.status(404).json({ error: 'Tracker not found.' });
  const { rows: opponents } = await query(
    `SELECT o.*, COUNT(g.id)::int AS game_count
     FROM opponents o LEFT JOIN games g ON g.opponent_id = o.id
     WHERE o.tracker_id = $1
     GROUP BY o.id ORDER BY o.created_at ASC`,
    [tracker.id],
  );
  res.json({ tracker, opponents });
}

export async function deleteTracker(req, res) {
  const tracker = await ownTracker(req.user.id, req.params.id);
  if (!tracker) return res.status(404).json({ error: 'Tracker not found.' });
  await query('DELETE FROM trackers WHERE id = $1', [tracker.id]);
  res.json({ ok: true });
}

// --- Opponents ---
export async function addOpponent(req, res) {
  const tracker = await ownTracker(req.user.id, req.params.id);
  if (!tracker) return res.status(404).json({ error: 'Tracker not found.' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Opponent name is required.' });
  const { chesscom, lichess, fideId, cfcId, notes } = req.body || {};
  const { rows } = await query(
    `INSERT INTO opponents (tracker_id, name, chesscom, lichess, fide_id, cfc_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tracker.id, name, clean(chesscom), clean(lichess), clean(fideId), clean(cfcId), notes ? String(notes) : null],
  );
  res.json({ opponent: rows[0] });
}

export async function deleteOpponent(req, res) {
  const opp = await ownOpponent(req.user.id, req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opponent not found.' });
  await query('DELETE FROM opponents WHERE id = $1', [opp.id]);
  res.json({ ok: true });
}

// Import an opponent's online games (Chess.com / Lichess) into the database.
export async function importOpponentGames(req, res) {
  const opp = await ownOpponent(req.user.id, req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opponent not found.' });

  const sources = [];
  if (opp.chesscom) sources.push(['chesscom', opp.chesscom]);
  if (opp.lichess) sources.push(['lichess', opp.lichess]);
  if (!sources.length) {
    return res.status(400).json({ error: 'Add a Chess.com or Lichess username first.' });
  }

  let imported = 0;
  const errors = [];
  for (const [platform, username] of sources) {
    try {
      const games = await collectGames(platform, username, 300);
      for (const g of games) {
        if (!g.pgn) continue;
        const r = await query(
          `INSERT INTO games (opponent_id, source, ext_id, pgn, white, black, result, opp_color, opp_result, opening, time_class, played_at, url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (opponent_id, source, ext_id) WHERE ext_id IS NOT NULL DO NOTHING`,
          [
            opp.id, platform, g.extId || null, g.pgn, g.white || null, g.black || null,
            resultString(g.color, g.result), g.color, g.result, g.opening || null,
            g.timeClass || null, g.endTime ? new Date(g.endTime * 1000) : null, g.url || null,
          ],
        );
        imported += r.rowCount;
      }
    } catch (err) {
      errors.push(`${platform}: ${err.message}`);
    }
  }
  res.json({ imported, errors });
}

// Upload one or more games as raw PGN text.
export async function uploadOpponentGames(req, res) {
  const opp = await ownOpponent(req.user.id, req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opponent not found.' });
  const pgnText = String(req.body?.pgn || '').trim();
  if (!pgnText) return res.status(400).json({ error: 'Paste some PGN.' });

  const games = splitPgnGames(pgnText);
  if (!games.length) return res.status(400).json({ error: 'No valid games found in that PGN.' });

  let imported = 0;
  for (const pgn of games) {
    const meta = parseGameMeta(pgn, opp.name);
    await query(
      `INSERT INTO games (opponent_id, source, pgn, white, black, result, opp_color, opp_result, opening, time_class, played_at)
       VALUES ($1,'upload',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        opp.id, pgn, meta.white, meta.black, meta.result, meta.oppColor, meta.oppResult,
        meta.opening, null, meta.date,
      ],
    );
    imported += 1;
  }
  res.json({ imported });
}

// --- Games: list an opponent's stored games, and fetch one for board review ---
export async function listOpponentGames(req, res) {
  const opp = await ownOpponent(req.user.id, req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opponent not found.' });
  const { rows } = await query(
    `SELECT id, white, black, result, opp_color, opp_result, opening, time_class,
            played_at, url, source
     FROM games WHERE opponent_id = $1
     ORDER BY played_at DESC NULLS LAST, id DESC`,
    [opp.id],
  );
  res.json({
    opponent: { id: opp.id, name: opp.name, tracker_id: opp.tracker_id },
    games: rows,
  });
}

export async function getGame(req, res) {
  const game = await ownGame(req.user.id, req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found.' });
  res.json({ game });
}

// --- Prep report / playstyle summary ---
export async function opponentReport(req, res) {
  const opp = await ownOpponent(req.user.id, req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opponent not found.' });
  const { rows: games } = await query('SELECT * FROM games WHERE opponent_id = $1', [opp.id]);

  const totals = { win: 0, draw: 0, loss: 0 };
  const white = new Map();
  const black = new Map();
  const timeClasses = {};
  let plySum = 0;
  let plyCount = 0;

  for (const g of games) {
    if (g.opp_result && totals[g.opp_result] != null) totals[g.opp_result] += 1;
    if (g.time_class) timeClasses[g.time_class] = (timeClasses[g.time_class] || 0) + 1;
    const bucket = g.opp_color === 'black' ? black : white;
    const key = g.opening || 'Unknown';
    if (!bucket.has(key)) bucket.set(key, { name: key, count: 0, win: 0, draw: 0, loss: 0 });
    const rec = bucket.get(key);
    rec.count += 1;
    if (g.opp_result && rec[g.opp_result] != null) rec[g.opp_result] += 1;
    const plies = countPlies(g.pgn);
    if (plies) {
      plySum += plies;
      plyCount += 1;
    }
  }

  const total = games.length;
  const drawRate = total ? totals.draw / total : 0;
  const avgPlies = plyCount ? Math.round(plySum / plyCount) : null;
  const top = (m) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  const openingsWhite = top(white);
  const openingsBlack = top(black);

  res.json({
    opponent: {
      id: opp.id, name: opp.name, chesscom: opp.chesscom, lichess: opp.lichess,
      fide_id: opp.fide_id, cfc_id: opp.cfc_id, notes: opp.notes,
    },
    gameCount: total,
    totals,
    timeClasses,
    drawRate: Math.round(drawRate * 100),
    avgPlies,
    openingsWhite,
    openingsBlack,
    playstyle: playstyle({ drawRate, avgPlies, totals, total }),
    prep: prepPoints({ openingsWhite, openingsBlack, drawRate, avgPlies }),
  });
}

// --- Heuristic playstyle + prep ---
function playstyle({ drawRate, avgPlies, totals, total }) {
  const tags = [];
  if (!total) return { tags: ['No games yet'], summary: 'Import or upload games to build a profile.' };
  if (drawRate < 0.18) tags.push('Decisive');
  if (drawRate > 0.35) tags.push('Solid / draws often');
  if (avgPlies != null && avgPlies < 60) tags.push('Sharp, short games');
  if (avgPlies != null && avgPlies > 90) tags.push('Grinds long endgames');
  const winRate = total ? totals.win / total : 0;
  if (winRate > 0.55) tags.push('In good form');
  if (!tags.length) tags.push('Balanced');

  const parts = [];
  parts.push(
    drawRate < 0.18
      ? 'Plays for a result — few draws, so expect fighting chess.'
      : drawRate > 0.35
        ? 'Comfortable in quiet, balanced positions and happy to draw.'
        : 'A balanced competitor across sharp and quiet positions.',
  );
  if (avgPlies != null) {
    parts.push(
      avgPlies < 60
        ? `Games are short (~${Math.round(avgPlies / 2)} moves) — decisions come early.`
        : avgPlies > 90
          ? `Games run long (~${Math.round(avgPlies / 2)} moves) — prepared to grind endgames.`
          : `Games are typical length (~${Math.round(avgPlies / 2)} moves).`,
    );
  }
  return { tags, summary: parts.join(' ') };
}

function prepPoints({ openingsWhite, openingsBlack, drawRate }) {
  const points = [];
  if (openingsWhite[0]) {
    points.push(`As White they mostly play the ${openingsWhite[0].name} — have a prepared answer as Black.`);
  }
  if (openingsBlack[0]) {
    points.push(`As Black they favour the ${openingsBlack[0].name} — prepare your White repertoire against it.`);
  }
  const worst = [...openingsWhite, ...openingsBlack]
    .filter((o) => o.count >= 3)
    .map((o) => ({ ...o, score: (o.win + o.draw * 0.5) / o.count }))
    .sort((a, b) => a.score - b.score)[0];
  if (worst) {
    points.push(`They score worst in the ${worst.name} (${Math.round(worst.score * 100)}%) — a line to steer toward.`);
  }
  points.push(
    drawRate < 0.18
      ? 'They avoid draws — a solid, low-risk setup can frustrate them.'
      : 'They draw readily — you may need to create imbalances to win.',
  );
  return points;
}

// --- helpers ---
function clean(v) {
  const s = v == null ? '' : String(v).trim();
  return s || null;
}
function resultString(color, oppResult) {
  if (oppResult === 'draw') return '1/2-1/2';
  const whiteWon = (color === 'white') === (oppResult === 'win');
  return whiteWon ? '1-0' : '0-1';
}
function countPlies(pgn) {
  if (!pgn) return 0;
  const body = pgn.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '');
  const tokens = body
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.length;
}
function splitPgnGames(text) {
  // Split a multi-game PGN at each new [Event ...] header block.
  const parts = text.split(/\n\s*\n(?=\[Event )/);
  return parts.map((p) => p.trim()).filter((p) => /\[.*\]/.test(p) || /\d\./.test(p));
}
function tag(pgn, name) {
  const m = pgn.match(new RegExp(`\\[${name} "([^"]*)"\\]`));
  return m ? m[1] : null;
}
function parseGameMeta(pgn, opponentName) {
  const white = tag(pgn, 'White');
  const black = tag(pgn, 'Black');
  const result = tag(pgn, 'Result') || '*';
  const date = tag(pgn, 'Date');
  const lname = opponentName.toLowerCase();
  const isWhite = white && white.toLowerCase().includes(lname.split(' ').pop());
  const oppColor = isWhite ? 'white' : black ? 'black' : null;
  let oppResult = null;
  if (result === '1/2-1/2') oppResult = 'draw';
  else if (result === '1-0') oppResult = oppColor === 'white' ? 'win' : 'loss';
  else if (result === '0-1') oppResult = oppColor === 'black' ? 'win' : 'loss';
  let playedAt = null;
  if (date && /^\d{4}\.\d{2}\.\d{2}$/.test(date)) playedAt = new Date(date.replace(/\./g, '-'));
  return { white, black, result, oppColor, oppResult, opening: openingName(pgn), date: playedAt };
}
