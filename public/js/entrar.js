import { $, $$, icon, api, toast, setButtonBusy, waLink } from './ui.js';

function hydrateStaticIcons(root = document) {
  $$('[data-icon]', root).forEach(node => {
    node.innerHTML = icon(node.dataset.icon, Number(node.dataset.size || 18));
  });
}

function safeNext() {
  const next = new URLSearchParams(location.search).get('next') || '';
  if (!next.startsWith('/') || next.startsWith('//')) return '';
  return next;
}

function destinationFor(user) {
  if (user.role === 'admin') return '/admin';
  return safeNext() || '/minha-conta';
}

function setMode(mode) {
  $$('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === mode));
  $('#loginForm').hidden = mode !== 'login';
  $('#registerForm').hidden = mode !== 'register';
  $('#authTitle').innerHTML = mode === 'login' ? 'Entre na sua <em>conta</em>.' : 'Crie sua <em>conta</em>.';
  $('#authSub').textContent = mode === 'login'
    ? 'Acompanhe seus horários, retornos e histórico.'
    : 'Leva menos de um minuto. Depois é só escolher seu horário.';
  history.replaceState(null, '', `${location.pathname}${mode === 'register' ? '?modo=cadastro' : ''}`);
}

async function init() {
  hydrateStaticIcons();

  let site = null;
  try {
    site = await api('/api/site');
    $$('a[data-wa]').forEach(node => {
      node.href = waLink(site.business.whatsapp, 'Olá! Preciso de ajuda para acessar minha conta no site do Studio Lumière.');
      node.target = '_blank';
      node.rel = 'noopener';
    });
    const forgot = $('#forgotLink');
    if (forgot) forgot.href = waLink(site.business.whatsapp, 'Olá! Esqueci minha senha do site do Studio Lumière. Pode me ajudar a redefinir?');
  } catch { /* site info é opcional */ }

  const params = new URLSearchParams(location.search);
  if (params.get('modo') === 'cadastro') setMode('register');
  else setMode('login');

  const me = await api('/api/auth/me').catch(() => ({ user: null }));
  if (me.user) {
    location.replace(destinationFor(me.user));
    return;
  }

  $$('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => setMode(tab.dataset.tab));
  });

  $('#loginForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const errorBox = $('#loginError');
    errorBox.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    setButtonBusy(button, true, 'Entrando...');
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: data });
      toast(`Que bom te ver, ${user.name.split(' ')[0]}!`, { type: 'success' });
      location.assign(destinationFor(user));
    } catch (error) {
      errorBox.textContent = error.message;
      setButtonBusy(button, false);
    }
  });

  $('#registerForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const errorBox = $('#registerError');
    errorBox.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    setButtonBusy(button, true, 'Criando conta...');
    try {
      const { user } = await api('/api/auth/register', {
        method: 'POST',
        body: {
          name: data.name, email: data.email, phone: data.phone,
          password: data.password, birthdate: data.birthdate || null
        }
      });
      toast(`Conta criada, ${user.name.split(' ')[0]}!`, { type: 'success', title: 'Bem-vinda ao Lumière' });
      location.assign(destinationFor(user));
    } catch (error) {
      errorBox.textContent = error.message;
      setButtonBusy(button, false);
    }
  });
}

init();
