const form = document.querySelector('#case-form');
const panels = [...document.querySelectorAll('.step-panel')];
const stepButtons = [...document.querySelectorAll('[data-step-button]')];
const evaluationEl = document.querySelector('#evaluation');
const draftSection = document.querySelector('#draft-section');
const draftContent = document.querySelector('#draft-content');
let currentStep = 0, currentCaseId = null, documents = [], setupRequired = false;
let lastIndexedCount = -1;
let chatMeta = { chatCompleted: [], evidenceConfirmed: false };
let extraData = {};

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
function message(text) { document.querySelector('#save-status').textContent = text; }
async function api(route, options = {}) {
  const response = await fetch(route, { method: options.method || 'GET', headers: options.data === undefined ? {} : { 'Content-Type': 'application/json' }, body: options.data === undefined ? undefined : JSON.stringify(options.data), credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
  return result;
}
function getCase() {
  const f = new FormData(form);
  const children = [{ name: f.get('childName'), birthDate: f.get('childBirthDate') },
    ...[...document.querySelectorAll('#additional-children .child-row')].map(row => ({ name: row.querySelector('[name=childExtraName]').value, birthDate: row.querySelector('[name=childExtraBirthDate]').value }))]
    .map((child, index) => ({ ...child, relationToRespondent: extraData.children?.find(saved => saved.name === child.name)?.relationToRespondent || extraData.children?.[index]?.relationToRespondent || '' }));
  return {
    ...extraData,
    procedure: f.get('procedure'), applicantRelation: f.get('applicantRelation'),
    otherClaims: f.get('otherClaims') === 'yes', urgentRisk: f.get('urgentRisk') === 'yes', isFictional: f.get('isFictional') === 'on',
    applicantName: f.get('applicantName'), applicantDocument: f.get('applicantDocument'), applicantAddress: f.get('applicantAddress'),
    respondentName: f.get('respondentName'), respondentAddress: f.get('respondentAddress'), respondentAddressUnknown: f.get('respondentAddressUnknown') === 'on',
    childName: f.get('childName'), childBirthDate: f.get('childBirthDate'), children, requestedAmount: f.get('requestedAmount'),
    factDescription: f.get('factDescription'), expenseDescription: f.get('expenseDescription'),
    evidence: String(f.get('evidenceText') || '').split('\n').map(s => s.trim()).filter(Boolean),
    reviewConfirmed: f.get('reviewConfirmed') === 'on',
    ...chatMeta,
    chatCompleted: f.get('reviewConfirmed') === 'on' ? chatMeta.chatCompleted : chatMeta.chatCompleted.filter(id => id !== 'review')
  };
}
function setForm(data) {
  form.reset();
  extraData = structuredClone(data || {});
  chatMeta = { chatCompleted: data?.chatCompleted || [], evidenceConfirmed: Boolean(data?.evidenceConfirmed) };
  form.elements.reviewConfirmed.checked = Boolean(data?.reviewConfirmed);
  document.querySelector('#additional-children').innerHTML = '';
  document.querySelector('#add-child-button').disabled = false;
  for (const [key, value] of Object.entries(data || {})) {
    if (['otherClaims', 'urgentRisk'].includes(key)) {
      const radio = form.querySelector(`[name="${key}"][value="${value ? 'yes' : 'no'}"]`);
      if (radio) radio.checked = true;
    } else if (['isFictional', 'respondentAddressUnknown'].includes(key)) {
      form.elements[key].checked = Boolean(value);
    } else if (key === 'evidence') form.elements.evidenceText.value = Array.isArray(value) ? value.join('\n') : '';
    else if (form.elements[key]) form.elements[key].value = value ?? '';
  }
  const extra = Array.isArray(data?.children) ? data.children.slice(1, 5) : [];
  for (const child of extra) {
    addChild();
    const row = document.querySelector('#additional-children .child-row:last-child');
    row.querySelector('[name=childExtraName]').value = child.name || '';
    row.querySelector('[name=childExtraBirthDate]').value = child.birthDate || '';
  }
  draftSection.hidden = true;
}
function addChild() {
  const container = document.querySelector('#additional-children');
  if (container.children.length >= 4) return;
  const row = document.createElement('div');
  row.className = 'field-grid child-row extra-child';
  row.innerHTML = `<label class="field"><span>Nombre completo ficticio <b>*</b></span><input name="childExtraName" maxlength="120" placeholder="Ej. Otro menor de prueba"></label><label class="field"><span>Fecha de nacimiento <b>*</b></span><input type="date" name="childExtraBirthDate"></label><button type="button" class="remove-child-button">Quitar este menor</button>`;
  container.append(row);
  document.querySelector('#add-child-button').disabled = container.children.length >= 4;
}
function showStep(index) {
  currentStep = Math.max(0, Math.min(panels.length - 1, index));
  panels.forEach((panel, i) => panel.hidden = i !== currentStep);
  stepButtons.forEach((button, i) => { button.classList.toggle('active', i === currentStep); button.setAttribute('aria-current', i === currentStep ? 'step' : 'false'); });
  document.querySelector('#prev-button').hidden = currentStep === 0;
  document.querySelector('#next-button').hidden = currentStep === panels.length - 1;
  document.querySelector('#step-count').textContent = `Paso ${currentStep + 1} de ${panels.length}`;
  if (currentStep === panels.length - 1) evaluate();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function saveCase() {
  const data = getCase();
  const result = currentCaseId
    ? await api(`/api/cases/${currentCaseId}`, { method: 'PUT', data })
    : await api('/api/cases', { method: 'POST', data });
  currentCaseId = result.case.id;
  documents = result.case.documents || [];
  message(`Caso ${currentCaseId.slice(0, 8)} guardado`);
  await loadCases();
  renderDocuments();
  return result.case;
}
async function loadCases() {
  const { cases } = await api('/api/cases');
  const el = document.querySelector('#cases-list');
  el.innerHTML = cases.length ? cases.map(item => `<div class="case-item ${item.id === currentCaseId ? 'selected' : ''}"><button type="button" data-open-case="${esc(item.id)}">Caso ${esc(item.id.slice(0, 8))}<small>${esc(new Date(item.updated_at).toLocaleDateString('es-PE'))}</small></button><button type="button" data-delete-case="${esc(item.id)}" aria-label="Eliminar caso">×</button></div>`).join('') : '<p class="empty-cases">Todavía no hay casos.</p>';
}
async function openCase(id) {
  const result = await api(`/api/cases/${id}`);
  currentCaseId = id;
  document.querySelector('#return-chat').href = `/?case=${encodeURIComponent(id)}`;
  documents = result.case.documents || [];
  setForm(result.case.data);
  renderDocuments();
  await loadCases();
  message(`Caso ${id.slice(0, 8)} abierto`);
  showStep(0);
}
function newCase() {
  currentCaseId = null; documents = [];
  document.querySelector('#return-chat').href = '/';
  setForm({ procedure: 'ALIMENTOS_NNA' });
  renderDocuments();
  loadCases().catch(console.error);
  message('Caso nuevo sin guardar');
  showStep(0);
}
function card(type, heading, lines) {
  const list = lines.length ? `<ul>${lines.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  return `<div class="evaluation-card ${type}"><h3>${esc(heading)}</h3>${list || '<p>Sin observaciones.</p>'}</div>`;
}
function showEvaluation(result) {
  const status = result.status === 'blocked' ? 'El flujo debe detenerse' : result.status === 'incomplete' ? 'Faltan datos para el borrador' : 'Datos completos para un borrador de simulación';
  evaluationEl.innerHTML = card(result.status === 'draft_ready' ? 'success' : 'error', status, result.blocks.length ? result.blocks : result.missing)
    + (result.blocks.length && result.missing.length ? card('warn', 'Datos aún pendientes', result.missing) : '')
    + (result.warnings.length ? card('warn', 'Aspectos que requieren revisión', result.warnings) : '')
    + card('warn', 'Revisión jurídica pendiente', ['Los artículos, sus fechas de vigencia y la adaptación del formulario requieren aprobación humana.']);
  document.querySelector('#draft-button').disabled = result.status !== 'draft_ready';
}
async function evaluate() {
  try { await saveCase(); showEvaluation(await api(`/api/cases/${currentCaseId}/evaluate`)); }
  catch (error) { evaluationEl.innerHTML = card('error', 'Error de revisión', [error.message]); document.querySelector('#draft-button').disabled = true; }
}
function renderDraft(result) {
  const d = result.draft;
  if (!d) return;
  const evidence = result.documents.length ? `<ol>${result.documents.map(x => `<li>${esc(x.original_name)}</li>`).join('')}</ol>` : '<p>No se adjuntaron archivos.</p>';
  draftContent.innerHTML = `<div class="watermark">SIMULACIÓN · NO PRESENTAR</div><h1>${esc(d.title)}</h1><p>${esc(d.notice)}</p><h2>Personas</h2><p><strong>Solicitante:</strong> ${esc(d.applicant)}</p><p><strong>Persona demandada:</strong> ${esc(d.respondent)}</p><p><strong>Menor:</strong> ${esc(d.child)}</p><h2>Petitorio declarado</h2><p>${esc(d.petition)}</p><h2>Hechos declarados</h2>${d.facts.map((x, i) => `<p>${i + 1}. ${esc(x)}</p>`).join('')}<h2>Archivos adjuntados</h2>${evidence}<h2>Fundamentos jurídicos</h2><p>${esc(d.legalBasis)}</p><p class="draft-meta">Versión de plantilla: ${esc(d.templateVersion)} · Sin firma, presentación ni validación judicial.</p>`;
  document.querySelector('#references-list').innerHTML = result.references.length
    ? `<h3>Fragmentos localizados para revisar</h3>${result.references.slice(0, 6).map(x => `<div class="reference-row"><strong>${esc(x.title)} · pág. ${x.page}</strong><p>${esc(x.excerpt)}</p><small>Cita no aprobada</small></div>`).join('')}`
    : '<p>No se localizaron fragmentos textuales suficientes.</p>';
  draftSection.hidden = false;
  draftSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderDocuments() {
  const el = document.querySelector('#document-list');
  el.innerHTML = documents.length ? documents.map(doc => `<div class="document-row"><span>${esc(doc.original_name)} <small>${(doc.size / 1024).toFixed(0)} KB</small></span><div><button type="button" data-download-doc="${esc(doc.id)}">Descargar</button><button type="button" data-remove-doc="${esc(doc.id)}">Eliminar</button></div></div>`).join('') : '<p>Sin anexos cargados.</p>';
}
function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
async function uploadFile(file) {
  if (!file) return;
  if (file.size > 5_000_000) throw new Error('El archivo supera el límite de 5 MB.');
  await saveCase();
  const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  await api(`/api/cases/${currentCaseId}/documents`, { method: 'POST', data: { name: file.name, data } });
  const result = await api(`/api/cases/${currentCaseId}/documents`);
  documents = result.documents; renderDocuments(); message('Anexo guardado de forma privada');
}
async function downloadFile(route, fallback) {
  const response = await fetch(route, { credentials: 'same-origin' });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'No se pudo descargar.'); }
  const blob = await response.blob(), link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = fallback; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}
async function loadSources() {
  const { sources, indexed } = await api('/api/sources');
  const element = document.querySelector('#sources-list');
  const list = indexed.length ? indexed.map(x => ({ title: x.title, file: x.file_name, exists: true, pages: x.pages, warning: x.warning, indexed: true })) : sources.map(x => ({ title: x.title, file: x.file, exists: x.exists, indexed: false }));
  element.innerHTML = list.map(item => `<div class="source-row"><div><strong>${esc(item.title)}</strong><small>${esc(item.file)}${item.pages ? ` · ${item.pages} páginas` : ''}${item.warning ? ` · ${esc(item.warning)}` : ''}</small></div><span class="source-status ${item.exists ? '' : 'missing'}">${item.exists ? item.indexed ? 'Indexado' : 'Por indexar' : 'Falta PDF'}</span></div>`).join('');
  lastIndexedCount = indexed.length;
}
async function updateStatus() {
  const status = await api('/api/status');
  document.querySelector('#groq-status').textContent = status.groqConfigured ? `Groq: configurado (${status.groqModel})` : 'Groq: añade tu clave en mvp/.env';
  const ing = status.ingestion;
  document.querySelector('#index-status').textContent = ing.running ? `Leyendo PDF ${ing.processed}/${ing.total}: ${ing.current}` : `Biblioteca: ${status.sourceCount} PDF indexados${ing.errors?.length ? ` · ${ing.errors.length} error(es)` : ''}`;
  if (status.sourceCount !== lastIndexedCount) await loadSources();
}
async function searchSources() {
  const q = document.querySelector('#source-query').value.trim();
  const el = document.querySelector('#search-results');
  if (!q) { el.innerHTML = ''; return; }
  try {
    const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
    el.innerHTML = `<h3>${results.length} resultado(s) en los PDF</h3>` + (results.length ? results.map(x => `<div class="reference-row"><strong>${esc(x.title)} · pág. ${x.page}</strong><p>${esc(x.content.slice(0, 600))}</p><small>Texto extraído automáticamente; verificar contra el PDF</small></div>`).join('') : '<p>No se encontraron coincidencias textuales. Algunos PDF pueden requerir OCR.</p>');
  } catch (error) { el.textContent = error.message; }
}
function showAuth(status) {
  setupRequired = status.setupRequired;
  document.querySelector('#auth-title').textContent = setupRequired ? 'Crea tu cuenta local' : 'Inicia sesión';
  document.querySelector('#auth-description').textContent = setupRequired ? 'La primera cuenta administra este espacio de prueba en tu equipo.' : 'Continúa con tus casos guardados en este equipo.';
  document.querySelector('#auth-button').textContent = setupRequired ? 'Crear cuenta →' : 'Entrar →';
  document.querySelector('#auth-screen').hidden = false;
  document.querySelector('#app-shell').hidden = true;
}
async function showApp() {
  document.querySelector('#auth-screen').hidden = true;
  document.querySelector('#app-shell').hidden = false;
  await loadCases();
  await loadSources();
  await updateStatus();
  newCase();
  const requestedCase = new URLSearchParams(location.search).get('case');
  if (/^[a-f0-9-]{36}$/.test(requestedCase || '')) await openCase(requestedCase).catch(error => message(error.message));
}

document.querySelector('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const f = new FormData(event.currentTarget);
  try {
    await api(setupRequired ? '/api/auth/register' : '/api/auth/login', { method: 'POST', data: { email: f.get('email'), password: f.get('password') } });
    document.querySelector('#auth-error').textContent = '';
    await showApp();
  } catch (error) { document.querySelector('#auth-error').textContent = error.message; }
});
document.querySelector('#logout-button').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); showAuth(await api('/api/status')); });
document.querySelector('#new-case-button').addEventListener('click', newCase);
document.querySelector('#add-child-button').addEventListener('click', addChild);
document.querySelector('#additional-children').addEventListener('click', event => { if (event.target.closest('.remove-child-button')) { event.target.closest('.child-row').remove(); document.querySelector('#add-child-button').disabled = false; } });
document.querySelector('#save-case-button').addEventListener('click', () => saveCase().catch(error => message(error.message)));
document.querySelector('#cases-list').addEventListener('click', async event => {
  const open = event.target.closest('[data-open-case]'), remove = event.target.closest('[data-delete-case]');
  try {
    if (open) await openCase(open.dataset.openCase);
    if (remove && confirm('¿Eliminar este caso y sus anexos de este equipo?')) {
      await api(`/api/cases/${remove.dataset.deleteCase}`, { method: 'DELETE' });
      if (currentCaseId === remove.dataset.deleteCase) newCase(); else await loadCases();
    }
  } catch (error) { message(error.message); }
});
document.querySelector('#next-button').addEventListener('click', async () => { try { await saveCase(); showStep(currentStep + 1); } catch (error) { message(error.message); } });
document.querySelector('#prev-button').addEventListener('click', async () => { try { await saveCase(); showStep(currentStep - 1); } catch (error) { message(error.message); } });
stepButtons.forEach((button, i) => button.addEventListener('click', async () => { try { await saveCase(); showStep(i); } catch (error) { message(error.message); } }));
document.querySelector('#evaluate-button').addEventListener('click', evaluate);
document.querySelector('#draft-button').addEventListener('click', async () => {
  try { await saveCase(); const result = await api(`/api/cases/${currentCaseId}/draft`); showEvaluation(result); renderDraft(result); }
  catch (error) { evaluationEl.innerHTML = card('error', 'No se pudo crear el borrador', [error.message]); }
});
document.querySelector('#pdf-button').addEventListener('click', async () => { try { await saveCase(); await downloadFile(`/api/cases/${currentCaseId}/pdf`, `borrador-${currentCaseId.slice(0, 8)}.pdf`); } catch (error) { message(error.message); } });
document.querySelector('#document-input').addEventListener('change', async event => { try { await uploadFile(event.target.files[0]); event.target.value = ''; } catch (error) { message(error.message); } });
document.querySelector('#document-list').addEventListener('click', async event => {
  if (!currentCaseId) return;
  const download = event.target.closest('[data-download-doc]'), remove = event.target.closest('[data-remove-doc]');
  try {
    if (download) { const doc = documents.find(x => x.id === download.dataset.downloadDoc); await downloadFile(`/api/cases/${currentCaseId}/documents/${doc.id}`, doc.original_name); }
    if (remove) { await api(`/api/cases/${currentCaseId}/documents/${remove.dataset.removeDoc}`, { method: 'DELETE' }); documents = (await api(`/api/cases/${currentCaseId}/documents`)).documents; renderDocuments(); }
  } catch (error) { message(error.message); }
});
document.querySelector('#ai-button').addEventListener('click', async () => {
  const el = document.querySelector('#ai-result'); el.textContent = 'Consultando Groq…';
  try {
    await saveCase();
    const { suggestion: s } = await api(`/api/cases/${currentCaseId}/ai`, { method: 'POST' });
    el.innerHTML = `<div class="ai-suggestion"><strong>Sugerencia para revisar</strong><p><b>Hechos:</b> ${esc(s.hechos)}</p><p><b>Gastos:</b> ${esc(s.gastos)}</p>${s.preguntas.length ? `<p><b>Preguntas:</b> ${s.preguntas.map(esc).join(' · ')}</p>` : ''}<small>${esc(s.warning)}</small><button type="button" id="apply-ai-button" class="button button-secondary">Aplicar y revisar en el formulario</button></div>`;
    el.querySelector('#apply-ai-button').addEventListener('click', () => {
      form.elements.factDescription.value = s.hechos;
      form.elements.expenseDescription.value = s.gastos;
      draftSection.hidden = true;
      message('Sugerencia aplicada; revísala y guarda el caso.');
    });
  } catch (error) { el.textContent = error.message; }
});
document.querySelector('#reindex-button').addEventListener('click', async () => { try { await api('/api/reindex', { method: 'POST' }); await updateStatus(); } catch (error) { message(error.message); } });
document.querySelector('#source-search-button').addEventListener('click', searchSources);
document.querySelector('#source-query').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchSources(); } });
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', event => { if (event.target.name !== 'reviewConfirmed') form.elements.reviewConfirmed.checked = false; if (!draftSection.hidden) draftSection.hidden = true; message(currentCaseId ? 'Cambios sin guardar' : 'Caso nuevo sin guardar'); });

(async () => {
  try {
    const [status, session] = await Promise.all([api('/api/status'), api('/api/auth/me')]);
    if (session.user) await showApp(); else showAuth(status);
    setInterval(() => { if (document.querySelector('#app-shell').hidden) return; updateStatus().catch(() => {}); }, 2500);
  } catch (error) { document.querySelector('#auth-error').textContent = `No se pudo conectar al servidor: ${error.message}`; }
})();
