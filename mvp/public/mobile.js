// Navegación móvil, altura de teclado y entrada de chat.
const mq = window.matchMedia('(max-width: 850px)');
const $ = selector => document.querySelector(selector);
const menu = $('#mobile-menu'), tools = $('#mobile-tools');
const sidebar = $('#mobile-sidebar'), panel = $('#mobile-tools-panel');
const veil = $('#mobile-backdrop'), answer = $('#answer');
let active = null, previouslyFocused = null;
function height() {
  if (mq.matches) document.documentElement.style.setProperty('--mobile-app-height', Math.round(window.visualViewport?.height || window.innerHeight) + 'px');
  else document.documentElement.style.removeProperty('--mobile-app-height');
}
function drawer(name, restore = true) {
  if (!mq.matches) name = null;
  if (name && !active) previouslyFocused = document.activeElement;
  const old = active;
  active = name;
  document.body.classList.toggle('mobile-nav-open', name === 'menu');
  document.body.classList.toggle('mobile-tools-open', name === 'tools');
  veil.hidden = !name;
  menu.setAttribute('aria-expanded', String(name === 'menu'));
  tools.setAttribute('aria-expanded', String(name === 'tools'));
  sidebar.inert = mq.matches && name !== 'menu';
  panel.inert = mq.matches && name !== 'tools';
  if (name === 'menu') $('#mobile-close-menu').focus();
  else if (name === 'tools') {
    $('#mobile-form-link').href = $('.top-actions a')?.href || './formulario.html';
    $('#mobile-close-tools').focus();
  } else if (old && restore && previouslyFocused?.isConnected) {
    previouslyFocused.focus();
    previouslyFocused = null;
  }
}
menu.addEventListener('click', () => drawer(active === 'menu' ? null : 'menu'));
tools.addEventListener('click', () => drawer(active === 'tools' ? null : 'tools'));
$('#mobile-close-menu').addEventListener('click', () => drawer(null));
$('#mobile-close-tools').addEventListener('click', () => drawer(null));
veil.addEventListener('click', () => drawer(null));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) drawer(null); });
sidebar.addEventListener('click', event => {
  if (event.target.closest('#new-case,#qa-mode,[data-open]')) drawer(null, false);
});
panel.addEventListener('click', event => {
  if (event.target.closest('[data-edit]')) drawer(null, false);
});
function resizeInput() {
  if (!mq.matches) { answer.style.height = ''; return; }
  answer.style.height = '46px';
  answer.style.height = Math.min(128, Math.max(46, answer.scrollHeight)) + 'px';
}
answer.addEventListener('input', resizeInput);
$('#composer').addEventListener('submit', () => setTimeout(resizeInput, 0));
mq.addEventListener('change', () => { height(); drawer(null, false); resizeInput(); });
window.addEventListener('resize', height);
window.visualViewport?.addEventListener('resize', height);
height(); drawer(null, false); resizeInput();
