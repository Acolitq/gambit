import pg from 'pg';

// Single connection pool for the whole server. DATABASE_URL is a standard
// Postgres connection string; SSL is enabled for hosted providers (Neon, Render,
// Supabase) and disabled for a plain local Postgres.
const connectionString = process.env.DATABASE_URL;

const useSsl = connectionString && !/localhost|127\.0\.0\.1/.test(connectionString);

export const pool = connectionString
  ? new pg.Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      max: 5,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    })
  : null;

// A pool error (e.g. a dropped pooler connection) shouldn't crash the process.
if (pool) pool.on('error', (err) => console.error('PG pool error:', err.message));

export function hasDb() {
  return !!pool;
}

export function query(text, params) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query(text, params);
}

// True when an error means the database itself can't be reached (DNS failure,
// refused/reset connection, timeout, server shutting down, or a hosted pooler
// rejecting us, e.g. Supabase's "tenant/user not found" XX000), as opposed to a
// query-level error like a constraint violation.
const NET_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
]);
export function isDbUnavailable(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  if (NET_CODES.has(code)) return true;
  // SQLSTATE 08xxx = connection exception; 57P0x = admin/crash shutdown or
  // cannot connect now; 53300 = too many connections; 28xxx = the server
  // rejected our credentials (misconfigured or deleted project).
  if (/^(08|57P0|53300|28)/.test(code)) return true;
  if (code === 'XX000' && /tenant|user not found/i.test(msg)) return true;
  // pg-pool's own failures carry no SQLSTATE, only a message
  // ("timeout exceeded when trying to connect", "Connection terminated ...").
  const hasSqlState = /^[0-9A-Z]{5}$/.test(code);
  return !hasSqlState && /timeout|terminated|connect|not configured/i.test(msg);
}

// Create tables on first boot. Idempotent — safe to run every start.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  pw_hash     TEXT NOT NULL,
  pw_salt     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trackers (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  event_date  DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opponents (
  id            SERIAL PRIMARY KEY,
  tracker_id    INTEGER NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  chesscom      TEXT,
  lichess       TEXT,
  fide_id       TEXT,
  cfc_id        TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id           SERIAL PRIMARY KEY,
  opponent_id  INTEGER NOT NULL REFERENCES opponents(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,
  ext_id       TEXT,
  pgn          TEXT NOT NULL,
  white        TEXT,
  black        TEXT,
  result       TEXT,
  opp_color    TEXT,
  opp_result   TEXT,
  eco          TEXT,
  opening      TEXT,
  time_class   TEXT,
  played_at    TIMESTAMPTZ,
  url          TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Timestamped notes per opponent (replaces the single opponents.notes field).
CREATE TABLE IF NOT EXISTS opponent_notes (
  id           SERIAL PRIMARY KEY,
  opponent_id  INTEGER NOT NULL REFERENCES opponents(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest known OTB rating, and when online games were last pulled.
ALTER TABLE opponents ADD COLUMN IF NOT EXISTS rating INTEGER;
ALTER TABLE opponents ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

-- Move any legacy free-text notes into the notes table (a no-op once done).
INSERT INTO opponent_notes (opponent_id, body, created_at, updated_at)
  SELECT id, notes, created_at, created_at FROM opponents WHERE notes IS NOT NULL AND btrim(notes) <> '';
UPDATE opponents SET notes = NULL WHERE notes IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trackers_user ON trackers(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_opponent ON opponent_notes(opponent_id);
CREATE INDEX IF NOT EXISTS idx_opponents_tracker ON opponents(tracker_id);
CREATE INDEX IF NOT EXISTS idx_games_opponent ON games(opponent_id);
-- Avoid importing the same online game twice for an opponent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_games_ext
  ON games(opponent_id, source, ext_id) WHERE ext_id IS NOT NULL;
`;

export async function initDb() {
  if (!pool) {
    console.warn('DATABASE_URL not set — accounts and trackers are disabled.');
    return false;
  }
  await pool.query(SCHEMA);
  console.log('Database schema ready.');
  return true;
}
