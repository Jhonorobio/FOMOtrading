/**
 * Personal access control.
 * No Google OAuth. A single access code ("FOMO" or "fomo") unlocks the one
 * personal paper-trading account. Kept intentionally simple for a solo project.
 */
import jwt from 'jsonwebtoken';
import { run, get } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'cambia_esta_clave_secreta_por_algo_largo_y_aleatorio') {
  console.warn('[auth] WARNING: using default JWT_SECRET. Set a strong random value in .env for production.');
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACCESS_CODES = new Set(['FOMO', 'fomo']);
const PERSONAL_USER_ID = 'personal-0000-0000-0000-000000000001';
const PERSONAL_EMAIL = 'personal@paper.local';
const PERSONAL_NAME = 'Paper Trader';

export function signSession(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
}

export function verifySession(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function createSession(userId) {
  const token = signSession(userId);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  run('INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, expiresAt]);
  return { token, expiresAt };
}

export function getSessionUser(token) {
  let payload;
  try {
    payload = verifySession(token);
  } catch {
    throw new Error('INVALID_SESSION');
  }
  const row = get(
    'SELECT s.token, u.id, u.email, u.name, u.photo_url, u.created_at ' +
    'FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?',
    [token, Date.now()]
  );
  if (!row) throw new Error('SESSION_REVOKED');
  return {
    user: {
      id: row.id,
      email: row.email,
      displayName: row.name || row.email,
      photoUrl: row.photo_url || null,
    },
  };
}

export function deleteSession(token) {
  run('DELETE FROM sessions WHERE token = ?', [token]);
}

/** Validate the personal access code. */
export function verifyAccessCode(code) {
  if (!code || !ACCESS_CODES.has(String(code).trim())) {
    throw new Error('INVALID_CODE');
  }
  return {
    id: PERSONAL_USER_ID,
    email: PERSONAL_EMAIL,
    name: PERSONAL_NAME,
    photoUrl: null,
  };
}

/** Make sure the personal user row exists. */
export function ensurePersonalUser() {
  const existing = get('SELECT id FROM users WHERE id = ?', [PERSONAL_USER_ID]);
  if (!existing) {
    const now = Date.now();
    run(
      'INSERT INTO users (id, email, name, photo_url, created_at) VALUES (?, ?, ?, ?, ?)',
      [PERSONAL_USER_ID, PERSONAL_EMAIL, PERSONAL_NAME, null, now]
    );
  }
  return { id: PERSONAL_USER_ID, email: PERSONAL_EMAIL, name: PERSONAL_NAME, photoUrl: null };
}
