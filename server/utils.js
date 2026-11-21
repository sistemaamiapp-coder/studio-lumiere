export function toISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function addDays(iso, days) {
  const date = fromISO(iso);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

export function diffDays(fromIso, toIso) {
  const a = fromISO(fromIso);
  const b = fromISO(toIso);
  return Math.round((b - a) / 86400000);
}

export function weekday(iso) {
  return fromISO(iso).getDay();
}

export function toMinutes(time) {
  const [h, m] = String(time || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
}

export function toTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''));
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

export function formatDateBR(iso, options = { day: '2-digit', month: '2-digit' }) {
  return new Intl.DateTimeFormat('pt-BR', options).format(fromISO(iso));
}

export function normalizePhone(input) {
  let value = digits(input);
  if (value.length > 11 && value.startsWith('55')) value = value.slice(2);
  return value;
}

export function phoneDisplay(input) {
  const value = normalizePhone(input);
  if (value.length === 11) return `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
  if (value.length === 10) return `(${value.slice(0, 2)}) ${value.slice(2, 6)}-${value.slice(6)}`;
  return String(input || '');
}

export function normalizeTime(input) {
  const match = String(input || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  return toISO(fromISO(value)) === value;
}
