import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';

const scryptAsync = promisify(scrypt);

const SESSION_DAYS = 30;
const COOKIE = 'gambit_session';

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
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Auth error' });
  }
}

// --- Route handlers ---
export async function register(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
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
    if (err.code === '23505') return res.status(409).json({ error: 'That email is already registered.' });
    res.status(500).json({ error: 'Could not register.' });
  }
}

export async function login(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  try {
    const { rows } = await query('SELECT id, email, pw_hash, pw_salt FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.pw_salt, user.pw_hash))) {
      return res.status(401).json({ error: 'Wrong email or password.' });
    }
    const { token, expires } = await createSession(user.id);
    setSessionCookie(res, token, expires);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Could not sign in.' });
  }
}

export async function logout(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) {
    try {
      await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    } catch {
      /* ignore */
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
}

export async function me(req, res) {
  try {
    const user = await getSessionUser(req);
    res.json({ user: user || null });
  } catch {
    res.json({ user: null });
  }
}
