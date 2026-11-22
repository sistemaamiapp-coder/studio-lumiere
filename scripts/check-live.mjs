// Verifica o site publicado: páginas, API pública e (se houver senha) o painel.
// Uso: node scripts/check-live.mjs https://exemplo.workers.dev
import { readFileSync } from 'node:fs';

let url = process.argv[2] || process.env.DEPLOY_URL || '';
if (!url) {
  try { url = readFileSync(new URL('../.deploy-url', import.meta.url), 'utf8').trim(); } catch { /* sem arquivo */ }
}
url = url.replace(/\/+$/, '');
if (!url) {
  console.error('Informe o endereço publicado.');
  process.exit(1);
}

async function get(path, options = {}) {
  return fetch(url + path, { redirect: 'follow', ...options });
}

function expect(condition, label, detail = '') {
  if (condition) {
    console.log(`ok  ${label}`);
    return;
  }
  console.error(`FALHOU  ${label}${detail ? ` — ${detail}` : ''}`);
  process.exitCode = 1;
}

const home = await get('/');
const homeText = home.status === 200 ? await home.text() : '';
expect(home.status === 200 && homeText.includes('Paula Souza'), 'página inicial');

for (const page of ['/agendar', '/minha-conta', '/admin.html']) {
  const res = await get(page);
  expect(res.status === 200, `página ${page}`, `status ${res.status}`);
}

const site = await get('/api/site');
const siteData = site.status === 200 ? await site.json() : null;
expect(site.status === 200 && Array.isArray(siteData?.services) && siteData.services.length > 0, 'API pública com serviços');

const password = process.env.LUMIERE_ADMIN_PASSWORD || '';
if (password) {
  const login = await get('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'studio@paulasouza.com.br', password })
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  expect(login.status === 200 && cookie, 'login do painel');
  if (cookie) {
    const overview = await get('/api/admin/overview', { headers: { cookie } });
    expect(overview.status === 200, 'painel autenticado');
    await get('/api/auth/logout', { method: 'POST', headers: { cookie } });
  }
} else {
  console.log('aviso  senha do painel não informada; login não foi verificado');
}

if (process.exitCode) console.error('\nVerificação falhou.');
else console.log('\nTudo certo no ar.');
