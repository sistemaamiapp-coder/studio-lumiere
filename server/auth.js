import { db } from './db.js';
import { randomToken } from './hash.js';

export const COOKIE_NAME = 'lum_session';
const SESSION_DAYS = 30;

export function parseCookies(header = '') {
  return String(header).split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index > 0) {
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) acc[key] = decodeURIComponent(value);
    }
    return acc;
  }, {});
}

export function createSession(userId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, new Date().toISOString(), expires);
  return token;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.birthdate, u.role, u.notes, u.created_at, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    destroySession(token);
    return null;
  }
  const { expires_at, ...user } = row;
  return user;
}

export function userFromRequest(req) {
  return userFromToken(parseCookies(req.headers.cookie || '')[COOKIE_NAME]);
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function attachUser(req, _res, next) {
  req.user = userFromRequest(req);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao estúdio.' });
  next();
}
