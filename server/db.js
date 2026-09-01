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
    })
  : null;

export function hasDb() {
  return !!pool;
}

export function query(text, params) {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool.query(text, params);
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

CREATE INDEX IF NOT EXISTS idx_trackers_user ON trackers(user_id);
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
