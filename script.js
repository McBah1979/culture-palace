const menuButton = document.querySelector('#menuButton');
const mainNav = document.querySelector('#mainNav');
const visionButton = document.querySelector('#visionButton');
const adminButton = document.querySelector('#adminButton');
const adminDialog = document.querySelector('#adminDialog');
const adminClose = document.querySelector('#adminClose');
const adminForm = document.querySelector('#adminForm');
const adminStatus = document.querySelector('#adminStatus');

menuButton.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  mainNav.classList.toggle('open', !isOpen);
});

mainNav.addEventListener('click', (event) => {
  if (event.target.matches('a')) {
    menuButton.setAttribute('aria-expanded', 'false');
    mainNav.classList.remove('open');
  }
});

visionButton.addEventListener('click', () => {
  const enabled = document.body.classList.toggle('accessible');
  visionButton.setAttribute('aria-pressed', String(enabled));
  localStorage.setItem('accessibleView', String(enabled));
});

if (localStorage.getItem('accessibleView') === 'true') {
  document.body.classList.add('accessible');
  visionButton.setAttribute('aria-pressed', 'true');
}

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
  mainNav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  adminStatus.textContent = '';
  adminDialog.showModal();
});

adminClose.addEventListener('click', () => adminDialog.close());

adminDialog.addEventListener('click', (event) => {
  if (event.target === adminDialog) adminDialog.close();
});

adminForm.addEventListener('submit', (event) => {
  event.preventDefault();
  adminForm.reset();
  adminStatus.textContent = 'Сервер авторизации пока не подключён. Обратитесь к разработчику сайта.';
});
