import { api, download } from './js/api.js';
import { esc, appendMessage } from './js/chat-render.js';
import { resizeComposer } from './mobile.js';
import { attachVoice } from './js/voice.js';

const $ = selector => document.querySelector(selector);
let current = null, conversations = [], busy = false, setupRequired = false, formats = [], deleteId = null, toastTimer;
const caseRoute = tail => `/api/cases/${current.case.id}/${tail}`;
const voice = attachVoice({ send, getConversation: () => current, getConsent: () => $('#ai-consent').checked, onDictation(text) { $('#answer').value = ($('#answer').value.trim() + ' ' + text).trim().slice(0, 4000); resizeComposer(); $('#answer').focus(); toast('Dictado listo. Revisa el texto y pulsa Enviar.'); } });
function showError(error) {
  $('#chat-error').textContent = error.message || String(error);
  if (error.status === 401) { $('#workspace').hidden = true; $('#auth-screen').hidden = false; }
}
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000); }
function scrollEnd() { $('#thread').scrollTop = $('#thread').scrollHeight; }
function closePanels() { $('#sidebar').classList.remove('open'); $('#document-panel').hidden = true; $('#document-button').setAttribute('aria-expanded', 'false'); $('#menu-button').setAttribute('aria-expanded', 'false'); syncBackdrop(); }
function syncBackdrop() {
  const sidebarOpen = $('#sidebar').classList.contains('open'), overlay = !$('#document-panel').hidden && matchMedia('(max-width:1200px)').matches;
  $('#panel-backdrop').hidden = !(sidebarOpen || overlay);
  $('.main').inert = sidebarOpen || overlay;
  $('#sidebar').inert = overlay || matchMedia('(max-width:760px)').matches && !sidebarOpen;
}
function openDocument() { $('#sidebar').classList.remove('open'); $('#document-panel').hidden = false; $('#document-button').setAttribute('aria-expanded', 'true'); syncBackdrop(); $('#close-document').focus(); }
function renderList() {
  $('#conversation-list').innerHTML = conversations.map(item => `<div class="conversation-row ${item.id === current?.id ? 'active' : ''}"><button class="conversation-open" type="button" data-open="${esc(item.id)}" title="${esc(item.title)}">${item.caseId ? '▧ ' : ''}${esc(item.title)}</button><button class="conversation-delete" data-delete="${esc(item.id)}" type="button" aria-label="Eliminar ${esc(item.title)}">×</button></div>`).join('');
}
async function refreshList() { conversations = (await api('/api/conversations')).conversations; renderList(); }
function renderDocument() {
  const item = current?.case, progress = current?.progress;
  $('#document-empty').hidden = Boolean(item); $('#document-details').hidden = !item;
  $('#document-dot').hidden = !item; $('#document-progress').hidden = !item;
  if (!item) return;
  const ready = current.evaluation?.status === 'draft_ready' && item.data.reviewConfirmed;
  $('#progress-text').textContent = ready ? 'Documento listo para revisar' : progress.blocked ? 'Documento requiere revisión' : progress.paused ? 'Documento pausado · Datos guardados' : `Preparando tu documento · ${progress.completed}/${progress.total} pasos`;
  $('#pause-document').textContent = progress.paused ? 'Retomar' : 'Pausar';
  $('#document-state-label').textContent = ready ? 'RESUMEN CONFIRMADO' : progress.blocked ? 'REVISIÓN NECESARIA' : 'EN PREPARACIÓN';
  $('#case-progress').value = Math.round(progress.completed / progress.total * 100);
  const notices = [...new Set([...(current.evaluation?.blocks || []), ...(current.evaluation?.warnings || [])])];
  $('#case-notices').innerHTML = notices.map(text => `<p>${esc(text)}</p>`).join('');
  $('#summary').innerHTML = current.fields.filter(field => field.complete || field.value).map(field => `<div class="summary-row"><div><strong>${esc(field.label)}</strong><span>${esc(field.value || 'Sin dato declarado')}</span></div><button data-edit="${esc(field.id)}" type="button">Corregir</button></div>`).join('') || '<p class="muted">Los datos aparecerán a medida que avancemos en el chat.</p>';
  $('#documents').innerHTML = item.documents.map(doc => `<div class="doc-row"><button type="button" data-document="${esc(doc.id)}" data-filename="${esc(doc.original_name)}">▧ ${esc(doc.original_name)}</button><button type="button" data-remove-document="${esc(doc.id)}" aria-label="Eliminar ${esc(doc.original_name)}">×</button></div>`).join('');
  $('#confirm-summary').disabled = current.evaluation?.status !== 'draft_ready' || busy;
  $('#confirm-summary').textContent = ready ? 'Resumen confirmado ✓' : 'Confirmar el resumen';
  $('#view-draft').disabled = !ready; $('#download-pdf').disabled = !ready;
  $('#format-details').disabled = current.evaluation?.status !== 'draft_ready';
  $('#format-preview').disabled = !ready;
}
function render(scroll = true) {
  $('#conversation-title').textContent = current.state.title;
  $('#welcome').hidden = current.turns.some(turn => turn.question);
  $('#messages').innerHTML = '';
  current.turns.forEach((turn, i) => {
    if (!turn.question && !$('#welcome').hidden) return;
    if (turn.question) appendMessage($('#messages'), 'user', turn.question);
    appendMessage($('#messages'), 'assistant', turn.answer, turn, i === current.turns.length - 1);
  });
  renderDocument(); renderList();
  if (scroll) requestAnimationFrame(scrollEnd);
}
async function refreshFormats() {
  if (!current?.case) { formats = []; return; }
  formats = (await api(caseRoute('formats'))).formats;
  const previous = $('#format-select').value;
  $('#format-select').innerHTML = formats.map(item => `<option value="${esc(item.code)}">${esc(item.entity)} · ${esc(item.version)}</option>`).join('');
  if (formats.some(item => item.code === previous)) $('#format-select').value = previous;
  renderFormat();
}
function renderFormat() {
  const format = formats.find(item => item.code === $('#format-select').value);
  if (!format) return;
  $('#format-detail').innerHTML = `<p><strong>Destino:</strong> ${esc(format.destination)}<br><strong>Canal:</strong> ${esc(format.channel)}</p><p>${esc(format.note)}</p>${format.assessment?.missing?.length ? `<p>Datos pendientes: ${esc(format.assessment.missing.join(', '))}.</p>` : ''}<p><a href="${esc(format.sourceUrl)}" target="_blank" rel="noopener noreferrer">Ver fuente oficial ↗</a></p>`;
  const ready = current.case.data.reviewConfirmed && current.evaluation.status === 'draft_ready';
  $('#format-preview').disabled = !ready || !format.available || format.mode === 'filled_preview' && Boolean(format.assessment?.missing?.length);
}
async function openConversation(id) {
  if (busy) return;
  voice.stop();
  current = await api(`/api/conversations/${id}`);
  localStorage.setItem('abogadoia-conversation', id); closePanels(); render(); await refreshFormats();
}
async function createConversation() {
  if (busy) return;
  voice.stop();
  current = await api('/api/conversations', { method: 'POST', data: {} });
  localStorage.setItem('abogadoia-conversation', current.id); closePanels(); await refreshList(); render();
}
function setBusy(value) {
  busy = value; $('#send').disabled = value; $('#answer').disabled = value; $('#new-conversation').disabled = value;
  $('#sending-status').textContent = value ? 'Preparando respuesta…' : '';
  $('#attach-button').disabled = value; $('#upload-document').disabled = value;
  $('#voice-button').disabled = value; $('#dictate-button').disabled = value;
  $('#messages').setAttribute('aria-busy', String(value));
  document.querySelectorAll('#messages .turn-actions button').forEach(button => { if (value) button.disabled = true; });
}
async function send(message = '', action = '', extra = {}) {
  if (busy || !current) return;
  $('#chat-error').textContent = '';
  const savedInput = $('#answer').value;
  setBusy(true); $('#welcome').hidden = true;
  if (message) appendMessage($('#messages'), 'user', message);
  const thinking = appendMessage($('#messages'), 'assistant', 'Un momento…', { engine: 'Asistente' }); thinking.classList.add('thinking'); scrollEnd();
  try {
    current = await api(`/api/conversations/${current.id}/messages`, { method: 'POST', data: { message, action, consent: $('#ai-consent').checked, ...extra } });
    $('#answer').value = ''; $('#answer').rows = 1; resizeComposer();
    await refreshList(); await refreshFormats();
    return current;
  } catch (error) {
    showError(error); $('#answer').value = savedInput;
    current = await api(`/api/conversations/${current.id}`).catch(() => current);
  } finally { setBusy(false); render(); }
}
async function activate() {
  $('#auth-screen').hidden = true; $('#workspace').hidden = false;
  await refreshList();
  const previous = localStorage.getItem('abogadoia-conversation');
  const target = conversations.find(item => item.id === previous) || conversations.find(item => !item.caseId) || conversations[0];
  if (target) await openConversation(target.id); else await createConversation();
  syncBackdrop();
}
async function updateStatus() {
  const value = await api('/api/status'); setupRequired = value.setupRequired;
  $('#groq-status').textContent = value.groqConfigured ? 'Groq configurado' : 'IA sin configurar'; $('#groq-status').classList.toggle('ready', value.groqConfigured);
  $('#source-count').textContent = value.sourceCount;
  $('#library-status').textContent = value.ingestion.running ? `Leyendo PDF ${value.ingestion.processed}/${value.ingestion.total}…` : `${value.searchableCount} de ${value.sourceCount} PDF con texto buscable · ${value.chunkCount} fragmentos.`;
  $('#reindex-button').disabled = value.ingestion.running;
  $('#auth-title').textContent = setupRequired ? 'Crea tu cuenta local' : 'Vuelve a tu conversación';
  $('#auth-description').textContent = setupRequired ? 'Una cuenta para guardar tu avance en este equipo. La contraseña debe tener al menos 12 caracteres.' : 'Inicia sesión para retomar tus conversaciones y documentos.';
  $('#auth-button').textContent = setupRequired ? 'Crear mi espacio →' : 'Entrar a mi espacio →';
  $('#auth-form [name=password]').autocomplete = setupRequired ? 'new-password' : 'current-password';
}
async function openLibrary() {
  closePanels(); $('#library-dialog').showModal(); await updateStatus();
  const { indexed } = await api('/api/sources');
  $('#source-list').innerHTML = indexed.map(source => `<div class="source-card"><span class="source-icon">▧</span><div><strong>${esc(source.title)}</strong><small>${esc(source.file_name)} · ${source.pages} páginas${source.warning ? ` · ${esc(source.warning)}` : ''}</small></div><a href="/api/sources/${esc(source.id)}/pdf" target="_blank" rel="noopener noreferrer">Abrir ↗</a></div>`).join('');
}
async function showDraft() {
  const { draft, warnings } = await api(caseRoute('draft'));
  $('#draft-content').innerHTML = `<p class="draft-notice">${esc(draft.notice)}</p><h3>${esc(draft.title)}</h3><p><strong>Solicitante:</strong> ${esc(draft.applicant)}</p><p><strong>Demandado:</strong> ${esc(draft.respondent)}</p><p><strong>Menores:</strong> ${esc(draft.child)}</p><h3>Petitorio</h3><p>${esc(draft.petition)}</p><h3>Hechos declarados</h3>${draft.facts.map(fact => `<p>${esc(fact)}</p>`).join('')}<h3>Medios probatorios declarados</h3><p>${esc(draft.evidence.join('; ') || 'No declarados')}</p><h3>Fundamento jurídico</h3><p>${esc(draft.legalBasis)}</p>${warnings?.length ? `<p class="draft-notice">${esc(warnings.join(' '))}</p>` : ''}`;
  $('#draft-dialog').showModal();
}
async function handleAction(action, value) {
  if (action === 'show_document') return openDocument();
  if (action === 'show_draft') return showDraft();
  if (action === 'download_pdf') return download(caseRoute('pdf'), 'demanda-simulacion.pdf');
  if (action === 'library_question') { $('#answer').value = '¿Qué dice mi biblioteca sobre '; $('#answer').focus(); return; }
  if (action === 'answer' && value === 'Quiero corregir') return openDocument();
  await send(value || '', action);
  if (action === 'confirm_review') openDocument();
}

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#auth-error').textContent = ''; $('#auth-button').disabled = true;
  try { const form = new FormData(event.target); await api(setupRequired ? '/api/auth/register' : '/api/auth/login', { method: 'POST', data: { email: form.get('email'), password: form.get('password') } }); event.target.reset(); await activate(); }
  catch (error) { $('#auth-error').textContent = error.message; } finally { $('#auth-button').disabled = false; }
});
$('#composer').addEventListener('submit', event => { event.preventDefault(); const value = $('#answer').value.trim(); if (value) send(value); });
$('#answer').addEventListener('input', () => { $('#answer').rows = Math.min(5, Math.max(1, $('#answer').value.split('\n').length)); });
$('#answer').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !matchMedia('(max-width:760px)').matches && !matchMedia('(pointer:coarse)').matches) { event.preventDefault(); $('#composer').requestSubmit(); } });
$('#ai-consent').addEventListener('change', () => sessionStorage.setItem('abogadoia-ai-consent', String($('#ai-consent').checked)));
$('#new-conversation').addEventListener('click', () => createConversation().catch(showError));
$('#conversation-list').addEventListener('click', event => {
  if (busy) return;
  const open = event.target.closest('[data-open]'), remove = event.target.closest('[data-delete]');
  if (open) openConversation(open.dataset.open).catch(showError);
  if (remove) { deleteId = remove.dataset.delete; $('#delete-dialog').showModal(); }
});
$('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
$('#confirm-delete').addEventListener('click', async () => {
  try { await api(`/api/conversations/${deleteId}`, { method: 'DELETE' }); $('#delete-dialog').close(); const wasCurrent = deleteId === current.id; await refreshList(); if (wasCurrent) await openConversation(conversations[0].id); toast('Conversación eliminada.'); }
  catch (error) { showError(error); $('#delete-dialog').close(); }
});
$('#logout').addEventListener('click', async () => { if (busy) return; voice.stop(); await api('/api/auth/logout', { method: 'POST' }); sessionStorage.removeItem('abogadoia-ai-consent'); $('#ai-consent').checked = false; closePanels(); $('#workspace').hidden = true; $('#auth-screen').hidden = false; await updateStatus(); });
$('#menu-button').addEventListener('click', () => { $('#document-panel').hidden = true; $('#sidebar').classList.toggle('open'); $('#menu-button').setAttribute('aria-expanded', String($('#sidebar').classList.contains('open'))); syncBackdrop(); });
$('#close-sidebar').addEventListener('click', closePanels); $('#panel-backdrop').addEventListener('click', closePanels);
$('#document-button').addEventListener('click', () => $('#document-panel').hidden ? openDocument() : closePanels());
$('#close-document').addEventListener('click', closePanels); $('#progress-open').addEventListener('click', openDocument);
$('#pause-document').addEventListener('click', () => send('', current.state.paused ? 'resume_draft' : 'pause_draft'));
$('#start-document').addEventListener('click', () => { closePanels(); send('', 'start_draft'); });
$('#welcome').addEventListener('click', event => { const button = event.target.closest('[data-starter]'); if (!button) return; if (button.dataset.starter === 'draft') send('', 'start_draft'); else { $('#answer').value = button.dataset.starter === 'law' ? '¿Qué dice mi biblioteca sobre ' : ''; $('#answer').focus(); } });
$('#messages').addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button && !busy) handleAction(button.dataset.action, button.dataset.value).catch(showError); });
$('#summary').addEventListener('click', event => { const button = event.target.closest('[data-edit]'); if (button) { closePanels(); send('', 'edit', { stepId: button.dataset.edit }); } });
$('#confirm-summary').addEventListener('click', () => send('', 'confirm_review').then(openDocument));
$('#view-draft').addEventListener('click', () => showDraft().catch(showError));
$('#download-pdf').addEventListener('click', () => download(caseRoute('pdf'), 'demanda-simulacion.pdf').catch(showError));
$('#format-select').addEventListener('change', renderFormat);
$('#format-details').addEventListener('click', () => { closePanels(); send('', 'format_details'); });
$('#format-preview').addEventListener('click', () => download(caseRoute(`formats/${$('#format-select').value}/preview`), `formato-${$('#format-select').value}-simulacion.pdf`).catch(showError));
$('#close-draft').addEventListener('click', () => $('#draft-dialog').close());
function chooseAttachment() { if (busy) return; if (!current?.case?.data.isFictional) { toast('Inicia un documento y confirma que sus datos son ficticios antes de adjuntar.'); openDocument(); return; } $('#document-input').click(); }
$('#attach-button').addEventListener('click', chooseAttachment); $('#upload-document').addEventListener('click', chooseAttachment);
$('#document-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 5_000_000) throw new Error('El archivo supera el límite de 5 MB.'); const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); await api(caseRoute('documents'), { method: 'POST', data: { name: file.name, data: btoa(binary) } }); current = await api(`/api/conversations/${current.id}`); render(false); openDocument(); toast('Archivo ficticio adjuntado.'); }
  catch (error) { showError(error); } finally { event.target.value = ''; }
});
$('#documents').addEventListener('click', async event => {
  const get = event.target.closest('[data-document]'), remove = event.target.closest('[data-remove-document]');
  try { if (get) await download(caseRoute(`documents/${get.dataset.document}`), get.dataset.filename); if (remove) { await api(caseRoute(`documents/${remove.dataset.removeDocument}`), { method: 'DELETE' }); current = await api(`/api/conversations/${current.id}`); render(false); toast('Anexo eliminado.'); } } catch (error) { showError(error); }
});
$('#library-button').addEventListener('click', () => openLibrary().catch(showError));
$('#close-library').addEventListener('click', () => $('#library-dialog').close());
$('#source-search').addEventListener('submit', async event => {
  event.preventDefault();
  try { const { results } = await api(`/api/search?q=${encodeURIComponent($('#source-query').value)}`); $('#search-results').innerHTML = results.length ? results.map(result => `<div class="source-hit"><strong>${esc(result.title)} · Página ${result.page}</strong><p>${esc(result.content)}</p><a href="/api/sources/${esc(result.source_id)}/pdf#page=${result.page}" target="_blank" rel="noopener noreferrer">Abrir PDF original ↗</a></div>`).join('') : '<p class="muted">No encontré coincidencias. Prueba con otro término; algunos PDF necesitan OCR.</p>'; } catch (error) { toast(error.message); }
});
$('#reindex-button').addEventListener('click', async () => { try { await api('/api/reindex', { method: 'POST' }); await updateStatus(); toast('Actualizando la biblioteca.'); } catch (error) { toast(error.message); } });
window.addEventListener('resize', syncBackdrop);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanels(); });
$('#ai-consent').checked = sessionStorage.getItem('abogadoia-ai-consent') === 'true';
try { await updateStatus(); const { user } = await api('/api/auth/me'); if (user) await activate(); } catch (error) { $('#auth-error').textContent = error.message; }
setInterval(() => updateStatus().catch(() => {}), 15000);
