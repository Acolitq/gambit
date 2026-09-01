// Opponent scouting: given a Chess.com or Lichess username, pull their recent
// games from the platform's public API and build a "prep dossier" — most-played
// openings as White and Black with win/draw/loss splits, time-control mix, and a
// list of recent games the client can open in the analysis board.
//
// We proxy through the server (rather than calling from the browser) so we can
// cache results, present both platforms uniformly, and keep within the APIs'
// per-IP rate limits.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UA = 'Gambit/1.0 (portfolio chess study app; contact via github.com/Acolitq)';
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // key -> { at, data }

// Canonical opening names, matched by move sequence rather than by scraping the
// platform's URL slug (which mangles into fragments). Built once from the same
// lichess openings dataset the client uses.
const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENINGS = (() => {
  try {
    const raw = readFileSync(join(__dirname, '..', 'public', 'data', 'openings.json'), 'utf8');
    const map = new Map();
    for (const o of JSON.parse(raw)) map.set(o.san.join(' '), o.name);
    return map;
  } catch {
    return new Map();
  }
})();

// Pull the SAN move tokens out of a PGN movetext (comments, clocks, move numbers
// and NAGs stripped), then return the name of the deepest opening line that is a
// prefix of the game — the standard way to classify an opening.
export function openingName(pgn) {
  if (!pgn || !OPENINGS.size) return ecoHeader(pgn);
  const movetext = pgn.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '');
  const tokens = movetext
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let best = null;
  // Openings rarely run past ~15 plies; cap the search there.
  for (let n = Math.min(tokens.length, 16); n >= 1; n--) {
    const key = tokens.slice(0, n).join(' ');
    if (OPENINGS.has(key)) {
      best = OPENINGS.get(key);
      break;
    }
  }
  return best || ecoHeader(pgn);
}

const MAX_MONTHS = 3; // how many recent Chess.com monthly archives to pull
const MAX_GAMES = 400; // hard cap so a heavy account can't stall the server

export async function scout(platform, username) {
  const key = `${platform}:${username.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const data =
    platform === 'lichess'
      ? await scoutLichess(username)
      : await scoutChessCom(username);

  cache.set(key, { at: Date.now(), data });
  return data;
}

// Collect an online player's recent games as normalized rows. Shared by the
// scouting dossier and the tracker's game import.
export async function collectGames(platform, username, max = MAX_GAMES) {
  return platform === 'lichess'
    ? collectLichessGames(username, max)
    : collectChessComGames(username, max);
}

async function collectChessComGames(username, max = MAX_GAMES) {
  const u = username.toLowerCase();
  const arch = await getJson(`https://api.chess.com/pub/player/${u}/games/archives`);
  const months = (arch.archives || []).slice(-MAX_MONTHS).reverse();

  const games = [];
  for (const url of months) {
    if (games.length >= max) break;
    const monthly = await getJson(url);
    for (const g of monthly.games || []) {
      if (g.rules && g.rules !== 'chess') continue; // skip variants
      const white = g.white?.username?.toLowerCase();
      const color = white === u ? 'white' : 'black';
      const me = color === 'white' ? g.white : g.black;
      games.push({
        color,
        result: normalizeChessComResult(me?.result),
        opening: openingName(g.pgn),
        timeClass: g.time_class || 'unknown',
        url: g.url,
        extId: g.url,
        pgn: g.pgn,
        endTime: g.end_time,
        white: g.white?.username,
        black: g.black?.username,
        opponent: color === 'white' ? g.black?.username : g.white?.username,
        opponentRating: color === 'white' ? g.black?.rating : g.white?.rating,
      });
      if (games.length >= max) break;
    }
  }
  return games;
}

// --- Chess.com ---
async function scoutChessCom(username) {
  const u = username.toLowerCase();
  const profile = await getJson(`https://api.chess.com/pub/player/${u}`);
  if (!profile || profile.code) throw new Error('Player not found on Chess.com');
  const games = await collectChessComGames(u);
  return buildDossier({
    platform: 'chesscom',
    username: profile.username || username,
    title: profile.title || null,
    avatar: profile.avatar || null,
    url: profile.url,
    games,
  });
}

// Chess.com per-player result codes → win / draw / loss.
function normalizeChessComResult(code) {
  if (code === 'win') return 'win';
  const draws = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
  if (draws.includes(code)) return 'draw';
  return 'loss';
}

async function collectLichessGames(username, max = MAX_GAMES) {
  const url =
    `https://lichess.org/api/games/user/${encodeURIComponent(username)}` +
    `?max=${max}&opening=true&pgnInJson=true&clocks=false&evals=false`;
  const res = await fetch(url, { headers: { Accept: 'application/x-ndjson', 'User-Agent': UA } });
  if (res.status === 404) throw new Error('Player not found on Lichess');
  if (!res.ok) throw new Error(`Lichess API error (${res.status})`);
  const text = await res.text();

  const games = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let g;
    try {
      g = JSON.parse(line);
    } catch {
      continue;
    }
    const whiteName = g.players?.white?.user?.name?.toLowerCase();
    const color = whiteName === username.toLowerCase() ? 'white' : 'black';
    let result;
    if (!g.winner) result = 'draw';
    else result = g.winner === color ? 'win' : 'loss';
    games.push({
      color,
      result,
      opening: g.opening?.name || openingName(g.pgn),
      timeClass: g.speed || 'unknown',
      url: g.id ? `https://lichess.org/${g.id}` : null,
      extId: g.id || null,
      pgn: g.pgn || null,
      endTime: g.lastMoveAt ? Math.floor(g.lastMoveAt / 1000) : null,
      white: g.players?.white?.user?.name,
      black: g.players?.black?.user?.name,
      opponent:
        color === 'white' ? g.players?.black?.user?.name : g.players?.white?.user?.name,
      opponentRating:
        color === 'white' ? g.players?.black?.rating : g.players?.white?.rating,
    });
  }
  return games;
}

// --- Lichess ---
async function scoutLichess(username) {
  const games = await collectLichessGames(username);
  return buildDossier({
    platform: 'lichess',
    username,
    title: null,
    avatar: null,
    url: `https://lichess.org/@/${username}`,
    games,
  });
}

// --- Shared aggregation ---
function buildDossier({ platform, username, title, avatar, url, games }) {
  const openings = { white: new Map(), black: new Map() };
  const timeClasses = {};
  const totals = { win: 0, draw: 0, loss: 0 };

  for (const g of games) {
    const bucket = openings[g.color];
    const name = g.opening || 'Unknown';
    if (!bucket.has(name)) bucket.set(name, { name, count: 0, win: 0, draw: 0, loss: 0 });
    const rec = bucket.get(name);
    rec.count += 1;
    rec[g.result] += 1;
    totals[g.result] += 1;
    timeClasses[g.timeClass] = (timeClasses[g.timeClass] || 0) + 1;
  }

  const topOpenings = (map) =>
    [...map.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  return {
    platform,
    username,
    title,
    avatar,
    url,
    totalGames: games.length,
    totals,
    timeClasses,
    openings: {
      white: topOpenings(openings.white),
      black: topOpenings(openings.black),
    },
    recentGames: games.slice(0, 12).map((g) => ({
      color: g.color,
      result: g.result,
      opening: g.opening,
      timeClass: g.timeClass,
      opponent: g.opponent,
      opponentRating: g.opponentRating,
      url: g.url,
      pgn: g.pgn,
    })),
  };
}

// --- helpers ---
async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Chess.com API error (${res.status})`);
  return res.json();
}

function ecoHeader(pgn) {
  if (!pgn) return 'Unknown';
  const m = pgn.match(/\[ECO "([^"]+)"\]/);
  return m ? m[1] : 'Unknown';
}
