import {
  $, $$, esc, api, icon, money, todayISO, addDaysISO, dateLong, isoToDate,
  durationLabel, toast, setButtonBusy, copyText, waLink, waIcon, phoneDisplay, initials
} from './ui.js';

const state = {
  site: null,
  user: null,
  step: 1,
  service: null,
  date: null,
  time: null,
  slots: null,
  loadingSlots: false,
  slotsError: '',
  slotToken: 0,
  autoPicked: false,
  autoAttempts: 0,
  created: null,
  pix: null,
  authTab: 'register'
};

const GROUP_META = {
  cilios: { label: 'Cílios', note: 'Extensão, volume e lifting', glyph: 'sparkles' },
  unhas: { label: 'Unhas em gel', note: 'Alongamento e esmaltação em gel', glyph: 'sparkle' },
  manicure_pedicure: { label: 'Manicure & pedicure', note: 'Cuidado completo para mãos e pés', glyph: 'heart' }
};

function hydrateStaticIcons(root = document) {
  $$('[data-icon]', root).forEach(node => {
    node.innerHTML = icon(node.dataset.icon, Number(node.dataset.size || 18));
  });
}

function groupOf(service) {
  if (service.category === 'cilios') return 'cilios';
  if (service.category === 'unhas') return 'unhas';
  return 'manicure_pedicure';
}

function dateBrief(iso) {
  if (!iso) return '';
  const date = isoToDate(iso);
  const week = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${week}, ${day}/${month}`;
}

function monthShort(iso) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(isoToDate(iso)).replace('.', '');
}

function depositOf(service) {
  const pct = Number(state.site?.business?.depositPercent ?? 30);
  return Math.round(Number(service.price) * pct) / 100;
}

function toMin(time) {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

/* ---------------- header / static ---------------- */
function updateHeader() {
  const link = $('#headAccount');
  if (!link) return;
  if (state.user?.role === 'client') {
    link.textContent = 'Minha conta';
    link.href = '/minha-conta';
  } else if (state.user?.role === 'admin') {
    link.textContent = 'Painel';
    link.href = '/admin';
  } else {
    link.textContent = 'Entrar';
    link.href = '/entrar';
  }
  $$('a[data-wa]').forEach(node => {
    if (!state.site) return;
    node.href = waLink(state.site.business.whatsapp, 'Olá! Vim pelo site do Studio Lumière e tenho uma dúvida sobre o agendamento.');
    node.target = '_blank';
    node.rel = 'noopener';
  });
}

/* ---------------- stepper ---------------- */
function updateStepper() {
  $$('#stepper li').forEach(item => {
    const step = Number(item.dataset.step);
    item.classList.toggle('active', step === state.step);
    item.classList.toggle('done', step < state.step || state.step === 5);
  });
}

function goTo(step, { scroll = true } = {}) {
  state.step = step;
  $$('.step-panel').forEach(panel => {
    panel.hidden = Number(panel.dataset.panel) !== step;
  });
  updateStepper();
  renderSummary();

  if (step === 2) {
    if (!state.service) { goTo(1, { scroll }); return; }
    if (!state.date) {
      state.date = firstOpenDate();
      state.autoPicked = true;
      state.autoAttempts = 0;
    }
    renderDateStrip();
    if (!state.slots && !state.loadingSlots) loadSlots();
  }
  if (step === 3) renderIdentify();
  if (step === 4) renderConfirm();
  if (step === 5) renderSuccess();

  if (scroll) {
    const target = $('.booking-main');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ---------------- serviços ---------------- */
function serviceCard(service) {
  const isSelected = state.service?.id === service.id;
  const meta = GROUP_META[groupOf(service)];
  return `
    <button type="button" class="service-option ${isSelected ? 'selected' : ''}" data-service="${service.id}">
      <span class="service-mark">${icon(meta.glyph, 20)}</span>
      <span class="service-info">
        <span class="service-name">${esc(service.name)}</span>
        <span class="service-desc">${esc(service.description || '')}</span>
        <span class="service-meta">
          <span class="chip">${icon('clock', 13)} ${durationLabel(service.duration_min)}</span>
          ${service.maintenance_days ? `<span class="chip">${icon('repeat', 13)} retorno em ${service.maintenance_days} dias</span>` : ''}
        </span>
      </span>
      <span class="service-side">
        <span class="service-price">${money(service.price)}</span>
        <span class="service-pick">${isSelected ? 'Selecionado' : 'Escolher'} ${icon('arrowRight', 14)}</span>
      </span>
    </button>`;
}

function renderServices() {
  const wrap = $('#serviceList');
  if (!state.site) return;
  const groups = ['cilios', 'unhas', 'manicure_pedicure'];
  wrap.innerHTML = groups.map(key => {
    const items = state.site.services.filter(service => groupOf(service) === key);
    if (!items.length) return '';
    return `
      <div class="service-group">
        <div class="group-label"><span>${GROUP_META[key].label}</span><em>${GROUP_META[key].note}</em></div>
        <div class="service-group-list">${items.map(serviceCard).join('')}</div>
      </div>`;
  }).join('');

  $$('.service-option', wrap).forEach(button => {
    button.addEventListener('click', () => chooseService(Number(button.dataset.service)));
  });
}

function chooseService(id) {
  const service = state.site.services.find(item => item.id === id);
  if (!service) return;
  state.service = service;
  state.time = null;
  state.slots = null;
  state.slotsError = '';
  if (state.date && !isOpenDay(state.date)) state.date = null;
  renderServices();
  renderSummary();
  goTo(2);
}

/* ---------------- datas e horários ---------------- */
function isOpenDay(iso) {
  const hours = state.site?.business?.hours || {};
  const dow = String(isoToDate(iso).getDay());
  return Boolean(hours[dow]);
}

function firstOpenDate() {
  const start = todayISO();
  for (let i = 0; i < 30; i += 1) {
    const iso = addDaysISO(start, i);
    if (isOpenDay(iso)) return iso;
  }
  return start;
}

function renderDateStrip() {
  const strip = $('#dateStrip');
  if (!strip) return;
  const start = todayISO();
  const days = Array.from({ length: 21 }, (_, i) => addDaysISO(start, i));
  strip.innerHTML = `
    <button class="date-nav" type="button" data-scroll="-1" aria-label="Dias anteriores">${icon('chevronLeft', 16)}</button>
    <div class="date-track" id="dateTrack">
      ${days.map(iso => {
        const date = isoToDate(iso);
        const open = isOpenDay(iso);
        const selected = iso === state.date;
        const isToday = iso === start;
        return `
          <button type="button" class="date-btn ${selected ? 'selected' : ''} ${open ? '' : 'closed'}" data-date="${iso}" ${open ? '' : 'disabled'}>
            <span class="dow">${isToday ? 'hoje' : new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '')}</span>
            <strong>${String(date.getDate()).padStart(2, '0')}</strong>
            <span class="mon">${monthShort(iso)}</span>
            ${open ? '' : '<i class="date-off">fechado</i>'}
          </button>`;
      }).join('')}
    </div>
    <button class="date-nav" type="button" data-scroll="1" aria-label="Próximos dias">${icon('chevronRight', 16)}</button>`;

  $$('.date-btn', strip).forEach(button => {
    button.addEventListener('click', () => chooseDate(button.dataset.date));
  });
  $$('.date-nav', strip).forEach(button => {
    button.addEventListener('click', () => {
      const track = $('#dateTrack');
      if (track) track.scrollBy({ left: Number(button.dataset.scroll) * 320, behavior: 'smooth' });
    });
  });

  const active = $('.date-btn.selected', strip);
  if (active) {
    requestAnimationFrame(() => active.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
}

function chooseDate(iso) {
  if (!iso || iso === state.date) return;
  state.date = iso;
  state.time = null;
  state.slots = null;
  state.slotsError = '';
  state.autoPicked = false;
  state.autoAttempts = 0;
  renderDateStrip();
  renderSummary();
  loadSlots();
}

async function loadSlots() {
  if (!state.date || !state.service) return;
  const token = ++state.slotToken;
  state.loadingSlots = true;
  state.slots = null;
  state.slotsError = '';
  renderSlots();
  try {
    const data = await api(`/api/availability?date=${state.date}&serviceId=${state.service.id}`);
    if (token !== state.slotToken) return;
    state.slots = data;

    if (!data.closed && !data.slots.length && state.autoPicked && state.autoAttempts < 5) {
      const next = nextOpenDate(state.date);
      if (next) {
        state.autoAttempts += 1;
        state.date = next;
        renderDateStrip();
        renderSummary();
        loadSlots();
        return;
      }
    }
  } catch (error) {
    if (token !== state.slotToken) return;
    state.slotsError = error.message;
  } finally {
    if (token === state.slotToken) {
      state.loadingSlots = false;
      renderSlots();
    }
  }
}

function nextOpenDate(afterIso) {
  for (let i = 1; i <= 30; i += 1) {
    const iso = addDaysISO(afterIso, i);
    if (isOpenDay(iso)) return iso;
  }
  return null;
}

function renderSlots() {
  const area = $('#slotArea');
  const hint = $('#slotHint');
  if (!area) return;
  if (hint) hint.textContent = state.service
    ? `${state.service.name} · ${durationLabel(state.service.duration_min)} · horários livres em tempo real.`
    : 'Horários livres atualizados em tempo real.';

  if (!state.date) {
    area.innerHTML = `<div class="loading-row"><span class="spinner"></span> Escolhendo o próximo dia aberto...</div>`;
    return;
  }

  if (state.loadingSlots) {
    area.innerHTML = `
      <div class="slots-head"><h3>${dateLong(state.date)}</h3><span class="small muted">carregando...</span></div>
      <div class="slot-grid">${Array.from({ length: 8 }, () => '<span class="slot-skel"></span>').join('')}</div>`;
    return;
  }

  if (state.slotsError) {
    area.innerHTML = `<div class="empty-state"><div class="empty-glyph">${icon('alert', 24)}</div>
      <h3>Não foi possível carregar</h3><p>${esc(state.slotsError)}</p>
      <button class="btn btn-outline btn-sm" id="retrySlots">Tentar de novo</button></div>`;
    $('#retrySlots')?.addEventListener('click', loadSlots);
    return;
  }

  const data = state.slots;
  const next = nextOpenDate(state.date);

  if (data?.closed) {
    area.innerHTML = `<div class="empty-state"><div class="empty-glyph">${icon('calendar', 24)}</div>
      <h3>Estúdio fechado neste dia</h3><p>Escolha outro dia na faixa acima — ou veja o próximo dia aberto.</p>
      ${next ? `<button class="btn btn-outline btn-sm" data-next="${next}">Ver ${dateBrief(next)}</button>` : ''}</div>`;
  } else if (!data?.slots?.length) {
    area.innerHTML = `<div class="empty-state"><div class="empty-glyph">${icon('clock', 24)}</div>
      <h3>Este dia está completo</h3><p>Os horários de ${dateBrief(state.date)} já foram preenchidos ou não há tempo hábil para hoje.</p>
      ${next ? `<button class="btn btn-outline btn-sm" data-next="${next}">Ver ${dateBrief(next)}</button>` : ''}</div>`;
  } else {
    const periods = [
      { key: 'Manhã', slots: [] },
      { key: 'Tarde', slots: [] },
      { key: 'Noite', slots: [] }
    ];
    data.slots.forEach(time => {
      const minutes = toMin(time);
      const period = minutes < 12 * 60 ? periods[0] : minutes < 18 * 60 ? periods[1] : periods[2];
      period.slots.push(time);
    });

    area.innerHTML = `
      <div class="slots-head">
        <h3>${dateLong(state.date)}</h3>
        <span class="small muted">${data.hours ? `${data.hours[0]} às ${data.hours[1]}` : ''} · ${data.slots.length} horário${data.slots.length > 1 ? 's' : ''} livre${data.slots.length > 1 ? 's' : ''}</span>
      </div>
      ${periods.filter(period => period.slots.length).map(period => `
        <div class="slot-period">
          <span class="slot-period-label">${period.key}</span>
          <div class="slot-grid">
            ${period.slots.map(time => `
              <button type="button" class="slot-btn ${state.time === time ? 'selected' : ''}" data-time="${time}">
                ${time}
                <em>até ${endTime(time, state.service.duration_min)}</em>
              </button>`).join('')}
          </div>
        </div>`).join('')}`;
  }

  $$('[data-next]', area).forEach(button => {
    button.addEventListener('click', () => chooseDate(button.dataset.next));
  });
  $$('.slot-btn', area).forEach(button => {
    button.addEventListener('click', () => chooseTime(button.dataset.time));
  });
}

function endTime(time, duration) {
  const total = toMin(time) + Number(duration || 0);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function chooseTime(time) {
  state.time = time;
  renderSummary();
  $$('.slot-btn').forEach(button => button.classList.toggle('selected', button.dataset.time === time));
  if (state.user?.role === 'client') goTo(4);
  else goTo(3);
}

/* ---------------- resumo lateral ---------------- */
function renderSummary() {
  const body = $('#summaryBody');
  if (!body) return;
  const service = state.service;
  if (!service) {
    body.innerHTML = `
      <div class="summary-empty">
        <div class="summary-empty-glyph">${icon('calendar', 26)}</div>
        <strong>Seu horário aparece aqui</strong>
        <p>Escolha o serviço, o dia e a hora. Em seguida é só confirmar.</p>
      </div>`;
    return;
  }
  const deposit = depositOf(service);
  body.innerHTML = `
    <div class="summary-service">
      <span class="summary-mark">${icon(GROUP_META[groupOf(service)].glyph, 19)}</span>
      <div class="summary-service-text">
        <strong>${esc(service.name)}</strong>
        <span>${durationLabel(service.duration_min)} · ${GROUP_META[groupOf(service)].label}</span>
      </div>
    </div>
    <div class="summary-divider"></div>
    <ul class="summary-rows">
      <li><span>${icon('calendar', 15)} Data</span><strong class="${state.date ? '' : 'soft'}">${state.date ? dateBrief(state.date) : 'A escolher'}</strong></li>
      <li><span>${icon('clock', 15)} Horário</span><strong class="${state.time ? '' : 'soft'}">${state.time ? `${state.time} — ${endTime(state.time, service.duration_min)}` : 'A escolher'}</strong></li>
      <li><span>${icon('pix', 15)} Valor</span><strong>${money(service.price)}</strong></li>
    </ul>
    <div class="summary-total">
      <span>Sinal via Pix<em>garante o horário</em></span>
      <strong>${money(deposit)}</strong>
    </div>
    <p class="summary-note">O restante (${money(Number(service.price) - deposit)}) é pago no dia do atendimento.</p>`;
}

/* ---------------- identificação ---------------- */
function renderIdentify() {
  const area = $('#identifyArea');
  if (!area) return;

  if (state.user?.role === 'client') {
    const user = state.user;
    area.innerHTML = `
      <div class="account-card">
        <div class="account-person">
          <span class="avatar">${esc(initials(user.name))}</span>
          <div>
            <strong>${esc(user.name)}</strong>
            <span>${esc(user.email)}</span>
            <span>${esc(phoneDisplay(user.phone))}</span>
          </div>
          <span class="chip chip-pago">${icon('check', 12)} Conta verificada</span>
        </div>
        <p class="form-note">O agendamento entra direto no seu histórico, com acompanhamento de manutenção e lembretes.</p>
      </div>
      <div class="identify-actions">
        <button class="btn btn-quiet" id="switchAccount" type="button">Usar outra conta</button>
        <button class="btn btn-primary btn-lg" id="identifyContinue" type="button">Continuar ${icon('arrowRight', 16)}</button>
      </div>`;
    $('#identifyContinue')?.addEventListener('click', () => goTo(4));
    $('#switchAccount')?.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      state.user = null;
      updateHeader();
      renderIdentify();
    });
    return;
  }

  if (state.user?.role === 'admin') {
    area.innerHTML = `
      <div class="empty-state">
        <div class="empty-glyph">${icon('lock', 24)}</div>
        <h3>Você está no modo administrador</h3>
        <p>Para criar um horário para uma cliente, use a agenda do painel. Ou saia da conta para agendar como cliente.</p>
        <div class="identify-actions">
          <a class="btn btn-primary btn-sm" href="/admin">Abrir painel</a>
          <button class="btn btn-outline btn-sm" id="switchAccount" type="button">Sair da conta</button>
        </div>
      </div>`;
    $('#switchAccount')?.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      state.user = null;
      updateHeader();
      renderIdentify();
    });
    return;
  }

  const tabs = `
    <div class="auth-tabs" role="tablist">
      <button type="button" class="auth-tab ${state.authTab === 'register' ? 'active' : ''}" data-tab="register" role="tab">Criar conta</button>
      <button type="button" class="auth-tab ${state.authTab === 'login' ? 'active' : ''}" data-tab="login" role="tab">Já tenho conta</button>
    </div>`;

  const registerPanel = `
    <form id="registerForm" class="auth-form form-grid" ${state.authTab === 'register' ? '' : 'hidden'}>
      <div class="field">
        <label for="regName">Nome completo</label>
        <input class="input" id="regName" name="name" autocomplete="name" placeholder="Como podemos te chamar?" required>
      </div>
      <div class="form-row">
        <div class="field">
          <label for="regPhone">WhatsApp com DDD</label>
          <input class="input" id="regPhone" name="phone" inputmode="tel" autocomplete="tel" placeholder="(27) 99999-0000" required>
        </div>
        <div class="field">
          <label for="regBirth">Aniversário <span class="hint">(opcional)</span></label>
          <input class="input" id="regBirth" name="birthdate" type="date">
        </div>
      </div>
      <div class="field">
        <label for="regEmail">E-mail</label>
        <input class="input" id="regEmail" name="email" type="email" autocomplete="email" placeholder="voce@email.com" required>
      </div>
      <div class="field">
        <label for="regPass">Senha</label>
        <input class="input" id="regPass" name="password" type="password" autocomplete="new-password" placeholder="Pelo menos 6 caracteres" minlength="6" required>
        <span class="hint">Usada para acessar seu histórico e gerenciar horários.</span>
      </div>
      <div class="field">
        <label class="checkbox"><input type="checkbox" name="terms" required> Concordo em receber lembretes do estúdio pelo WhatsApp.</label>
      </div>
      <p class="field-error" id="registerError" role="alert"></p>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Criar conta e continuar ${icon('arrowRight', 16)}</button>
      <p class="form-note center">Já é cliente? <button type="button" class="text-link" data-tab="login">Entrar na minha conta</button></p>
    </form>`;

  const loginPanel = `
    <form id="loginForm" class="auth-form form-grid" ${state.authTab === 'login' ? '' : 'hidden'}>
      <div class="field">
        <label for="loginEmail">E-mail</label>
        <input class="input" id="loginEmail" name="email" type="email" autocomplete="email" placeholder="voce@email.com" required>
      </div>
      <div class="field">
        <label for="loginPass">Senha</label>
        <input class="input" id="loginPass" name="password" type="password" autocomplete="current-password" required>
      </div>
      <p class="field-error" id="loginError" role="alert"></p>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Entrar e continuar ${icon('arrowRight', 16)}</button>
      <p class="form-note center"><a class="text-link" id="forgotLink" href="#" target="_blank" rel="noopener">Esqueci minha senha</a> · <button type="button" class="text-link" data-tab="register">Criar uma conta</button></p>
    </form>`;

  area.innerHTML = `<div class="auth-card">${tabs}${registerPanel}${loginPanel}</div>`;

  $$('[data-tab]', area).forEach(button => {
    button.addEventListener('click', () => {
      state.authTab = button.dataset.tab;
      renderIdentify();
    });
  });

  const forgot = $('#forgotLink');
  if (forgot) {
    forgot.href = waLink(state.site.business.whatsapp, 'Olá! Esqueci minha senha do site do Studio Lumière e preciso de ajuda para acessar minha conta.');
  }

  $('#registerForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const errorBox = $('#registerError');
    errorBox.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    setButtonBusy(button, true, 'Criando conta...');
    try {
      const result = await api('/api/auth/register', {
        method: 'POST',
        body: { name: data.name, email: data.email, phone: data.phone, password: data.password, birthdate: data.birthdate || null }
      });
      state.user = result.user;
      updateHeader();
      toast(`Conta criada, ${result.user.name.split(' ')[0]}! Agora confirme seu horário.`, { type: 'success', title: 'Bem-vinda ao Lumière' });
      goTo(4);
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      setButtonBusy(button, false);
    }
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
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: { email: data.email, password: data.password }
      });
      state.user = result.user;
      updateHeader();
      toast(`Que bom te ver, ${result.user.name.split(' ')[0]}!`, { type: 'success' });
      goTo(4);
    } catch (error) {
      errorBox.textContent = error.message;
    } finally {
      setButtonBusy(button, false);
    }
  });
}

/* ---------------- confirmação ---------------- */
function renderConfirm() {
  const area = $('#confirmArea');
  if (!area) return;
  if (!state.service || !state.date || !state.time) {
    area.innerHTML = `<p class="form-note">Escolha serviço, dia e horário para continuar.</p>`;
    return;
  }
  const service = state.service;
  const deposit = depositOf(service);
  const user = state.user;
  area.innerHTML = `
    <div class="confirm-card">
      <div class="confirm-head">
        <span class="glyph-soft">${icon(GROUP_META[groupOf(service)].glyph, 20)}</span>
        <div>
          <strong>${esc(service.name)}</strong>
          <span>${durationLabel(service.duration_min)} · ${GROUP_META[groupOf(service)].label}</span>
        </div>
        <span class="confirm-price">${money(service.price)}</span>
      </div>
      <ul class="confirm-list">
        <li>${icon('calendar', 16)}<span><em>Data</em><strong>${dateLong(state.date)}</strong></span></li>
        <li>${icon('clock', 16)}<span><em>Horário</em><strong>${state.time} — ${endTime(state.time, service.duration_min)}</strong></span></li>
        ${user ? `<li>${icon('user', 16)}<span><em>Cliente</em><strong>${esc(user.name)} · ${esc(phoneDisplay(user.phone) || '')}</strong></span></li>` : ''}
      </ul>
      <label class="field">
        <span class="field-label">Alguma observação? <span class="hint">(opcional)</span></span>
        <textarea class="textarea" id="bookingNotes" maxlength="500" placeholder="Ex.: primeira vez com cílios, unha quebrada, alergia a algum produto..."></textarea>
      </label>
      <div class="deposit-box">
        <div class="deposit-box-head">
          <span class="glyph-soft pix">${icon('pix', 18)}</span>
          <div><strong>Sinal para garantir o horário</strong><span>Pague via Pix agora ou no dia, combinando no WhatsApp.</span></div>
          <b>${money(deposit)}</b>
        </div>
        <p class="form-note">Restante de ${money(Number(service.price) - deposit)} no dia do atendimento. Cancelamento online até ${state.site.business.cancelHours}h antes.</p>
      </div>
      <button class="btn btn-primary btn-lg btn-block" id="confirmBtn" type="button">Confirmar agendamento ${icon('arrowRight', 17)}</button>
      <p class="form-note center">Ao confirmar, seu horário fica bloqueado na agenda do estúdio.</p>
    </div>`;

  $('#confirmBtn')?.addEventListener('click', submitBooking);
}

async function submitBooking() {
  const button = $('#confirmBtn');
  if (!button || !state.service || !state.date || !state.time) return;
  const notes = $('#bookingNotes')?.value || '';
  setButtonBusy(button, true, 'Reservando...');
  try {
    const { appointment } = await api('/api/appointments', {
      method: 'POST',
      body: { serviceId: state.service.id, date: state.date, time: state.time, notes }
    });
    state.created = appointment;
    await loadPix();
    goTo(5);
  } catch (error) {
    if (error.status === 409) {
      toast(error.message, { type: 'error', title: 'Horário indisponível' });
      state.time = null;
      state.slots = null;
      goTo(2);
      loadSlots();
    } else {
      toast(error.message, { type: 'error' });
    }
  } finally {
    setButtonBusy(button, false);
  }
}

/* ---------------- sucesso + Pix ---------------- */
async function loadPix() {
  if (!state.created) return;
  try {
    state.pix = await api(`/api/deposit/${state.created.id}/pix`);
  } catch {
    state.pix = null;
  }
}

function renderSuccess() {
  const area = $('#successArea');
  if (!area) return;
  const appointment = state.created;
  if (!appointment) { area.innerHTML = ''; return; }
  const service = state.service;
  const paid = appointment.deposit_status;
  const pix = state.pix;
  const depositAmount = pix?.amount ?? Number(appointment.deposit_amount ?? depositOf(service));
  const price = Number(appointment.price ?? service.price);
  const ticketNumber = `LUM-${String(appointment.id).padStart(4, '0')}`;
  const firstName = String(state.user?.name || '').split(' ')[0];

  const waMessage = [
    `Olá, Studio Lumière! Sou ${state.user?.name || ''}.`,
    `Acabei de agendar ${service.name} para ${dateLong(appointment.date)} às ${appointment.time} (${ticketNumber}).`,
    `Sinal de ${money(depositAmount)} via Pix. Pode confirmar meu horário?`
  ].join(' ');

  const statusChip = paid === 'pago'
    ? `<span class="chip chip-pago">${icon('check', 12)} Sinal confirmado</span>`
    : paid === 'informado'
      ? `<span class="chip chip-informado">${icon('clock', 12)} Sinal em conferência</span>`
      : `<span class="chip chip-pendente">${icon('pix', 12)} Sinal pendente</span>`;

  const pixBlock = paid === 'pago' ? `
    <div class="pix-done">
      ${icon('checkCircle', 22)}
      <div><strong>Sinal confirmado pelo estúdio</strong><span>Seu horário está garantido. Até lá!</span></div>
    </div>` : `
    <div class="pix-panel">
      <div class="pix-panel-head">
        <span class="glyph-soft pix">${icon('pix', 20)}</span>
        <div class="pix-panel-title">
          <strong>Pague o sinal via Pix</strong>
          <span>${money(depositAmount)} · ${pix ? esc(pix.pixName) : esc(state.site.business.name)}</span>
        </div>
        ${statusChip}
      </div>
      <div class="pix-layout">
        ${pix?.qr ? `<div class="pix-qr"><img src="${pix.qr}" alt="QR Code para pagamento do sinal via Pix"></div>` : `<div class="pix-qr pix-qr-empty">${icon('pix', 34)}<span>Use a chave ao lado</span></div>`}
        <div class="pix-info">
          <div class="pix-key"><span>Chave Pix</span><strong>${esc(pix?.pixKey || state.site.business.pixKey)}</strong></div>
          ${pix?.payload ? `<div class="pix-copy">
            <label class="field-label" for="pixPayload">Pix copia e cola</label>
            <div class="pix-code-row">
              <input class="input pix-payload" id="pixPayload" readonly value="${esc(pix.payload)}">
              <button class="btn btn-outline btn-sm" id="copyPix" type="button">${icon('copy', 14)} Copiar</button>
            </div>
          </div>` : ''}
          <div class="pix-actions">
            ${paid === 'informado'
              ? `<span class="pix-wait">${icon('clock', 15)} Aviso enviado. O estúdio confirma o recebimento.</span>`
              : `<button class="btn btn-primary btn-sm" id="paidPix" type="button">${icon('check', 15)} Já fiz o Pix</button>`}
            <a class="btn btn-outline btn-sm" href="${waLink(state.site.business.whatsapp, waMessage)}" target="_blank" rel="noopener">${waIcon(15)} Enviar comprovante</a>
          </div>
        </div>
      </div>
      <p class="form-note">${paid === 'informado'
        ? 'Seu aviso chegou ao painel do estúdio. A confirmação pode levar alguns minutos.'
        : 'Depois de pagar, toque em “Já fiz o Pix” para avisar o estúdio. A confirmação chega no seu WhatsApp.'}</p>
    </div>`;

  area.innerHTML = `
    <div class="success-hero">
      <div class="success-check">${icon('check', 26)}</div>
      <span class="eyebrow"><span class="dot"></span> Agendamento reservado</span>
      <h2>Prontinho${firstName ? `, ${esc(firstName)}` : ''}. <em>Seu horário é seu.</em></h2>
      <p class="lead">O horário já está bloqueado na agenda do estúdio. ${paid === 'pago' ? 'Está tudo certo — te esperamos!' : 'Garanta a vaga com o sinal via Pix.'}</p>
    </div>

    <div class="ticket">
      <div class="ticket-head">
        <div>
          <span class="ticket-code">${ticketNumber}</span>
          <strong>${esc(service.name)}</strong>
        </div>
        <span class="ticket-price">${money(price)}</span>
      </div>
      <div class="ticket-grid">
        <div><span>${icon('calendar', 14)} Data</span><strong>${dateBrief(appointment.date)}</strong></div>
        <div><span>${icon('clock', 14)} Horário</span><strong>${appointment.time}</strong></div>
        <div><span>${icon('pix', 14)} Sinal</span><strong>${money(depositAmount)}</strong></div>
      </div>
      <div class="ticket-foot">
        ${statusChip}
        <span class="small muted">Cancelamento online até ${state.site.business.cancelHours}h antes.</span>
      </div>
    </div>

    ${pixBlock}

    <div class="success-actions">
      <a class="btn btn-primary" href="/minha-conta">${icon('calendar', 16)} Ver meus agendamentos</a>
      <a class="btn btn-outline" href="/agendar" id="newBooking">Agendar outro horário</a>
    </div>
    <div class="success-foot">
      <span>${icon('pin', 14)} ${esc(state.site.business.address || '')}</span>
      <span>${icon('clock', 14)} Te esperamos com 10 minutos de antecedência, se puder.</span>
    </div>`;

  $('#copyPix')?.addEventListener('click', async () => {
    if (!pix?.payload) return;
    await copyText(pix.payload);
    toast('Código Pix copiado. Cole no seu banco para pagar.', { type: 'success' });
  });

  $('#paidPix')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setButtonBusy(button, true, 'Avisando...');
    try {
      const result = await api(`/api/my/appointments/${appointment.id}/deposit`, { method: 'POST' });
      state.created = result.appointment;
      toast('Avisamos o estúdio. Você recebe a confirmação pelo WhatsApp.', { type: 'success', title: 'Sinal informado' });
      renderSuccess();
    } catch (error) {
      toast(error.message, { type: 'error' });
      setButtonBusy(button, false);
    }
  });

  $('#newBooking')?.addEventListener('click', event => {
    event.preventDefault();
    resetBooking();
  });
}

function resetBooking() {
  state.service = null;
  state.date = null;
  state.time = null;
  state.slots = null;
  state.slotsError = '';
  state.created = null;
  state.pix = null;
  state.step = 1;
  renderServices();
  renderSummary();
  goTo(1);
}

/* ---------------- init ---------------- */
async function init() {
  hydrateStaticIcons();

  try {
    const [site, me] = await Promise.all([
      api('/api/site'),
      api('/api/auth/me').catch(() => ({ user: null }))
    ]);
    state.site = site;
    state.user = me.user || null;
  } catch (error) {
    $('#serviceList').innerHTML = `<div class="empty-state"><div class="empty-glyph">${icon('alert', 24)}</div>
      <h3>Não foi possível carregar</h3><p>${esc(error.message)}</p>
      <button class="btn btn-outline btn-sm" onclick="location.reload()">Recarregar</button></div>`;
    return;
  }

  updateHeader();
  if ($('#footAddress')) $('#footAddress').textContent = state.site.business.address || '';
  if ($('#cancelPolicy')) $('#cancelPolicy').textContent = `Até ${state.site.business.cancelHours}h antes, sem burocracia.`;

  renderServices();
  goTo(1, { scroll: false });

  const params = new URLSearchParams(location.search);
  const wanted = Number(params.get('servico'));
  if (wanted) {
    const service = state.site.services.find(item => item.id === wanted);
    if (service) {
      state.service = service;
      renderServices();
      renderSummary();
      goTo(2);
    }
  }
  if (params.get('conta') === '1') {
    toast('Entre na sua conta para ver e gerenciar seus agendamentos.', { type: 'info' });
  }

  $$('[data-back]').forEach(button => {
    button.addEventListener('click', () => goTo(Number(button.dataset.back)));
  });
}

init();
