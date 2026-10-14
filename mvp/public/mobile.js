// Adaptación del teclado móvil y del área de escritura al chat unificado.
const mobile = matchMedia('(max-width:760px)');
const answer = document.querySelector('#answer');
export function resizeComposer() {
  if (!answer) return;
  if (!mobile.matches && !matchMedia('(pointer:coarse)').matches) { answer.style.removeProperty('height'); return; }
  answer.style.height = 'auto';
  answer.style.height = `${Math.min(144, Math.max(32, answer.scrollHeight))}px`;
}
function updateViewport() {
  if (mobile.matches) document.documentElement.style.setProperty('--chat-viewport-height', `${Math.round(window.visualViewport?.height || window.innerHeight)}px`);
  else document.documentElement.style.removeProperty('--chat-viewport-height');
  resizeComposer();
}
answer?.addEventListener('input', resizeComposer);
window.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('resize', updateViewport);
mobile.addEventListener('change', updateViewport);
updateViewport();
