import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { db } from './db.js';
import { BUSINESS, ADMIN, DEMO_CLIENT, CATEGORIES, STATUS } from './config.js';
import { hashPassword, verifyPassword, friendlyPassword } from './hash.js';
import {
  attachUser, requireAuth, requireAdmin, createSession, destroySession,
  setSessionCookie, clearSessionCookie, userFromRequest, COOKIE_NAME
} from './auth.js';
import { slotsFor, hasConflict, fitsHours, workingHours } from './availability.js';
import { pixPayload, pixQrDataUrl } from './pix.js';
import {
  toISO, addDays, diffDays, toMinutes, nowMinutes, digits, clean, isValidEmail,
  round2, formatDateBR, normalizePhone, normalizeTime, isISODate, money, phoneDisplay
} from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const PORT = Number(process.env.PORT) || 3000;

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(attachUser);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const STATUS_LABEL = {
  pendente: 'aguardando confirmação',
  confirmado: 'confirmado',
  concluido: 'concluído',
  cancelado: 'cancelado',
  faltou: 'não compareceu'
};

const APPT_SELECT = `
  SELECT a.*, u.name AS client_name, u.phone AS client_phone, u.email AS client_email,
         s.name AS service_name, s.category AS service_category, s.maintenance_days
  FROM appointments a
  JOIN users u ON u.id = a.client_id
  JOIN services s ON s.id = a.service_id
`;

/* ---------------- Contato e redes do site ---------------- */
function getSettings() {
  const stored = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value]));
  const whatsapp = stored.whatsapp || BUSINESS.whatsapp;
  return {
    whatsapp,
    whatsappDisplay: phoneDisplay(whatsapp),
    email: stored.email ?? BUSINESS.email,
    instagram: stored.instagram ?? BUSINESS.instagram,
    address: stored.address ?? BUSINESS.address
  };
}

function saveSettings(values) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  for (const [key, value] of Object.entries(values)) upsert.run(key, value);
}

function instagramHandle(input) {
  let value = clean(input, 120).trim();
  if (!value) return '';
  value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '');
  return value.split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g, '');
}

function getAppointment(id) {
  return db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(Number(id));
}

function getBusy(date, ignoreId = null) {
  return db.prepare('SELECT id, time, duration_min, status FROM appointments WHERE date = ?').all(date)
    .filter(row => !ignoreId || Number(row.id) !== Number(ignoreId));
}

function getService(id) {
  return db.prepare('SELECT * FROM services WHERE id = ?').get(Number(id));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone,
    birthdate: user.birthdate, role: user.role
  };
}

/* ---------------- WebSocket ---------------- */
let wss = null;

function notify(event) {
  if (!wss) return;
  const payload = JSON.stringify({ ...event, at: new Date().toISOString() });
  for (const socket of wss.clients) {
    if (socket.readyState !== 1) continue;
    const user = socket.user;
    if (!user) continue;
    if (user.role === 'admin' || Number(event.clientId) === Number(user.id)) {
      socket.send(payload);
    }
  }
}

/* ---------------- Financeiro ---------------- */
function insertFinance({ kind, amount, method, category, description, date, appointmentId = null }) {
  db.prepare(`
    INSERT INTO finance (kind, amount, method, category, description, date, appointment_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(kind, round2(amount), method || 'pix', category, description, date, appointmentId, new Date().toISOString());
}

function financeTotalFor(appointmentId, category = null) {
  const row = category
    ? db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM finance WHERE appointment_id = ? AND category = ?').get(appointmentId, category)
    : db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM finance WHERE appointment_id = ? AND kind = \'entrada\'').get(appointmentId);
  return Number(row.total) || 0;
}

function syncFinance(appointmentId) {
  const appt = getAppointment(appointmentId);
  if (!appt) return;
  const sinal = financeTotalFor(appointmentId, 'Sinal');

  if (appt.status === 'concluido') {
    const hasServiceEntry = financeTotalFor(appointmentId, 'Atendimento') > 0;
    if (appt.deposit_status === 'pago' && !hasServiceEntry && sinal < appt.deposit_amount - 0.01) {
      insertFinance({
        kind: 'entrada', amount: appt.deposit_amount - sinal, method: appt.payment_method,
        category: 'Sinal', description: `Sinal · ${appt.service_name}`, date: appt.date, appointmentId
      });
    }
    const remaining = round2(appt.price - financeTotalFor(appointmentId));
    if (remaining > 0.009) {
      insertFinance({
        kind: 'entrada', amount: remaining, method: appt.payment_method,
        category: 'Atendimento', description: `${appt.service_name} · ${appt.client_name}`,
        date: appt.date, appointmentId
      });
    }
  } else if (appt.deposit_status === 'pago' && appt.status !== 'cancelado' && sinal < 0.01) {
    insertFinance({
      kind: 'entrada', amount: appt.deposit_amount, method: appt.payment_method,
      category: 'Sinal', description: `Sinal · ${appt.service_name}`, date: appt.date, appointmentId
    });
  }
}

/* ---------------- Manutenções ---------------- */
function maintenanceList(clientId = null) {
  const params = [];
  let where = "a.status = 'concluido' AND s.maintenance_days > 0";
  if (clientId) {
    where += ' AND a.client_id = ?';
    params.push(Number(clientId));
  }
  const rows = db.prepare(`
    SELECT a.client_id, u.name AS client_name, u.phone AS client_phone,
           s.id AS service_id, s.name AS service_name, s.category, s.price,
           s.duration_min, s.maintenance_days, MAX(a.date) AS last_date
    FROM appointments a
    JOIN users u ON u.id = a.client_id
    JOIN services s ON s.id = a.service_id
    WHERE ${where}
    GROUP BY a.client_id, s.id
  `).all(...params);

  const today = toISO();
  return rows.map(row => {
    const due = addDays(row.last_date, row.maintenance_days);
    return { ...row, due, daysLeft: diffDays(today, due) };
  }).sort((a, b) => a.daysLeft - b.daysLeft);
}

function birthdayList() {
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  return db.prepare("SELECT id, name, phone, birthdate FROM users WHERE role = 'client' AND birthdate IS NOT NULL").all()
    .filter(user => String(user.birthdate).slice(5, 7) === month)
    .map(user => ({ ...user, day: Number(String(user.birthdate).slice(8, 10)) }))
    .sort((a, b) => a.day - b.day);
}

/* ---------------- Auth ---------------- */
const loginAttempts = new Map();

function checkLoginRate(req, email) {
  const key = `${req.ip}:${String(email).toLowerCase()}`;
  const entry = loginAttempts.get(key);
  if (!entry) return;
  if (Date.now() - entry.first > 10 * 60 * 1000) {
    loginAttempts.delete(key);
    return;
  }
  if (entry.count >= 8) fail(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}

function registerFailure(req, email) {
  const key = `${req.ip}:${String(email).toLowerCase()}`;
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.first > 10 * 60 * 1000) {
    loginAttempts.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

app.get('/api/auth/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/register', (req, res) => {
  const body = req.body || {};
  const name = clean(body.name, 120);
  const email = clean(body.email, 160).toLowerCase();
  const phone = normalizePhone(body.phone);
  const password = String(body.password || '');
  const birthdate = body.birthdate && isISODate(body.birthdate) ? body.birthdate : null;

  if (name.length < 2) fail(400, 'Escreva seu nome completo.');
  if (!isValidEmail(email)) fail(400, 'Confira o e-mail informado.');
  if (phone.length < 10 || phone.length > 11) fail(400, 'Confira o WhatsApp com DDD.');
  if (password.length < 6) fail(400, 'A senha precisa ter pelo menos 6 caracteres.');

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) fail(409, 'Este e-mail já tem cadastro. Faça login para continuar.');

  const info = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, birthdate, role, notes, created_at)
    VALUES (?, ?, ?, ?, ?, 'client', '', ?)
  `).run(name, email, phone, hashPassword(password), birthdate, new Date().toISOString());

  const userId = Number(info.lastInsertRowid);
  const token = createSession(userId);
  setSessionCookie(res, token);
  notify({
    type: 'client:new', title: 'Nova cliente cadastrada',
    message: `${name} criou uma conta no site.`, clientId: userId
  });
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
});

app.post('/api/auth/login', (req, res) => {
  const body = req.body || {};
  const email = clean(body.email, 160).toLowerCase();
  const password = String(body.password || '');
  checkLoginRate(req, email);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    registerFailure(req, email);
    fail(401, 'E-mail ou senha incorretos.');
  }

  loginAttempts.delete(`${req.ip}:${email}`);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE_NAME}=`));
  if (match) destroySession(decodeURIComponent(match.split('=').slice(1).join('=')));
  clearSessionCookie(res);
  res.json({ ok: true });
});

/* ---------------- Site público ---------------- */
app.get('/api/site', (req, res) => {
  const services = db.prepare(`
    SELECT id, name, category, description, price, duration_min, maintenance_days
    FROM services WHERE active = 1 ORDER BY sort, id
  `).all();
  const portfolio = db.prepare('SELECT id, title, description, category, image FROM portfolio ORDER BY sort, id DESC').all();
  const contact = getSettings();
  res.json({
    business: {
      name: BUSINESS.name, shortName: BUSINESS.shortName, tagline: BUSINESS.tagline,
      eyebrow: BUSINESS.eyebrow, whatsapp: contact.whatsapp,
      whatsappDisplay: contact.whatsappDisplay, instagram: contact.instagram,
      email: contact.email, depositPercent: BUSINESS.depositPercent,
      cancelHours: BUSINESS.cancelHours, address: contact.address, hours: BUSINESS.hours
    },
    services, portfolio, categories: CATEGORIES
  });
});

app.get('/api/availability', (req, res) => {
  const date = String(req.query.date || '');
  const serviceId = Number(req.query.serviceId);
  if (!isISODate(date)) fail(400, 'Escolha uma data válida.');
  if (date < toISO()) fail(400, 'Essa data já passou.');
  const service = getService(serviceId);
  if (!service || !service.active) fail(404, 'Serviço não encontrado.');
  const hours = workingHours(date);
  const slots = slotsFor(date, service, getBusy(date));
  res.json({ date, serviceId, slots, hours, closed: !hours });
});

/* ---------------- Agendamentos ---------------- */
function createAppointmentRecord({
  clientId, service, date, time, notes = '', status = 'pendente',
  depositStatus = 'pendente', method = 'pix', source = 'online', enforceSlots = true
}) {
  if (!isISODate(date)) fail(400, 'Escolha uma data válida.');
  if (date < toISO()) fail(400, 'Escolha uma data a partir de hoje.');
  const normalized = normalizeTime(time);
  if (!normalized) fail(400, 'Escolha um horário válido.');

  if (enforceSlots) {
    const options = slotsFor(date, service, getBusy(date));
    if (!options.includes(normalized)) fail(409, 'Esse horário acabou de ser reservado. Escolha outro, por favor.');
  } else {
    if (!fitsHours(date, normalized, service.duration_min)) fail(400, 'Horário fora do funcionamento do estúdio.');
    if (hasConflict(date, normalized, service.duration_min, getBusy(date))) fail(409, 'Já existe um atendimento nesse horário.');
  }

  if (!['pendente', 'informado', 'pago'].includes(depositStatus)) depositStatus = 'pendente';
  const deposit = round2(service.price * BUSINESS.depositPercent / 100);
  const nowIso = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO appointments
    (client_id, service_id, date, time, duration_min, price, status, notes, deposit_amount,
     deposit_status, payment_method, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    clientId, service.id, date, normalized, service.duration_min, service.price,
    status, clean(notes, 1000), deposit, depositStatus, method || 'pix', source, nowIso, nowIso
  );
  const id = Number(info.lastInsertRowid);
  if (depositStatus === 'pago' || status === 'concluido') syncFinance(id);
  return getAppointment(id);
}

app.post('/api/appointments', requireAuth, (req, res) => {
  if (req.user.role !== 'client') fail(400, 'Use o painel do estúdio para criar agendamentos.');
  const body = req.body || {};
  const service = getService(body.serviceId);
  if (!service || !service.active) fail(404, 'Serviço não encontrado.');
  const appointment = createAppointmentRecord({
    clientId: req.user.id, service, date: String(body.date || ''), time: body.time,
    notes: body.notes, enforceSlots: true, status: 'pendente', source: 'online'
  });
  notify({
    type: 'appointment:created', title: 'Novo agendamento online',
    message: `${appointment.client_name} agendou ${appointment.service_name} para ${formatDateBR(appointment.date)} às ${appointment.time}.`,
    appointmentId: appointment.id, clientId: appointment.client_id
  });
  res.status(201).json({ appointment });
});

app.get('/api/my/appointments', requireAuth, (req, res) => {
  const rows = db.prepare(`${APPT_SELECT} WHERE a.client_id = ? ORDER BY a.date, a.time`).all(req.user.id);
  const today = toISO();
  const now = nowMinutes();
  const isUpcoming = row => ['pendente', 'confirmado'].includes(row.status)
    && (row.date > today || (row.date === today && toMinutes(row.time) > now));

  const upcoming = rows.filter(isUpcoming);
  const history = rows.filter(row => !isUpcoming(row)).reverse();

  const maintenanceMap = new Map();
  rows.forEach(row => {
    if (row.status !== 'concluido' || !row.maintenance_days) return;
    const current = maintenanceMap.get(row.service_id);
    if (!current || row.date > current.last_date) {
      maintenanceMap.set(row.service_id, {
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

  const completed = rows.filter(row => row.status === 'concluido');
  const stats = {
    visits: completed.length,
    spent: round2(completed.reduce((sum, row) => sum + Number(row.price), 0)),
    memberSince: req.user.created_at,
    upcoming: upcoming.length
  };

  res.json({ appointments: rows, upcoming, history, maintenance, stats, user: publicUser(req.user) });
});

app.post('/api/my/appointments/:id/cancel', requireAuth, (req, res) => {
  const appointment = getAppointment(req.params.id);
  if (!appointment || Number(appointment.client_id) !== Number(req.user.id)) fail(404, 'Agendamento não encontrado.');
  if (!['pendente', 'confirmado'].includes(appointment.status)) fail(400, 'Este agendamento não pode mais ser cancelado.');
  const start = new Date(`${appointment.date}T${appointment.time}:00`);
  const hours = (start.getTime() - Date.now()) / 3600000;
  if (hours < BUSINESS.cancelHours) {
    fail(400, `Cancelamentos online até ${BUSINESS.cancelHours}h antes do horário. Chame o estúdio no WhatsApp.`);
  }
  db.prepare("UPDATE appointments SET status = 'cancelado', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), appointment.id);
  notify({
    type: 'appointment:updated', title: 'Agendamento cancelado pela cliente',
    message: `${appointment.client_name} cancelou ${appointment.service_name} de ${formatDateBR(appointment.date)} às ${appointment.time}.`,
    appointmentId: appointment.id, clientId: appointment.client_id
  });
  res.json({ appointment: getAppointment(appointment.id) });
});

app.post('/api/my/appointments/:id/confirm', requireAuth, (req, res) => {
  const appointment = getAppointment(req.params.id);
  if (!appointment || Number(appointment.client_id) !== Number(req.user.id)) fail(404, 'Agendamento não encontrado.');
  if (appointment.status !== 'pendente') fail(400, 'Este agendamento já foi atualizado.');
  db.prepare("UPDATE appointments SET status = 'confirmado', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), appointment.id);
  notify({
    type: 'appointment:updated', title: 'Cliente confirmou presença',
    message: `${appointment.client_name} confirmou ${appointment.service_name} de ${formatDateBR(appointment.date)} às ${appointment.time}.`,
    appointmentId: appointment.id, clientId: appointment.client_id
  });
  res.json({ appointment: getAppointment(appointment.id) });
});

app.post('/api/my/appointments/:id/deposit', requireAuth, (req, res) => {
  const appointment = getAppointment(req.params.id);
  if (!appointment || Number(appointment.client_id) !== Number(req.user.id)) fail(404, 'Agendamento não encontrado.');
  if (appointment.deposit_status === 'pago') fail(400, 'O sinal deste agendamento já foi confirmado.');
  if (appointment.status === 'cancelado') fail(400, 'Este agendamento foi cancelado.');
  db.prepare("UPDATE appointments SET deposit_status = 'informado', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), appointment.id);
  notify({
    type: 'deposit:reported', title: 'Sinal informado pela cliente',
    message: `${appointment.client_name} informou o pagamento do sinal de ${appointment.service_name} (${formatDateBR(appointment.date)}). Confira o Pix e confirme no painel.`,
    appointmentId: appointment.id, clientId: appointment.client_id
  });
  res.json({ appointment: getAppointment(appointment.id) });
});

app.get('/api/deposit/:id/pix', requireAuth, wrap(async (req, res) => {
  const appointment = getAppointment(req.params.id);
  if (!appointment) fail(404, 'Agendamento não encontrado.');
  if (req.user.role !== 'admin' && Number(appointment.client_id) !== Number(req.user.id)) {
    fail(403, 'Sem acesso a este agendamento.');
  }
  if (appointment.status === 'cancelado') fail(400, 'Agendamento cancelado.');
  const amount = Number(appointment.deposit_amount);
  const payload = pixPayload({ amount, txid: `LUM${appointment.id}` });
  const qr = await pixQrDataUrl(payload);
  res.json({
    appointmentId: appointment.id, amount, payload, qr,
    depositStatus: appointment.deposit_status, pixKey: BUSINESS.pixKey,
    pixName: BUSINESS.pixName, serviceName: appointment.service_name,
    date: appointment.date, time: appointment.time
  });
}));

app.patch('/api/my/profile', requireAuth, (req, res) => {
  const body = req.body || {};
  const name = clean(body.name, 120);
  if (name.length < 2) fail(400, 'Escreva seu nome completo.');
  const phone = normalizePhone(body.phone);
  if (phone.length < 10 || phone.length > 11) fail(400, 'Confira o WhatsApp com DDD.');
  const birthdate = body.birthdate && isISODate(body.birthdate) ? body.birthdate : null;
  db.prepare('UPDATE users SET name = ?, phone = ?, birthdate = ? WHERE id = ?')
    .run(name, phone, birthdate, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

app.post('/api/my/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(currentPassword || ''), user.password_hash)) fail(400, 'A senha atual não confere.');
  if (String(newPassword || '').length < 6) fail(400, 'A nova senha precisa ter pelo menos 6 caracteres.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

/* ---------------- Admin: visão geral ---------------- */
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const date = isISODate(req.query.date) ? req.query.date : toISO();
  const today = toISO();
  const month = date.slice(0, 7);

  const dayAppointments = db.prepare(`${APPT_SELECT} WHERE a.date = ? ORDER BY a.time`).all(date);
  const upcoming = db.prepare(`
    ${APPT_SELECT}
    WHERE a.date >= ? AND a.status IN ('pendente','confirmado')
    ORDER BY a.date, a.time LIMIT 6
  `).all(date);

  const monthRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM finance WHERE kind = 'entrada' AND date LIKE ?").get(`${month}%`).total;
  const monthExpenses = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM finance WHERE kind = 'saida' AND date LIKE ?").get(`${month}%`).total;
  const pendingDeposits = db.prepare(`
    SELECT COUNT(*) AS n FROM appointments
    WHERE status IN ('pendente','confirmado') AND deposit_status != 'pago' AND date >= ?
  `).get(today).n;
  const newClients = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'client' AND created_at LIKE ?").get(`${month}%`).n;
  const completedMonth = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(price),0) AS total FROM appointments WHERE status = 'concluido' AND date LIKE ?").get(`${month}%`);
  const maintenance = maintenanceList();
  const maintenanceDue = maintenance.filter(item => item.daysLeft <= 7).length;
  const activeToday = dayAppointments.filter(row => !['cancelado', 'faltou'].includes(row.status));

  const chart = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = addDays(date, -i);
    const total = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM finance WHERE kind = 'entrada' AND date = ?").get(day).total;
    chart.push({ date: day, total: Number(total) });
  }

  const activity = db.prepare(`
    SELECT a.id, a.status, a.created_at, a.source, a.date, a.time,
           u.name AS client_name, s.name AS service_name
    FROM appointments a JOIN users u ON u.id = a.client_id JOIN services s ON s.id = a.service_id
    ORDER BY a.created_at DESC LIMIT 6
  `).all();

  res.json({
    date, stats: {
      todayCount: activeToday.length,
      todayExpected: round2(activeToday.reduce((sum, row) => sum + Number(row.price), 0)),
      monthRevenue: Number(monthRevenue),
      monthExpenses: Number(monthExpenses),
      monthProfit: round2(Number(monthRevenue) - Number(monthExpenses)),
      pendingDeposits,
      maintenanceDue,
      newClients,
      completedMonth: completedMonth.n,
      ticket: completedMonth.n ? round2(completedMonth.total / completedMonth.n) : 0
    },
    dayAppointments, upcoming, chart, activity, maintenance: maintenance.slice(0, 10),
    birthdays: birthdayList()
  });
});

/* ---------------- Admin: agenda ---------------- */
app.get('/api/admin/appointments', requireAdmin, (req, res) => {
  const { date, from, to, status } = req.query;
  const conditions = [];
  const params = [];
  if (isISODate(date)) {
    conditions.push('a.date = ?');
    params.push(date);
  } else {
    if (isISODate(from)) { conditions.push('a.date >= ?'); params.push(from); }
    if (isISODate(to)) { conditions.push('a.date <= ?'); params.push(to); }
  }
  if (STATUS.includes(status)) { conditions.push('a.status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`${APPT_SELECT} ${where} ORDER BY a.date, a.time LIMIT 500`).all(...params);
  res.json({ appointments: rows });
});

app.post('/api/admin/appointments', requireAdmin, (req, res) => {
  const body = req.body || {};
  const service = getService(body.serviceId);
  if (!service) fail(404, 'Serviço não encontrado.');
  const date = String(body.date || '');
  if (!isISODate(date)) fail(400, 'Escolha uma data válida.');

  let clientId = Number(body.clientId) || null;
  let clientAccess = null;
  let newClient = null;

  if (clientId) {
    const client = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'client'").get(clientId);
    if (!client) fail(404, 'Cliente não encontrada.');
  } else {
    const name = clean(body.clientName, 120);
    const email = clean(body.clientEmail, 160).toLowerCase();
    const phone = normalizePhone(body.clientPhone);
    const birthdate = body.clientBirthdate && isISODate(body.clientBirthdate) ? body.clientBirthdate : null;
    if (name.length < 2) fail(400, 'Informe o nome da cliente.');
    if (!isValidEmail(email)) fail(400, 'Informe um e-mail válido para a cliente.');
    if (phone.length < 10 || phone.length > 11) fail(400, 'Informe o WhatsApp com DDD.');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      fail(409, 'Já existe uma cliente com este e-mail. Selecione na lista.');
    }
    const password = String(body.clientPassword || '').length >= 6 ? String(body.clientPassword) : friendlyPassword(8);
    newClient = { name, email, phone, birthdate, password };
  }

  const status = STATUS.includes(body.status) ? body.status : 'confirmado';
  const depositStatus = ['pendente', 'informado', 'pago'].includes(body.depositStatus) ? body.depositStatus : 'pendente';
  let appointment;
  db.exec('BEGIN');
  try {
    if (newClient) {
      const info = db.prepare(`
        INSERT INTO users (name, email, phone, password_hash, birthdate, role, notes, created_at)
        VALUES (?, ?, ?, ?, ?, 'client', '', ?)
      `).run(newClient.name, newClient.email, newClient.phone, hashPassword(newClient.password), newClient.birthdate, new Date().toISOString());
      clientId = Number(info.lastInsertRowid);
      clientAccess = { email: newClient.email, password: newClient.password };
    }
    appointment = createAppointmentRecord({
      clientId, service, date, time: body.time, notes: body.notes,
      status, depositStatus, method: body.paymentMethod || 'pix', source: 'manual', enforceSlots: false
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  if (newClient) {
    notify({
      type: 'client:new', title: 'Nova cliente cadastrada',
      message: `${newClient.name} foi cadastrada pela agenda.`, clientId
    });
  }
  notify({
    type: 'appointment:created', title: 'Agendamento criado no estúdio',
    message: `${appointment.client_name} · ${appointment.service_name} · ${formatDateBR(date)} às ${appointment.time}.`,
    appointmentId: appointment.id, clientId
  });
  res.status(201).json({ appointment, clientAccess });
});

app.patch('/api/admin/appointments/:id', requireAdmin, (req, res) => {
  const appointment = getAppointment(req.params.id);
  if (!appointment) fail(404, 'Agendamento não encontrado.');
  const body = req.body || {};
  const updates = {};

  let date = appointment.date;
  let time = appointment.time;
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
    if (date >= toISO() && !fitsHours(date, time, appointment.duration_min)) {
      fail(400, 'Horário fora do funcionamento do estúdio.');
    }
    if (hasConflict(date, time, appointment.duration_min, getBusy(date, appointment.id), appointment.id)) {
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

  const columns = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  db.prepare(`UPDATE appointments SET ${columns}, updated_at = ? WHERE id = ?`)
    .run(...Object.values(updates), new Date().toISOString(), appointment.id);

  syncFinance(appointment.id);
  const updated = getAppointment(appointment.id);

  let message = `${updated.client_name} · ${updated.service_name}`;
  if (updates.status) message += ` — ${STATUS_LABEL[updates.status]}`;
  if (rescheduled) message += ` · remarcado para ${formatDateBR(updated.date)} às ${updated.time}`;
  if (updates.deposit_status === 'pago') message += ' · sinal confirmado';
  notify({
    type: 'appointment:updated', title: 'Agenda atualizada', message,
    appointmentId: updated.id, clientId: updated.client_id
  });
  res.json({ appointment: updated });
});

/* ---------------- Admin: clientes ---------------- */
app.get('/api/admin/clients', requireAdmin, (req, res) => {
  const q = clean(req.query.q, 100);
  const today = toISO();
  const params = [];
  let where = "u.role = 'client'";
  if (q) {
    where += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const clients = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, u.birthdate, u.notes, u.created_at,
      (SELECT COUNT(*) FROM appointments a WHERE a.client_id = u.id AND a.status = 'concluido') AS visits,
      (SELECT COALESCE(SUM(a.price),0) FROM appointments a WHERE a.client_id = u.id AND a.status = 'concluido') AS spent,
      (SELECT MAX(a.date) FROM appointments a WHERE a.client_id = u.id AND a.status = 'concluido') AS last_visit,
      (SELECT MIN(a.date) FROM appointments a WHERE a.client_id = u.id AND a.date >= ? AND a.status IN ('pendente','confirmado')) AS next_visit
    FROM users u
    WHERE ${where}
    ORDER BY u.name
  `).all(today, ...params);
  res.json({ clients });
});

app.post('/api/admin/clients', requireAdmin, (req, res) => {
  const body = req.body || {};
  const name = clean(body.name, 120);
  const email = clean(body.email, 160).toLowerCase();
  const phone = normalizePhone(body.phone);
  const birthdate = body.birthdate && isISODate(body.birthdate) ? body.birthdate : null;
  const notes = clean(body.notes, 1000);
  if (name.length < 2) fail(400, 'Informe o nome da cliente.');
  if (!isValidEmail(email)) fail(400, 'Informe um e-mail válido.');
  if (phone.length < 10 || phone.length > 11) fail(400, 'Informe o WhatsApp com DDD.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) fail(409, 'Já existe uma cliente com este e-mail.');

  const password = String(body.password || '').length >= 6 ? String(body.password) : friendlyPassword(8);
  const info = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, birthdate, role, notes, created_at)
    VALUES (?, ?, ?, ?, ?, 'client', ?, ?)
  `).run(name, email, phone, hashPassword(password), birthdate, notes, new Date().toISOString());
  const id = Number(info.lastInsertRowid);
  notify({ type: 'client:new', title: 'Nova cliente cadastrada', message: `${name} entrou na lista de clientes.`, clientId: id });
  res.status(201).json({
    client: db.prepare('SELECT id, name, email, phone, birthdate, notes, created_at FROM users WHERE id = ?').get(id),
    access: { email, password: body.password ? null : password }
  });
});

app.get('/api/admin/clients/:id', requireAdmin, (req, res) => {
  const client = db.prepare("SELECT id, name, email, phone, birthdate, notes, created_at FROM users WHERE id = ? AND role = 'client'").get(Number(req.params.id));
  if (!client) fail(404, 'Cliente não encontrada.');
  const appointments = db.prepare(`${APPT_SELECT} WHERE a.client_id = ? ORDER BY a.date DESC, a.time DESC`).all(client.id);
  const completed = appointments.filter(row => row.status === 'concluido');
  const today = toISO();
  const upcoming = appointments.filter(row => ['pendente', 'confirmado'].includes(row.status) && row.date >= today)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const stats = {
    visits: completed.length,
    spent: round2(completed.reduce((sum, row) => sum + Number(row.price), 0)),
    lastVisit: completed.length ? completed[0].date : null,
    upcoming: upcoming.length,
    ticket: completed.length ? round2(completed.reduce((sum, row) => sum + Number(row.price), 0) / completed.length) : 0
  };
  res.json({ client, appointments, upcoming, maintenance: maintenanceList(client.id), stats });
});

app.patch('/api/admin/clients/:id', requireAdmin, (req, res) => {
  const client = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'client'").get(Number(req.params.id));
  if (!client) fail(404, 'Cliente não encontrada.');
  const body = req.body || {};
  const name = body.name !== undefined ? clean(body.name, 120) : client.name;
  const phone = body.phone !== undefined ? normalizePhone(body.phone) : client.phone;
  const birthdate = body.birthdate !== undefined ? (isISODate(body.birthdate) ? body.birthdate : null) : client.birthdate;
  const notes = body.notes !== undefined ? clean(body.notes, 1000) : client.notes;
  if (name.length < 2) fail(400, 'Informe o nome da cliente.');
  if (phone.length < 10 || phone.length > 11) fail(400, 'Confira o WhatsApp com DDD.');
  db.prepare('UPDATE users SET name = ?, phone = ?, birthdate = ?, notes = ? WHERE id = ?')
    .run(name, phone, birthdate, notes, client.id);
  res.json({ client: db.prepare('SELECT id, name, email, phone, birthdate, notes, created_at FROM users WHERE id = ?').get(client.id) });
});

app.post('/api/admin/clients/:id/reset-password', requireAdmin, (req, res) => {
  const client = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'client'").get(Number(req.params.id));
  if (!client) fail(404, 'Cliente não encontrada.');
  const password = friendlyPassword(8);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), client.id);
  res.json({ password, email: client.email });
});

/* ---------------- Admin: serviços ---------------- */
app.get('/api/admin/services', requireAdmin, (req, res) => {
  const services = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM appointments a WHERE a.service_id = s.id) AS bookings
    FROM services s ORDER BY s.sort, s.name
  `).all();
  res.json({ services, categories: CATEGORIES });
});

app.post('/api/admin/services', requireAdmin, (req, res) => {
  const body = req.body || {};
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
  const max = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM services').get().n;
  const info = db.prepare(`
    INSERT INTO services (name, category, description, price, duration_min, maintenance_days, active, sort)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(name, category, description, price, duration, maintenance, max + 1);
  res.status(201).json({ service: db.prepare('SELECT * FROM services WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

app.patch('/api/admin/services/:id', requireAdmin, (req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(req.params.id));
  if (!service) fail(404, 'Serviço não encontrado.');
  const body = req.body || {};
  const name = body.name !== undefined ? clean(body.name, 120) : service.name;
  const category = body.category !== undefined ? body.category : service.category;
  const description = body.description !== undefined ? clean(body.description, 300) : service.description;
  const price = body.price !== undefined ? round2(body.price) : service.price;
  const duration = body.durationMin !== undefined ? Number(body.durationMin) : service.duration_min;
  const maintenance = body.maintenanceDays !== undefined ? Number(body.maintenanceDays) : service.maintenance_days;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : service.active;
  if (name.length < 2) fail(400, 'Informe o nome do serviço.');
  if (!Object.keys(CATEGORIES).includes(category)) fail(400, 'Categoria inválida.');
  if (!(price > 0)) fail(400, 'Informe um preço válido.');
  if (!(duration >= 10 && duration <= 600)) fail(400, 'Informe a duração em minutos.');
  if (!(maintenance >= 0 && maintenance <= 365)) fail(400, 'Informe o prazo de manutenção.');
  db.prepare(`
    UPDATE services SET name = ?, category = ?, description = ?, price = ?, duration_min = ?,
      maintenance_days = ?, active = ? WHERE id = ?
  `).run(name, category, description, price, duration, maintenance, active, service.id);
  res.json({ service: db.prepare('SELECT * FROM services WHERE id = ?').get(service.id) });
});

app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(req.params.id));
  if (!service) fail(404, 'Serviço não encontrado.');
  const used = db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE service_id = ?').get(service.id).n;
  if (used > 0) fail(409, 'Este serviço já tem atendimentos. Desative-o em vez de excluir.');
  db.prepare('DELETE FROM services WHERE id = ?').run(service.id);
  res.json({ ok: true });
});

/* ---------------- Admin: portfólio ---------------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'Envie uma imagem JPG, PNG ou WebP.'));
  }
});

app.get('/api/admin/portfolio', requireAdmin, (req, res) => {
  res.json({ portfolio: db.prepare('SELECT * FROM portfolio ORDER BY sort, id DESC').all() });
});

app.post('/api/admin/portfolio', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) fail(400, 'Escolha uma foto para publicar.');
  const title = clean(req.body.title, 120);
  const description = clean(req.body.description, 300);
  const category = Object.keys(CATEGORIES).includes(req.body.category) ? req.body.category : 'cilios';
  if (title.length < 2) {
    fs.unlink(req.file.path, () => {});
    fail(400, 'Dê um título para a foto.');
  }
  const max = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM portfolio').get().n;
  const info = db.prepare(`
    INSERT INTO portfolio (title, description, category, image, sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, description, category, `/uploads/${req.file.filename}`, max + 1, new Date().toISOString());
  notify({ type: 'portfolio:changed', title: 'Portfólio atualizado', message: `Nova foto publicada: ${title}.` });
  res.status(201).json({ item: db.prepare('SELECT * FROM portfolio WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

app.delete('/api/admin/portfolio/:id', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM portfolio WHERE id = ?').get(Number(req.params.id));
  if (!item) fail(404, 'Foto não encontrada.');
  db.prepare('DELETE FROM portfolio WHERE id = ?').run(item.id);
  if (item.image.startsWith('/uploads/')) {
    const filePath = path.join(UPLOADS_DIR, path.basename(item.image));
    fs.unlink(filePath, () => {});
  }
  notify({ type: 'portfolio:changed', title: 'Portfólio atualizado', message: `Foto removida: ${item.title}.` });
  res.json({ ok: true });
});

/* ---------------- Admin: financeiro ---------------- */
app.get('/api/admin/finance', requireAdmin, (req, res) => {
  const month = toISO().slice(0, 7);
  const from = isISODate(req.query.from) ? req.query.from : `${month}-01`;
  const to = isISODate(req.query.to) ? req.query.to : `${month}-31`;
  const entries = db.prepare(`
    SELECT f.*, a.date AS appointment_date, u.name AS client_name, s.name AS service_name
    FROM finance f
    LEFT JOIN appointments a ON a.id = f.appointment_id
    LEFT JOIN users u ON u.id = a.client_id
    LEFT JOIN services s ON s.id = a.service_id
    WHERE f.date BETWEEN ? AND ? ORDER BY f.date DESC, f.id DESC
  `).all(from, to);
  const income = round2(entries.filter(row => row.kind === 'entrada').reduce((sum, row) => sum + Number(row.amount), 0));
  const expense = round2(entries.filter(row => row.kind === 'saida').reduce((sum, row) => sum + Number(row.amount), 0));
  const deposits = round2(entries.filter(row => row.category === 'Sinal' && row.kind === 'entrada').reduce((sum, row) => sum + Number(row.amount), 0));
  res.json({ entries, summary: { income, expense, balance: round2(income - expense), deposits }, from, to });
});

app.post('/api/admin/finance', requireAdmin, (req, res) => {
  const body = req.body || {};
  const kind = body.kind === 'saida' ? 'saida' : 'entrada';
  const amount = round2(body.amount);
  const date = isISODate(body.date) ? body.date : toISO();
  const description = clean(body.description, 160);
  const category = clean(body.category, 60) || 'Outros';
  const method = ['pix', 'dinheiro', 'cartao', 'transferencia'].includes(body.method) ? body.method : 'pix';
  if (!(amount > 0)) fail(400, 'Informe um valor maior que zero.');
  if (description.length < 2) fail(400, 'Descreva o lançamento.');
  const info = db.prepare(`
    INSERT INTO finance (kind, amount, method, category, description, date, appointment_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(kind, amount, method, category, description, date, new Date().toISOString());
  notify({
    type: 'finance:changed', title: kind === 'entrada' ? 'Entrada lançada' : 'Despesa lançada',
    message: `${description} · ${kind === 'entrada' ? '+' : '−'} ${money(amount)}`
  });
  res.status(201).json({ entry: db.prepare('SELECT * FROM finance WHERE id = ?').get(Number(info.lastInsertRowid)) });
});

app.delete('/api/admin/finance/:id', requireAdmin, (req, res) => {
  const entry = db.prepare('SELECT * FROM finance WHERE id = ?').get(Number(req.params.id));
  if (!entry) fail(404, 'Lançamento não encontrado.');
  db.prepare('DELETE FROM finance WHERE id = ?').run(entry.id);
  notify({ type: 'finance:changed', title: 'Lançamento removido', message: `${entry.description} foi excluído do caixa.` });
  res.json({ ok: true });
});

/* ---------------- Admin: retornos e lembretes ---------------- */
app.get('/api/admin/maintenance', requireAdmin, (req, res) => {
  res.json({ maintenance: maintenanceList() });
});

app.get('/api/admin/reminders', requireAdmin, (req, res) => {
  const today = toISO();
  const tomorrow = addDays(today, 1);
  const tomorrowAppointments = db.prepare(`${APPT_SELECT} WHERE a.date = ? AND a.status IN ('pendente','confirmado') ORDER BY a.time`).all(tomorrow);
  const todayPending = db.prepare(`${APPT_SELECT} WHERE a.date = ? AND a.status = 'pendente' ORDER BY a.time`).all(today);
  const pendingDeposits = db.prepare(`
    ${APPT_SELECT} WHERE a.deposit_status != 'pago' AND a.status IN ('pendente','confirmado') AND a.date >= ?
    ORDER BY a.date, a.time
  `).all(today);
  res.json({
    tomorrowAppointments, todayPending, pendingDeposits,
    birthdays: birthdayList(), maintenance: maintenanceList(),
    business: { whatsapp: getSettings().whatsapp, name: BUSINESS.name }
  });
});

/* ---------------- Admin: contato e redes ---------------- */
app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  res.json({ settings: getSettings() });
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
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
  if (body.instagram !== undefined) {
    values.instagram = instagramHandle(body.instagram);
  }
  if (body.address !== undefined) {
    values.address = clean(body.address, 160);
  }

  if (!Object.keys(values).length) fail(400, 'Nenhuma alteração informada.');
  saveSettings(values);
  res.json({ settings: getSettings() });
});

/* ---------------- Estáticos ---------------- */
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get('/admin', (_req, res) => res.redirect('/admin.html'));
app.get('/agendar', (_req, res) => res.redirect('/agendar.html'));
app.get('/entrar', (_req, res) => res.redirect('/entrar.html'));
app.get('/minha-conta', (_req, res) => res.redirect('/minha-conta.html'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Recurso não encontrado.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'A imagem pode ter no máximo 8 MB.' : 'Não foi possível enviar a imagem.';
    return res.status(400).json({ error: message });
  }
  const status = err.status || 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || 'Não foi possível concluir a operação.' });
});

/* ---------------- Servidor + WebSocket ---------------- */
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());

const server = http.createServer(app);
wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const user = userFromRequest(req);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.user = user;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: 'connected', role: ws.user.role, userId: ws.user.id }));
});

const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
heartbeat.unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log(`  ${BUSINESS.name} — sistema no ar`);
  console.log(`  Site........: http://localhost:${PORT}`);
  console.log(`  Painel......: http://localhost:${PORT}/admin.html`);
  console.log(`  Admin.......: ${ADMIN.email}`);
  console.log(`  Cliente demo: ${DEMO_CLIENT.email} / ${DEMO_CLIENT.password}`);
  console.log('');
});
