import {
  $, $$, icon, waIcon, esc, money, durationLabel, api, waLink,
  revealOnScroll, initHeader, toast
} from './ui.js';

const CATEGORY_LABEL = {
  cilios: 'Cílios',
  unhas: 'Unhas em gel',
  manicure: 'Manicure',
  pedicure: 'Pedicure'
};

function hydrateStaticIcons() {
  $$('[data-icon]').forEach(node => {
    node.innerHTML = icon(node.dataset.icon, Number(node.dataset.size) || 20);
  });
  $$('[data-wa]').forEach(node => {
    node.innerHTML = waIcon(Number(node.dataset.wa) || 20);
  });
}

function serviceCard(service) {
  const cat = CATEGORY_LABEL[service.category] || 'Serviço';
  const maintenance = Number(service.maintenance_days) > 0
    ? `<span>${icon('repeat', 13)} manutenção ${service.maintenance_days} dias</span>`
    : '';
  return `<article class="service-card">
    <span class="service-cat">${esc(cat)}</span>
    <h3>${esc(service.name)}</h3>
    <p>${esc(service.description)}</p>
    <div class="service-meta">
      <span>${icon('clock', 13)} ${durationLabel(service.duration_min)}</span>
      ${maintenance}
    </div>
    <div class="service-bottom">
      <div class="service-price"><small>a partir de</small><strong>${money(service.price)}</strong></div>
      <a class="service-book" href="/agendar?servico=${service.id}" aria-label="Agendar ${esc(service.name)}">${icon('arrowRight', 17)}</a>
    </div>
  </article>`;
}

function renderServices(services) {
  const cilios = services.filter(service => service.category === 'cilios');
  const nails = services.filter(service => service.category !== 'cilios');
  const groups = [
    { title: 'Cílios & olhar', items: cilios },
    { title: 'Unhas & cuidados', items: nails }
  ].filter(group => group.items.length);

  $('#serviceGroups').innerHTML = groups.map(group => `
    <section class="service-group">
      <div class="service-group-head"><h3>${esc(group.title)}</h3><span></span></div>
      <div class="service-grid">${group.items.map(serviceCard).join('')}</div>
    </section>
  `).join('');
}

function portfolioCard(item) {
  const category = item.category === 'cilios' ? 'Cílios' : 'Unhas';
  return `<button class="portfolio-card" type="button" data-lightbox data-image="${esc(item.image)}" data-title="${esc(item.title)}" data-description="${esc(item.description || '')}" aria-label="Ampliar ${esc(item.title)}">
    <span class="portfolio-tag">${esc(category)}</span>
    <img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy">
    <span class="portfolio-overlay">
      <strong>${esc(item.title)}</strong>
      <span>${esc(item.description || '')}</span>
    </span>
  </button>`;
}

function renderPortfolio(items) {
  if (!items.length) {
    $('#portfolioGrid').innerHTML = '<p class="muted">O portfólio está sendo preparado com carinho.</p>';
    return;
  }
  $('#portfolioGrid').innerHTML = items.map(portfolioCard).join('');
  $$('#portfolioGrid img').forEach(img => {
    img.addEventListener('error', () => img.classList.add('missing'));
  });
}

function initLightbox() {
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-lightbox]');
    if (!trigger) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open';
    backdrop.innerHTML = `<div class="modal modal-lg" style="padding:0;overflow:hidden">
      <button class="modal-close" style="background:rgba(255,255,255,.85)" aria-label="Fechar">${icon('x', 18)}</button>
      <img src="${esc(trigger.dataset.image)}" alt="${esc(trigger.dataset.title)}" style="width:100%;max-height:70vh;object-fit:cover">
      <div style="padding:18px 22px 22px">
        <h3>${esc(trigger.dataset.title)}</h3>
        <p class="muted" style="font-size:13.5px">${esc(trigger.dataset.description)}</p>
      </div>
    </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    backdrop.querySelector('.modal-close').addEventListener('click', close);
    document.addEventListener('keydown', function onKey(event) {
      if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
  });
}

function setWhatsAppLinks(business) {
  $$('[data-wa-link]').forEach(link => {
    const message = link.dataset.waMessage || `Olá! Vim pelo site do ${business.name} e gostaria de saber mais.`;
    link.href = waLink(business.whatsapp, message);
    link.target = '_blank';
    link.rel = 'noopener';
  });
}

function handleHeroImage() {
  const image = $('#heroPhoto');
  if (!image) return;
  image.addEventListener('error', () => image.classList.add('missing'));
}

async function init() {
  hydrateStaticIcons();
  initHeader();
  handleHeroImage();
  initLightbox();
  revealOnScroll();
  $('#year').textContent = new Date().getFullYear();

  try {
    const data = await api('/api/site');
    setWhatsAppLinks(data.business);
    renderServices(data.services);
    renderPortfolio(data.portfolio);
    document.title = `${data.business.name} — ${data.business.tagline}`;
  } catch (error) {
    $('#serviceGroups').innerHTML = `<p class="muted">Não foi possível carregar os serviços agora. <a class="link-arrow" href="/agendar">Tente pelo agendamento</a>.</p>`;
    $('#portfolioGrid').innerHTML = '';
    setWhatsAppLinks({ name: 'Studio Lumière', whatsapp: '5527999990000' });
    toast('Não foi possível carregar o site agora. Tente novamente em instantes.', { type: 'error' });
  }
}

init();
