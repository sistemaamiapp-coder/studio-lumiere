export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

// Em produção (Qoder Sites) a API vive na função edge; no servidor local fica na raiz.
const API_BASE = typeof window !== 'undefined' ? (window.__API_BASE || '') : '';

export async function api(path, options = {}) {
  const opts = { credentials: 'same-origin', ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const url = API_BASE && path.startsWith('/api/') ? `${API_BASE}${path}` : path;
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const error = new Error(data.error || 'Não foi possível concluir a operação.');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const ICONS = {
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M8 3v3M16 3v3M3 9.5h18"/><path d="M8 13.5h2M14 13.5h2M8 17.5h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3 1.9"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
  pix: '<path d="m12 2.8 4.6 4.6a1.2 1.2 0 0 1 0 1.7L12 13.7 7.4 9.1a1.2 1.2 0 0 1 0-1.7L12 2.8Z"/><path d="m12 10.3 4.6 4.6a1.2 1.2 0 0 1 0 1.7L12 21.2l-4.6-4.6a1.2 1.2 0 0 1 0-1.7l4.6-4.6Z"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.4" cy="14.6" r="1.2"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><path d="M16 5.5a3 3 0 0 1 0 5.8"/><path d="M17.6 14.6c2 .5 3.3 2 3.6 4.4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9.5" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
  heart: '<path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9Z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.4l2.4 2.4 4.8-5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.2 4.2"/>',
  arrowRight: '<path d="M4 12h15"/><path d="M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M20 12H5"/><path d="M11 6l-6 6 6 6"/>',
  arrowUpRight: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevronRight: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  chevronDown: '<path d="M6 9.5 12 15l6-5.5"/>',
  logout: '<path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M13.5 6.5l3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  star: '<path fill="currentColor" stroke="none" d="M12 3.3l2.6 5.4 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.3Z"/>',
  phone: '<path d="M5 4h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4Z"/>',
  pin: '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  gift: '<rect x="4" y="8.5" width="16" height="11.5" rx="2"/><path d="M4 12.5h16M12 8.5V20"/><path d="M12 8.5c-3.7 0-5-1.3-5-2.8A2.4 2.4 0 0 1 11.8 5c.2 1.5-.6 3.5-5 3.5M12 8.5c3.7 0 5-1.3 5-2.8A2.4 2.4 0 0 0 12.2 5c-.2 1.5.6 3.5 5 3.5"/>',
  repeat: '<path d="M4 8.5h11a4.5 4.5 0 0 1 4.5 4.5v.5"/><path d="M20 15.5H9A4.5 4.5 0 0 1 4.5 11v-.5"/><path d="M16.5 5.5 20 8.5l-3.5 3M7.5 12.5 4 15.5l3.5 3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9.5Z"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M8 16.5 20 6"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r=".9" fill="currentColor" stroke="none"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M3 10h18"/><path d="M7 15h3"/>',
  trending: '<path d="M4 17l5-5 4 3 6-7"/><path d="M16 8h4v4"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.2"/>',
  send: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7-7-4L21 3Z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.5 3.2-5.5 7-5.5s6.3 2 7 5.5"/>',
  dashboard: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  list: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M8 3v3M16 3v3M3.5 9.5h17M8 13.5h3M8 17h6"/>',
  layers: '<path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z"/><path d="M3.5 12.5 12 17l8.5-4.5"/><path d="M3.5 17 12 21.5 20.5 17"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>'
};

export function icon(name, size = 18, cls = '') {
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function waIcon(size = 18) {
  return `<svg class="ico ico-wa" width="${size}" height="${size}" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>`;
}

export const STATUS_META = {
  pendente: { label: 'Aguardando', cls: 'pendente' },
  confirmado: { label: 'Confirmado', cls: 'confirmado' },
  concluido: { label: 'Concluído', cls: 'concluido' },
  cancelado: { label: 'Cancelado', cls: 'cancelado' },
  faltou: { label: 'Não compareceu', cls: 'faltou' }
};

export const DEPOSIT_META = {
  pendente: { label: 'Sinal pendente', cls: 'pendente' },
  informado: { label: 'Sinal informado', cls: 'informado' },
  pago: { label: 'Sinal pago', cls: 'pago' }
};

export function statusBadge(status) {
  const meta = STATUS_META[status] || { label: status, cls: 'pendente' };
  return `<span class="badge badge-${meta.cls}">${meta.label}</span>`;
}

export function depositBadge(status) {
  const meta = DEPOSIT_META[status] || { label: status, cls: 'pendente' };
  return `<span class="chip chip-${meta.cls}">${icon('pix', 13)}${meta.label}</span>`;
}

export function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

export function isoToDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

export function todayISO() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function addDaysISO(iso, days) {
  const date = isoToDate(iso);
  date.setDate(date.getDate() + days);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export function dateLong(iso) {
  const text = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(isoToDate(iso));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function dateShort(iso) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(isoToDate(iso));
}

export function weekdayShort(iso) {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(isoToDate(iso)).replace('.', '');
}

export function monthLong(iso) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(isoToDate(iso));
}

export function durationLabel(minutes) {
  const value = Number(minutes) || 0;
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  return digits;
}

export function phoneDisplay(value) {
  const digits = normalizePhone(value);
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value || '';
}

export function waLink(phone, text) {
  let digits = normalizePhone(phone);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  const suffix = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${suffix}`;
}

export function bookingLink(serviceId) {
  const base = `${location.origin}/agendar`;
  return serviceId ? `${base}?servico=${serviceId}` : base;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch { /* noop */ }
    area.remove();
    return true;
  }
}

export function pixQrDataUrl(payload, size = 240) {
  if (!payload || typeof qrcode !== 'function') return '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(String(payload));
    qr.make();
    const count = qr.getModuleCount();
    const quiet = 4;
    const cell = Math.max(2, Math.floor(size / (count + quiet * 2)));
    const dimension = cell * (count + quiet * 2);
    const canvas = document.createElement('canvas');
    canvas.width = dimension;
    canvas.height = dimension;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dimension, dimension);
    ctx.fillStyle = '#000000';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) ctx.fillRect((col + quiet) * cell, (row + quiet) * cell, cell, cell);
      }
    }
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

let toastContainer = null;export function toast(message, options = {}) {
  const { type = 'info', title = '', iconName = null } = options;
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-stack';
    toastContainer.id = 'toasts';
    document.body.appendChild(toastContainer);
  }
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  const glyph = iconName || (type === 'success' ? 'checkCircle' : type === 'error' ? 'alert' : type === 'whatsapp' ? 'send' : 'sparkles');
  node.innerHTML = `<div class="toast-glyph">${icon(glyph, 18)}</div><div class="toast-text">${title ? `<strong>${esc(title)}</strong>` : ''}<span>${esc(message)}</span></div><button class="toast-close" aria-label="Fechar">${icon('x', 14)}</button>`;
  toastContainer.appendChild(node);
  const remove = () => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 260);
  };
  node.querySelector('.toast-close').addEventListener('click', remove);
  setTimeout(remove, 5600);
}

export function confirmAction({ title = 'Confirmar ação', message = '', confirmLabel = 'Confirmar', cancelLabel = 'Voltar', danger = false }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open';
    backdrop.innerHTML = `
      <div class="modal modal-sm" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <button class="modal-close" aria-label="Fechar">${icon('x', 18)}</button>
        <div class="confirm-glyph ${danger ? 'danger' : ''}">${icon(danger ? 'alert' : 'sparkles', 22)}</div>
        <h3>${esc(title)}</h3>
        <p class="muted">${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-outline" data-answer="0">${esc(cancelLabel)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="1">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = answer => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(answer);
    };
    const onKey = event => { if (event.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(false); });
    backdrop.querySelector('.modal-close').addEventListener('click', () => close(false));
    backdrop.querySelectorAll('[data-answer]').forEach(button => {
      button.addEventListener('click', () => close(button.dataset.answer === '1'));
    });
  });
}

export function skeleton(lines = 3) {
  return `<div class="skeleton">${Array.from({ length: lines }, () => '<span></span>').join('')}</div>`;
}

export function emptyState(title, message, action = '') {
  return `<div class="empty-state">
    <div class="empty-glyph">${icon('sparkles', 24)}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(message)}</p>
    ${action}
  </div>`;
}

export function revealOnScroll() {
  const nodes = $$('.reveal');
  if (!nodes.length) return;
  if (!('IntersectionObserver' in window)) {
    nodes.forEach(node => node.classList.add('in'));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px' });
  nodes.forEach(node => observer.observe(node));
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function setButtonBusy(button, busy, label = 'Aguarde...') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}

export function initHeader() {
  const header = $('.site-head');
  if (!header) return;
  const button = $('.menu-btn', header);
  if (button) {
    button.addEventListener('click', () => {
      header.classList.toggle('nav-open');
      button.setAttribute('aria-expanded', header.classList.contains('nav-open') ? 'true' : 'false');
    });
    $$('.mobile-nav a', header).forEach(link => link.addEventListener('click', () => header.classList.remove('nav-open')));
  }
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 18);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}
