import {
  $, $$, esc, api, icon, money, dateLong, dateShort, weekdayShort, durationLabel,
  statusBadge, depositBadge, toast, confirmAction, waLink, waIcon, phoneDisplay,
  normalizePhone, initials, firstName, setButtonBusy, initHeader, copyText
} from './ui.js';

const state = {
  site: null,
  user: null,
  data: null,
  pixTarget: null,
  refreshing: false,
  refreshQueued: false
};

const CATEGORY_LABEL = {
  cilios: 'Cílios',
  unhas: 'Unhas em gel',
  manicure: 'Manicure',
  pedicure: 'Pedicure'
};

function categoryGlyph(category) {
  if (category === 'cilios') return 'sparkles';
  if (category === 'unhas') return 'sparkle';
  return 'heart';
}

function hydrateStaticIcons(root = document) {
  $$('[data-icon]', root).forEach(node => {
    node.innerHTML = icon(node.dataset.icon, Number(node.dataset.size || 18));
  });
}

function appointmentDate(row) {
  return new Date(`${row.date}T${row.time}:00`);
}

function canCancel(row) {
  if (!['pendente', 'confirmado'].includes(row.status)) return false;
  const hours = (appointmentDate(row).getTime() - Date.now()) / 3600000;
  return hours >= Number(state.site.business.cancelHours);
}

function canConfirm(row) {
  return row.status === 'pendente' && appointmentDate(row).getTime() > Date.now();
}

function shortDateParts(iso) {
  const [, m, d] = String(iso).split('-');
  return { day: d, month: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(`${iso}T12:00:00`)).replace('.', '') };
}

function memberSince(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(date).replace('.', '');
}

function waStudio(text) {
  return waLink(state.site.business.whatsapp, text);
}

/* ---------------- próximo horário ---------------- */
function renderNext() {
  const wrap = $('#nextWrap');
  const next = state.data.upcoming[0];
  if (!next) {
    wrap.innerHTML = `
      <div class="next-card">
        <span class="eyebrow light"><span class="dot"></span> Próximo passo</span>
        <div class="next-empty">
          <h2>Sem horário marcado.</h2>
          <p>Que tal cuidar de você esta semana? Escolha um serviço e o horário que combina com a sua rotina.</p>
          <a class="btn btn-light" href="/agendar">Escolher meu horário ${icon('arrowRight', 15)}</a>
        </div>
      </div>`;
    return;
  }

  const dep = next.deposit_status;
  const actions = [];
  if (canConfirm(next)) {
    actions.push(`<button class="btn btn-outline btn-sm" type="button" data-confirm="${next.id}">${icon('check', 14)} Confirmar presença</button>`);
  }
  if (dep !== 'pago') {
    actions.push(`<button class="btn btn-light btn-sm" type="button" data-pix="${next.id}">${icon('pix', 15)} ${dep === 'informado' ? 'Ver sinal Pix' : 'Pagar sinal via Pix'}</button>`);
  }
  actions.push(`<a class="btn btn-outline btn-sm" href="${waStudio(`Olá! Sou ${state.user.name} e tenho um horário de ${next.service_name} em ${dateLong(next.date)} às ${next.time}. Gostaria de falar sobre ele.`)}" target="_blank" rel="noopener">${waIcon(14)} Falar no estúdio</a>`);
  if (canCancel(next)) {
    actions.push(`<button class="btn btn-outline btn-sm" type="button" data-cancel="${next.id}">Cancelar</button>`);
  }

  const depNote = dep === 'pago'
    ? '<span class="dot" style="background:#d8ecd9"></span> Sinal confirmado'
    : dep === 'informado'
      ? 'Sinal em conferência pelo estúdio'
      : `Sinal de ${money(next.deposit_amount)} via Pix`;

  wrap.innerHTML = `
    <div class="next-card">
      <span class="eyebrow light"><span class="dot"></span> Próximo horário</span>
      <h2>${dateLong(next.date)}</h2>
      <div class="next-when">${icon('clock', 15)} <strong>${next.time}</strong> · ${durationLabel(next.duration_min)} · ${esc(next.service_name)}</div>
      <div class="next-service">
        <span class="next-mark">${icon(categoryGlyph(next.service_category), 20)}</span>
        <div>
          <strong>${esc(next.service_name)}</strong>
          <span>${CATEGORY_LABEL[next.service_category] || ''} · ${money(next.price)} · ${esc(depNote)}</span>
        </div>
        <div class="next-chips">${statusBadge(next.status)}${depositBadge(dep)}</div>
      </div>
      <div class="next-actions">${actions.join('')}</div>
    </div>`;
}

/* ---------------- métricas ---------------- */
function renderStats() {
  const { stats } = state.data;
  $('#statsRow').innerHTML = `
    <div class="stat-tile"><span>Visitas</span><strong>${stats.visits}</strong><em>atendimentos concluídos</em></div>
    <div class="stat-tile"><span>Investido</span><strong>${money(stats.spent)}</strong><em>em cuidados com você</em></div>
    <div class="stat-tile"><span>Cliente desde</span><strong>${memberSince(stats.memberSince)}</strong><em>${stats.upcoming} horário${stats.upcoming === 1 ? '' : 's'} a caminho</em></div>`;
}

/* ---------------- retornos ---------------- */
function renderMaintenance() {
  const area = $('#maintenanceArea');
  const items = state.data.maintenance;
  if (!items.length) {
    area.innerHTML = `<div class="empty-state" style="padding:26px 12px">
      <div class="empty-glyph">${icon('repeat', 22)}</div>
      <h3>Seus retornos aparecem aqui</h3>
      <p>Depois do primeiro atendimento concluído, o estúdio calcula quando é hora de voltar.</p>
      <a class="btn btn-outline btn-sm" href="/agendar">Agendar meu primeiro horário</a>
    </div>`;
    return;
  }

  area.innerHTML = `<div class="maint-list">${items.map(item => {
    const late = item.daysLeft < 0;
    const soon = item.daysLeft >= 0 && item.daysLeft <= 7;
    const statusChip = late
      ? `<span class="chip chip-pendente">${icon('alert', 12)} ${Math.abs(item.daysLeft)} dia${Math.abs(item.daysLeft) === 1 ? '' : 's'} de atraso</span>`
      : soon
        ? `<span class="chip chip-informado">${icon('clock', 12)} ${item.daysLeft === 0 ? 'é hoje' : `faltam ${item.daysLeft} dias`}</span>`
        : `<span class="chip chip-pago">${icon('check', 12)} em dia</span>`;
    return `
      <div class="maint-item ${late ? 'late' : ''}">
        <span class="maint-mark">${icon(categoryGlyph(item.category), 18)}</span>
        <div class="maint-info">
          <strong>${esc(item.service_name)}</strong>
          <span>Último em ${dateShort(item.last_date)} · retorno a cada ${item.maintenance_days} dias</span>
        </div>
        <div class="maint-due">
          <strong>${dateShort(item.due)}</strong>
          ${statusChip}
        </div>
        <a class="btn btn-outline btn-xs" href="/agendar?servico=${item.service_id}">Agendar</a>
      </div>`;
  }).join('')}</div>`;
}

/* ---------------- horários ---------------- */
function apptRow(row, { history = false } = {}) {
  const parts = shortDateParts(row.date);
  const chip = history ? statusBadge(row.status) : `${statusBadge(row.status)}${row.deposit_status !== 'pago' ? depositBadge(row.deposit_status) : ''}`;
  const actions = [];

  if (!history) {
    if (canConfirm(row)) actions.push(`<button class="btn btn-outline btn-xs" type="button" data-confirm="${row.id}">Confirmar</button>`);
    if (row.deposit_status !== 'pago') actions.push(`<button class="btn btn-outline btn-xs" type="button" data-pix="${row.id}">${icon('pix', 12)} Sinal</button>`);
    if (canCancel(row)) actions.push(`<button class="btn btn-quiet btn-xs" type="button" data-cancel="${row.id}">Cancelar</button>`);
  } else if (row.status === 'concluido') {
    actions.push(`<a class="btn btn-quiet btn-xs" href="/agendar?servico=${row.service_id}">Agendar de novo</a>`);
  }

  return `
    <div class="appt-row">
      <div class="appt-date"><strong>${parts.day}</strong><span>${parts.month}</span></div>
      <div class="appt-info">
        <strong>${esc(row.service_name)}</strong>
        <span>${history ? dateShort(row.date) : `${weekdayShort(row.date)}, ${dateShort(row.date)}`} às ${row.time} · ${durationLabel(row.duration_min)} · ${money(row.price)}</span>
      </div>
      <div class="appt-side">${chip}${actions.join('')}</div>
    </div>`;
}

function renderAppointments() {
  const area = $('#appointmentsArea');
  const { upcoming, history } = state.data;
  const later = upcoming.slice(1);
  const completed = history.slice(0, 12);
  let html = '';

  if (later.length) {
    html += `<div class="history-head"><span>Também marcados</span><span>${later.length}</span></div>
      <div class="appt-list">${later.map(row => apptRow(row)).join('')}</div>`;
  }

  if (completed.length) {
    html += `<div class="history-head"><span>Histórico</span><span>${completed.length} atendimento${completed.length === 1 ? '' : 's'}</span></div>
      <div class="appt-list">${completed.map(row => apptRow(row, { history: true })).join('')}</div>`;
  }

  if (!later.length && !completed.length) {
    html = `<div class="empty-state" style="padding:28px 12px">
      <div class="empty-glyph">${icon('calendar', 22)}</div>
      <h3>Seu histórico começa aqui</h3>
      <p>Quando você concluir um atendimento, ele fica registrado com data, serviço e valor.</p>
      <a class="btn btn-outline btn-sm" href="/agendar">Agendar meu primeiro horário</a>
    </div>`;
  }

  area.innerHTML = html;
}

/* ---------------- cabeçalho e estúdio ---------------- */
function renderHeader() {
  const first = firstName(state.user.name);
  $('#accountFirstName').textContent = first || 'cliente';
  const upcoming = state.data.upcoming.length;
  $('#accountLead').textContent = upcoming
    ? `Você tem ${upcoming} horário${upcoming === 1 ? '' : 's'} marcado${upcoming === 1 ? '' : 's'}. Tudo organizado aqui, sem depender de conversa no WhatsApp.`
    : 'Seus horários, retornos e histórico em um só lugar. Vamos marcar seu próximo cuidado?';
  $('#headName').textContent = first || 'Minha conta';
  $('#headAvatar').textContent = initials(state.user.name);
  $('#profileName').value = state.user.name || '';
  $('#profilePhone').value = phoneDisplay(state.user.phone) || '';
  $('#profileBirth').value = state.user.birthdate ? String(state.user.birthdate).slice(0, 10) : '';
  $('#profileEmail').textContent = state.user.email || '—';
  $('#cancelPolicy').textContent = `${state.site.business.cancelHours}h`;
}

function renderStudio() {
  const business = state.site.business;
  $('#studioAddress').textContent = business.address || '—';
  $('#footTagline').textContent = `${business.shortName} · ${business.tagline}`;
  const hours = business.hours || {};
  const line = range => range ? `${range[0]} – ${range[1]}` : 'fechado';
  const rows = [
    ['Segunda a sexta', line(hours['1'])],
    ['Sábado', line(hours['6'])],
    ['Domingo', line(hours['0'])]
  ];
  $('#studioHours').innerHTML = rows.map(([label, value]) => `<span><b>${label}</b>${esc(value)}</span>`).join('');
  $$('a[data-wa]').forEach(node => {
    node.href = waStudio('Olá! Sou cliente do Studio Lumière e preciso de ajuda com meu agendamento.');
    node.target = '_blank';
    node.rel = 'noopener';
  });
}

/* ---------------- dados ---------------- */
async function loadData() {
  const data = await api('/api/my/appointments');
  state.data = data;
  state.user = data.user;
}

async function refresh(showToast = false) {
  if (state.refreshing) { state.refreshQueued = true; return; }
  state.refreshing = true;
  try {
    await loadData();
    renderHeader();
    renderNext();
    renderStats();
    renderMaintenance();
    renderAppointments();
    if (showToast) toast('Seus horários foram atualizados.', { type: 'info', title: 'Agenda atualizada' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    state.refreshing = false;
    if (state.refreshQueued) {
      state.refreshQueued = false;
      refresh(false);
    }
  }
}

/* ---------------- Pix ---------------- */
function closePix() {
  $('#pixModal').classList.remove('open');
  state.pixTarget = null;
}

function renderPix(pix) {
  const informado = pix.depositStatus === 'informado';
  const box = $('#pixContent');
  box.innerHTML = `
    <div class="modal-pix-grid">
      <div class="pix-qr-l"><img src="${esc(pix.qr)}" alt="QR Code para pagamento do sinal via Pix"></div>
      <div class="pix-side">
        <div class="pix-amount"><span>Sinal de</span><strong>${money(pix.amount)}</strong></div>
        <div class="pix-key-line"><span>Chave Pix</span>${esc(pix.pixKey)}</div>
        <div class="pix-copy">
          <div class="pix-code-row">
            <input class="input" readonly id="pixPayload" value="${esc(pix.payload)}">
            <button class="btn btn-outline btn-sm" type="button" data-copy>${icon('copy', 14)} Copiar</button>
          </div>
        </div>
        <div class="pix-modal-actions">
          ${informado
            ? `<span class="pix-report-ok">${icon('clock', 15)} Aviso enviado — o estúdio confirma o recebimento.</span>`
            : `<button class="btn btn-primary btn-sm" type="button" data-pix-paid>${icon('check', 15)} Já fiz o Pix</button>`}
          <a class="btn btn-outline btn-sm" href="${waStudio(`Olá! Sou ${state.user.name}. Paguei o sinal de ${pix.serviceName} (${dateShort(pix.date)} às ${pix.time}) e estou enviando o comprovante.`)}" target="_blank" rel="noopener">${waIcon(14)} Enviar comprovante</a>
        </div>
      </div>
    </div>
    <p class="pix-modal-note">${informado
      ? 'Seu aviso chegou ao painel do estúdio. A confirmação do recebimento pode levar alguns minutos.'
      : 'Depois de pagar, toque em “Já fiz o Pix” para avisar o estúdio. O horário fica garantido após a conferência do sinal.'}</p>`;

  box.querySelector('[data-copy]')?.addEventListener('click', async () => {
    await copyText(pix.payload);
    toast('Código Pix copiado.', { type: 'success' });
  });

  box.querySelector('[data-pix-paid]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setButtonBusy(button, true, 'Avisando...');
    try {
      await api(`/api/my/appointments/${pix.appointmentId}/deposit`, { method: 'POST' });
      toast('Avisamos o estúdio. Você recebe a confirmação pelo WhatsApp.', { type: 'success', title: 'Sinal informado' });
      pix.depositStatus = 'informado';
      renderPix(pix);
      await refresh();
    } catch (error) {
      toast(error.message, { type: 'error' });
      setButtonBusy(button, false);
    }
  });
}

async function openPix(appointment) {
  state.pixTarget = appointment;
  const modal = $('#pixModal');
  $('#pixTitle').textContent = 'Garanta seu horário.';
  $('#pixSub').textContent = `${appointment.service_name} · ${dateLong(appointment.date)} às ${appointment.time}`;
  $('#pixContent').innerHTML = `<div class="loading-row"><span class="spinner"></span> Gerando seu Pix...</div>`;
  modal.classList.add('open');
  try {
    const pix = await api(`/api/deposit/${appointment.id}/pix`);
    // o modal permanece aberto somente para o horário atual
    if (state.pixTarget?.id !== appointment.id) return;
    renderPix(pix);
    if (pix.depositStatus === 'pago') {
      $('#pixContent').innerHTML = `<div class="pix-report-ok">${icon('checkCircle', 16)} Sinal já confirmado pelo estúdio. Tudo certo!</div>`;
    }
  } catch (error) {
    $('#pixContent').innerHTML = `<p class="field-error">${esc(error.message)}</p>
      <p class="pix-modal-note">Chave Pix do estúdio: <strong>${esc(state.site.business.pixKey)}</strong>. Em caso de dúvida, fale no WhatsApp.</p>`;
  }
}

/* ---------------- ações ---------------- */
async function submitProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const body = {
    name: $('#profileName').value.trim(),
    phone: normalizePhone($('#profilePhone').value),
    birthdate: $('#profileBirth').value || null
  };
  setButtonBusy(button, true, 'Salvando...');
  try {
    const { user } = await api('/api/my/profile', { method: 'PATCH', body });
    state.user = user;
    state.data.user = user;
    renderHeader();
    toast('Seus dados de contato foram atualizados.', { type: 'success', title: 'Dados salvos' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    setButtonBusy(button, false);
  }
}

async function submitPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const body = {
    currentPassword: $('#currentPass').value,
    newPassword: $('#newPass').value
  };
  setButtonBusy(button, true, 'Salvando...');
  try {
    await api('/api/my/password', { method: 'POST', body });
    form.reset();
    toast('Sua nova senha já está valendo.', { type: 'success', title: 'Senha salva' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    setButtonBusy(button, false);
  }
}

async function cancelAppointment(row) {
  const ok = await confirmAction({
    title: 'Cancelar este horário?',
    message: `${row.service_name} · ${dateLong(row.date)} às ${row.time}. Cancelamentos online até ${state.site.business.cancelHours}h antes do horário.`,
    confirmLabel: 'Sim, cancelar',
    cancelLabel: 'Manter horário',
    danger: true
  });
  if (!ok) return;
  try {
    await api(`/api/my/appointments/${row.id}/cancel`, { method: 'POST' });
    toast('Seu horário foi cancelado.', { type: 'success', title: 'Agendamento cancelado' });
    await refresh();
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

async function confirmPresence(row) {
  try {
    await api(`/api/my/appointments/${row.id}/confirm`, { method: 'POST' });
    toast('Presença confirmada. Te esperamos!', { type: 'success' });
    await refresh();
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

function findAppointment(id) {
  return state.data?.appointments.find(row => Number(row.id) === Number(id)) || null;
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* segue para a home */ }
  location.assign('/');
}

/* ---------------- tempo real ---------------- */
function connectWS() {
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    socket.addEventListener('message', event => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      const type = String(payload.type || '');
      if (!type.startsWith('appointment:') && !type.startsWith('deposit:')) return;
      if (Number(payload.clientId) !== Number(state.user?.id)) return;
      refresh(false);
    });
    socket.addEventListener('close', () => setTimeout(connectWS, 5000));
  } catch { /* sem tempo real, a página continua funcionando */ }
}

/* ---------------- init ---------------- */
async function init() {
  hydrateStaticIcons();
  initHeader();

  let site = null;
  try {
    site = await api('/api/site');
    state.site = site;
  } catch (error) {
    toast(error.message, { type: 'error' });
    return;
  }

  try {
    await loadData();
  } catch (error) {
    if (error.status === 401) {
      location.replace('/entrar?next=/minha-conta');
      return;
    }
    toast(error.message, { type: 'error' });
    return;
  }

  if (state.user.role === 'admin') {
    location.replace('/admin');
    return;
  }

  renderHeader();
  renderNext();
  renderStats();
  renderMaintenance();
  renderAppointments();
  renderStudio();

  $('#profileForm').addEventListener('submit', submitProfile);
  $('#passwordForm').addEventListener('submit', submitPassword);
  $('#logoutBtn').addEventListener('click', logout);
  $('#mobileLogout')?.addEventListener('click', event => { event.preventDefault(); logout(); });

  $('#pixClose').addEventListener('click', closePix);
  $('#pixModal').addEventListener('click', event => {
    if (event.target === event.currentTarget) closePix();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('#pixModal').classList.contains('open')) closePix();
  });

  document.addEventListener('click', event => {
    const confirmBtn = event.target.closest('[data-confirm]');
    if (confirmBtn) {
      const row = findAppointment(confirmBtn.dataset.confirm);
      if (row) confirmPresence(row);
      return;
    }
    const cancelBtn = event.target.closest('[data-cancel]');
    if (cancelBtn) {
      const row = findAppointment(cancelBtn.dataset.cancel);
      if (row) cancelAppointment(row);
      return;
    }
    const pixBtn = event.target.closest('[data-pix]');
    if (pixBtn) {
      const row = findAppointment(pixBtn.dataset.pix);
      if (row) openPix(row);
    }
  });

  connectWS();
}

init();
