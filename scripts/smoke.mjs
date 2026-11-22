// Teste de fumaça: sobe o servidor local (API = functions/routes.mjs com banco
// em memória), exercita os fluxos principais e desliga. Com SMOKE_TARGET
// (ex.: https://app.exemplo.com) testa um ambiente já publicado.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const TARGET = String(process.env.SMOKE_TARGET || '').replace(/\/+$/, '');
const PORT = Number(process.env.SMOKE_PORT) || 3179;
const BASE = TARGET || `http://127.0.0.1:${PORT}`;
const API = TARGET || `${BASE}/functions/v1/app`;
const ADMIN_EMAIL = 'studio@paulasouza.com.br';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || 'smoke-admin-2026';

let server;
let output = '';

function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), LUMIERE_ADMIN_PASSWORD: ADMIN_PASSWORD },
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
      const res = await fetch(`${API}/api/site`);
      if (res.ok) return;
    } catch { /* ainda subindo */ }
    await sleep(250);
  }
  throw new Error('O servidor não respondeu em 20s.');
}

async function call(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(API + path, {
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

async function page(path) {
  return fetch(BASE + path);
}

function isoAddDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function book({ name, phone, serviceId }) {
  for (let days = 1; days <= 10; days += 1) {
    const date = isoAddDays(days);
    const availability = await call(`/api/availability?date=${date}&serviceId=${serviceId}`);
    if (availability.status !== 200 || availability.data.closed || !availability.data.slots.length) continue;
    const res = await call('/api/appointments', {
      method: 'POST',
      body: { name, phone, serviceId, date, time: availability.data.slots[0], notes: 'Teste automatizado' }
    });
    assert.equal(res.status, 201, `agendamento falhou: ${JSON.stringify(res.data)}`);
    return res.data;
  }
  throw new Error('nenhum dia aberto nos próximos 10 dias para agendar');
}

async function main() {
  if (!TARGET) {
    startServer();
    await waitForServer();
  }

  for (const path of ['/', '/admin.html', '/agendar.html', '/minha-conta.html']) {
    const res = await page(path);
    assert.equal(res.status, 200, `${path} não abriu`);
  }

  const site = await call('/api/site');
  assert.equal(site.status, 200);
  assert.ok(site.data.services.length > 0, 'seed sem serviços');
  assert.ok(site.data.business.depositPercent > 0);

  const login = await call('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200, `login do painel falhou: ${JSON.stringify(login.data)}`);
  assert.ok(login.cookie, 'login não retornou cookie de sessão');
  const adminCookie = login.cookie;

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

  const identity = { name: 'Teste Automatizado Silva', phone: '21977776666' };
  const serviceId = site.data.services[0].id;
  const booking = await book({ ...identity, serviceId });
  assert.ok(booking.appointment?.id, 'agendamento sem id');
  assert.ok(String(booking.pix?.payload || '').startsWith('000201'), 'PIX inválido na resposta do agendamento');

  const wrongName = await call('/api/my/appointments', {
    method: 'POST',
    body: { name: 'Outra Pessoa', phone: identity.phone }
  });
  assert.equal(wrongName.status, 404, 'nome diferente deveria ser recusado');

  const mine = await call('/api/my/appointments', { method: 'POST', body: identity });
  assert.equal(mine.status, 200);
  assert.ok(mine.data.appointments.some(row => row.id === booking.appointment.id), 'agendamento não apareceu para a cliente');

  const pix = await call(`/api/deposit/${booking.appointment.id}/pix`, { method: 'POST', body: identity });
  assert.equal(pix.status, 200);
  assert.ok(String(pix.data.payload).startsWith('000201'), 'payload Pix inválido');

  const reported = await call(`/api/my/appointments/${booking.appointment.id}/deposit`, { method: 'POST', body: identity });
  assert.equal(reported.status, 200);
  assert.equal(reported.data.appointment.deposit_status, 'informado');

  const dayAppointments = await call(`/api/admin/appointments?from=${booking.appointment.date}&to=${booking.appointment.date}`, { cookie: adminCookie });
  assert.equal(dayAppointments.status, 200);
  assert.ok(dayAppointments.data.appointments.some(row => row.id === booking.appointment.id), 'agendamento não apareceu no painel');

  const confirmed = await call(`/api/admin/appointments/${booking.appointment.id}`, {
    method: 'PATCH', cookie: adminCookie, body: { status: 'confirmado' }
  });
  assert.equal(confirmed.status, 200, `confirmação falhou: ${JSON.stringify(confirmed.data)}`);
  assert.equal(confirmed.data.appointment.status, 'confirmado');

  const unauthorized = await call('/api/admin/overview');
  assert.equal(unauthorized.status, 401, 'rota de admin acessível sem login');

  const registerGone = await call('/api/auth/register', { method: 'POST', body: {} });
  assert.equal(registerGone.status, 404, 'cadastro de cliente com senha não deveria existir');

  console.log('OK — roteiro completo passou (site, agenda sem login, Pix, painel).');
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
  });
