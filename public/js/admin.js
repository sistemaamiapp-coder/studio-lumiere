import {
  $, $$, esc, api as apiFetch, icon, waIcon, statusBadge, depositBadge, STATUS_META, money,
  todayISO, addDaysISO, isoToDate, dateLong, dateShort, weekdayShort, monthLong,
  durationLabel, firstName, initials, phoneDisplay, waLink, bookingLink, copyText,
  toast, confirmAction, skeleton, debounce, setButtonBusy
} from './ui.js';

const CATEGORY_FALLBACK = { cilios: 'Cílios', unhas: 'Unhas', manicure: 'Manicure', pedicure: 'Pedicure' };
const METHOD_LABEL = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão', transferencia: 'Transferência' };
const FIN_CATEGORIES = ['Atendimento', 'Sinal', 'Produtos', 'Insumos', 'Aluguel', 'Estrutura', 'Marketing', 'Outros'];
const PERIODS = [
  { label: 'Manhã', from: 0, to: 719 },
  { label: 'Tarde', from: 720, to: 1079 },
  { label: 'Noite', from: 1080, to: 1439 }
];
const NOTIF_META = {
  'appointment:created': { icon: 'calendar', tone: '' },
  'appointment:updated': { icon: 'repeat', tone: 'gold' },
  'deposit:reported': { icon: 'pix', tone: 'sage' },
  'client:new': { icon: 'users', tone: 'lilac' },
  'finance:changed': { icon: 'wallet', tone: 'sage' },
  'portfolio:changed': { icon: 'image', tone: 'lilac' }
};

const state = {
  user: null,
  view: 'dashboard',
  param: null,
  date: todayISO(),
  token: 0,
  renderToken: 0,
  site: null,
  services: [],
  categories: {},
  apptIndex: new Map(),
  clientQuery: '',
  currentClient: null,
  agendaFilter: 'todos',
  financeFrom: '',
  financeTo: '',
  notifs: [],
  ws: null,
  pendingRefresh: false
};

let sitePromise = null;
let modalEl = null;
let refreshTimer = null;
let lastFocusBeforeModal = null;
let selfActionUntil = 0;

// A própria ação do estúdio já mostra um toast; o eco pelo WebSocket só atualiza a lista.
async function api(path, options = {}) {
  if (options.method && options.method !== 'GET') selfActionUntil = Date.now() + 2500;
  return apiFetch(path, options);
}

/* ============================================================
   utilidades
   ============================================================ */
const enc = value => encodeURIComponent(String(value ?? ''));

function toISODate(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function timeMinutes(time) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function toneFor(name) {
  const tones = ['', 'lilac', 'gold', 'sage'];
  let sum = 0;
  for (const ch of String(name || '')) sum += ch.charCodeAt(0);
  return tones[sum % tones.length];
}

function categoryLabel(key) {
  return state.categories[key]?.label || CATEGORY_FALLBACK[key] || key || 'Serviço';
}

function maintChip(daysLeft) {
  if (daysLeft < 0) return `<span class="maint-chip late">${Math.abs(daysLeft)}d atrasado</span>`;
  if (daysLeft <= 7) return `<span class="maint-chip soon">em ${daysLeft}d</span>`;
  return `<span class="maint-chip ok">em dia</span>`;
}

function timeAgo(iso) {
  const then = new Date(iso || Date.now()).getTime();
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'ontem' : `há ${days} dias`;
}

function compactNumber(value) {
  const number = Math.round(Number(value) || 0);
  if (number < 1000) return String(number);
  return `${(number / 1000).toFixed(1).replace('.', ',')}k`;
}

async function loadSite() {
  if (!sitePromise) {
    sitePromise = api('/api/site').then(data => {
      state.site = data;
      return data;
    }).catch(error => {
      sitePromise = null;
      throw error;
    });
  }
  return sitePromise;
}

async function loadServices(force = false) {
  if (state.services.length && !force) return state.services;
  const data = await api('/api/admin/services');
  state.services = data.services;
  state.categories = data.categories || {};
  return state.services;
}

async function loadClients(force = false) {
  if (state.clients?.length && !force) return state.clients;
  const data = await api('/api/admin/clients');
  state.clients = data.clients;
  return state.clients;
}

function notifyError(error, title = 'Não foi possível concluir') {
  if (error.status === 401) {
    showGate('Sua sessão expirou. Entre novamente para continuar.');
    return;
  }
  toast(error.message, { type: 'error', title });
}

function showGate(message = '') {
  if (state.ws) {
    state.ws.onclose = null;
    try { state.ws.close(); } catch { /* noop */ }
    state.ws = null;
  }
  state.user = null;
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#gate').hidden = false;
  $('#gateError').textContent = message;
  if (!message) setTimeout(() => $('#gateEmail')?.focus(), 60);
}

/* ============================================================
   mensagens de WhatsApp
   ============================================================ */
function apptMessage(appointment) {
  const first = firstName(appointment.client_name);
  const when = `${dateLong(appointment.date)} às ${appointment.time}`;
  if (appointment.status === 'pendente') {
    return `Olá, ${first}! Recebi seu pedido de ${appointment.service_name} para ${when}. Para garantir o horário, o sinal de ${money(appointment.deposit_amount)} pode ser feito pelo Pix. Posso confirmar sua presença?`;
  }
  if (appointment.status === 'confirmado') {
    return `Olá, ${first}! Seu horário de ${appointment.service_name} está confirmado para ${when}, no Studio Paula Souza. Se precisar remarcar, me avise por aqui com antecedência.`;
  }
  return `Olá, ${first}! Passando para falar do seu horário de ${appointment.service_name}, ${when}.`;
}

function reminderMessage(appointment) {
  const first = firstName(appointment.client_name);
  return `Olá, ${first}! Passando para lembrar do seu horário amanhã: ${appointment.service_name} em ${dateLong(appointment.date)} às ${appointment.time}, no Studio Paula Souza. Se precisar remarcar, me avise por aqui.`;
}

function todayMessage(appointment) {
  const first = firstName(appointment.client_name);
  return `Olá, ${first}! Seu horário de ${appointment.service_name} é hoje às ${appointment.time}. Posso confirmar sua presença?`;
}

function depositMessage(appointment) {
  const first = firstName(appointment.client_name);
  const key = state.site?.business?.pixKey || 'contato@paulasouza.com.br';
  return `Olá, ${first}! Para garantir seu horário de ${appointment.service_name} em ${dateLong(appointment.date)} às ${appointment.time}, o sinal é de ${money(appointment.deposit_amount)} via Pix. Chave: ${key}. Quando enviar, me manda o comprovante por aqui.`;
}

function maintenanceMessage(item) {
  const first = firstName(item.client_name);
  return `Olá, ${first}! Já faz ${item.maintenance_days} dias desde seu último ${item.service_name}. Que tal garantir seu retorno? Você escolhe o melhor horário por aqui: ${bookingLink(item.service_id)}`;
}

function birthdayMessage(person) {
  const first = firstName(person.name);
  return `Olá, ${first}! Passando para te desejar um feliz aniversário! Que seu novo ano seja lindo. Com carinho, Studio Paula Souza.`;
}

function accessMessage(name, email, password) {
  return `Olá, ${firstName(name)}! Seu acesso ao Studio Paula Souza está pronto. E-mail: ${email} · Senha: ${password}. Por aqui você agenda, acompanha seus horários e envia o sinal pelo Pix.`;
}

/* ============================================================
   pedaços de interface
   ============================================================ */
function cardHead(title, subtitle = '', right = '') {
  return `<div class="card-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${right}</div>`;
}

function kpi(tone, iconName, label, value, hint) {
  return `<article class="kpi ${tone}">
    <div class="kpi-top"><span class="kpi-label">${esc(label)}</span><span class="kpi-ico">${icon(iconName, 14)}</span></div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-hint">${hint}</div>
  </article>`;
}

function miniRow(iconName, tone, title, subtitle, right = '') {
  return `<div class="mini-row">
    <span class="mini-ico ${tone}">${icon(iconName, 13)}</span>
    <div class="mini-text"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></div>
    ${right}
  </div>`;
}

function quickBtn(appointment, quick, iconName, label, extra = '') {
  return `<button class="qbtn ${extra}" type="button" data-act="appt-quick" data-id="${appointment.id}" data-quick="${quick}" title="${esc(label)}" aria-label="${esc(label)}">${icon(iconName, 14)}</button>`;
}

function apptRow(appointment, opts = {}) {
  const { showDate = false } = opts;
  state.apptIndex.set(Number(appointment.id), appointment);
  const canceled = appointment.status === 'cancelado' || appointment.status === 'faltou';
  return `<article class="arow ${appointment.status === 'concluido' ? 'done' : ''} ${canceled ? 'canceled' : ''}">
    <div class="arow-time"><strong>${esc(appointment.time)}</strong><small>${showDate ? dateShort(appointment.date) : durationLabel(appointment.duration_min)}</small></div>
    <span class="mini-avatar ${toneFor(appointment.client_name)}">${esc(initials(appointment.client_name))}</span>
    <div class="arow-main">
      <strong>${esc(firstName(appointment.client_name))} <em>· ${esc(appointment.service_name)}</em> ${statusBadge(appointment.status)}</strong>
      <span>${money(appointment.price)} · ${esc(phoneDisplay(appointment.client_phone))}${appointment.source === 'manual' ? ' · criado no estúdio' : ''}</span>
    </div>
    <div class="arow-chips">${depositBadge(appointment.deposit_status)}</div>
    <div class="arow-actions">
      ${appointment.status === 'pendente' ? quickBtn(appointment, 'confirmar', 'check', 'Confirmar presença', 'good') : ''}
      ${['pendente', 'confirmado'].includes(appointment.status) ? quickBtn(appointment, 'concluir', 'checkCircle', 'Concluir atendimento', 'good') : ''}
      ${!canceled && appointment.deposit_status !== 'pago' ? quickBtn(appointment, 'pago', 'pix', 'Confirmar sinal pago', 'gold') : ''}
      <a class="qbtn wa" href="${waLink(appointment.client_phone, apptMessage(appointment))}" target="_blank" rel="noopener" title="Abrir WhatsApp">${waIcon(13)}</a>
      <button class="qbtn" type="button" data-act="appt-open" data-id="${appointment.id}" title="Editar agendamento">${icon('edit', 13)}</button>
    </div>
  </article>`;
}

function emptyLine(text) {
  return `<p class="card-sub" style="padding:10px 2px">${esc(text)}</p>`;
}

function viewError(root, error) {
  if (error.status === 401) { showGate('Sua sessão expirou. Entre novamente para continuar.'); return; }
  if (error.status === 403) { showGate('Esta conta não tem acesso ao painel do estúdio.'); return; }
  root.innerHTML = `<div class="adm-card"><div class="adm-error">${icon('alert', 22)}<strong>Não foi possível carregar esta área</strong><span>${esc(error.message)}</span><button class="btn btn-outline btn-sm" type="button" data-act="retry">Tentar de novo</button></div></div>`;
}

/* ============================================================
   roteador
   ============================================================ */
const VIEWS = {
  dashboard: { eyebrow: 'Painel · Paula Souza', title: 'Visão geral', render: viewDashboard },
  agenda: { eyebrow: 'Agenda do estúdio', title: 'Agenda', render: viewAgenda },
  clientes: { eyebrow: 'Clientes · Paula Souza', title: 'Clientes', render: viewClients },
  servicos: { eyebrow: 'Catálogo do estúdio', title: 'Serviços', render: viewServices },
  portfolio: { eyebrow: 'Vitrine do site', title: 'Portfólio', render: viewPortfolio },
  financeiro: { eyebrow: 'Caixa do estúdio', title: 'Financeiro', render: viewFinance },
  retornos: { eyebrow: 'Relacionamento', title: 'Retornos & lembretes', render: viewReminders },
  contato: { eyebrow: 'Site · Contato', title: 'Contato & redes', render: viewContact }
};

function route() {
  if (!state.user) return;
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, param] = raw.split('/');
  const view = VIEWS[name] ? name : 'dashboard';
  if (!VIEWS[name]) history.replaceState(null, '', '#/dashboard');
  state.view = view;
  state.param = param || null;
  applyChrome();
  closeSidebar();
  $('#notifPanel').classList.remove('open');
  renderView();
}

function applyChrome() {
  const meta = VIEWS[state.view];
  const detail = state.view === 'clientes' && state.param;
  $('#viewEyebrow').textContent = meta.eyebrow;
  $('#viewTitle').textContent = detail ? 'Ficha da cliente' : meta.title;
  document.title = `${detail ? 'Ficha da cliente' : meta.title} · Painel Paula Souza`;
  $$('.adm-nav a').forEach(link => {
    link.classList.toggle('active', link.dataset.view === state.view);
  });
}

async function renderView() {
  if (!state.user) return;
  const token = ++state.renderToken;
  state.token = token;
  const root = $('#view');
  if (!root) return;
  root.innerHTML = `<div class="adm-card"><div class="adm-loading">${skeleton(3)}${skeleton(2)}</div></div>`;
  try {
    await VIEWS[state.view].render(root, token);
  } catch (error) {
    if (token === state.renderToken) viewError(root, error);
  }
}

function refreshView() {
  if (modalEl) { state.pendingRefresh = true; return; }
  renderView();
}

/* ============================================================
   visão geral
   ============================================================ */
async function viewDashboard(root, token) {
  const data = await api(`/api/admin/overview?date=${todayISO()}`);
  if (token !== state.renderToken) return;
  const s = data.stats;
  const chartTotal = data.chart.reduce((sum, day) => sum + Number(day.total), 0);
  const max = Math.max(...data.chart.map(day => Number(day.total)), 1);
  const today = todayISO();

  const chart = data.chart.map(day => `
    <div class="chart-col ${day.date === today ? 'today' : ''}" title="${esc(dateLong(day.date))} · ${money(day.total)}">
      <b>${compactNumber(day.total)}</b>
      <div class="chart-track"><span class="chart-bar" style="--h:${Math.max(4, Math.round(Number(day.total) / max * 100))}%"></span></div>
      <small>${esc(weekdayShort(day.date))}</small>
    </div>`).join('');

  const birthdays = data.birthdays.length
    ? data.birthdays.map(person => miniRow('gift', 'lilac', person.name, `Dia ${person.day} · ${phoneDisplay(person.phone)}`,
      `<a class="qbtn wa" href="${waLink(person.phone, birthdayMessage(person))}" target="_blank" rel="noopener" title="Parabenizar no WhatsApp">${waIcon(12)}</a>`)).join('')
    : emptyLine('Nenhum aniversário este mês.');

  const maintenance = data.maintenance.length
    ? data.maintenance.slice(0, 5).map(item => miniRow('repeat', 'gold', item.client_name, `${item.service_name} · vence ${dateShort(item.due)}`, maintChip(item.daysLeft))).join('')
    : emptyLine('Nenhum retorno pendente.');

  const activity = data.activity.length
    ? data.activity.map(item => miniRow('calendar', item.status === 'concluido' ? 'sage' : item.status === 'cancelado' ? 'danger' : '',
      `${item.client_name} · ${item.service_name}`,
      `${dateShort(item.date)} às ${item.time} · ${STATUS_META[item.status]?.label || item.status}${item.source === 'manual' ? ' · no estúdio' : ' · online'}`,
      `<time>${timeAgo(item.created_at)}</time>`)).join('')
    : emptyLine('Ainda sem movimentações.');

  root.innerHTML = `
    <div class="kpi-grid">
      ${kpi('rose', 'calendar', 'Hoje', s.todayCount, `${money(s.todayExpected)} previstos`)}
      ${kpi('sage', 'wallet', 'Faturamento do mês', money(s.monthRevenue), `lucro de ${money(s.monthProfit)}`)}
      ${kpi('gold', 'pix', 'Sinais a conferir', s.pendingDeposits, 'aguardando pagamento')}
      ${kpi('lilac', 'repeat', 'Retornos vencendo', s.maintenanceDue, 'nos próximos 7 dias')}
      ${kpi('rose', 'users', 'Novas clientes', s.newClients, 'no mês')}
      ${kpi('gold', 'trending', 'Ticket médio', money(s.ticket), `${s.completedMonth} atendimentos`)}
    </div>

    <div class="dash-grid">
      <div class="dash-left">
        <section class="adm-card">
          ${cardHead('Agenda de hoje', dateLong(today), `<a class="card-link" href="#/agenda">Abrir agenda ${icon('arrowRight', 13)}</a>`)}
          ${data.dayAppointments.length ? data.dayAppointments.map(appointment => apptRow(appointment)).join('') : emptyLine('Dia livre. Bom momento para um encaixe ou para divulgar horários no WhatsApp.')}
        </section>
        <section class="adm-card tight">
          ${cardHead('Retornos a lembrar', 'Manutenção vencendo', `<a class="card-link" href="#/retornos">Ver todos ${icon('arrowRight', 13)}</a>`)}
          ${maintenance}
        </section>
      </div>
      <aside class="dash-side">
        <section class="adm-card tight">
          ${cardHead('Faturamento', 'Últimos 7 dias')}
          <div class="chart">${chart}</div>
          <div class="chart-legend"><span>Total no período</span><b class="num">${money(chartTotal)}</b></div>
        </section>
        <section class="adm-card tight">
          ${cardHead('Aniversariantes', monthLong(today))}
          ${birthdays}
        </section>
      </aside>
    </div>

    <div class="adm-grid-2">
      <section class="adm-card">
        ${cardHead('Próximos horários', 'Depois de hoje', `<a class="card-link" href="#/agenda">Ver agenda ${icon('arrowRight', 13)}</a>`)}
        ${data.upcoming.length ? data.upcoming.map(appointment => apptRow(appointment, { showDate: true })).join('') : emptyLine('Nenhum horário futuro marcado.')}
      </section>
      <section class="adm-card">
        ${cardHead('Atalhos', 'O que você costuma usar')}
        <div class="quick-grid">
          <button class="quick-btn" type="button" data-act="new-appt"><span class="mini-ico">${icon('plus', 13)}</span><strong>Novo agendamento</strong><small>Cliente fixa ou cadastro rápido</small></button>
          <button class="quick-btn" type="button" data-act="new-client"><span class="mini-ico lilac">${icon('users', 13)}</span><strong>Nova cliente</strong><small>Cria a ficha e o acesso</small></button>
          <button class="quick-btn" type="button" data-act="copy" data-copy="${esc(enc(bookingLink()))}"><span class="mini-ico wa">${icon('send', 13)}</span><strong>Copiar link de agendamento</strong><small>Envie para as clientes</small></button>
          <a class="quick-btn" href="#/retornos"><span class="mini-ico gold">${icon('repeat', 13)}</span><strong>Retornos &amp; lembretes</strong><small>Mensagens prontas no WhatsApp</small></a>
        </div>
      </section>
    </div>

    <section class="adm-card">
      ${cardHead('Últimas movimentações', 'Agendamentos criados recentemente')}
      ${activity}
    </section>`;
}

/* ============================================================
   agenda
   ============================================================ */
async function viewAgenda(root, token) {
  const data = await api(`/api/admin/appointments?date=${state.date}`);
  if (token !== state.renderToken) return;
  const rows = data.appointments;
  const active = rows.filter(row => !['cancelado', 'faltou'].includes(row.status));
  const expected = active.reduce((sum, row) => sum + Number(row.price), 0);
  const pendingDeposits = active.filter(row => row.deposit_status !== 'pago').length;
  const filtered = state.agendaFilter === 'todos' ? rows : rows.filter(row => row.status === state.agendaFilter);

  const groups = PERIODS.map(period => ({
    ...period,
    rows: filtered.filter(row => {
      const minutes = timeMinutes(row.time);
      return minutes >= period.from && minutes <= period.to;
    })
  })).filter(group => group.rows.length);

  const body = groups.length
    ? groups.map(group => `<div class="day-group">
        <div class="day-label">${group.label}<span>${group.rows.length}</span></div>
        ${group.rows.map(appointment => apptRow(appointment)).join('')}
      </div>`).join('')
    : `<div class="table-empty">${rows.length ? 'Nenhum horário com este status.' : 'Dia livre — bom momento para um encaixe.'}</div>`;

  const filters = [['todos', 'Todos'], ['pendente', 'Aguardando'], ['confirmado', 'Confirmados'], ['concluido', 'Concluídos'], ['cancelado', 'Cancelados'], ['faltou', 'Faltou']];

  root.innerHTML = `
    <section class="adm-card tight agenda-bar">
      <div class="agenda-line">
        <div class="agenda-date">
          <strong>${dateLong(state.date)}</strong>
          <small>${active.length} atendimento(s) · ${money(expected)} previstos · ${pendingDeposits} sinal(is) a conferir</small>
        </div>
        <div class="agenda-nav">
          <button class="adm-icon-btn" type="button" data-act="agenda-shift" data-delta="-1" title="Dia anterior">${icon('chevronLeft', 16)}</button>
          <label class="date-pill">${icon('calendar', 14)}<input type="date" id="agendaDate" value="${state.date}" aria-label="Escolher dia" /></label>
          <button class="adm-icon-btn" type="button" data-act="agenda-shift" data-delta="1" title="Próximo dia">${icon('chevronRight', 16)}</button>
          <button class="btn btn-outline btn-sm" type="button" data-act="agenda-today">Hoje</button>
          <button class="btn btn-primary btn-sm" type="button" data-act="new-appt">${icon('plus', 14)} Agendar</button>
        </div>
      </div>
      <div class="status-filter">
        ${filters.map(([value, label]) => `<button class="filter-chip ${state.agendaFilter === value ? 'active' : ''}" type="button" data-act="agenda-filter" data-status="${value}">${label}${value !== 'todos' && value !== 'faltou' && value !== 'cancelado' ? `<span class="dot ${value === 'pendente' ? 'gold' : value === 'confirmado' ? 'sage' : 'rose'}"></span>` : ''}</button>`).join('')}
      </div>
    </section>
    <section class="adm-card">
      ${cardHead('Horários do dia', `${rows.length} agendamento(s) · sinal e status editáveis pelo lápis`)}
      ${body}
    </section>`;

  const dateInput = $('#agendaDate', root);
  dateInput?.addEventListener('change', () => {
    if (!dateInput.value) return;
    state.date = dateInput.value;
    renderView();
  });
}

function shiftAgendaDate(delta) {
  state.date = addDaysISO(state.date, delta);
  renderView();
}

/* ============================================================
   clientes
   ============================================================ */
async function viewClients(root, token) {
  if (state.param) return viewClientDetail(root, token);
  const query = state.clientQuery;
  const data = await api(`/api/admin/clients?q=${encodeURIComponent(query)}`);
  if (token !== state.renderToken) return;
  root.innerHTML = `
    <section class="adm-card tight">
      <div class="toolbar">
        <div class="search-box">${icon('search', 16)}<input class="input" id="clientSearch" type="search" placeholder="Buscar por nome, e-mail ou WhatsApp" value="${esc(query)}" autocomplete="off" /></div>
        <span class="card-sub" id="clientCount">${data.clients.length} cliente(s)</span>
        <button class="btn btn-primary btn-sm" type="button" data-act="new-client">${icon('plus', 14)} Nova cliente</button>
      </div>
    </section>
    <section class="adm-card flush" id="clientTable">${clientsTable(data.clients)}</section>`;

  const input = $('#clientSearch', root);
  const reload = debounce(async () => {
    state.clientQuery = input.value;
    try {
      const fresh = await api(`/api/admin/clients?q=${encodeURIComponent(state.clientQuery)}`);
      const table = $('#clientTable');
      const count = $('#clientCount');
      if (table) table.innerHTML = clientsTable(fresh.clients);
      if (count) count.textContent = `${fresh.clients.length} cliente(s)`;
    } catch (error) {
      notifyError(error, 'Busca indisponível');
    }
  }, 280);
  input?.addEventListener('input', reload);
}

function clientsTable(clients) {
  if (!clients.length) {
    return `<div class="table-empty">Nenhuma cliente encontrada. Ajuste a busca ou cadastre uma nova ficha.</div>`;
  }
  return `<table class="adm-table">
    <thead><tr><th>Cliente</th><th>WhatsApp</th><th>Visitas</th><th>Investido</th><th>Última visita</th><th>Próximo</th><th></th></tr></thead>
    <tbody>
      ${clients.map(client => `<tr class="row-link" data-act="client-open" data-id="${client.id}">
        <td><div class="client-cell"><span class="mini-avatar ${toneFor(client.name)}">${esc(initials(client.name))}</span><div><strong>${esc(client.name)}</strong><small>${esc(client.email)}</small></div></div></td>
        <td>${esc(phoneDisplay(client.phone))}</td>
        <td class="num">${client.visits}</td>
        <td class="num">${money(client.spent)}</td>
        <td>${client.last_visit ? dateShort(client.last_visit) : '—'}</td>
        <td>${client.next_visit ? dateShort(client.next_visit) : '—'}</td>
        <td style="text-align:right;color:var(--muted-2)">${icon('chevronRight', 15)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

async function viewClientDetail(root, token) {
  const id = Number(state.param);
  if (!id) { location.hash = '#/clientes'; return; }
  const data = await api(`/api/admin/clients/${id}`);
  if (token !== state.renderToken) return;
  const client = data.client;
  state.currentClient = client;
  const stats = data.stats;
  const memberSince = client.created_at ? new Date(client.created_at) : null;

  const upcoming = data.upcoming.length
    ? data.upcoming.map(appointment => apptRow(appointment, { showDate: true })).join('')
    : emptyLine('Nenhum horário futuro marcado.');

  const maintenance = data.maintenance.length
    ? data.maintenance.map(item => miniRow('repeat', 'gold', item.service_name, `Último em ${dateShort(item.last_date)} · vence ${dateShort(item.due)}`, maintChip(item.daysLeft))).join('')
    : emptyLine('Sem retorno programado.');

  const history = data.appointments.length
    ? `<table class="adm-table">
        <thead><tr><th>Data</th><th>Serviço</th><th>Status</th><th>Sinal</th><th>Valor</th><th></th></tr></thead>
        <tbody>${data.appointments.map(appointment => {
          state.apptIndex.set(Number(appointment.id), appointment);
          return `<tr class="row-link" data-act="appt-open" data-id="${appointment.id}">
            <td><span class="num">${dateShort(appointment.date)}</span><br /><small class="muted">${esc(appointment.time)}</small></td>
            <td>${esc(appointment.service_name)}</td>
            <td>${statusBadge(appointment.status)}</td>
            <td>${depositBadge(appointment.deposit_status)}</td>
            <td class="num">${money(appointment.price)}</td>
            <td style="text-align:right;color:var(--muted-2)">${icon('chevronRight', 15)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
    : `<div class="table-empty">Nenhum atendimento registrado ainda.</div>`;

  root.innerHTML = `
    <a class="card-link" href="#/clientes" style="justify-self:start">${icon('arrowLeft', 13)} Voltar para clientes</a>

    <section class="adm-card">
      <div class="client-head">
        <span class="client-avatar">${esc(initials(client.name))}</span>
        <div class="client-head-main">
          <h2>${esc(client.name)}</h2>
          <p>
            <span>${icon('phone', 12)} ${esc(phoneDisplay(client.phone))}</span>
            <span>${icon('send', 12)} ${esc(client.email)}</span>
            ${client.birthdate ? `<span>${icon('gift', 12)} ${dateShort(client.birthdate)}</span>` : ''}
            ${memberSince ? `<span>${icon('heart', 12)} cliente desde ${monthLong(toISODate(memberSince))}</span>` : ''}
          </p>
        </div>
        <div class="client-actions">
          <a class="btn btn-outline btn-sm" href="${waLink(client.phone, `Olá, ${firstName(client.name)}! Tudo bem?`)}" target="_blank" rel="noopener">${waIcon(13)} WhatsApp</a>
          <button class="btn btn-primary btn-sm" type="button" data-act="new-appt" data-client="${client.id}">${icon('plus', 13)} Agendar</button>
          <button class="btn btn-outline btn-sm" type="button" data-act="client-reset" data-id="${client.id}">${icon('lock', 13)} Redefinir senha</button>
        </div>
      </div>
      <div class="mini-stats">
        <div class="mini-stat"><span>Visitas</span><strong>${stats.visits}</strong></div>
        <div class="mini-stat"><span>Investido</span><strong>${money(stats.spent)}</strong></div>
        <div class="mini-stat"><span>Ticket médio</span><strong>${money(stats.ticket)}</strong></div>
        <div class="mini-stat"><span>Próximos</span><strong>${stats.upcoming}</strong></div>
      </div>
    </section>

    <div class="adm-grid-2">
      <section class="adm-card">
        ${cardHead('Ficha da cliente', 'Preferências, alergias e combinados que a equipe precisa lembrar')}
        <form class="adm-form" id="clientForm" novalidate>
          <div class="form-grid-2">
            <div class="field"><label for="cfName">Nome completo</label><input class="input" id="cfName" value="${esc(client.name)}" maxlength="120" required /></div>
            <div class="field"><label for="cfPhone">WhatsApp com DDD</label><input class="input" id="cfPhone" value="${esc(phoneDisplay(client.phone))}" inputmode="tel" required /></div>
          </div>
          <div class="form-grid-2">
            <div class="field"><label for="cfBirth">Aniversário</label><input class="input" id="cfBirth" type="date" value="${esc(client.birthdate || '')}" /></div>
            <div class="field"><label>E-mail de acesso</label><input class="input" value="${esc(client.email)}" disabled title="O e-mail de acesso não muda por aqui" /></div>
          </div>
          <div class="field"><label for="cfNotes">Anotações internas</label><textarea class="textarea" id="cfNotes" maxlength="1000" placeholder="Alergias, preferências, histórico importante...">${esc(client.notes || '')}</textarea></div>
          <p class="form-error" id="cfError"></p>
          <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit" id="cfSave">Salvar ficha da cliente</button></div>
        </form>
      </section>
      <div class="dash-side">
        <section class="adm-card tight">
          ${cardHead('Próximos horários', 'Com sinal e status atualizados')}
          ${upcoming}
        </section>
        <section class="adm-card tight">
          ${cardHead('Retornos', 'Calculados pelo último atendimento')}
          ${maintenance}
        </section>
      </div>
    </div>

    <section class="adm-card">
      ${cardHead('Histórico completo', `${data.appointments.length} agendamentos desde o primeiro contato`)}
      ${history}
    </section>`;

  const form = $('#clientForm', root);
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const errorEl = $('#cfError', root);
    errorEl.textContent = '';
    const button = $('#cfSave', root);
    setButtonBusy(button, true, 'Salvando...');
    try {
      const { client: updated } = await api(`/api/admin/clients/${client.id}`, {
        method: 'PATCH',
        body: {
          name: $('#cfName', root).value.trim(),
          phone: $('#cfPhone', root).value.trim(),
          birthdate: $('#cfBirth', root).value || null,
          notes: $('#cfNotes', root).value.trim()
        }
      });
      state.currentClient = { ...client, ...updated };
      toast('Ficha da cliente atualizada.', { type: 'success', title: 'Tudo certo' });
      renderView();
    } catch (error) {
      if (error.status === 401) { showGate('Sua sessão expirou. Entre novamente.'); return; }
      errorEl.textContent = error.message;
      setButtonBusy(button, false);
    }
  });
}

/* ============================================================
   serviços
   ============================================================ */
async function viewServices(root, token) {
  await loadServices(true);
  if (token !== state.renderToken) return;
  const services = state.services;
  const activeCount = services.filter(service => service.active).length;
  const order = Object.keys(state.categories);

  const groups = order.map(key => {
    const items = services.filter(service => service.category === key);
    if (!items.length) return '';
    return `<div class="svc-group">
      <div class="svc-group-head">${esc(categoryLabel(key))}<b>${items.length}</b></div>
      <div class="svc-grid">${items.map(serviceCard).join('')}</div>
    </div>`;
  }).join('');

  const uncategorized = services.filter(service => !order.includes(service.category));
  const extra = uncategorized.length
    ? `<div class="svc-group"><div class="svc-group-head">Outros<b>${uncategorized.length}</b></div><div class="svc-grid">${uncategorized.map(serviceCard).join('')}</div></div>`
    : '';

  root.innerHTML = `
    <section class="adm-card tight">
      <div class="toolbar">
        <div style="display:grid;gap:1px">
          <strong style="font-size:13px">${services.length} serviços · ${activeCount} ativos</strong>
          <span class="card-sub">Preço, duração e retorno definem a agenda e os lembretes automáticos.</span>
        </div>
        <button class="btn btn-primary btn-sm" type="button" data-act="svc-new" style="margin-left:auto">${icon('plus', 14)} Novo serviço</button>
      </div>
    </section>
    <section class="adm-card">
      ${groups || extra ? `<div class="svc-groups">${groups}${extra}</div>` : `<div class="table-empty">Nenhum serviço cadastrado. Crie o primeiro para abrir a agenda.</div>`}
    </section>`;
}

function serviceCard(service) {
  return `<article class="svc-admin ${service.active ? '' : 'off'}">
    <div class="svc-admin-top">
      <span class="svc-cat">${esc(categoryLabel(service.category))}</span>
      ${service.maintenance_days ? `<span class="chip">${service.maintenance_days} dias</span>` : ''}
      ${service.active ? '' : '<span class="chip">Inativo</span>'}
    </div>
    <h3>${esc(service.name)}</h3>
    <p>${esc(service.description || 'Sem descrição cadastrada.')}</p>
    <div class="svc-admin-foot">
      <strong>${money(service.price)}</strong>
      <span>${durationLabel(service.duration_min)}</span>
      <span>${service.bookings || 0} agend.</span>
      <button class="btn btn-quiet btn-xs" type="button" data-act="svc-edit" data-id="${service.id}">Editar</button>
      <button class="btn btn-quiet btn-xs" type="button" data-act="svc-toggle" data-id="${service.id}">${service.active ? 'Desativar' : 'Ativar'}</button>
    </div>
  </article>`;
}

async function openServiceModal(service = null) {
  try { await loadServices(); } catch (error) { notifyError(error); return; }
  const categoryOptions = Object.keys(state.categories).map(key =>
    `<option value="${key}" ${service?.category === key ? 'selected' : ''}>${esc(categoryLabel(key))}</option>`).join('');

  openModal(`
    <button class="modal-close" type="button" data-close aria-label="Fechar">${icon('x', 18)}</button>
    <h3>${service ? 'Editar serviço' : 'Novo serviço'}</h3>
    <p class="modal-sub">${service ? 'Ajuste valores, duração e retorno automático deste serviço.' : 'Cadastre um serviço para aparecer na página de agendamento.'}</p>
    <form class="adm-form" id="svcForm" novalidate>
      <div class="field"><label for="svcName">Nome do serviço</label><input class="input" id="svcName" maxlength="120" value="${esc(service?.name || '')}" required /></div>
      <div class="form-grid-2">
        <div class="field"><label for="svcCategory">Categoria</label><select class="select" id="svcCategory">${categoryOptions}</select></div>
        <div class="field"><label for="svcPrice">Preço (R$)</label><input class="input" id="svcPrice" type="number" min="1" step="0.01" value="${service ? Number(service.price).toFixed(2) : ''}" required /></div>
      </div>
      <div class="form-grid-2">
        <div class="field"><label for="svcDuration">Duração (min)</label><input class="input" id="svcDuration" type="number" min="10" max="600" step="5" value="${service ? service.duration_min : 60}" required /></div>
        <div class="field"><label for="svcMaintenance">Retorno (dias)</label><input class="input" id="svcMaintenance" type="number" min="0" max="365" value="${service ? service.maintenance_days : 21}" /><span class="hint">0 = sem retorno programado</span></div>
      </div>
      <div class="field"><label for="svcDescription">Descrição</label><textarea class="textarea" id="svcDescription" maxlength="300" placeholder="Como esse serviço aparece no site...">${esc(service?.description || '')}</textarea></div>
      <label class="checkbox"><input type="checkbox" id="svcActive" ${service ? (service.active ? 'checked' : '') : 'checked'} /> Ativo na página de agendamento</label>
      <p class="form-error" id="svcError"></p>
      <div class="modal-actions">
        ${service && !service.bookings ? `<button class="btn btn-quiet" type="button" id="svcDelete" style="margin-right:auto;color:var(--danger)">Excluir serviço</button>` : ''}
        <button class="btn btn-outline" type="button" data-close>Fechar</button>
        <button class="btn btn-primary" type="submit" id="svcSave">${service ? 'Salvar alterações do serviço' : 'Criar serviço'}</button>
      </div>
    </form>`, {
    onMount(el, close) {
      const form = $('#svcForm', el);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const errorEl = $('#svcError', el);
        errorEl.textContent = '';
        const button = $('#svcSave', el);
        setButtonBusy(button, true, 'Salvando...');
        const body = {
          name: $('#svcName', el).value.trim(),
          category: $('#svcCategory', el).value,
          price: Number($('#svcPrice', el).value),
          durationMin: Number($('#svcDuration', el).value),
          maintenanceDays: Number($('#svcMaintenance', el).value),
          description: $('#svcDescription', el).value.trim(),
          active: $('#svcActive', el).checked
        };
        try {
          await api(service ? `/api/admin/services/${service.id}` : '/api/admin/services', {
            method: service ? 'PATCH' : 'POST',
            body
          });
          toast(service ? 'Serviço atualizado.' : 'Serviço criado e já disponível no agendamento.', { type: 'success', title: 'Catálogo atualizado' });
          close();
          await loadServices(true);
          renderView();
        } catch (error) {
          if (error.status === 401) { showGate('Sua sessão expirou. Entre novamente.'); return; }
          errorEl.textContent = error.message;
          setButtonBusy(button, false);
        }
      });

      const deleteBtn = $('#svcDelete', el);
      deleteBtn?.addEventListener('click', async () => {
        const confirmed = await confirmAction({
          title: 'Excluir este serviço?',
          message: `${service.name} será removido do catálogo. Como ainda não tem atendimentos, não há histórico a perder.`,
          confirmLabel: 'Excluir serviço',
          danger: true
        });
        if (!confirmed) return;
        try {
          await api(`/api/admin/services/${service.id}`, { method: 'DELETE' });
          toast('Serviço excluído.', { type: 'success' });
          close();
          await loadServices(true);
          renderView();
        } catch (error) {
          notifyError(error, 'Não foi possível excluir');
        }
      });
    }
  });
}

async function toggleService(id) {
  const service = state.services.find(item => Number(item.id) === Number(id));
  if (!service) return;
  try {
    await api(`/api/admin/services/${service.id}`, { method: 'PATCH', body: { active: !service.active } });
    toast(service.active ? `${service.name} saiu do agendamento online.` : `${service.name} está disponível para agendamento.`, { type: 'success' });
    await loadServices(true);
    renderView();
  } catch (error) {
    notifyError(error);
  }
}

/* ============================================================
   portfólio
   ============================================================ */
async function viewPortfolio(root, token) {
  const [{ portfolio }, services] = await Promise.all([
    api('/api/admin/portfolio'),
    loadServices().catch(() => [])
  ]);
  if (token !== state.renderToken) return;
  const cats = state.categories;

  root.innerHTML = `
    <div class="adm-grid-2">
      <section class="adm-card">
        ${cardHead('Publicar nova foto', 'A vitrine do site usa estas imagens')}
        <form class="adm-form upload-card" id="pfForm" novalidate>
          <label class="drop-zone" id="pfDrop">
            <input type="file" id="pfFile" accept="image/jpeg,image/png,image/webp" />
            <span class="icon">${icon('image', 22)}</span>
            <strong>Escolher foto</strong>
            <span>JPG, PNG ou WebP · até 8 MB</span>
          </label>
          <div class="field"><label for="pfTitle">Título</label><input class="input" id="pfTitle" maxlength="120" placeholder="Ex: Volume brasileiro iluminado" required /></div>
          <div class="form-grid-2">
            <div class="field"><label for="pfCategory">Categoria</label><select class="select" id="pfCategory">${Object.keys(cats).map(key => `<option value="${key}">${esc(categoryLabel(key))}</option>`).join('')}</select></div>
            <div class="field"><label for="pfDesc">Descrição curta</label><input class="input" id="pfDesc" maxlength="300" placeholder="Opcional" /></div>
          </div>
          <p class="form-error" id="pfError"></p>
          <button class="btn btn-primary btn-sm btn-block" type="submit" id="pfSave">Publicar no portfólio</button>
        </form>
      </section>
      <section class="adm-card">
        ${cardHead('Fotos publicadas', `${portfolio.length} imagem(ns) na vitrine`)}
        ${portfolio.length ? `<div class="pf-grid">${portfolio.map(item => `<article class="pf-item">
          <img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy" />
          <button class="pf-del" type="button" data-act="pf-del" data-id="${item.id}" title="Remover foto" aria-label="Remover foto">${icon('trash', 13)}</button>
          <div class="pf-caption"><strong>${esc(item.title)}</strong><small>${esc(categoryLabel(item.category))}</small></div>
        </article>`).join('')}</div>` : `<div class="table-empty">A vitrine ainda está vazia. Publique a primeira foto ao lado.</div>`}
      </section>
    </div>`;

  const fileInput = $('#pfFile', root);
  const drop = $('#pfDrop', root);
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) { drop.classList.remove('has-file'); return; }
    const url = URL.createObjectURL(file);
    drop.querySelectorAll('img').forEach(img => img.remove());
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    drop.prepend(img);
    drop.classList.add('has-file');
    const strong = drop.querySelector('strong');
    if (strong) strong.textContent = file.name;
  });

  $('#pfForm', root)?.addEventListener('submit', async event => {
    event.preventDefault();
    const errorEl = $('#pfError', root);
    errorEl.textContent = '';
    const file = fileInput.files?.[0];
    if (!file) { errorEl.textContent = 'Escolha uma foto para publicar.'; return; }
    const title = $('#pfTitle', root).value.trim();
    if (title.length < 2) { errorEl.textContent = 'Dê um título para a foto.'; return; }
    const formData = new FormData();
    formData.append('image', file);
    formData.append('title', title);
    formData.append('category', $('#pfCategory', root).value);
    formData.append('description', $('#pfDesc', root).value.trim());
    const button = $('#pfSave', root);
    setButtonBusy(button, true, 'Publicando...');
    try {
      await api('/api/admin/portfolio', { method: 'POST', body: formData });
      toast('Foto publicada no portfólio.', { type: 'success', title: 'Vitrine atualizada' });
      renderView();
    } catch (error) {
      if (error.status === 401) { showGate('Sua sessão expirou. Entre novamente.'); return; }
      errorEl.textContent = error.message;
      setButtonBusy(button, false);
    }
  });
}

async function deletePortfolio(id) {
  const confirmed = await confirmAction({
    title: 'Remover esta foto?',
    message: 'A imagem sai do portfólio e da vitrine do site imediatamente.',
    confirmLabel: 'Remover foto',
    danger: true
  });
  if (!confirmed) return;
  try {
    await api(`/api/admin/portfolio/${id}`, { method: 'DELETE' });
    toast('Foto removida do portfólio.', { type: 'success' });
    renderView();
  } catch (error) {
    notifyError(error, 'Não foi possível remover');
  }
}

/* ============================================================
   financeiro
   ============================================================ */
async function viewFinance(root, token) {
  if (!state.financeFrom || !state.financeTo) {
    state.financeFrom = `${todayISO().slice(0, 7)}-01`;
    state.financeTo = todayISO();
  }
  const data = await api(`/api/admin/finance?from=${state.financeFrom}&to=${state.financeTo}`);
  if (token !== state.renderToken) return;

  root.innerHTML = `
    <section class="adm-card tight">
      <div class="card-head">
        <div><h2>Caixa do estúdio</h2><p>Período de ${dateShort(data.from)} a ${dateShort(data.to)}</p></div>
        <div class="fin-filter">
          <label class="date-pill">${icon('calendar', 13)}<input type="date" id="finFrom" value="${data.from}" aria-label="Data inicial" /></label>
          <span class="card-sub">até</span>
          <label class="date-pill"><input type="date" id="finTo" value="${data.to}" aria-label="Data final" /></label>
          <button class="preset" type="button" data-act="fin-preset" data-preset="month">Este mês</button>
          <button class="preset" type="button" data-act="fin-preset" data-preset="last">Mês passado</button>
          <button class="preset" type="button" data-act="fin-preset" data-preset="30">Últimos 30 dias</button>
        </div>
      </div>
      <div class="fin-summary">
        <div class="fin-tile in"><span>Entradas</span><strong>${money(data.summary.income)}</strong></div>
        <div class="fin-tile out"><span>Saídas</span><strong>${money(data.summary.expense)}</strong></div>
        <div class="fin-tile"><span>Saldo</span><strong>${money(data.summary.balance)}</strong></div>
        <div class="fin-tile dep"><span>Sinais recebidos</span><strong>${money(data.summary.deposits)}</strong></div>
      </div>
    </section>

    <div class="adm-grid-2">
      <section class="adm-card">
        ${cardHead('Novo lançamento', 'Registre uma entrada ou despesa avulsa')}
        <form class="adm-form" id="finForm" novalidate>
          <div class="kind-toggle" id="finKindToggle">
            <button type="button" class="active" data-kind="entrada">${icon('trending', 13)} Entrada</button>
            <button type="button" data-kind="saida">${icon('wallet', 13)} Saída</button>
          </div>
          <input type="hidden" id="finKind" value="entrada" />
          <div class="form-grid-2">
            <div class="field"><label for="finAmount">Valor (R$)</label><input class="input" id="finAmount" type="number" min="0.01" step="0.01" placeholder="0,00" required /></div>
            <div class="field"><label for="finDate">Data</label><input class="input" id="finDate" type="date" value="${todayISO()}" required /></div>
          </div>
          <div class="form-grid-2">
            <div class="field"><label for="finCategory">Categoria</label><select class="select" id="finCategory">${FIN_CATEGORIES.map(cat => `<option>${cat}</option>`).join('')}</select></div>
            <div class="field"><label for="finMethod">Forma de pagamento</label><select class="select" id="finMethod">${Object.entries(METHOD_LABEL).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label for="finDescription">Descrição</label><input class="input" id="finDescription" maxlength="160" placeholder="Ex: Compra de esmaltes e lixas" required /></div>
          <p class="form-error" id="finError"></p>
          <button class="btn btn-primary btn-sm btn-block" type="submit" id="finSave">Salvar lançamento no caixa</button>
        </form>
      </section>

      <section class="adm-card">
        ${cardHead('Lançamentos do período', `${data.entries.length} movimento(s)`)}
        <div>${financeRows(data.entries)}</div>
      </section>
    </div>`;

  $('#finKindToggle', root)?.addEventListener('click', event => {
    const button = event.target.closest('[data-kind]');
    if (!button) return;
    $$('#finKindToggle button', root).forEach(item => item.classList.toggle('active', item === button));
    $('#finKind', root).value = button.dataset.kind;
  });

  $('#finFrom', root)?.addEventListener('change', event => {
    if (!event.target.value) return;
    state.financeFrom = event.target.value;
    renderView();
  });
  $('#finTo', root)?.addEventListener('change', event => {
    if (!event.target.value) return;
    state.financeTo = event.target.value;
    renderView();
  });

  $('#finForm', root)?.addEventListener('submit', async event => {
    event.preventDefault();
    const errorEl = $('#finError', root);
    errorEl.textContent = '';
    const button = $('#finSave', root);
    setButtonBusy(button, true, 'Salvando...');
    try {
      await api('/api/admin/finance', {
        method: 'POST',
        body: {
          kind: $('#finKind', root).value,
          amount: Number($('#finAmount', root).value),
          date: $('#finDate', root).value || todayISO(),
          category: $('#finCategory', root).value,
          method: $('#finMethod', root).value,
          description: $('#finDescription', root).value.trim()
        }
      });
      toast('Lançamento salvo no caixa.', { type: 'success', title: 'Financeiro atualizado' });
      renderView();
    } catch (error) {
      if (error.status === 401) { showGate('Sua sessão expirou. Entre novamente.'); return; }
      errorEl.textContent = error.message;
      setButtonBusy(button, false);
    }
  });
}

function financeRows(entries) {
  if (!entries.length) return `<div class="table-empty">Nenhum lançamento neste período. Ajuste as datas ou registre um novo movimento.</div>`;
  return entries.map(entry => `<div class="fin-row">
    <div class="fin-date"><b>${dateShort(entry.date)}</b><span>${weekdayShort(entry.date)}</span></div>
    <div class="fin-main">
      <strong>${esc(entry.description)}</strong>
      <small>${esc(entry.category)} · ${esc(METHOD_LABEL[entry.method] || entry.method)}${entry.client_name ? ` · ${esc(entry.client_name)}` : ''}</small>
    </div>
    <span class="fin-tag">${esc(entry.category)}</span>
    <span class="fin-amount ${entry.kind === 'saida' ? 'out' : ''}">${entry.kind === 'saida' ? '−' : '+'} ${money(entry.amount)}</span>
    <button class="qbtn" type="button" data-act="fin-del" data-id="${entry.id}" title="Excluir lançamento" aria-label="Excluir lançamento">${icon('trash', 13)}</button>
  </div>`).join('');
}

function applyFinancePreset(preset) {
  const today = todayISO();
  const base = isoToDate(today);
  if (preset === 'month') {
    state.financeFrom = `${today.slice(0, 7)}-01`;
    state.financeTo = today;
  } else if (preset === 'last') {
    const first = new Date(base.getFullYear(), base.getMonth() - 1, 1);
    const last = new Date(base.getFullYear(), base.getMonth(), 0);
    state.financeFrom = toISODate(first);
    state.financeTo = toISODate(last);
  } else {
    state.financeFrom = addDaysISO(today, -29);
    state.financeTo = today;
  }
  renderView();
}

async function deleteFinance(id) {
  const confirmed = await confirmAction({
    title: 'Excluir este lançamento?',
    message: 'O valor sai do caixa e dos totais do período.',
    confirmLabel: 'Excluir lançamento',
    danger: true
  });
  if (!confirmed) return;
  try {
    await api(`/api/admin/finance/${id}`, { method: 'DELETE' });
    toast('Lançamento removido do caixa.', { type: 'success' });
    renderView();
  } catch (error) {
    notifyError(error, 'Não foi possível excluir');
  }
}

/* ============================================================
   retornos e lembretes
   ============================================================ */
async function viewReminders(root, token) {
  const [data, site] = await Promise.all([api('/api/admin/reminders'), loadSite().catch(() => null)]);
  await loadServices().catch(() => []);
  if (token !== state.renderToken) return;
  const biz = site?.business || {};
  const pixKey = biz.pixKey || 'contato@paulasouza.com.br';
  const services = state.services.filter(service => service.active);

  const reminderRow = (iconName, tone, title, subtitle, phone, message) => `<div class="rem-row">
    <span class="mini-ico ${tone}">${icon(iconName, 13)}</span>
    <div class="rem-main"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></div>
    <div class="rem-actions">
      ${phone ? `<a class="qbtn wa" href="${waLink(phone, message)}" target="_blank" rel="noopener" title="Enviar no WhatsApp">${waIcon(12)}</a>` : ''}
      <button class="qbtn" type="button" data-act="copy" data-copy="${esc(enc(message))}" title="Copiar mensagem" aria-label="Copiar mensagem">${icon('copy', 12)}</button>
    </div>
  </div>`;

  const tomorrow = data.tomorrowAppointments.length
    ? data.tomorrowAppointments.map(appointment => reminderRow('clock', '', appointment.client_name, `${appointment.service_name} · ${appointment.time} · ${dateShort(appointment.date)}`, appointment.client_phone, reminderMessage(appointment))).join('')
    : `<div class="rem-empty">Nenhum horário para amanhã.</div>`;

  const todayPending = data.todayPending.length
    ? data.todayPending.map(appointment => reminderRow('checkCircle', 'sage', appointment.client_name, `${appointment.service_name} · hoje às ${appointment.time}`, appointment.client_phone, todayMessage(appointment))).join('')
    : `<div class="rem-empty">Nenhuma presença pendente de confirmação hoje.</div>`;

  const deposits = data.pendingDeposits.length
    ? data.pendingDeposits.map(appointment => reminderRow('pix', 'gold', appointment.client_name, `${appointment.service_name} · ${dateShort(appointment.date)} às ${appointment.time} · sinal ${money(appointment.deposit_amount)}`, appointment.client_phone, depositMessage(appointment))).join('')
    : `<div class="rem-empty">Todos os sinais em dia.</div>`;

  const maintenance = data.maintenance.length
    ? data.maintenance.slice(0, 14).map(item => reminderRow('repeat', 'gold', item.client_name, `${item.service_name} · vence ${dateShort(item.due)} · ${item.daysLeft < 0 ? `${Math.abs(item.daysLeft)} dias atrasado` : `em ${item.daysLeft} dias`}`, item.client_phone, maintenanceMessage(item))).join('')
    : `<div class="rem-empty">Nenhum retorno pendente.</div>`;

  const birthdays = data.birthdays.length
    ? data.birthdays.map(person => reminderRow('gift', 'lilac', person.name, `Dia ${person.day} · ${phoneDisplay(person.phone)}`, person.phone, birthdayMessage(person))).join('')
    : `<div class="rem-empty">Nenhum aniversário este mês.</div>`;

  root.innerHTML = `
    <div class="adm-grid-2">
      <section class="adm-card">
        ${cardHead('Lembretes de amanhã', `${data.tomorrowAppointments.length} conversa(s) para iniciar`)}
        ${tomorrow}
      </section>
      <section class="adm-card">
        ${cardHead('Confirmar presença hoje', 'Aguardando resposta da cliente')}
        ${todayPending}
      </section>
    </div>

    <div class="rem-grid">
      <section class="adm-card">
        ${cardHead('Sinais a cobrar', `Pix: ${pixKey}`)}
        ${deposits}
      </section>
      <section class="adm-card">
        ${cardHead('Retornos e manutenções', 'Baseado no último atendimento')}
        ${maintenance}
      </section>
      <section class="adm-card">
        ${cardHead('Aniversariantes do mês', 'Uma mensagem simples fideliza')}
        ${birthdays}
      </section>
      <section class="adm-card">
        ${cardHead('Link de agendamento', 'A cliente escolhe o horário sozinha')}
        <p class="card-sub">Envie o link geral ou de um serviço específico. A página mostra só os horários livres e o sinal via Pix.</p>
        <div class="link-share">
          <input class="input" readonly value="${esc(bookingLink())}" aria-label="Link de agendamento" />
          <button class="qbtn" type="button" data-act="copy" data-copy="${esc(enc(bookingLink()))}" title="Copiar link" aria-label="Copiar link">${icon('copy', 13)}</button>
        </div>
        <div class="link-share">
          <select class="select" id="linkService" aria-label="Serviço do link" style="height:34px;font-size:11.5px">
            ${services.map(service => `<option value="${service.id}">${esc(service.name)} · ${money(service.price)}</option>`).join('')}
          </select>
          <button class="btn btn-outline btn-xs" type="button" data-act="copy-service-link">Copiar link</button>
        </div>
        <p class="inline-note">Dica: cole o link na bio do Instagram e nas respostas automáticas do WhatsApp.</p>
      </section>
    </div>`;
}

/* ============================================================
   contato e redes
   ============================================================ */
async function viewContact(root, token) {
  const { settings } = await api('/api/admin/settings');
  if (token !== state.renderToken) return;

  const instagramLabel = settings.instagram ? `@${settings.instagram}` : '';
  root.innerHTML = `
    <div class="adm-grid-2">
      <section class="adm-card">
        ${cardHead('Contato e redes do site', 'Aparecem no rodapé, no agendamento e nas mensagens de WhatsApp')}
        <form class="adm-form" id="contactForm" novalidate>
          <div class="form-grid-2">
            <div class="field"><label for="ctWhats">WhatsApp com DDD</label><input class="input" id="ctWhats" value="${esc(settings.whatsappDisplay)}" inputmode="tel" required /></div>
            <div class="field"><label for="ctEmail">E-mail de contato</label><input class="input" id="ctEmail" type="email" value="${esc(settings.email)}" placeholder="contato@seuestudio.com.br" /></div>
          </div>
          <div class="form-grid-2">
            <div class="field"><label for="ctInsta">Instagram</label><input class="input" id="ctInsta" value="${esc(instagramLabel)}" placeholder="@seuestudio" /></div>
            <div class="field"><label for="ctAddress">Endereço exibido</label><input class="input" id="ctAddress" maxlength="160" value="${esc(settings.address)}" placeholder="Bairro, cidade ou frase de atendimento" /></div>
          </div>
          <p class="form-error" id="ctError"></p>
          <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit" id="ctSave">Salvar contato e redes</button></div>
        </form>
      </section>
      <section class="adm-card tight">
        ${cardHead('Prévia no site', 'Como os links aparecem para as clientes')}
        <div class="contact-preview">
          <a class="contact-line" href="${esc(waLink(settings.whatsapp, 'Olá! Vim pelo site.'))}" target="_blank" rel="noopener">${waIcon(15)}<span>${esc(settings.whatsappDisplay)}</span></a>
          ${settings.email ? `<a class="contact-line" href="mailto:${esc(settings.email)}">${icon('send', 15)}<span>${esc(settings.email)}</span></a>` : `<div class="contact-line muted">${icon('send', 15)}<span>Sem e-mail cadastrado</span></div>`}
          ${settings.instagram ? `<a class="contact-line" href="https://instagram.com/${esc(settings.instagram)}" target="_blank" rel="noopener">${icon('instagram', 15)}<span>${esc(instagramLabel)}</span></a>` : `<div class="contact-line muted">${icon('instagram', 15)}<span>Sem Instagram cadastrado</span></div>`}
          <div class="contact-line">${icon('pin', 15)}<span>${esc(settings.address || 'Sem endereço cadastrado')}</span></div>
        </div>
        <p class="inline-note">O WhatsApp também alimenta o botão flutuante e os lembretes prontos do painel.</p>
      </section>
    </div>`;

  $('#contactForm', root).addEventListener('submit', async event => {
    event.preventDefault();
    const errorEl = $('#ctError', root);
    errorEl.textContent = '';
    const button = $('#ctSave', root);
    setButtonBusy(button, true, 'Salvando...');
    try {
      await api('/api/admin/settings', {
        method: 'PATCH',
        body: {
          whatsapp: $('#ctWhats', root).value.trim(),
          email: $('#ctEmail', root).value.trim(),
          instagram: $('#ctInsta', root).value.trim(),
          address: $('#ctAddress', root).value.trim()
        }
      });
      sitePromise = null;
      await loadSite().catch(() => {});
      toast('Contato e redes atualizados.', { type: 'success', title: 'Site atualizado' });
      renderView();
    } catch (error) {
      if (error.status === 401) { showGate('Sua sessão expirou. Entre novamente.'); return; }
      errorEl.textContent = error.message;
      setButtonBusy(button, false);
    }
  });
}

/* ============================================================
   modais
   ============================================================ */
function openModal(html, options = {}) {
  const { size = '', onMount = null } = options;
  closeModal();
  lastFocusBeforeModal = document.activeElement;
  const host = $('#modalHost');
  host.innerHTML = `<div class="modal-backdrop open"><div class="modal ${size} adm-modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = host.firstElementChild;
  modalEl = backdrop;
  const onKey = event => { if (event.key === 'Escape') closeModal(); };
  backdrop._onKey = onKey;
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(); });
  backdrop.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeModal));
  if (onMount) onMount(backdrop, closeModal);
  return backdrop;
}

function closeModal() {
  if (modalEl?._onKey) document.removeEventListener('keydown', modalEl._onKey);
  modalEl = null;
  const host = $('#modalHost');
  if (host) host.innerHTML = '';
  if (lastFocusBeforeModal && document.contains(lastFocusBeforeModal)) {
    try { lastFocusBeforeModal.focus({ preventScroll: true }); } catch { /* noop */ }
  }
  lastFocusBeforeModal = null;
  if (state.pendingRefresh) {
    state.pendingRefresh = false;
    renderView();
  }
}

function showAccess({ name, email, password, phone }) {
  const message = accessMessage(name, email, password);
  openModal(`
    <button class="modal-close" type="button" data-close aria-label="Fechar">${icon('x', 18)}</button>
    <h3>Acesso criado</h3>
    <p class="modal-sub">Envie para ${esc(name)} e ela já consegue agendar sozinha.</p>
    <div class="access-box">
      <strong>${esc(name)}</strong>
      <span>E-mail: <code>${esc(email)}</code></span>
      <span>Senha: <code>${esc(password)}</code></span>
      <div class="link-share">
        <button class="btn btn-outline btn-xs" type="button" data-act="copy" data-copy="${esc(enc(message))}">${icon('copy', 12)} Copiar mensagem</button>
        ${phone ? `<a class="btn btn-outline btn-xs" href="${waLink(phone, message)}" target="_blank" rel="noopener">${waIcon(12)} WhatsApp</a>` : ''}
      </div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" type="button" data-close>Concluir</button></div>`,
  { size: 'modal-sm' });
}

async function openNewAppointment({ clientId = null } = {}) {
  let clients, services;
  try {
    [clients, services] = await Promise.all([loadClients(true), loadServices(true)]);
  } catch (error) {
    notifyError(error, 'Não foi possível abrir o formulário');
    return;
  }
  const activeServices = services.filter(service => service.active);
  if (!activeServices.length) {
    toast('Cadastre um serviço ativo antes de abrir a agenda.', { type: 'error', title: 'Catálogo vazio' });
    return;
  }
  const initialDate = state.view === 'agenda' ? state.date : todayISO();
  const activeClients = clients.filter(client => Number(client.id) !== Number(state.user?.id));
  const clientOptions = activeClients.map(client =>
    `<option value="${client.id}" ${Number(clientId) === Number(client.id) ? 'selected' : ''}>${esc(client.name)} · ${esc(phoneDisplay(client.phone))}</option>`).join('');
  const serviceOptions = activeServices.map(service =>
    `<option value="${service.id}">${esc(categoryLabel(service.category))} · ${esc(service.name)} · ${money(service.price)}</option>`).join('');

  openModal(`
    <button class="modal-close" type="button" data-close aria-label="Fechar">${icon('x', 18)}</button>
    <h3>Novo agendamento</h3>
    <p class="modal-sub">Marque manualmente, com sinal e status já definidos. A cliente recebe aviso pelo painel em tempo real.</p>
    <form class="adm-form" id="naForm" novalidate>
      <div class="field">
        <label for="naClient">Cliente</label>
        <select class="select" id="naClient" required>
          <option value="" disabled ${clientId ? '' : 'selected'}>Selecione a cliente</option>
          <option value="new">＋ Cadastrar cliente nova</option>
          ${clientOptions}
        </select>
      </div>
      <div class="adm-form" id="naNewClient" hidden>
        <div class="form-grid-2">
          <div class="field"><label for="naName">Nome completo</label><input class="input" id="naName" maxlength="120" placeholder="Nome da cliente" /></div>
          <div class="field"><label for="naPhone">WhatsApp com DDD</label><input class="input" id="naPhone" inputmode="tel" placeholder="(27) 99999-0000" /></div>
        </div>
        <div class="form-grid-2">
          <div class="field"><label for="naEmail">E-mail de acesso</label><input class="input" id="naEmail" type="email" placeholder="cliente@email.com" /></div>
          <div class="field"><label for="naBirth">Aniversário (opcional)</label><input class="input" id="naBirth" type="date" /></div>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="field"><label for="naService">Serviço</label><select class="select" id="naService">${serviceOptions}</select></div>
        <div class="field"><label for="naDate">Data</label><input class="input" id="naDate" type="date" value="${initialDate}" required /></div>
      </div>
      <div class="form-grid-3">
        <div class="field"><label for="naTime">Horário</label><input class="input" id="naTime" type="time" step="900" value="09:00" required /></div>
        <div class="field"><label for="naStatus">Status</label><select class="select" id="naStatus">
          <option value="confirmado">Confirmado</option>
          <option value="pendente">Aguardando</option>
          <option value="concluido">Concluído</option>
        </select></div>
        <div class="field"><label for="naDeposit">Sinal</label><select class="select" id="naDeposit">
          <option value="pendente">Pendente</option>
          <option value="informado">Informado</option>
          <option value="pago">Pago</option>
        </select></div>
      </div>
      <div class="field"><label for="naMethod">Forma de pagamento</label><select class="select" id="naMethod">
        ${Object.entries(METHOD_LABEL).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
      </select></div>
      <div class="field"><label for="naNotes">Observações</label><textarea class="textarea" id="naNotes" maxlength="1000" placeholder="Preferências, encaixe, combinados..."></textarea></div>
      <p class="form-error" id="naError"></p>
      <div class="modal-actions">
        <button class="btn btn-outline" type="button" data-close>Cancelar</button>
        <button class="btn btn-primary" type="submit" id="naSave">Salvar agendamento</button>
      </div>
    </form>`, {
    size: 'modal-lg',
    onMount(el, close) {
      const select = $('#naClient', el);
      const newFields = $('#naNewClient', el);
      const syncNewFields = () => { newFields.hidden = select.value !== 'new'; };
      select.addEventListener('change', syncNewFields);
      syncNewFields();

      $('#naForm', el).addEventListener('submit', async event => {
        event.preventDefault();
        const errorEl = $('#naError', el);
        errorEl.textContent = '';
        const clientValue = select.value;
        if (!clientValue) { errorEl.textContent = 'Escolha a cliente ou use o cadastro rápido.'; return; }

        const body = {
          serviceId: Number($('#naService', el).value),
          date: $('#naDate', el).value,
          time: $('#naTime', el).value,
          status: $('#naStatus', el).value,
          depositStatus: $('#naDeposit', el).value,
          paymentMethod: $('#naMethod', el).value,
          notes: $('#naNotes', el).value.trim()
        };
        if (clientValue === 'new') {
          body.clientName = $('#naName', el).value.trim();
          body.clientPhone = $('#naPhone', el).value.trim();
          body.clientEmail = $('#naEmail', el).value.trim();
          body.clientBirthdate = $('#naBirth', el).value || null;
          if (body.clientName.length < 2) { errorEl.textContent = 'Informe o nome da cliente.'; return; }
          if (!body.clientEmail) { errorEl.textContent = 'Informe o e-mail de acesso da cliente.'; return; }
          if (!body.clientPhone) { errorEl.textContent = 'Informe o WhatsApp com DDD.'; return; }
        } else {
          body.clientId = Number(clientValue);
        }
        if (!body.date) { errorEl.textContent = 'Escolha a data do atendimento.'; return; }
        if (!body.time) { errorEl.textContent = 'Escolha o horário.'; return; }

        const button = $('#naSave', el);
        setButtonBusy(button, true, 'Salvando...');
        try {
          const result = await api('/api/admin/appointments', { method: 'POST', body });
          close();
          toast(`Agendamento de ${result.appointment.client_name} criado.`, { type: 'success', title: 'Agenda atualizada' });
          state.apptIndex.set(Number(result.appointment.id), result.appointment);
          if (result.clientAccess) {
            showAccess({
              name: result.appointment.client_name,
              email: result.clientAccess.email,
              password: result.clientAccess.password,
              phone: result.appointment.client_phone
            });
          }
          renderView();
        } catch (error) {
          if (error.status === 401) { showGate('Sua sessão expirou. Entre novamente.'); return; }
          errorEl.textContent = error.message;
          setButtonBusy(button, false);
        }
      });
    }
  });
}

function openNewClient() {
  openModal(`
    <button class="modal-close" type="button" data-close aria-label="Fechar">${icon('x', 18)}</button>
    <h3>Nova cliente</h3>
    <p class="modal-sub">Cria a ficha, o histórico e um acesso para ela agendar pelo site.</p>
    <form class="adm-form" id="ncForm" novalidate>
      <div class="form-grid-2">
        <div class="field"><label for="ncName">Nome completo</label><input class="input" id="ncName" maxlength="120" required /></div>
        <div class="field"><label for="ncPhone">WhatsApp com DDD</label><input class="input" id="ncPhone" inputmode="tel" placeholder="(27) 99999-0000" required /></div>
      </div>
      <div class="form-grid-2">
        <div class="field"><label for="ncEmail">E-mail de acesso</label><input class="input" id="ncEmail" type="email" required /></div>
        <div class="field"><label for="ncBirth">Aniversário (opcional)</label><input class="input" id="ncBirth" type="date" /></div>
      </div>
      <div class="field"><label for="ncNotes">Anotações internas</label><textarea class="textarea" id="ncNotes" maxlength="1000" placeholder="Alergias, preferências, como conheceu o estúdio..."></textarea></div>
      <p class="inline-note">A senha de acesso é gerada automaticamente e mostrada no próximo passo.</p>
      <p class="form-error" id="ncError"></p>
      <div class="modal-actions">
        <button class="btn btn-outline" type="button" data-close>Cancelar</button>
        <button class="btn btn-primary" type="submit" id="ncSave">Cadastrar cliente</button>
      </div>
    </form>`, {
    size: 'modal-lg',
    onMount(el, close) {
      $('#ncForm', el).addEventListener('submit', async event => {
        event.preventDefault();
        const errorEl = $('#ncError', el);
        errorEl.textContent = '';
        const button = $('#ncSave', el);
        setButtonBusy(button, true, 'Cadastrando...');
        try {
          const result = await api('/api/admin/clients', {
            method: 'POST',
            body: {
              name: $('#ncName', el).value.trim(),
              phone: $('#ncPhone', el).value.trim(),
              email: $('#ncEmail', el).value.trim().toLowerCase(),
              birthdate: $('#ncBirth', el).value || null,
              notes: $('#ncNotes', el).value.trim()
            }
          });
          close();
          toast('Cliente cadastrada com ficha e acesso.', { type: 'success', title: 'Nova ficha' });
          state.clients = null;
          if (result.access?.password) {
            showAccess({ name: result.client.name, email: result.client.email, password: result.access.password, phone: result.client.phone });
          }
          renderView();
        } catch (error) {
          if (error.status === 401) { showGate('Sua sessão expirou. Entre novamente.'); return; }
          errorEl.textContent = error.message;
          setButtonBusy(button, false);
        }
      });
    }
  });
}

function openAppointment(id) {
  const appointment = state.apptIndex.get(Number(id));
  if (!appointment) return;
  const message = apptMessage(appointment);
  const statusOptions = ['pendente', 'confirmado', 'concluido', 'cancelado', 'faltou'].map(value =>
    `<option value="${value}" ${appointment.status === value ? 'selected' : ''}>${STATUS_META[value].label}</option>`).join('');
  const depositOptions = ['pendente', 'informado', 'pago'].map(value =>
    `<option value="${value}" ${appointment.deposit_status === value ? 'selected' : ''}>${value === 'pago' ? 'Sinal pago' : value === 'informado' ? 'Sinal informado' : 'Sinal pendente'}</option>`).join('');
  const methodOptions = Object.entries(METHOD_LABEL).map(([value, label]) =>
    `<option value="${value}" ${appointment.payment_method === value ? 'selected' : ''}>${label}</option>`).join('');

  openModal(`
    <button class="modal-close" type="button" data-close aria-label="Fechar">${icon('x', 18)}</button>
    <h3>${esc(appointment.client_name)}</h3>
    <p class="modal-sub">${esc(appointment.service_name)} · ${dateLong(appointment.date)} às ${esc(appointment.time)} · ${durationLabel(appointment.duration_min)}</p>
    <div class="appt-summary">
      <strong>${money(appointment.price)} ${depositBadge(appointment.deposit_status)}</strong>
      <span>Sinal de ${money(appointment.deposit_amount)} · ${statusBadge(appointment.status)} · ${appointment.source === 'manual' ? 'criado no estúdio' : 'agendado online'}</span>
      <span>${esc(phoneDisplay(appointment.client_phone))}${appointment.client_email ? ` · ${esc(appointment.client_email)}` : ''}</span>
    </div>
    <div class="appt-contact">
      <a class="btn btn-outline btn-xs" href="${waLink(appointment.client_phone, message)}" target="_blank" rel="noopener">${waIcon(13)} WhatsApp</a>
      <a class="btn btn-quiet btn-xs" href="tel:+${esc(String(appointment.client_phone).replace(/\D/g, ''))}">${icon('phone', 13)} Ligar</a>
    </div>
    ${appointment.notes ? `<div class="appt-note" style="margin-top:10px"><b>Observação:</b> ${esc(appointment.notes)}</div>` : ''}
    <form class="adm-form" id="apForm" style="margin-top:14px" novalidate>
      <div class="form-grid-2">
        <div class="field"><label for="apStatus">Status</label><select class="select" id="apStatus">${statusOptions}</select></div>
        <div class="field"><label for="apDeposit">Sinal</label><select class="select" id="apDeposit">${depositOptions}</select></div>
      </div>
      <div class="form-grid-3">
        <div class="field"><label for="apDate">Data</label><input class="input" id="apDate" type="date" value="${appointment.date}" /></div>
        <div class="field"><label for="apTime">Horário</label><input class="input" id="apTime" type="time" step="900" value="${esc(appointment.time)}" /></div>
        <div class="field"><label for="apMethod">Pagamento</label><select class="select" id="apMethod">${methodOptions}</select></div>
      </div>
      <div class="field"><label for="apNotes">Observações internas</label><textarea class="textarea" id="apNotes" maxlength="1000">${esc(appointment.notes || '')}</textarea></div>
      <p class="form-error" id="apError"></p>
      <div class="modal-actions" style="justify-content:space-between">
        <button class="btn btn-quiet" type="button" id="apCancel" style="color:var(--danger)">Cancelar horário</button>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${['pendente', 'confirmado'].includes(appointment.status) ? `<button class="btn btn-outline" type="button" id="apDone">${icon('checkCircle', 14)} Concluir</button>` : ''}
          <button class="btn btn-primary" type="submit" id="apSave">Salvar alterações</button>
        </div>
      </div>
    </form>`, {
    size: 'modal-lg',
    onMount(el, close) {
      $('#apForm', el).addEventListener('submit', async event => {
        event.preventDefault();
        const errorEl = $('#apError', el);
        errorEl.textContent = '';
        const button = $('#apSave', el);
        setButtonBusy(button, true, 'Salvando...');
        try {
          const { appointment: updated } = await api(`/api/admin/appointments/${appointment.id}`, {
            method: 'PATCH',
            body: {
              status: $('#apStatus', el).value,
              depositStatus: $('#apDeposit', el).value,
              paymentMethod: $('#apMethod', el).value,
              date: $('#apDate', el).value,
              time: $('#apTime', el).value,
              notes: $('#apNotes', el).value.trim()
            }
          });
          state.apptIndex.set(Number(updated.id), updated);
          toast('Agendamento atualizado.', { type: 'success' });
          close();
          renderView();
        } catch (error) {
          if (error.status === 401) { showGate('Sua sessão expirou. Entre novamente.'); return; }
          errorEl.textContent = error.message;
          setButtonBusy(button, false);
        }
      });

      $('#apDone', el)?.addEventListener('click', async () => {
        const confirmed = await confirmAction({
          title: 'Concluir atendimento?',
          message: `O valor de ${money(appointment.price)} entra no caixa e a manutenção da cliente é renovada.`,
          confirmLabel: 'Concluir e lançar no caixa'
        });
        if (!confirmed) return;
        try {
          await patchAppointment(appointment.id, { status: 'concluido' });
          close();
          toast('Atendimento concluído e lançado no caixa.', { type: 'success', title: 'Tudo certo' });
          renderView();
        } catch (error) {
          notifyError(error);
        }
      });

      $('#apCancel', el)?.addEventListener('click', async () => {
        const confirmed = await confirmAction({
          title: 'Cancelar este horário?',
          message: 'O horário volta a ficar livre na agenda. Avise a cliente pelo WhatsApp se ela não cancelou.',
          confirmLabel: 'Cancelar horário',
          danger: true
        });
        if (!confirmed) return;
        try {
          await patchAppointment(appointment.id, { status: 'cancelado' });
          close();
          toast('Horário cancelado.', { type: 'success' });
          renderView();
        } catch (error) {
          notifyError(error);
        }
      });
    }
  });
}

async function patchAppointment(id, changes) {
  const { appointment } = await api(`/api/admin/appointments/${id}`, { method: 'PATCH', body: changes });
  state.apptIndex.set(Number(appointment.id), appointment);
  return appointment;
}

async function quickStatus(id, quick) {
  const appointment = state.apptIndex.get(Number(id));
  if (!appointment) return;

  if (quick === 'concluir') {
    const confirmed = await confirmAction({
      title: 'Concluir atendimento?',
      message: `${appointment.client_name} · ${appointment.service_name}. O valor de ${money(appointment.price)} entra no caixa e a manutenção é renovada.`,
      confirmLabel: 'Concluir atendimento'
    });
    if (!confirmed) return;
  }

  const changes = quick === 'confirmar' ? { status: 'confirmado' }
    : quick === 'concluir' ? { status: 'concluido' }
      : { depositStatus: 'pago' };

  try {
    await patchAppointment(appointment.id, changes);
    if (quick === 'confirmar') toast('Presença confirmada.', { type: 'success' });
    else if (quick === 'concluir') toast('Atendimento concluído e lançado no caixa.', { type: 'success' });
    else toast('Sinal confirmado e lançado no caixa.', { type: 'success' });
    renderView();
  } catch (error) {
    notifyError(error, 'Não foi possível atualizar');
  }
}

async function resetClientPassword(id) {
  const client = state.currentClient && Number(state.currentClient.id) === Number(id)
    ? state.currentClient
    : { name: 'cliente', phone: '' };
  try {
    const data = await api(`/api/admin/clients/${id}/reset-password`, { method: 'POST' });
    showAccess({ name: client.name, email: data.email, password: data.password, phone: client.phone });
  } catch (error) {
    notifyError(error, 'Não foi possível redefinir');
  }
}

/* ============================================================
   notificações em tempo real
   ============================================================ */
function connectWS() {
  if (state.ws) {
    try { state.ws.close(); } catch { /* noop */ }
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let socket;
  try {
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
  } catch {
    setLive(false);
    return;
  }
  state.ws = socket;
  socket.addEventListener('open', () => setLive(true));
  socket.addEventListener('close', () => {
    if (state.ws !== socket) return;
    setLive(false);
    if (state.user) setTimeout(connectWS, 6000);
  });
  socket.addEventListener('error', () => {
    try { socket.close(); } catch { /* noop */ }
  });
  socket.addEventListener('message', event => {
    try {
      handleRealtime(JSON.parse(event.data));
    } catch { /* noop */ }
  });
}

function setLive(on) {
  const pill = $('#livePill');
  if (!pill) return;
  pill.classList.toggle('on', on);
  const label = $('#liveText');
  if (label) label.textContent = on ? 'Ao vivo' : 'Reconectando';
}

function handleRealtime(event) {
  if (!event?.type || event.type === 'connected') return;
  state.notifs.unshift({ ...event, read: false, key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  if (state.notifs.length > 40) state.notifs.length = 40;
  renderNotifBadge();
  renderNotifList();

  const meta = NOTIF_META[event.type] || { icon: 'bell' };
  if (Date.now() >= selfActionUntil) {
    toast(event.message, {
      type: event.type === 'deposit:reported' ? 'whatsapp' : 'info',
      title: event.title || 'Movimentação no estúdio',
      iconName: meta.icon
    });
  }

  const liveViews = ['dashboard', 'agenda', 'financeiro', 'retornos'];
  if (liveViews.includes(state.view)) scheduleRefresh();
  else if (event.type === 'client:new' && state.view === 'clientes' && !state.param) scheduleRefresh();
  else if (state.view === 'clientes' && state.param && Number(event.clientId) === Number(state.param)) scheduleRefresh();
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (modalEl) { state.pendingRefresh = true; return; }
    renderView();
  }, 700);
}

function renderNotifBadge() {
  const count = state.notifs.filter(item => !item.read).length;
  const badge = $('#notifCount');
  if (!badge) return;
  badge.hidden = count === 0;
  badge.textContent = count > 9 ? '9+' : String(count);
}

function renderNotifList() {
  const body = $('#notifBody');
  if (!body) return;
  if (!state.notifs.length) {
    body.innerHTML = `<div class="notif-empty">${icon('bell', 22)}<span>Nada por aqui ainda. As movimentações do estúdio aparecem em tempo real.</span></div>`;
    return;
  }
  body.innerHTML = state.notifs.map(item => {
    const meta = NOTIF_META[item.type] || { icon: 'bell', tone: '' };
    return `<article class="notif-item ${item.read ? '' : 'unread'}" data-key="${item.key}">
      <span class="mini-ico ${meta.tone || ''}">${icon(meta.icon, 13)}</span>
      <div class="mini-text">
        <strong>${esc(item.title || 'Movimentação')}</strong>
        <span>${esc(item.message || '')}</span>
        <time>${timeAgo(item.at)}</time>
      </div>
    </article>`;
  }).join('');
}

/* ============================================================
   eventos globais
   ============================================================ */
function handleAction(button, event) {
  const action = button.dataset.act;
  switch (action) {
    case 'new-appt':
      openNewAppointment({ clientId: button.dataset.client ? Number(button.dataset.client) : null });
      break;
    case 'new-client':
      openNewClient();
      break;
    case 'appt-open':
      openAppointment(button.dataset.id);
      break;
    case 'appt-quick':
      quickStatus(button.dataset.id, button.dataset.quick);
      break;
    case 'client-open':
      if (event.target.closest('a, button')) break;
      location.hash = `#/clientes/${button.dataset.id}`;
      break;
    case 'client-reset':
      resetClientPassword(button.dataset.id);
      break;
    case 'svc-new':
      openServiceModal();
      break;
    case 'svc-edit': {
      const service = state.services.find(item => Number(item.id) === Number(button.dataset.id));
      if (service) openServiceModal(service);
      break;
    }
    case 'svc-toggle':
      toggleService(button.dataset.id);
      break;
    case 'pf-del':
      deletePortfolio(button.dataset.id);
      break;
    case 'fin-del':
      deleteFinance(button.dataset.id);
      break;
    case 'fin-preset':
      applyFinancePreset(button.dataset.preset);
      break;
    case 'agenda-shift':
      shiftAgendaDate(Number(button.dataset.delta) || 1);
      break;
    case 'agenda-today':
      state.date = todayISO();
      renderView();
      break;
    case 'agenda-filter':
      state.agendaFilter = button.dataset.status;
      renderView();
      break;
    case 'copy': {
      const text = decodeURIComponent(button.dataset.copy || '');
      copyText(text).then(() => toast('Mensagem copiada. Cole no WhatsApp.', { type: 'success' }));
      break;
    }
    case 'copy-service-link': {
      const select = $('#linkService');
      const serviceId = select?.value;
      copyText(bookingLink(serviceId)).then(() => toast('Link do serviço copiado.', { type: 'success' }));
      break;
    }
    case 'retry':
      renderView();
      break;
    default:
      break;
  }
}

function bindShell() {
  $('#logoutBtn')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* noop */ }
    if (state.ws) state.ws.onclose = null;
    location.href = '/';
  });

  const toggle = $('#sideToggle');
  const side = $('#admSide');
  const scrim = $('#sideScrim');
  const closeSide = () => {
    side.classList.remove('open');
    if (scrim) scrim.hidden = true;
  };
  toggle?.addEventListener('click', () => {
    const open = !side.classList.contains('open');
    side.classList.toggle('open', open);
    if (scrim) scrim.hidden = !open;
  });
  scrim?.addEventListener('click', closeSide);

  $('#newApptBtn')?.addEventListener('click', () => openNewAppointment());
  $('#notifBtn')?.addEventListener('click', () => {
    const panel = $('#notifPanel');
    const open = !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    if (open) renderNotifList();
  });
  $('#notifClose')?.addEventListener('click', () => $('#notifPanel').classList.remove('open'));
  $('#notifReadAll')?.addEventListener('click', () => {
    state.notifs.forEach(item => { item.read = true; });
    renderNotifBadge();
    renderNotifList();
  });
  $('#notifBody')?.addEventListener('click', event => {
    const item = event.target.closest('.notif-item');
    if (!item) return;
    const found = state.notifs.find(entry => entry.key === item.dataset.key);
    if (found) found.read = true;
    item.classList.remove('unread');
    renderNotifBadge();
  });

  document.addEventListener('click', event => {
    const panel = $('#notifPanel');
    if (panel.classList.contains('open') && !panel.contains(event.target) && !event.target.closest('#notifBtn')) {
      panel.classList.remove('open');
    }
    const actionEl = event.target.closest('[data-act]');
    if (actionEl) handleAction(actionEl, event);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      $('#notifPanel')?.classList.remove('open');
    }
  });

  window.addEventListener('hashchange', route);
}

function closeSidebar() {
  const side = $('#admSide');
  const scrim = $('#sideScrim');
  if (!side) return;
  side.classList.remove('open');
  if (scrim) scrim.hidden = true;
}

function fillSidebar() {
  const user = state.user;
  if (!user) return;
  $('#sideName').textContent = user.name || 'Studio Paula Souza';
  $('#sideEmail').textContent = user.email || '';
  $('#sideAvatar').textContent = initials(user.name || 'Studio Paula Souza');
}

/* ============================================================
   inicialização
   ============================================================ */
function bindGate() {
  $('#gateForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const errorEl = $('#gateError');
    const button = $('#gateSubmit');
    errorEl.textContent = '';
    const email = $('#gateEmail').value.trim();
    const password = $('#gatePassword').value;
    if (!email || !password) { errorEl.textContent = 'Preencha e-mail e senha.'; return; }
    setButtonBusy(button, true, 'Entrando...');
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      if (!user || user.role !== 'admin') {
        errorEl.textContent = 'Esta conta é de cliente. Use a área da cliente para ver seus horários.';
        setButtonBusy(button, false);
        return;
      }
      start(user);
    } catch (error) {
      errorEl.textContent = error.message;
      setButtonBusy(button, false);
    }
  });
}

function start(user) {
  state.user = user;
  $('#boot').hidden = true;
  $('#gate').hidden = true;
  $('#app').hidden = false;
  fillSidebar();
  loadSite().catch(() => {});
  if (!location.hash) history.replaceState(null, '', '#/dashboard');
  route();
  connectWS();
  renderNotifList();
}

async function init() {
  bindShell();
  bindGate();
  $$('.adm-nav a').forEach(link => {
    const map = { dashboard: 'dashboard', agenda: 'calendar', clientes: 'users', servicos: 'sparkles', portfolio: 'image', financeiro: 'wallet', retornos: 'repeat', contato: 'instagram' };
    link.querySelector('.nav-ico').innerHTML = icon(map[link.dataset.view] || 'dashboard', 15);
  });
  $('.adm-share .nav-ico').innerHTML = icon('external', 15);
  $('#logoutBtn').innerHTML = icon('logout', 15);
  $('#sideToggle').innerHTML = icon('menu', 17);
  $('#notifGlyph').innerHTML = icon('bell', 17);
  $('#newApptBtn').innerHTML = `${icon('plus', 14)} Novo agendamento`;

  try {
    const { user } = await api('/api/auth/me');
    if (user && user.role === 'admin') { start(user); return; }
    showGate(user ? 'Esta conta é de cliente. Entre com o acesso do estúdio para abrir o painel.' : '');
  } catch {
    showGate();
  }
}

init();
