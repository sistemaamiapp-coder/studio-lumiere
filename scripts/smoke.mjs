// Teste de fumaça: sobe o servidor, exercita as rotas principais e desliga.
// Roda com banco vazio (seed automático), então pode executar a qualquer momento.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ADMIN, DEMO_CLIENT } from '../server/config.js';

const PORT = Number(process.env.SMOKE_PORT) || 3179;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'smoke-admin-2026';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paula-souza-smoke-'));

let server;
let output = '';

function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), LUMIERE_DATA_DIR: dataDir, LUMIERE_ADMIN_PASSWORD: ADMIN_PASSWORD },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  server.on('exit', code => {
    if (code && code !== 0) output += `\n[servidor encerrou com código ${code}]`;
  });
}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/site`);
      if (res.ok) return;
    } catch { /* ainda subindo */ }
    await sleep(250);
  }
  throw new Error('O servidor não respondeu em 20s.');
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const setCookie = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie().map(entry => entry.split(';')[0]).join('; ')
    : res.headers.get('set-cookie')?.split(';')[0] || '';
  return { status: res.status, data, cookie: setCookie || cookie };
}

async function login(email, password) {
  const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 200, `login falhou para ${email}: ${JSON.stringify(res.data)}`);
  assert.ok(res.cookie, 'login não retornou cookie de sessão');
  return res.cookie;
}

function isoAddDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function main() {
  startServer();
  await waitForServer();

  const home = await call('/');
  assert.equal(home.status, 200);
  assert.match(home.data, /Paula Souza/);

  for (const page of ['/admin.html', '/agendar.html', '/entrar.html']) {
    const res = await call(page);
    assert.equal(res.status, 200, `${page} não abriu`);
  }

  const site = await call('/api/site');
  assert.equal(site.status, 200);
  assert.ok(site.data.services.length > 0, 'seed sem serviços');
  assert.ok(site.data.business.depositPercent > 0);

  const adminCookie = await login(ADMIN.email, ADMIN_PASSWORD);
  for (const path of ['/api/admin/overview', '/api/admin/clients', '/api/admin/services', '/api/admin/finance', '/api/admin/reminders', '/api/admin/maintenance']) {
    const res = await call(path, { cookie: adminCookie });
    assert.equal(res.status, 200, `${path} falhou: ${JSON.stringify(res.data)}`);
  }

  const settings = await call('/api/admin/settings', { cookie: adminCookie });
  assert.equal(settings.status, 200);
  assert.match(settings.data.settings.whatsappDisplay, /^\(\d{2}\) /);

  const saved = await call('/api/admin/settings', {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      whatsapp: '(11) 98888-7777',
      email: 'contato@paulasouza.com.br',
      instagram: 'https://instagram.com/studio.paula.teste',
      address: 'Rua das Flores, 123 · Vila Velha, ES'
    }
  });
  assert.equal(saved.status, 200, `salvar contato falhou: ${JSON.stringify(saved.data)}`);
  assert.equal(saved.data.settings.whatsapp, '5511988887777');
  assert.equal(saved.data.settings.instagram, 'studio.paula.teste');

  const siteAfter = await call('/api/site');
  assert.equal(siteAfter.data.business.whatsapp, '5511988887777');
  assert.equal(siteAfter.data.business.email, 'contato@paulasouza.com.br');
  assert.equal(siteAfter.data.business.instagram, 'studio.paula.teste');
  assert.equal(siteAfter.data.business.address, 'Rua das Flores, 123 · Vila Velha, ES');

  const badPhone = await call('/api/admin/settings', { method: 'PATCH', cookie: adminCookie, body: { whatsapp: '123' } });
  assert.equal(badPhone.status, 400, 'WhatsApp inválido deveria ser recusado');
  const badEmail = await call('/api/admin/settings', { method: 'PATCH', cookie: adminCookie, body: { email: 'sem-arroba' } });
  assert.equal(badEmail.status, 400, 'E-mail inválido deveria ser recusado');
  const clientSettings = await call('/api/admin/settings');
  assert.equal(clientSettings.status, 401, 'contato do site não pode ser lido sem login de admin');

  const clientCookie = await login(DEMO_CLIENT.email, DEMO_CLIENT.password);
  const mine = await call('/api/my/appointments', { cookie: clientCookie });
  assert.equal(mine.status, 200);

  const serviceId = site.data.services[0].id;
  let booking = null;
  for (let days = 1; days <= 8 && !booking; days += 1) {
    const date = isoAddDays(days);
    const availability = await call(`/api/availability?date=${date}&serviceId=${serviceId}`);
    if (availability.status !== 200 || availability.data.closed || !availability.data.slots.length) continue;
    const res = await call('/api/appointments', {
      method: 'POST',
      cookie: clientCookie,
      body: { serviceId, date, time: availability.data.slots[0], notes: 'Teste automatizado' }
    });
    assert.equal(res.status, 201, `agendamento falhou: ${JSON.stringify(res.data)}`);
    booking = res.data.appointment;
  }
  assert.ok(booking, 'nenhum dia aberto nos próximos 8 dias para agendar');

  const pix = await call(`/api/deposit/${booking.id}/pix`, { cookie: clientCookie });
  assert.equal(pix.status, 200);
  assert.ok(String(pix.data.payload).startsWith('000201'), 'payload Pix inválido');
  assert.ok(pix.data.qr.startsWith('data:image/'));

  const dayAppointments = await call(`/api/admin/appointments?from=${booking.date}&to=${booking.date}`, { cookie: adminCookie });
  assert.equal(dayAppointments.status, 200);
  assert.ok(dayAppointments.data.appointments.some(row => row.id === booking.id), 'agendamento não apareceu no painel');

  const confirmed = await call(`/api/admin/appointments/${booking.id}`, {
    method: 'PATCH', cookie: adminCookie, body: { status: 'confirmado' }
  });
  assert.equal(confirmed.status, 200, `confirmação falhou: ${JSON.stringify(confirmed.data)}`);
  assert.equal(confirmed.data.appointment.status, 'confirmado');

  const unauthorized = await call('/api/admin/overview');
  assert.equal(unauthorized.status, 401, 'rota de admin acessível sem login');

  console.log('OK — roteiro completo passou (site, login, agenda, Pix, painel).');
}

main()
  .catch(error => {
    console.error(error);
    if (output) console.error('\n--- saída do servidor ---\n' + output);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server && server.exitCode === null) {
      const closed = new Promise(resolve => server.once('exit', resolve));
      server.kill();
      await closed;
    }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* arquivo preso no Windows */ }
  });
