const menuButton = document.querySelector('#menuButton');
const mainNav = document.querySelector('#mainNav');
const visionButton = document.querySelector('#visionButton');
const adminButton = document.querySelector('#adminButton');
const adminDialog = document.querySelector('#adminDialog');
const adminClose = document.querySelector('#adminClose');
const adminForm = document.querySelector('#adminForm');
const adminStatus = document.querySelector('#adminStatus');
const speechPanel = document.querySelector('#speechPanel');
const speechHint = document.querySelector('#speechHint');
const speechStop = document.querySelector('#speechStop');
const speech = window.speechSynthesis;
let lastReadLink = null;
let lastReadTime = 0;

function closeMenu() {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Открыть меню');
  mainNav.classList.remove('open');
}

menuButton.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Открыть меню' : 'Закрыть меню');
  mainNav.classList.toggle('open', !isOpen);
});

mainNav.addEventListener('click', (event) => {
  if (event.target.matches('a')) {
    closeMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenu();
});

function setAccessibleView(enabled) {
  document.body.classList.toggle('accessible', enabled);
  visionButton.setAttribute('aria-pressed', String(enabled));
  speechPanel.hidden = !enabled;
  if (!enabled) {
    speech?.cancel();
    lastReadLink = null;
  }
  try { localStorage.setItem('accessibleView', String(enabled)); } catch { /* Storage may be disabled. */ }
}

visionButton.addEventListener('click', () => {
  setAccessibleView(!document.body.classList.contains('accessible'));
});

try {
  if (localStorage.getItem('accessibleView') === 'true') setAccessibleView(true);
} catch { /* Storage may be disabled. */ }

speechStop.addEventListener('click', () => {
  speech?.cancel();
  speechHint.textContent = 'Чтение остановлено. Нажмите на другой блок для озвучивания.';
});

document.addEventListener('click', (event) => {
  if (!document.body.classList.contains('accessible') || !(event.target instanceof Element)) return;
  if (event.target.closest('.site-header, .speech-panel, .admin-dialog form, input, textarea, select, details, summary')) return;

  const block = event.target.closest('.event-card, .studio-item, .channel-card, .hero-copy, .hero-stage, .about-visual, .about-copy, .contact-card, .quote-inner, .section-heading, .stats-grid > div, .info-row > div, .admin-dialog > p, #adminTitle');
  if (!block) return;
  const link = block.matches('a') ? block : null;
  if (event.target.closest('a') && !link) return;

  if (link) {
    if (lastReadLink === link && Date.now() - lastReadTime < 8000) {
      speech?.cancel();
      lastReadLink = null;
      return;
    }
    event.preventDefault();
    lastReadLink = link;
    lastReadTime = Date.now();
  } else lastReadLink = null;

  const imageDescription = [...block.querySelectorAll('img[alt]')]
    .filter((image) => image.alt && !image.closest('.hero-sticker'))
    .map((image) => image.alt).join('. ');
  const text = [imageDescription, block.innerText].filter(Boolean).join('. ').replace(/\s+/g, ' ').trim().slice(0, 1800);
  if (!text) return;
  if (!speech || !window.SpeechSynthesisUtterance) {
    speechHint.textContent = 'Озвучивание не поддерживается этим браузером.';
    return;
  }
  speech.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  utterance.rate = 0.9;
  const russianVoice = speech.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('ru'));
  if (russianVoice) utterance.voice = russianVoice;
  speech.speak(utterance);
  speechHint.textContent = link ? 'Читаю. Нажмите ещё раз, чтобы открыть ссылку.' : 'Читаю выбранный блок.';
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

document.querySelectorAll('details').forEach((details) => {
  details.addEventListener('toggle', () => {
    const marker = details.querySelector('summary span');
    if (marker) marker.textContent = details.open ? '−' : '+';
  });
});

adminButton.addEventListener('click', () => {
  closeMenu();
  adminStatus.textContent = '';
  adminDialog.showModal();
});

adminClose.addEventListener('click', () => adminDialog.close());

adminDialog.addEventListener('click', (event) => {
  if (event.target === adminDialog) adminDialog.close();
});
