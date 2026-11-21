import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    const derived = scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === derived.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function friendlyPassword(length = 8) {
  const bytes = randomBytes(length);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}
