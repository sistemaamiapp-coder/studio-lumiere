// Studio Paula Souza — API para a função edge do Qoder Sites.
// A mesma lógica de negócio do servidor Express local, adaptada ao banco
// gerenciado da plataforma (UUID, valores em centavos, sessões por cookie).
import { verifyUploadedObject } from './storage-validation.mjs';

const BUSINESS = {
  name: 'Studio Paula Souza',
  shortName: 'Paula Souza',
  tagline: 'Lash & Nails Studio',
  eyebrow: 'Lash · Gel · Manicure & Pedicure',
  whatsapp: '5527999990000',
  instagram: 'studiodapaulasouza',
  email: 'contato@paulasouza.com.br',
  pixKey: 'contato@paulasouza.com.br',
  pixName: 'STUDIO PAULA SOUZA',
  pixCity: 'VILA VELHA',
  depositPercent: 30,
  cancelHours: 6,
  slotMinutes: 30,
  minLeadMinutes: 90,
  address: 'Atendimento exclusivo com hora marcada · Vila Velha, ES',
  hours: {
    0: null,
    1: ['09:00', '19:00'],
    2: ['09:00', '19:00'],
    3: ['09:00', '19:00'],
    4: ['09:00', '19:00'],
    5: ['09:00', '19:00'],
    6: ['09:00', '17:00']
  }
};

const ADMIN = { name: 'Studio Paula Souza', email: 'studio@paulasouza.com.br', phone: '27999990000' };
const DEMO_CLIENT = { email: 'cliente@demo.com' };
const CATEGORIES = {
  cilios: { label: 'Cílios', singular: 'cílios' },
  unhas: { label: 'Unhas', singular: 'unhas' },
  manicure: { label: 'Manicure', singular: 'manicure' },
  pedicure: { label: 'Pedicure', singular: 'pedicure' }
};
const STATUS = ['pendente', 'confirmado', 'concluido', 'cancelado', 'faltou'];
const STATUS_LABEL = {
  pendente: 'aguardando confirmação',
  confirmado: 'confirmado',
  concluido: 'concluído',
  cancelado: 'cancelado',
  faltou: 'não compareceu'
};
const COOKIE_NAME = 'lum_session';
const SESSION_DAYS = 30;
const TZ = 'America/Sao_Paulo';
const API_PUBLIC = '/functions/v1/app';

const COLS = {
  users: 'id,name,email,phone,password_hash,birthdate,role,notes,created_at',
  services: 'id,name,category,description,price_cents,duration_min,maintenance_days,active,sort',
  appointments: 'id,client_id,service_id,date,time,duration_min,price_cents,status,notes,deposit_cents,deposit_status,payment_method,source,created_at,updated_at',
  finance: 'id,kind,amount_cents,method,category,description,date,appointment_id,created_at',
  portfolio: 'id,title,description,category,image,sort,created_at',
  notifications: 'id,type,title,message,client_id,appointment_id,created_at',
  sessions: 'token,user_id,created_at,expires_at',
  meta: 'key,value'
};

/* ---------------- datas e utilitários ---------------- */
const pad = n => String(n).padStart(2, '0');

export function todayISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function partsISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return { y, m, d };
}

function dateUTC(iso) {
  const { y, m, d } = partsISO(iso);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
}

function isoFromUTC(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDays(iso, days) {
  const date = dateUTC(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromUTC(date);
}

function diffDays(fromIso, toIso) {
  return Math.round((dateUTC(toIso) - dateUTC(fromIso)) / 86400000);
}

function weekday(iso) {
  return dateUTC(iso).getUTCDay();
}

function nowMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const hour = Number(parts.find(p => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function toMinutes(time) {
  const [h, m] = String(time || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
}

function toTime(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''));
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function toCents(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100);
}

function fromCents(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

function formatDateBR(iso, options = { day: '2-digit', month: '2-digit' }) {
  return new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' }).format(dateUTC(iso));
}

function normalizePhone(input) {
  let value = digits(input);
  if (value.length > 11 && value.startsWith('55')) value = value.slice(2);
  return value;
}

function phoneDisplay(input) {
  const value = normalizePhone(input);
  if (value.length === 11) return `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
  if (value.length === 10) return `(${value.slice(0, 2)}) ${value.slice(2, 6)}-${value.slice(6)}`;
  return String(input || '');
}

function normalizeTime(input) {
  const match = String(input || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const { y, m, d } = partsISO(value);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return isoFromUTC(date) === value;
}

function instagramHandle(input) {
  let value = clean(input, 120).trim();
  if (!value) return '';
  value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '');
  return value.split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g, '');
}

function uuid() {
  return crypto.randomUUID();
}

function randomToken(bytes = 32) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function friendlyPassword(length = 8) {
  const buf = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(buf, b => ALPHABET[b % ALPHABET.length]).join('');
}

/* ---------------- senhas (PBKDF2 / WebCrypto) ---------------- */
const PBKDF2_ITERATIONS = 120000;
const textEncoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, iterations, salt, hash] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2' || !salt || !hash) return false;
    const derived = await derive(password, fromHex(salt), Number(iterations) || PBKDF2_ITERATIONS);
    const expected = fromHex(hash);
    if (derived.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < derived.length; i += 1) diff |= derived[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

/* ---------------- Pix (sem QR: o navegador desenha) ---------------- */
function emv(id, value) {
  const text = String(value);
  return `${id}${String(text.length).padStart(2, '0')}${text}`;
}

function deaccent(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .trim();
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function pixPayload({ amount, txid }) {
  const value = round2(amount || 0);
  const merchant = emv('00', 'BR.GOV.BCB.PIX') + emv('01', String(BUSINESS.pixKey));
  let payload = emv('00', '01');
  payload += emv('26', merchant);
  payload += emv('52', '0000');
  payload += emv('53', '986');
  if (value > 0) payload += emv('54', value.toFixed(2));
  payload += emv('58', 'BR');
  payload += emv('59', deaccent(BUSINESS.pixName).slice(0, 25));
  payload += emv('60', deaccent(BUSINESS.pixCity).slice(0, 15));
  const cleanTxid = String(txid || 'STUDIOPAULA').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || 'STUDIOPAULA';
  payload += emv('62', emv('05', cleanTxid));
  payload += '6304';
  return payload + crc16(payload);
}

/* ---------------- disponibilidade ---------------- */
function workingHours(date) {
  return BUSINESS.hours[weekday(date)] || null;
}

function fitsHours(date, time, duration) {
  const hours = workingHours(date);
  if (!hours) return false;
  const start = toMinutes(time);
  return start >= toMinutes(hours[0]) && start + duration <= toMinutes(hours[1]);
}

function slotsFor(date, service, appointments) {
  const hours = workingHours(date);
  if (!hours) return [];
  const open = toMinutes(hours[0]);
  const close = toMinutes(hours[1]);
  const step = BUSINESS.slotMinutes;
  const duration = Number(service.duration_min);
  const today = todayISO();
  const earliest = date === today ? nowMinutes() + BUSINESS.minLeadMinutes : -1;
  const slots = [];

  for (let start = open; start + duration <= close; start += step) {
    if (date === today && start < earliest) continue;
    const end = start + duration;
    const conflict = appointments.some(appt => {
      if (appt.status === 'cancelado' || appt.status === 'faltou') return false;
      const busyStart = toMinutes(appt.time);
      const busyEnd = busyStart + Number(appt.duration_min);
      return start < busyEnd && end > busyStart;
    });
    if (!conflict) slots.push(toTime(start));
  }
  return slots;
}

function hasConflict(date, time, duration, appointments, ignoreId = null) {
  const start = toMinutes(time);
  const end = start + Number(duration);
  return appointments.some(appt => {
    if (appt.status === 'cancelado' || appt.status === 'faltou') return false;
    if (ignoreId && String(appt.id) === String(ignoreId)) return false;
    const busyStart = toMinutes(appt.time);
    const busyEnd = busyStart + Number(appt.duration_min);
    return start < busyEnd && end > busyStart;
  });
}

/* ---------------- aplicação ---------------- */
export function application({ db, storage }) {
  // O index.ts recebe o contexto da plataforma; os testes locais passam a Request.
  const requestOf = ctx => ctx?.request || ctx;
  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function fail(status, message) {
    throw new ApiError(status, message);
  }

  function rows(result) {
    if (result && result.error) {
      const error = new Error('database_error');
      error.kind = 'database';
      throw error;
    }
    return result?.data ?? [];
  }

  async function selectAll(table, columns, options = {}) {
    let query = db.from(table).select(columns);
    let ordered = query;
    if (options.order) ordered = ordered.order(options.order[0], { ascending: options.order[1] });
    return rows(await ordered.limit(options.limit || 2000));
  }

  function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...extraHeaders
      }
    });
  }

  function parseCookies(header) {
    return String(header || '').split(';').reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index > 0) {
        const key = part.slice(0, index).trim();
        if (key) acc[key] = decodeURIComponent(part.slice(index + 1).trim());
      }
      return acc;
    }, {});
  }

  function cookieHeader(token, maxAge) {
    const secure = currentSecure ? '; Secure' : '';
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  let currentSecure = true;

  async function readBody(request) {
    const type = request.headers.get('content-type') || '';
    if (!type.startsWith('application/json')) fail(400, 'Formato de dados inválido.');
    const text = await request.text();
    if (text.length > 65536) fail(413, 'Dados grandes demais.');
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      fail(400, 'Formato de dados inválido.');
    }
  }

  /* ---------- sessões ---------- */
  async function createSession(userId) {
    const token = randomToken(32);
    const nowIso = new Date().toISOString();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    rows(await db.from('sessions').insert({ token, user_id: userId, created_at: nowIso, expires_at: expires }));
    return token;
  }

  async function destroySession(token) {
    if (!token) return;
    try { rows(await db.from('sessions').delete().eq('token', token)); } catch { /* sessão já ausente */ }
  }

  async function userFromToken(token) {
    if (!token) return null;
    const found = rows(await db.from('sessions').select(COLS.sessions).eq('token', token).limit(1));
    const session = found[0];
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
      await destroySession(token);
      return null;
    }
    const users = rows(await db.from('users').select(COLS.users).eq('id', session.user_id).limit(1));
    return users[0] || null;
  }

  async function currentUser(request) {
    const parsed = parseCookies(request.headers.get('cookie'));
    return userFromToken(parsed[COOKIE_NAME]);
  }

  async function requireUser(request) {
    const user = await currentUser(request);
    if (!user) fail(401, 'Faça login para continuar.');
    return user;
  }

  async function requireAdmin(request) {
    const user = await requireUser(request);
    if (user.role !== 'admin') fail(403, 'Acesso restrito ao estúdio.');
    return user;
  }

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id, name: user.name, email: user.email, phone: user.phone,
      birthdate: user.birthdate, role: user.role
    };
  }

  /* ---------- identidade da cliente (nome completo + celular) ---------- */
  function nameKey(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function isFullName(value) {
    return String(value || '').trim().split(/\s+/).filter(Boolean).length >= 2;
  }

  async function clientByPhone(phone) {
    if (!phone) return null;
    const found = rows(await db.from('users').select(COLS.users).eq('phone', phone).limit(5));
    return found.find(user => user.role === 'client') || null;
  }

  async function identifyClient(body) {
    const name = clean(body?.name, 120);
    const phone = normalizePhone(body?.phone);
    if (!isFullName(name)) fail(400, 'Informe seu nome completo.');
    if (phone.length < 10 || phone.length > 11) fail(400, 'Confira o WhatsApp com DDD.');
    const client = await clientByPhone(phone);
    if (!client || nameKey(client.name) !== nameKey(name)) {
      fail(404, 'Marcação não encontrada. Confira o nome completo e o celular informados.');
    }
    return client;
  }

  /* ---------- dados ---------- */
  const loadUsers = () => selectAll('users', COLS.users);
  const loadServices = () => selectAll('services', COLS.services);
  const loadAppointments = () => selectAll('appointments', COLS.appointments);
  const loadFinance = () => selectAll('finance', COLS.finance);
  const loadPortfolio = () => selectAll('portfolio', COLS.portfolio);

  function userMap(users) {
    return new Map(users.map(user => [String(user.id), user]));
  }

  function serviceMap(services) {
    return new Map(services.map(service => [String(service.id), service]));
  }

  function serviceView(service, bookings = null) {
    const view = {
      id: service.id,
      name: service.name,
      category: service.category,
      description: service.description || '',
      price: fromCents(service.price_cents),
      duration_min: service.duration_min,
      maintenance_days: service.maintenance_days,
      active: Boolean(service.active),
      sort: service.sort
    };
    if (bookings !== null) view.bookings = bookings;
    return view;
  }

  function appointmentView(appt, users, services) {
    const client = users.get(String(appt.client_id));
    const service = services.get(String(appt.service_id));
    return {
      id: appt.id,
      client_id: appt.client_id,
      service_id: appt.service_id,
      date: appt.date,
      time: appt.time,
      duration_min: appt.duration_min,
      price: fromCents(appt.price_cents),
      status: appt.status,
      notes: appt.notes || '',
      deposit_amount: fromCents(appt.deposit_cents),
      deposit_status: appt.deposit_status,
      payment_method: appt.payment_method,
      source: appt.source,
      created_at: appt.created_at,
      updated_at: appt.updated_at,
      client_name: client?.name || '',
      client_phone: client?.phone || '',
      client_email: client?.email || '',
      service_name: service?.name || '',
      service_category: service?.category || '',
      maintenance_days: service?.maintenance_days ?? 0
    };
  }

  function sortByDateTime(list) {
    return list.slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  async function appointmentById(id) {
    const found = rows(await db.from('appointments').select(COLS.appointments).eq('id', String(id)).limit(1));
    return found[0] || null;
  }

  async function getSettings() {
    const stored = rows(await db.from('settings').select('key,value').limit(50));
    const map = Object.fromEntries(stored.map(row => [row.key, row.value]));
    const whatsapp = map.whatsapp || BUSINESS.whatsapp;
    return {
      whatsapp,
      whatsappDisplay: phoneDisplay(whatsapp),
      email: map.email ?? BUSINESS.email,
      instagram: map.instagram ?? BUSINESS.instagram,
      address: map.address ?? BUSINESS.address
    };
  }

  async function saveSettings(values) {
    const existing = rows(await db.from('settings').select('key,value').limit(50));
    const known = new Set(existing.map(row => row.key));
    for (const [key, value] of Object.entries(values)) {
      if (known.has(key)) rows(await db.from('settings').update({ value }).eq('key', key));
      else rows(await db.from('settings').insert({ key, value }));
    }
  }

  async function notify(event) {
    try {
      rows(await db.from('notifications').insert({
        id: uuid(),
        type: String(event.type || 'event'),
        title: clean(event.title, 140) || 'Movimentação no estúdio',
        message: clean(event.message, 500),
        client_id: event.clientId ? String(event.clientId) : null,
        appointment_id: event.appointmentId ? String(event.appointmentId) : null,
        created_at: new Date().toISOString()
      }));
    } catch (error) {
      console.error('[notify] falha ao registrar notificação', error?.message || error);
    }
  }

  /* ---------- financeiro ---------- */
  async function insertFinance({ kind, amount, method, category, description, date, appointmentId = null }) {
    rows(await db.from('finance').insert({
      id: uuid(), kind, amount_cents: toCents(amount), method: method || 'pix', category,
      description, date, appointment_id: appointmentId ? String(appointmentId) : null,
      created_at: new Date().toISOString()
    }));
  }

  function financeTotal(entries, appointmentId, category = null) {
    return entries
      .filter(row => String(row.appointment_id) === String(appointmentId))
      .filter(row => category ? row.category === category : row.kind === 'entrada')
      .reduce((sum, row) => sum + fromCents(row.amount_cents), 0);
  }

  async function syncFinance(appointmentId) {
    const appt = await appointmentById(appointmentId);
    if (!appt) return;
    const [users, services, finance] = await Promise.all([loadUsers(), loadServices(), loadFinance()]);
    const view = appointmentView(appt, userMap(users), serviceMap(services));
    const entries = finance.map(row => ({ ...row, amount: fromCents(row.amount_cents) }));
    const sinal = financeTotal(entries, appt.id, 'Sinal');

    if (appt.status === 'concluido') {
      const hasServiceEntry = financeTotal(entries, appt.id, 'Atendimento') > 0;
      if (appt.deposit_status === 'pago' && !hasServiceEntry && sinal < view.deposit_amount - 0.01) {
        await insertFinance({
          kind: 'entrada', amount: view.deposit_amount - sinal, method: appt.payment_method,
          category: 'Sinal', description: `Sinal · ${view.service_name}`, date: appt.date, appointmentId: appt.id
        });
      }
      const remaining = round2(view.price - financeTotal(entries, appt.id));
      if (remaining > 0.009) {
        await insertFinance({
          kind: 'entrada', amount: remaining, method: appt.payment_method,
          category: 'Atendimento', description: `${view.service_name} · ${view.client_name}`,
          date: appt.date, appointmentId: appt.id
        });
      }
    } else if (appt.deposit_status === 'pago' && appt.status !== 'cancelado' && sinal < 0.01) {
      await insertFinance({
        kind: 'entrada', amount: view.deposit_amount, method: appt.payment_method,
        category: 'Sinal', description: `Sinal · ${view.service_name}`, date: appt.date, appointmentId: appt.id
      });
    }
  }

  /* ---------- manutenções e aniversários ---------- */
  function maintenanceList(users, services, appointments, clientId = null) {
    const scoped = clientId
      ? appointments.filter(appt => String(appt.client_id) === String(clientId))
      : appointments;
    const latest = new Map();
    scoped.forEach(appt => {
      if (appt.status !== 'concluido') return;
      const service = services.get(String(appt.service_id));
      if (!service || !(service.maintenance_days > 0)) return;
      const key = `${appt.client_id}|${appt.service_id}`;
      const current = latest.get(key);
      if (!current || appt.date > current.last_date) latest.set(key, appt);
    });
    const today = todayISO();
    return [...latest.values()].map(appt => {
      const service = services.get(String(appt.service_id));
      const client = users.get(String(appt.client_id));
      const due = addDays(appt.date, service.maintenance_days);
      return {
        client_id: appt.client_id,
        client_name: client?.name || '',
        client_phone: client?.phone || '',
        service_id: appt.service_id,
        service_name: service.name,
        category: service.category,
        price: fromCents(service.price_cents),
        duration_min: service.duration_min,
        maintenance_days: service.maintenance_days,
        last_date: appt.date,
        due,
        daysLeft: diffDays(today, due)
      };
    }).sort((a, b) => a.daysLeft - b.daysLeft);
  }

  function birthdayList(users) {
    const month = todayISO().slice(5, 7);
    return users
      .filter(user => user.role === 'client' && user.birthdate)
      .filter(user => String(user.birthdate).slice(5, 7) === month)
      .map(user => ({ id: user.id, name: user.name, phone: user.phone, birthdate: user.birthdate, day: Number(String(user.birthdate).slice(8, 10)) }))
      .sort((a, b) => a.day - b.day);
  }

  /* ---------- seed ---------- */
  let seedChecked = false;

  async function ensureSeed() {
    if (seedChecked) return;
    const found = rows(await db.from('meta').select(COLS.meta).eq('key', 'seed').limit(1));
    if (found.length) {
      seedChecked = true;
      return;
    }
    const lock = rows(await db.from('meta').insertIfAbsent({ key: 'seed', value: 'running' }, { onConflict: 'key' }).select('key'));
    if (!lock?.length) {
      seedChecked = true;
      return;
    }
    try {
      await seedData();
      rows(await db.from('meta').update({ value: 'done' }).eq('key', 'seed'));
      seedChecked = true;
      console.log('[seed] Estúdio de demonstração criado.');
    } catch (error) {
      console.error('[seed] Falha ao criar dados iniciais:', error?.message || error);
      try { rows(await db.from('meta').delete().eq('key', 'seed')); } catch { /* mantém para novo ciclo */ }
    }
  }

  async function seedData() {
    const nowIso = new Date().toISOString();
    const envPassword = String(
      (typeof Deno !== 'undefined' && Deno.env?.get?.('LUMIERE_ADMIN_PASSWORD'))
      || (typeof process !== 'undefined' && process.env?.LUMIERE_ADMIN_PASSWORD)
      || ''
    ).trim();
    const adminPassword = envPassword || friendlyPassword(12);
    console.log(envPassword
      ? `[seed] Painel criado · login: ${ADMIN.email} · senha definida em LUMIERE_ADMIN_PASSWORD`
      : `[seed] Painel criado · login: ${ADMIN.email} · senha: ${adminPassword}`);

    const adminHash = await hashPassword(adminPassword);
    const adminId = uuid();
    rows(await db.from('users').insert({
      id: adminId, name: ADMIN.name, email: ADMIN.email, phone: ADMIN.phone,
      password_hash: adminHash, birthdate: null, role: 'admin',
      notes: 'Conta principal do estúdio.', created_at: nowIso
    }));

    const demoMonth = todayISO().slice(5, 7);
    const clients = [
      ['Ana Clara Martins', DEMO_CLIENT.email, '27999990001', `1993-${demoMonth}-05`, 'Prefere efeito natural. Sensibilidade leve na fita adesiva.'],
      ['Beatriz Nunes', 'bia@demo.com', '27999990002', `1990-${demoMonth}-12`, 'Alergia a esmalte com formol.'],
      ['Camila Souza', 'camila@demo.com', '27999990003', `1996-${demoMonth}-27`, 'Sempre pede volume mais denso.'],
      ['Daniela Reis', 'daniela@demo.com', '27999990004', '1988-03-18', 'Cliente fiel desde a abertura do estúdio.'],
      ['Eduarda Lima', 'duda@demo.com', '27999990005', `1999-${demoMonth}-19`, 'Gosta de unhas nude e curtas.'],
      ['Fernanda Alves', 'fer@demo.com', '27999990006', `1991-${demoMonth}-08`, 'Retorno de cílios a cada 21 dias.'],
      ['Gabriela Rocha', 'gabi@demo.com', '27999990007', '1995-07-30', 'Prefere horários pela manhã.'],
      ['Helena Prado', 'helena@demo.com', '27999990008', `1985-${demoMonth}-24`, 'Fotografa os resultados para as redes.']
    ];
    const clientIds = [];
    for (const [name, email, phone, birthdate, notes] of clients) {
      const id = uuid();
      clientIds.push(id);
      rows(await db.from('users').insert({
        id, name, email, phone, password_hash: '', birthdate, role: 'client', notes,
        created_at: new Date(Date.now() - 60 * 86400000).toISOString()
      }));
    }

    const serviceRows = [
      ['Extensão de Cílios Clássico', 'cilios', 'Fio a fio, efeito natural e olhar descansado.', 15000, 120, 21],
      ['Volume Brasileiro', 'cilios', 'Leve, preenchido e com o volume na medida certa.', 19000, 150, 21],
      ['Volume Russo', 'cilios', 'Máxima densidade e dramaticidade, feitas para durar.', 23000, 180, 21],
      ['Manutenção de Cílios', 'cilios', 'Retoque completo para manter o desenho impecável.', 9000, 60, 21],
      ['Lash Lifting', 'cilios', 'Curvatura e alongamento naturais, sem extensão.', 12000, 60, 45],
      ['Alongamento em Gel', 'unhas', 'Estrutura resistente com acabamento fino e natural.', 16000, 120, 21],
      ['Esmaltação em Gel', 'unhas', 'Cor impecável e brilho por semanas.', 8000, 60, 18],
      ['Manicure Tradicional', 'manicure', 'Cutilagem, lixamento e esmaltação cuidadosa.', 5000, 40, 15],
      ['Pedicure Completa', 'pedicure', 'Cuidado completo para pés macios e esmaltados.', 6500, 50, 21],
      ['Spa dos Pés', 'pedicure', 'Esfoliação, hidratação intensa e massagem relaxante.', 9500, 70, 30]
    ];
    const services = new Map();
    let sort = 1;
    for (const [name, category, description, priceCents, duration, maintenance] of serviceRows) {
      const id = uuid();
      services.set(name, { id, name, category, description, price_cents: priceCents, duration_min: duration, maintenance_days: maintenance, active: true, sort });
      sort += 1;
      rows(await db.from('services').insert(services.get(name)));
    }

    const today = todayISO();
    const created = new Date(Date.now() - 3 * 86400000).toISOString();

    async function createAppointment(clientIdx, serviceName, date, time, status, opts = {}) {
      const service = services.get(serviceName);
      const depositCents = Math.round(service.price_cents * BUSINESS.depositPercent / 100);
      const depositStatus = opts.depositStatus || 'pendente';
      const method = opts.method || ['pix', 'cartao', 'dinheiro'][Math.floor(Math.random() * 3)];
      const id = uuid();
      rows(await db.from('appointments').insert({
        id, client_id: clientIds[clientIdx], service_id: service.id, date, time,
        duration_min: service.duration_min, price_cents: service.price_cents, status,
        notes: opts.notes || '', deposit_cents: depositCents, deposit_status: depositStatus,
        payment_method: method, source: opts.source || 'online', created_at: created, updated_at: created
      }));
      if (depositStatus === 'pago' && status !== 'cancelado') {
        await insertFinance({
          kind: 'entrada', amount: depositCents / 100, method, category: 'Sinal',
          description: `Sinal · ${service.name}`, date, appointmentId: id
        });
      }
      if (status === 'concluido') {
        const remaining = round2(service.price_cents / 100 - (depositStatus === 'pago' ? depositCents / 100 : 0));
        if (remaining > 0) {
          await insertFinance({
            kind: 'entrada', amount: remaining, method, category: 'Atendimento',
            description: `${service.name} · ${clients[clientIdx][0]}`, date, appointmentId: id
          });
        }
      }
      return id;
    }

    await createAppointment(0, 'Volume Brasileiro', today, '09:00', 'concluido', { depositStatus: 'pago', method: 'pix' });
    await createAppointment(1, 'Esmaltação em Gel', today, '11:30', 'confirmado', { depositStatus: 'pendente', method: 'pix' });
    await createAppointment(2, 'Volume Russo', today, '13:30', 'pendente', { depositStatus: 'informado', method: 'pix', notes: 'Enviou comprovante do sinal pelo WhatsApp.' });
    await createAppointment(4, 'Manicure Tradicional', today, '16:30', 'confirmado', { depositStatus: 'pago', method: 'cartao' });
    await createAppointment(3, 'Pedicure Completa', today, '17:30', 'confirmado', { depositStatus: 'pendente', method: 'pix' });
    await createAppointment(5, 'Volume Brasileiro', addDays(today, 1), '09:30', 'pendente', { depositStatus: 'pendente' });
    await createAppointment(6, 'Spa dos Pés', addDays(today, 1), '13:00', 'confirmado', { depositStatus: 'pago', method: 'pix' });
    await createAppointment(7, 'Lash Lifting', addDays(today, 1), '15:00', 'confirmado', { depositStatus: 'pendente' });
    await createAppointment(0, 'Manutenção de Cílios', addDays(today, 2), '16:30', 'pendente', { depositStatus: 'pendente' });
    await createAppointment(1, 'Alongamento em Gel', addDays(today, 3), '10:00', 'confirmado', { depositStatus: 'pago', method: 'pix' });
    await createAppointment(2, 'Esmaltação em Gel', addDays(today, 4), '14:00', 'confirmado', { depositStatus: 'pendente' });

    const history = [
      [0, 'Manutenção de Cílios', -3, '10:00', 'pago'],
      [1, 'Manicure Tradicional', -6, '15:00', 'pendente'],
      [2, 'Esmaltação em Gel', -8, '09:00', 'pago'],
      [3, 'Volume Russo', -12, '14:00', 'pago'],
      [4, 'Alongamento em Gel', -15, '11:00', 'pendente'],
      [5, 'Volume Brasileiro', -20, '16:00', 'pago'],
      [6, 'Pedicure Completa', -23, '10:00', 'pendente'],
      [7, 'Esmaltação em Gel', -26, '13:00', 'pago'],
      [2, 'Volume Russo', -28, '14:00', 'pago'],
      [1, 'Esmaltação em Gel', -19, '09:00', 'pago'],
      [0, 'Volume Brasileiro', -40, '10:00', 'pendente'],
      [3, 'Lash Lifting', -45, '15:00', 'pendente'],
      [4, 'Pedicure Completa', -52, '10:00', 'pendente'],
      [5, 'Manutenção de Cílios', -33, '11:00', 'pago'],
      [6, 'Spa dos Pés', -60, '16:00', 'pendente']
    ];
    for (const [clientIdx, serviceName, daysAgo, time, depositStatus] of history) {
      await createAppointment(clientIdx, serviceName, addDays(today, daysAgo), time, 'concluido', { depositStatus, method: 'pix' });
    }

    const expenses = [
      ['Insumos', 'Cola, pinças e fitas para cílios', 186.9, 'pix', -1],
      ['Insumos', 'Esmaltes e produtos de unha', 240, 'cartao', -4],
      ['Estrutura', 'Aluguel do espaço', 950, 'transferencia', -9],
      ['Estúdio', 'Café, água e recepção', 120, 'dinheiro', -14]
    ];
    for (const [category, description, amount, method, daysAgo] of expenses) {
      rows(await db.from('finance').insert({
        id: uuid(), kind: 'saida', amount_cents: toCents(amount), method, category,
        description, date: addDays(today, daysAgo), appointment_id: null, created_at: nowIso
      }));
    }

    const portfolio = [
      ['Volume brasileiro', 'Preenchimento leve, simétrico e fio a fio.', 'cilios', '/img/portfolio-1.jpg'],
      ['Clássico delicado', 'Olhar natural com efeito de rímel perfeito.', 'cilios', '/img/portfolio-2.jpg'],
      ['Híbrido iluminado', 'Contraste suave com pontas mais definidas.', 'cilios', '/img/portfolio-3.jpg'],
      ['Alongamento em gel', 'Estrutura fina, resistente e com brilho de espelho.', 'unhas', '/img/portfolio-4.jpg'],
      ['Francesinha gel', 'Clássica, clean e feita para durar semanas.', 'unhas', '/img/portfolio-5.jpg'],
      ['Nude acetinado', 'Cor neutra com acabamento sofisticado.', 'unhas', '/img/portfolio-6.jpg']
    ];
    let pSort = 1;
    for (const [title, description, category, image] of portfolio) {
      rows(await db.from('portfolio').insert({
        id: uuid(), title, description, category, image, sort: pSort, created_at: nowIso
      }));
      pSort += 1;
    }

    const defaults = {
      whatsapp: BUSINESS.whatsapp,
      email: BUSINESS.email,
      instagram: BUSINESS.instagram,
      address: BUSINESS.address
    };
    for (const [key, value] of Object.entries(defaults)) {
      rows(await db.from('settings').insert({ key, value }));
    }
  }

  /* ---------- agendamentos ---------- */
  async function createAppointmentRecord({
    clientId, service, date, time, notes = '', status = 'pendente',
    depositStatus = 'pendente', method = 'pix', source = 'online', enforceSlots = true
  }) {
    if (!isISODate(date)) fail(400, 'Escolha uma data válida.');
    if (date < todayISO()) fail(400, 'Escolha uma data a partir de hoje.');
    const normalized = normalizeTime(time);
    if (!normalized) fail(400, 'Escolha um horário válido.');

    const busy = (await loadAppointments()).filter(appt => appt.date === date);

    if (enforceSlots) {
      const options = slotsFor(date, service, busy);
      if (!options.includes(normalized)) fail(409, 'Esse horário acabou de ser reservado. Escolha outro, por favor.');
    } else {
      if (!fitsHours(date, normalized, service.duration_min)) fail(400, 'Horário fora do funcionamento do estúdio.');
      if (hasConflict(date, normalized, service.duration_min, busy)) fail(409, 'Já existe um atendimento nesse horário.');
    }

    if (!['pendente', 'informado', 'pago'].includes(depositStatus)) depositStatus = 'pendente';
    const depositCents = Math.round(Number(service.price_cents) * BUSINESS.depositPercent / 100);
    const nowIso = new Date().toISOString();
    const id = uuid();
    rows(await db.from('appointments').insert({
      id,
      client_id: String(clientId),
      service_id: String(service.id),
      date,
      time: normalized,
      duration_min: service.duration_min,
      price_cents: service.price_cents,
      status,
      notes: clean(notes, 1000),
      deposit_cents: depositCents,
      deposit_status: depositStatus,
      payment_method: method || 'pix',
      source,
      created_at: nowIso,
      updated_at: nowIso
    }));
    if (depositStatus === 'pago' || status === 'concluido') await syncFinance(id);
    return id;
  }

  /* ---------- rotas ---------- */
  const loginAttempts = new Map();

  function checkLoginRate(email) {
    const key = String(email).toLowerCase();
    const entry = loginAttempts.get(key);
    if (!entry) return;
    if (Date.now() - entry.first > 10 * 60 * 1000) {
      loginAttempts.delete(key);
      return;
    }
    if (entry.count >= 8) fail(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  }

  function registerFailure(email) {
    const key = String(email).toLowerCase();
    const entry = loginAttempts.get(key);
    if (!entry || Date.now() - entry.first > 10 * 60 * 1000) loginAttempts.set(key, { count: 1, first: Date.now() });
    else entry.count += 1;
  }

  async function handle(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if (!match) return json({ error: 'Recurso não encontrado.' }, 404);
    const path = match[1] || '/';
    const method = request.method;
    currentSecure = url.protocol === 'https:';

    await ensureSeed();

    if (path === '/api/health' && method === 'GET') return json({ ok: true, name: BUSINESS.name });

    /* ---------- site público ---------- */
    if (path === '/api/site' && method === 'GET') {
      const [services, portfolio, contact] = await Promise.all([loadServices(), loadPortfolio(), getSettings()]);
      return json({
        business: {
          name: BUSINESS.name, shortName: BUSINESS.shortName, tagline: BUSINESS.tagline,
          eyebrow: BUSINESS.eyebrow, whatsapp: contact.whatsapp,
          whatsappDisplay: contact.whatsappDisplay, instagram: contact.instagram,
          email: contact.email, depositPercent: BUSINESS.depositPercent,
          cancelHours: BUSINESS.cancelHours, address: contact.address, hours: BUSINESS.hours
        },
        services: services
          .filter(service => service.active)
          .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name))
          .map(service => ({
            id: service.id, name: service.name, category: service.category,
            description: service.description, price: fromCents(service.price_cents),
            duration_min: service.duration_min, maintenance_days: service.maintenance_days
          })),
        portfolio: portfolio
          .sort((a, b) => (a.sort - b.sort) || String(b.id).localeCompare(String(a.id)))
          .map(item => ({
            id: item.id, title: item.title, description: item.description,
            category: item.category, image: portfolioImageUrl(item)
          })),
        categories: CATEGORIES
      });
    }

    if (path === '/api/availability' && method === 'GET') {
      const date = String(url.searchParams.get('date') || '');
      const serviceId = String(url.searchParams.get('serviceId') || '');
      if (!isISODate(date)) fail(400, 'Escolha uma data válida.');
      if (date < todayISO()) fail(400, 'Essa data já passou.');
      const service = (await loadServices()).find(item => String(item.id) === serviceId);
      if (!service || !service.active) fail(404, 'Serviço não encontrado.');
      const hours = workingHours(date);
      const busy = (await loadAppointments()).filter(appt => appt.date === date);
      const slots = slotsFor(date, service, busy);
      return json({ date, serviceId, slots, hours, closed: !hours });
    }

    /* ---------- autenticação ---------- */
    if (path === '/api/auth/me' && method === 'GET') {
      const user = await currentUser(request);
      return json({ user: publicUser(user) });
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const body = await readBody(request);
      const email = clean(body.email, 160).toLowerCase();
      const password = String(body.password || '');
      checkLoginRate(email);

      const found = rows(await db.from('users').select(COLS.users).eq('email', email).limit(1));
      const user = found[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        registerFailure(email);
        fail(401, 'E-mail ou senha incorretos.');
      }

      loginAttempts.delete(email);
      const token = await createSession(user.id);
      return json({ user: publicUser(user) }, 200, { 'set-cookie': cookieHeader(token, SESSION_DAYS * 86400) });
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const parsed = parseCookies(request.headers.get('cookie'));
      await destroySession(parsed[COOKIE_NAME]);
      return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0) });
    }

    /* ---------- notificações (polling leve) ---------- */
    if (path === '/api/notifications' && method === 'GET') {
      const user = await requireUser(request);
      const rowsFound = await selectAll('notifications', COLS.notifications, { order: ['created_at', false], limit: 80 });
      const since = Number(url.searchParams.get('since') || 0);
      const items = rowsFound
        .filter(row => user.role === 'admin' || String(row.client_id) === String(user.id))
        .filter(row => new Date(row.created_at).getTime() > since)
        .reverse()
        .map(row => ({
          id: row.id, type: row.type, title: row.title, message: row.message,
          clientId: row.client_id, appointmentId: row.appointment_id, at: row.created_at
        }));
      return json({ notifications: items, now: Date.now() });
    }

    /* ---------- agendamento da cliente (sem login) ---------- */
    if (path === '/api/appointments' && method === 'POST') {
      const body = await readBody(request);
      const name = clean(body.name, 120);
      const phone = normalizePhone(body.phone);
      const birthdate = body.birthdate && isISODate(body.birthdate) ? body.birthdate : null;
      if (!isFullName(name)) fail(400, 'Informe seu nome completo.');
      if (phone.length < 10 || phone.length > 11) fail(400, 'Confira o WhatsApp com DDD.');

      const service = (await loadServices()).find(item => String(item.id) === String(body.serviceId));
      if (!service || !service.active) fail(404, 'Serviço não encontrado.');

      let client = await clientByPhone(phone);
      if (client) {
        if (!client.birthdate && birthdate) {
          rows(await db.from('users').update({ birthdate }).eq('id', client.id));
          client = { ...client, birthdate };
        }
      } else {
        client = {
          id: uuid(), name, email: null, phone, password_hash: '', birthdate,
          role: 'client', notes: '', created_at: new Date().toISOString()
        };
        rows(await db.from('users').insert(client));
        await notify({
          type: 'client:new', title: 'Nova cliente',
          message: `${name} agendou pela primeira vez.`, clientId: client.id
        });
      }

      const id = await createAppointmentRecord({
        clientId: client.id, service, date: String(body.date || ''), time: body.time,
        notes: body.notes, enforceSlots: true, status: 'pendente', source: 'online'
      });
      const appt = await appointmentById(id);
      const [users, services] = await Promise.all([loadUsers(), loadServices()]);
      const view = appointmentView(appt, userMap(users), serviceMap(services));
      await notify({
        type: 'appointment:created', title: 'Novo agendamento online',
        message: `${view.client_name} agendou ${view.service_name} para ${formatDateBR(view.date)} às ${view.time}.`,
        appointmentId: view.id, clientId: view.client_id
      });
      const depositAmount = view.deposit_amount;
      const pix = {
        amount: depositAmount,
        payload: pixPayload({ amount: depositAmount, txid: `STUDIO${String(appt.id).slice(0, 8)}` }),
        pixKey: BUSINESS.pixKey, pixName: BUSINESS.pixName
      };
      return json({ appointment: view, client: { name: client.name, phone: client.phone }, pix }, 201);
    }

    if (path === '/api/my/appointments' && method === 'POST') {
      const body = await readBody(request);
      const user = await identifyClient(body);
      const [appointments, users, services] = await Promise.all([loadAppointments(), loadUsers(), loadServices()]);
      const uMap = userMap(users);
      const sMap = serviceMap(services);
      const list = sortByDateTime(appointments.filter(appt => String(appt.client_id) === String(user.id)))
        .map(appt => appointmentView(appt, uMap, sMap));
      const today = todayISO();
      const now = nowMinutes();
      const isUpcoming = row => ['pendente', 'confirmado'].includes(row.status)
        && (row.date > today || (row.date === today && toMinutes(row.time) > now));

      const upcoming = list.filter(isUpcoming);
      const history = list.filter(row => !isUpcoming(row)).reverse();
      const completed = list.filter(row => row.status === 'concluido');

      const maintenanceMap = new Map();
      list.forEach(row => {
        if (row.status !== 'concluido' || !row.maintenance_days) return;
        const current = maintenanceMap.get(String(row.service_id));
        if (!current || row.date > current.last_date) {
          maintenanceMap.set(String(row.service_id), {
            service_id: row.service_id, service_name: row.service_name, category: row.service_category,
            price: row.price, duration_min: row.duration_min, maintenance_days: row.maintenance_days,
            last_date: row.date
          });
        }
      });
      const maintenance = [...maintenanceMap.values()].map(item => {
        const due = addDays(item.last_date, item.maintenance_days);
        return { ...item, due, daysLeft: diffDays(today, due) };
      }).sort((a, b) => a.daysLeft - b.daysLeft);

      const stats = {
        visits: completed.length,
        spent: round2(completed.reduce((sum, row) => sum + Number(row.price), 0)),
        memberSince: user.created_at,
        upcoming: upcoming.length
      };
      return json({ appointments: list, upcoming, history, maintenance, stats, user: publicUser(user) });
    }

    const clientApptAction = path.match(/^\/api\/my\/appointments\/([0-9a-f-]{36})\/(cancel|confirm|deposit)$/);
    if (clientApptAction && method === 'POST') {
      const body = await readBody(request);
      const user = await identifyClient(body);
      const [, id, action] = clientApptAction;
      const appt = await appointmentById(id);
      if (!appt || String(appt.client_id) !== String(user.id)) fail(404, 'Agendamento não encontrado.');
      const [users, services] = await Promise.all([loadUsers(), loadServices()]);
      const view = appointmentView(appt, userMap(users), serviceMap(services));

      if (action === 'cancel') {
        if (!['pendente', 'confirmado'].includes(appt.status)) fail(400, 'Este agendamento não pode mais ser cancelado.');
        const start = new Date(`${appt.date}T${appt.time}:00-03:00`);
        const hours = (start.getTime() - Date.now()) / 3600000;
        if (hours < BUSINESS.cancelHours) {
          fail(400, `Cancelamentos online até ${BUSINESS.cancelHours}h antes do horário. Chame o estúdio no WhatsApp.`);
        }
        rows(await db.from('appointments').update({ status: 'cancelado', updated_at: new Date().toISOString() }).eq('id', appt.id));
        await notify({
          type: 'appointment:updated', title: 'Agendamento cancelado pela cliente',
          message: `${view.client_name} cancelou ${view.service_name} de ${formatDateBR(view.date)} às ${view.time}.`,
          appointmentId: view.id, clientId: view.client_id
        });
      } else if (action === 'confirm') {
        if (appt.status !== 'pendente') fail(400, 'Este agendamento já foi atualizado.');
        rows(await db.from('appointments').update({ status: 'confirmado', updated_at: new Date().toISOString() }).eq('id', appt.id));
        await notify({
          type: 'appointment:updated', title: 'Cliente confirmou presença',
          message: `${view.client_name} confirmou ${view.service_name} de ${formatDateBR(view.date)} às ${view.time}.`,
          appointmentId: view.id, clientId: view.client_id
        });
      } else {
        if (appt.deposit_status === 'pago') fail(400, 'O sinal deste agendamento já foi confirmado.');
        if (appt.status === 'cancelado') fail(400, 'Este agendamento foi cancelado.');
        rows(await db.from('appointments').update({ deposit_status: 'informado', updated_at: new Date().toISOString() }).eq('id', appt.id));
        await notify({
          type: 'deposit:reported', title: 'Sinal informado pela cliente',
          message: `${view.client_name} informou o pagamento do sinal de ${view.service_name} (${formatDateBR(view.date)}). Confira o Pix e confirme no painel.`,
          appointmentId: view.id, clientId: view.client_id
        });
      }

      const updated = await appointmentById(id);
      return json({ appointment: appointmentView(updated, userMap(users), serviceMap(services)) });
    }

    const depositPix = path.match(/^\/api\/deposit\/([0-9a-f-]{36})\/pix$/);
    if (depositPix && method === 'POST') {
      const body = await readBody(request);
      const appt = await appointmentById(depositPix[1]);
      if (!appt) fail(404, 'Agendamento não encontrado.');
      const admin = await currentUser(request);
      if (admin?.role !== 'admin') {
        const client = await identifyClient(body);
        if (String(appt.client_id) !== String(client.id)) fail(404, 'Agendamento não encontrado.');
      }
      if (appt.status === 'cancelado') fail(400, 'Agendamento cancelado.');
      const [users, services] = await Promise.all([loadUsers(), loadServices()]);
      const view = appointmentView(appt, userMap(users), serviceMap(services));
      const amount = view.deposit_amount;
      const payload = pixPayload({ amount, txid: `STUDIO${String(appt.id).slice(0, 8)}` });
      return json({
        appointmentId: view.id, amount, payload, qr: null,
        depositStatus: appt.deposit_status, pixKey: BUSINESS.pixKey,
        pixName: BUSINESS.pixName, serviceName: view.service_name,
        date: view.date, time: view.time
      });
    }

    /* ---------- painel: visão geral ---------- */
    if (path === '/api/admin/overview' && method === 'GET') {
      await requireAdmin(request);
      const date = isISODate(url.searchParams.get('date')) ? url.searchParams.get('date') : todayISO();
      const today = todayISO();
      const month = date.slice(0, 7);
      const [appointments, finance, users, services] = await Promise.all([loadAppointments(), loadFinance(), loadUsers(), loadServices()]);
      const uMap = userMap(users);
      const sMap = serviceMap(services);
      const views = appointments.map(appt => appointmentView(appt, uMap, sMap));

      const dayAppointments = sortByDateTime(views.filter(row => row.date === date));
      const upcoming = sortByDateTime(views.filter(row => row.date >= date && ['pendente', 'confirmado'].includes(row.status))).slice(0, 6);
      const monthRevenue = finance.filter(row => row.kind === 'entrada' && String(row.date).startsWith(month)).reduce((sum, row) => sum + fromCents(row.amount_cents), 0);
      const monthExpenses = finance.filter(row => row.kind === 'saida' && String(row.date).startsWith(month)).reduce((sum, row) => sum + fromCents(row.amount_cents), 0);
      const pendingDeposits = views.filter(row => ['pendente', 'confirmado'].includes(row.status) && row.deposit_status !== 'pago' && row.date >= today).length;
      const newClients = users.filter(user => user.role === 'client' && String(user.created_at).startsWith(month)).length;
      const completedMonth = views.filter(row => row.status === 'concluido' && String(row.date).startsWith(month));
      const maintenance = maintenanceList(uMap, sMap, appointments);
      const maintenanceDue = maintenance.filter(item => item.daysLeft <= 7).length;
      const activeToday = dayAppointments.filter(row => !['cancelado', 'faltou'].includes(row.status));

      const chart = [];
      for (let i = 6; i >= 0; i -= 1) {
        const day = addDays(date, -i);
        const total = finance.filter(row => row.kind === 'entrada' && row.date === day).reduce((sum, row) => sum + fromCents(row.amount_cents), 0);
        chart.push({ date: day, total: round2(total) });
      }

      const activity = views
        .slice()
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 6)
        .map(row => ({
          id: row.id, status: row.status, created_at: row.created_at, source: row.source,
          date: row.date, time: row.time, client_name: row.client_name, service_name: row.service_name
        }));

      const completedTotal = completedMonth.reduce((sum, row) => sum + Number(row.price), 0);
      return json({
        date,
        stats: {
          todayCount: activeToday.length,
          todayExpected: round2(activeToday.reduce((sum, row) => sum + Number(row.price), 0)),
          monthRevenue: round2(monthRevenue),
          monthExpenses: round2(monthExpenses),
          monthProfit: round2(monthRevenue - monthExpenses),
          pendingDeposits,
          maintenanceDue,
          newClients,
          completedMonth: completedMonth.length,
          ticket: completedMonth.length ? round2(completedTotal / completedMonth.length) : 0
        },
        dayAppointments, upcoming, chart, activity,
        maintenance: maintenance.slice(0, 10),
        birthdays: birthdayList(users)
      });
    }

    /* ---------- painel: agenda ---------- */
    if (path === '/api/admin/appointments' && method === 'GET') {
      await requireAdmin(request);
      const date = url.searchParams.get('date');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const status = url.searchParams.get('status');
      const [appointments, users, services] = await Promise.all([loadAppointments(), loadUsers(), loadServices()]);
      const uMap = userMap(users);
      const sMap = serviceMap(services);
      let list = appointments.map(appt => appointmentView(appt, uMap, sMap));
      if (isISODate(date)) list = list.filter(row => row.date === date);
      else {
        if (isISODate(from)) list = list.filter(row => row.date >= from);
        if (isISODate(to)) list = list.filter(row => row.date <= to);
      }
      if (STATUS.includes(status)) list = list.filter(row => row.status === status);
      list = sortByDateTime(list).slice(0, 500);
      return json({ appointments: list });
    }

    if (path === '/api/admin/appointments' && method === 'POST') {
      await requireAdmin(request);
      const body = await readBody(request);
      const services = await loadServices();
      const service = services.find(item => String(item.id) === String(body.serviceId));
      if (!service) fail(404, 'Serviço não encontrado.');
      const date = String(body.date || '');
      if (!isISODate(date)) fail(400, 'Escolha uma data válida.');

      let clientId = body.clientId ? String(body.clientId) : null;
      let newClient = null;
      let clientName = '';

      const users = await loadUsers();
      if (clientId) {
        const client = users.find(user => String(user.id) === clientId && user.role === 'client');
        if (!client) fail(404, 'Cliente não encontrada.');
        clientName = client.name;
      } else {
        const name = clean(body.clientName, 120);
        const phone = normalizePhone(body.clientPhone);
        const birthdate = body.clientBirthdate && isISODate(body.clientBirthdate) ? body.clientBirthdate : null;
        if (!isFullName(name)) fail(400, 'Informe o nome completo da cliente.');
        if (phone.length < 10 || phone.length > 11) fail(400, 'Informe o WhatsApp com DDD.');
        const existing = users.find(user => user.role === 'client' && String(user.phone) === phone);
        if (existing) {
          clientId = existing.id;
          clientName = existing.name;
        } else {
          newClient = { id: uuid(), name, phone, birthdate };
          clientName = name;
        }
      }

      const status = STATUS.includes(body.status) ? body.status : 'confirmado';
      const depositStatus = ['pendente', 'informado', 'pago'].includes(body.depositStatus) ? body.depositStatus : 'pendente';

      if (newClient) {
        rows(await db.from('users').insert({
          id: newClient.id, name: newClient.name, email: null, phone: newClient.phone,
          password_hash: '', birthdate: newClient.birthdate,
          role: 'client', notes: '', created_at: new Date().toISOString()
        }));
        clientId = newClient.id;
      }

      const id = await createAppointmentRecord({
        clientId, service, date, time: body.time, notes: body.notes,
        status, depositStatus, method: body.paymentMethod || 'pix', source: 'manual', enforceSlots: false
      });

      const appt = await appointmentById(id);
      const view = appointmentView(appt, userMap(await loadUsers()), serviceMap(await loadServices()));

      if (newClient) {
        await notify({
          type: 'client:new', title: 'Nova cliente cadastrada',
          message: `${clientName} foi cadastrada pela agenda.`, clientId
        });
      }
      await notify({
        type: 'appointment:created', title: 'Agendamento criado no estúdio',
        message: `${view.client_name} · ${view.service_name} · ${formatDateBR(date)} às ${view.time}.`,
        appointmentId: view.id, clientId
      });
      return json({ appointment: view }, 201);
    }

    const adminAppt = path.match(/^\/api\/admin\/appointments\/([0-9a-f-]{36})$/);
    if (adminAppt && method === 'PATCH') {
      await requireAdmin(request);
      const appt = await appointmentById(adminAppt[1]);
      if (!appt) fail(404, 'Agendamento não encontrado.');
      const body = await readBody(request);
      const updates = {};
      let date = appt.date;
      let time = appt.time;
      let rescheduled = false;

      if (body.date !== undefined) {
        if (!isISODate(body.date)) fail(400, 'Data inválida.');
        date = body.date;
        rescheduled = true;
      }
      if (body.time !== undefined) {
        const normalized = normalizeTime(body.time);
        if (!normalized) fail(400, 'Horário inválido.');
        time = normalized;
        rescheduled = true;
      }

      if (rescheduled) {
        const busy = (await loadAppointments()).filter(row => row.date === date);
        if (date >= todayISO() && !fitsHours(date, time, appt.duration_min)) {
          fail(400, 'Horário fora do funcionamento do estúdio.');
        }
        if (hasConflict(date, time, appt.duration_min, busy, appt.id)) {
          fail(409, 'Já existe um atendimento nesse horário.');
        }
        updates.date = date;
        updates.time = time;
      }

      if (body.status !== undefined) {
        if (!STATUS.includes(body.status)) fail(400, 'Status inválido.');
        updates.status = body.status;
      }
      if (body.depositStatus !== undefined) {
        if (!['pendente', 'informado', 'pago'].includes(body.depositStatus)) fail(400, 'Status de sinal inválido.');
        updates.deposit_status = body.depositStatus;
      }
      if (body.paymentMethod !== undefined) updates.payment_method = clean(body.paymentMethod, 30);
      if (body.notes !== undefined) updates.notes = clean(body.notes, 1000);

      if (!Object.keys(updates).length) fail(400, 'Nenhuma alteração informada.');
      rows(await db.from('appointments').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', appt.id));
      await syncFinance(appt.id);

      const [users, services] = await Promise.all([loadUsers(), loadServices()]);
      const updated = appointmentView(await appointmentById(appt.id), userMap(users), serviceMap(services));
      let message = `${updated.client_name} · ${updated.service_name}`;
      if (updates.status) message += ` — ${STATUS_LABEL[updates.status]}`;
      if (rescheduled) message += ` · remarcado para ${formatDateBR(updated.date)} às ${updated.time}`;
      if (updates.deposit_status === 'pago') message += ' · sinal confirmado';
      await notify({
        type: 'appointment:updated', title: 'Agenda atualizada', message,
        appointmentId: updated.id, clientId: updated.client_id
      });
      return json({ appointment: updated });
    }

    /* ---------- painel: clientes ---------- */
    if (path === '/api/admin/clients' && method === 'GET') {
      await requireAdmin(request);
      const q = clean(url.searchParams.get('q'), 100).toLowerCase();
      const [users, appointments] = await Promise.all([loadUsers(), loadAppointments()]);
      const today = todayISO();
      let clients = users.filter(user => user.role === 'client');
      if (q) clients = clients.filter(user => `${user.name} ${user.email} ${user.phone}`.toLowerCase().includes(q));
      const list = clients.map(user => {
        const own = appointments.filter(appt => String(appt.client_id) === String(user.id));
        const completed = own.filter(appt => appt.status === 'concluido');
        const upcoming = own.filter(appt => appt.date >= today && ['pendente', 'confirmado'].includes(appt.status));
        return {
          id: user.id, name: user.name, email: user.email, phone: user.phone,
          birthdate: user.birthdate, notes: user.notes, created_at: user.created_at,
          visits: completed.length,
          spent: round2(completed.reduce((sum, appt) => sum + fromCents(appt.price_cents), 0)),
          last_visit: completed.length ? completed.map(appt => appt.date).sort().pop() : null,
          next_visit: upcoming.length ? upcoming.map(appt => appt.date).sort()[0] : null
        };
      }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      return json({ clients: list });
    }

    if (path === '/api/admin/clients' && method === 'POST') {
      await requireAdmin(request);
      const body = await readBody(request);
      const name = clean(body.name, 120);
      const email = clean(body.email, 160).toLowerCase() || null;
      const phone = normalizePhone(body.phone);
      const birthdate = body.birthdate && isISODate(body.birthdate) ? body.birthdate : null;
      const notes = clean(body.notes, 1000);
      if (!isFullName(name)) fail(400, 'Informe o nome completo da cliente.');
      if (email && !isValidEmail(email)) fail(400, 'Confira o e-mail informado.');
      if (phone.length < 10 || phone.length > 11) fail(400, 'Informe o WhatsApp com DDD.');
      const users = await loadUsers();
      if (users.some(user => user.role === 'client' && String(user.phone) === phone)) {
        fail(409, 'Já existe uma cliente com este celular. Selecione na lista.');
      }

      const user = {
        id: uuid(), name, email, phone, password_hash: '', birthdate,
        role: 'client', notes, created_at: new Date().toISOString()
      };
      rows(await db.from('users').insert(user));
      await notify({ type: 'client:new', title: 'Nova cliente cadastrada', message: `${name} entrou na lista de clientes.`, clientId: user.id });
      return json({
        client: { id: user.id, name: user.name, email: user.email, phone: user.phone, birthdate: user.birthdate, notes: user.notes, created_at: user.created_at }
      }, 201);
    }

    const adminClient = path.match(/^\/api\/admin\/clients\/([0-9a-f-]{36})$/);
    if (adminClient && method === 'GET') {
      await requireAdmin(request);
      const [users, appointments, services] = await Promise.all([loadUsers(), loadAppointments(), loadServices()]);
      const client = users.find(user => String(user.id) === adminClient[1] && user.role === 'client');
      if (!client) fail(404, 'Cliente não encontrada.');
      const uMap = userMap(users);
      const sMap = serviceMap(services);
      const list = appointments
        .filter(appt => String(appt.client_id) === String(client.id))
        .map(appt => appointmentView(appt, uMap, sMap))
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
      const completed = list.filter(row => row.status === 'concluido');
      const today = todayISO();
      const upcoming = list.filter(row => ['pendente', 'confirmado'].includes(row.status) && row.date >= today)
        .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
      const spent = round2(completed.reduce((sum, row) => sum + Number(row.price), 0));
      return json({
        client: {
          id: client.id, name: client.name, email: client.email, phone: client.phone,
          birthdate: client.birthdate, notes: client.notes, created_at: client.created_at
        },
        appointments: list, upcoming,
        maintenance: maintenanceList(uMap, sMap, appointments, client.id),
        stats: {
          visits: completed.length, spent,
          lastVisit: completed.length ? completed[0].date : null,
          upcoming: upcoming.length,
          ticket: completed.length ? round2(spent / completed.length) : 0
        }
      });
    }

    if (adminClient && method === 'PATCH') {
      await requireAdmin(request);
      const users = await loadUsers();
      const client = users.find(user => String(user.id) === adminClient[1] && user.role === 'client');
      if (!client) fail(404, 'Cliente não encontrada.');
      const body = await readBody(request);
      const name = body.name !== undefined ? clean(body.name, 120) : client.name;
      const phone = body.phone !== undefined ? normalizePhone(body.phone) : client.phone;
      const birthdate = body.birthdate !== undefined ? (isISODate(body.birthdate) ? body.birthdate : null) : client.birthdate;
      const notes = body.notes !== undefined ? clean(body.notes, 1000) : client.notes;
      if (name.length < 2) fail(400, 'Informe o nome da cliente.');
      if (phone.length < 10 || phone.length > 11) fail(400, 'Confira o WhatsApp com DDD.');
      rows(await db.from('users').update({ name, phone, birthdate, notes }).eq('id', client.id));
      return json({ client: { id: client.id, name, email: client.email, phone, birthdate, notes, created_at: client.created_at } });
    }

    /* ---------- painel: serviços ---------- */
    if (path === '/api/admin/services' && method === 'GET') {
      await requireAdmin(request);
      const [services, appointments] = await Promise.all([loadServices(), loadAppointments()]);
      return json({
        services: services
          .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name))
          .map(service => serviceView(service, appointments.filter(appt => String(appt.service_id) === String(service.id)).length)),
        categories: CATEGORIES
      });
    }

    if (path === '/api/admin/services' && method === 'POST') {
      await requireAdmin(request);
      const body = await readBody(request);
      const name = clean(body.name, 120);
      const category = Object.keys(CATEGORIES).includes(body.category) ? body.category : 'cilios';
      const description = clean(body.description, 300);
      const price = round2(body.price);
      const duration = Number(body.durationMin);
      const maintenance = Number(body.maintenanceDays || 0);
      if (name.length < 2) fail(400, 'Informe o nome do serviço.');
      if (!(price > 0)) fail(400, 'Informe um preço válido.');
      if (!(duration >= 10 && duration <= 600)) fail(400, 'Informe a duração em minutos.');
      if (!(maintenance >= 0 && maintenance <= 365)) fail(400, 'Informe o prazo de manutenção.');
      const services = await loadServices();
      const maxSort = services.reduce((max, service) => Math.max(max, Number(service.sort) || 0), 0);
      const service = {
        id: uuid(), name, category, description, price_cents: toCents(price),
        duration_min: duration, maintenance_days: maintenance, active: true, sort: maxSort + 1
      };
      rows(await db.from('services').insert(service));
      return json({ service: serviceView(service) }, 201);
    }

    const adminService = path.match(/^\/api\/admin\/services\/([0-9a-f-]{36})$/);
    if (adminService && method === 'PATCH') {
      await requireAdmin(request);
      const service = (await loadServices()).find(item => String(item.id) === adminService[1]);
      if (!service) fail(404, 'Serviço não encontrado.');
      const body = await readBody(request);
      const name = body.name !== undefined ? clean(body.name, 120) : service.name;
      const category = body.category !== undefined ? body.category : service.category;
      const description = body.description !== undefined ? clean(body.description, 300) : service.description;
      const price = body.price !== undefined ? round2(body.price) : fromCents(service.price_cents);
      const duration = body.durationMin !== undefined ? Number(body.durationMin) : service.duration_min;
      const maintenance = body.maintenanceDays !== undefined ? Number(body.maintenanceDays) : service.maintenance_days;
      const active = body.active !== undefined ? Boolean(body.active) : Boolean(service.active);
      if (name.length < 2) fail(400, 'Informe o nome do serviço.');
      if (!Object.keys(CATEGORIES).includes(category)) fail(400, 'Categoria inválida.');
      if (!(price > 0)) fail(400, 'Informe um preço válido.');
      if (!(duration >= 10 && duration <= 600)) fail(400, 'Informe a duração em minutos.');
      if (!(maintenance >= 0 && maintenance <= 365)) fail(400, 'Informe o prazo de manutenção.');
      rows(await db.from('services').update({
        name, category, description, price_cents: toCents(price),
        duration_min: duration, maintenance_days: maintenance, active
      }).eq('id', service.id));
      return json({ service: serviceView({ ...service, name, category, description, price_cents: toCents(price), duration_min: duration, maintenance_days: maintenance, active }) });
    }

    if (adminService && method === 'DELETE') {
      await requireAdmin(request);
      const service = (await loadServices()).find(item => String(item.id) === adminService[1]);
      if (!service) fail(404, 'Serviço não encontrado.');
      const used = (await loadAppointments()).some(appt => String(appt.service_id) === String(service.id));
      if (used) fail(409, 'Este serviço já tem atendimentos. Desative-o em vez de excluir.');
      rows(await db.from('services').delete().eq('id', service.id));
      return json({ ok: true });
    }

    /* ---------- painel: portfólio ---------- */
    function portfolioImageUrl(item) {
      const image = String(item.image || '');
      if (image.startsWith('portfolio/')) return `${API_PUBLIC}/api/media/${item.id}`;
      return image;
    }

    if (path === '/api/admin/portfolio' && method === 'GET') {
      await requireAdmin(request);
      const portfolio = await loadPortfolio();
      return json({
        portfolio: portfolio
          .sort((a, b) => (a.sort - b.sort) || String(b.id).localeCompare(String(a.id)))
          .map(item => ({ ...item, image: portfolioImageUrl(item) }))
      });
    }

    if (path === '/api/admin/portfolio/sign' && method === 'POST') {
      await requireAdmin(request);
      const body = await readBody(request);
      const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const type = String(body.type || '');
      const size = Number(body.size);
      if (!types[type]) fail(400, 'Envie uma imagem JPG, PNG ou WebP.');
      if (!(size > 0 && size <= 8 * 1024 * 1024)) fail(400, 'A imagem pode ter no máximo 8 MB.');
      const id = uuid();
      const objectPath = `portfolio/${id}.${types[type]}`;
      const signed = await storage.createSignedUploadUrl(objectPath, { upsert: false });
      return json({ id, path: objectPath, signedUrl: signed.signedUrl, contentType: type }, 201);
    }

    if (path === '/api/admin/portfolio' && method === 'POST') {
      await requireAdmin(request);
      const body = await readBody(request);
      const id = String(body.id || '');
      const objectPath = String(body.path || '');
      if (!/^[0-9a-f-]{36}$/.test(id) || !/^portfolio\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(objectPath)) {
        fail(400, 'Envie uma foto para publicar.');
      }
      if (!objectPath.startsWith(`portfolio/${id}.`)) fail(400, 'Envie uma foto para publicar.');
      const title = clean(body.title, 120);
      const description = clean(body.description, 300);
      const category = Object.keys(CATEGORIES).includes(body.category) ? body.category : 'cilios';
      if (title.length < 2) fail(400, 'Dê um título para a foto.');
      const size = Number(body.size);
      if (!(size > 0 && size <= 8 * 1024 * 1024)) fail(400, 'A imagem pode ter no máximo 8 MB.');

      let uploaded;
      try {
        uploaded = await storage.download(objectPath);
        const types = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
        const ext = objectPath.split('.').pop();
        await verifyUploadedObject(uploaded, {
          maxBytes: 8 * 1024 * 1024,
          expectedBytes: size,
          allowedContentTypes: [types[ext]]
        });
      } catch (error) {
        console.error('[portfolio] upload inválido', error?.message || error);
        fail(422, 'Não foi possível validar a imagem enviada. Tente novamente.');
      }

      const portfolio = await loadPortfolio();
      const maxSort = portfolio.reduce((max, item) => Math.max(max, Number(item.sort) || 0), 0);
      const item = {
        id, title, description, category, image: objectPath,
        sort: maxSort + 1, created_at: new Date().toISOString()
      };
      rows(await db.from('portfolio').insert(item));
      await notify({ type: 'portfolio:changed', title: 'Portfólio atualizado', message: `Nova foto publicada: ${title}.` });
      return json({ item: { ...item, image: portfolioImageUrl(item) } }, 201);
    }

    const adminPortfolio = path.match(/^\/api\/admin\/portfolio\/([0-9a-f-]{36})$/);
    if (adminPortfolio && method === 'DELETE') {
      await requireAdmin(request);
      const item = (await loadPortfolio()).find(row => String(row.id) === adminPortfolio[1]);
      if (!item) fail(404, 'Foto não encontrada.');
      rows(await db.from('portfolio').delete().eq('id', item.id));
      if (String(item.image).startsWith('portfolio/')) {
        try { await storage.remove([item.image]); } catch (error) { console.error('[portfolio] falha ao remover arquivo', error?.message || error); }
      }
      await notify({ type: 'portfolio:changed', title: 'Portfólio atualizado', message: `Foto removida: ${item.title}.` });
      return json({ ok: true });
    }

    const media = path.match(/^\/api\/media\/([0-9a-f-]{36})$/);
    if (media && method === 'GET') {
      const item = (await loadPortfolio()).find(row => String(row.id) === media[1]);
      if (!item || !String(item.image).startsWith('portfolio/')) return json({ error: 'Imagem não encontrada.' }, 404);
      let file;
      try {
        file = await storage.download(item.image);
      } catch {
        return json({ error: 'Imagem não encontrada.' }, 404);
      }
      const ext = String(item.image).split('.').pop();
      const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || 'application/octet-stream';
      return new Response(file.body, {
        headers: {
          'content-type': type,
          'cache-control': 'public, max-age=86400',
          'x-content-type-options': 'nosniff'
        }
      });
    }

    /* ---------- painel: financeiro ---------- */
    if (path === '/api/admin/finance' && method === 'GET') {
      await requireAdmin(request);
      const month = todayISO().slice(0, 7);
      const from = isISODate(url.searchParams.get('from')) ? url.searchParams.get('from') : `${month}-01`;
      const to = isISODate(url.searchParams.get('to')) ? url.searchParams.get('to') : `${month}-31`;
      const [finance, appointments, users, services] = await Promise.all([loadFinance(), loadAppointments(), loadUsers(), loadServices()]);
      const uMap = userMap(users);
      const sMap = serviceMap(services);
      const apptMap = new Map(appointments.map(appt => [String(appt.id), appt]));
      const entries = finance
        .filter(row => row.date >= from && row.date <= to)
        .map(row => {
          const appt = row.appointment_id ? apptMap.get(String(row.appointment_id)) : null;
          const client = appt ? uMap.get(String(appt.client_id)) : null;
          const service = appt ? sMap.get(String(appt.service_id)) : null;
          return {
            id: row.id, kind: row.kind, amount: fromCents(row.amount_cents), method: row.method,
            category: row.category, description: row.description, date: row.date,
            appointment_id: row.appointment_id, created_at: row.created_at,
            appointment_date: appt?.date ?? null,
            client_name: client?.name ?? null,
            service_name: service?.name ?? null
          };
        })
        .sort((a, b) => `${b.date}`.localeCompare(`${a.date}`) || String(b.created_at).localeCompare(String(a.created_at)));
      const income = round2(entries.filter(row => row.kind === 'entrada').reduce((sum, row) => sum + Number(row.amount), 0));
      const expense = round2(entries.filter(row => row.kind === 'saida').reduce((sum, row) => sum + Number(row.amount), 0));
      const deposits = round2(entries.filter(row => row.category === 'Sinal' && row.kind === 'entrada').reduce((sum, row) => sum + Number(row.amount), 0));
      return json({ entries, summary: { income, expense, balance: round2(income - expense), deposits }, from, to });
    }

    if (path === '/api/admin/finance' && method === 'POST') {
      await requireAdmin(request);
      const body = await readBody(request);
      const kind = body.kind === 'saida' ? 'saida' : 'entrada';
      const amount = round2(body.amount);
      const date = isISODate(body.date) ? body.date : todayISO();
      const description = clean(body.description, 160);
      const category = clean(body.category, 60) || 'Outros';
      const method = ['pix', 'dinheiro', 'cartao', 'transferencia'].includes(body.method) ? body.method : 'pix';
      if (!(amount > 0)) fail(400, 'Informe um valor maior que zero.');
      if (description.length < 2) fail(400, 'Descreva o lançamento.');
      const entry = {
        id: uuid(), kind, amount_cents: toCents(amount), method, category,
        description, date, appointment_id: null, created_at: new Date().toISOString()
      };
      rows(await db.from('finance').insert(entry));
      await notify({
        type: 'finance:changed', title: kind === 'entrada' ? 'Entrada lançada' : 'Despesa lançada',
        message: `${description} · ${kind === 'entrada' ? '+' : '−'} ${money(amount)}`
      });
      return json({ entry: { ...entry, amount } }, 201);
    }

    const adminFinance = path.match(/^\/api\/admin\/finance\/([0-9a-f-]{36})$/);
    if (adminFinance && method === 'DELETE') {
      await requireAdmin(request);
      const entry = (await loadFinance()).find(row => String(row.id) === adminFinance[1]);
      if (!entry) fail(404, 'Lançamento não encontrado.');
      rows(await db.from('finance').delete().eq('id', entry.id));
      await notify({ type: 'finance:changed', title: 'Lançamento removido', message: `${entry.description} foi excluído do caixa.` });
      return json({ ok: true });
    }

    /* ---------- painel: retornos, lembretes e contato ---------- */
    if (path === '/api/admin/maintenance' && method === 'GET') {
      await requireAdmin(request);
      const [users, services, appointments] = await Promise.all([loadUsers(), loadServices(), loadAppointments()]);
      return json({ maintenance: maintenanceList(userMap(users), serviceMap(services), appointments) });
    }

    if (path === '/api/admin/reminders' && method === 'GET') {
      await requireAdmin(request);
      const today = todayISO();
      const tomorrow = addDays(today, 1);
      const [appointments, users, services, contact] = await Promise.all([loadAppointments(), loadUsers(), loadServices(), getSettings()]);
      const uMap = userMap(users);
      const sMap = serviceMap(services);
      const views = appointments.map(appt => appointmentView(appt, uMap, sMap));
      return json({
        tomorrowAppointments: sortByDateTime(views.filter(row => row.date === tomorrow && ['pendente', 'confirmado'].includes(row.status))),
        todayPending: sortByDateTime(views.filter(row => row.date === today && row.status === 'pendente')),
        pendingDeposits: sortByDateTime(views.filter(row => row.deposit_status !== 'pago' && ['pendente', 'confirmado'].includes(row.status) && row.date >= today)),
        birthdays: birthdayList(users),
        maintenance: maintenanceList(uMap, sMap, appointments),
        business: { whatsapp: contact.whatsapp, name: BUSINESS.name }
      });
    }

    if (path === '/api/admin/settings' && method === 'GET') {
      await requireAdmin(request);
      return json({ settings: await getSettings() });
    }

    if (path === '/api/admin/settings' && method === 'PATCH') {
      await requireAdmin(request);
      const body = await readBody(request);
      const values = {};
      if (body.whatsapp !== undefined) {
        const phone = normalizePhone(body.whatsapp);
        if (phone.length < 10 || phone.length > 11) fail(400, 'Informe o WhatsApp com DDD.');
        values.whatsapp = `55${phone}`;
      }
      if (body.email !== undefined) {
        const email = clean(body.email, 160).toLowerCase();
        if (email && !isValidEmail(email)) fail(400, 'Confira o e-mail de contato.');
        values.email = email;
      }
      if (body.instagram !== undefined) values.instagram = instagramHandle(body.instagram);
      if (body.address !== undefined) values.address = clean(body.address, 160);
      if (!Object.keys(values).length) fail(400, 'Nenhuma alteração informada.');
      await saveSettings(values);
      return json({ settings: await getSettings() });
    }

    return json({ error: 'Recurso não encontrado.' }, 404);
  }

  return async ctx => {
    const request = requestOf(ctx);
    try {
      return await handle(request);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error('[api]', error?.kind === 'database' ? 'database_error' : (error?.message || error));
      return json({ error: 'Não foi possível concluir a operação.' }, 500);
    }
  };
}
