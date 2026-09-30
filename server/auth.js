import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { query, isDbUnavailable } from './db.js';

const scryptAsync = promisify(scrypt);

const SESSION_DAYS = 30;
const COOKIE = 'gambit_session';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const DB_DOWN_MESSAGE =
  "Accounts are temporarily unavailable — the database can't be reached. Try again later.";

// Error bodies are `{ error, code }`: `error` is shown to the user as-is, `code`
// lets the client attach it to the right field.
function fail(res, status, code, error) {
  return res.status(status).json({ error, code });
}

// Log the real cause, then answer 503 if the database is unreachable or a
// generic 500 otherwise.
export function sendDbError(res, err, context, fallback = 'Server error') {
  console.error(`[${context}]`, err);
  if (isDbUnavailable(err)) return fail(res, 503, 'db_unavailable', DB_DOWN_MESSAGE);
  return fail(res, 500, 'server_error', fallback);
}

// --- Password hashing (scrypt, no native dependency) ---
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return { salt, hash: derived.toString('hex') };
}

async function verifyPassword(password, salt, hash) {
  const derived = await scryptAsync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

// --- Sessions ---
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expires],
  );
  return { token, expires };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token, expires) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${expires.toUTCString()}${secure}`,
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// Look up the user for the request's session cookie, or null.
export async function getSessionUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.id, u.email FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

// Express middleware: attaches req.user or 401s.
export async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return fail(res, 401, 'not_signed_in', 'Not signed in');
    req.user = user;
    next();
  } catch (err) {
    sendDbError(res, err, 'auth', 'Auth error');
  }
}

// --- Route handlers ---
export async function register(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'invalid_email', 'Enter a valid email address.');
  if (password.length < 8) {
    return fail(res, 400, 'weak_password', 'Password must be at least 8 characters.');
  }
  try {
    const { salt, hash } = await hashPassword(password);
    const { rows } = await query(
      'INSERT INTO users (email, pw_hash, pw_salt) VALUES ($1, $2, $3) RETURNING id, email',
      [email, hash, salt],
    );
    const user = rows[0];
    const { token, expires } = await createSession(user.id);
    setSessionCookie(res, token, expires);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    if (err.code === '23505') {
      return fail(res, 409, 'email_taken', 'An account with that email already exists.');
    }
    sendDbError(res, err, 'register', 'Could not create the account.');
  }
}

export async function login(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'invalid_email', 'Enter a valid email address.');
  if (!password) return fail(res, 400, 'missing_password', 'Enter your password.');
  try {
    const { rows } = await query('SELECT id, email, pw_hash, pw_salt FROM users WHERE email = $1', [email]);
    const user = rows[0];
    // Saying which part was wrong is a deliberate product choice: the account
    // enumeration tradeoff is accepted in exchange for clearer feedback.
    if (!user) return fail(res, 401, 'no_account', 'No account found for that email.');
    if (!(await verifyPassword(password, user.pw_salt, user.pw_hash))) {
      return fail(res, 401, 'wrong_password', 'Incorrect password.');
    }
    const { token, expires } = await createSession(user.id);
    setSessionCookie(res, token, expires);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    sendDbError(res, err, 'login', 'Could not sign in.');
  }
}

// Always clears the cookie and succeeds, even when the session row can't be
// deleted (database down) — the browser is signed out either way. The delete
// gets a short head start rather than the pool's full connect timeout.
export async function logout(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    // (query() throws synchronously when no DB is configured, hence the .then.)
    const del = Promise.resolve()
      .then(() => query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]))
      .catch((err) => console.error('[logout] could not delete session:', err.message));
    await Promise.race([del, new Promise((r) => setTimeout(r, 3000))]);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
}

export async function me(req, res) {
  try {
    const user = await getSessionUser(req);
    res.json({ user: user || null });
  } catch (err) {
    // Treat as signed out rather than failing every page load.
    console.error('[me]', err.message);
    res.json({ user: null });
  }
}
