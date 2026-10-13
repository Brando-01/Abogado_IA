const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const unknown = value => /^(no s[eé]|desconozco|no lo s[eé])\.?$/i.test(value.trim());
const yes = value => /^(s[ií]|si,? |afirmativo)/i.test(value.trim());
const no = value => /^(no|negativo)/i.test(value.trim());
const initial = () => ({ procedure: 'ALIMENTOS_NNA', children: [{ name: '', birthDate: '' }], chatCompleted: [], evidence: [], isFictional: false, reviewConfirmed: false });
let data = initial(), caseId = null, documents = [], editing = null, busy = false, setupRequired = false, extras = [], evaluation = null, formats = [], qaHistory = [], mode = 'qa';

async function api(route, options = {}) {
  const response = await fetch(route, { method: options.method || 'GET', headers: options.data === undefined ? {} : { 'Content-Type': 'application/json' }, body: options.data === undefined ? undefined : JSON.stringify(options.data), credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Error HTTP ${response.status}`);
  return result;
}
function steps() {
  const list = [
    { id: 'consent', label: 'Datos de prueba', question: 'Antes de empezar: ¿confirmas que usarás solo datos y documentos ficticios?', choices: ['Sí, solo datos ficticios', 'No'], value: () => data.isFictional ? 'Sí, solo datos ficticios' : 'No' },
    { id: 'procedure', label: 'Procedimiento', question: '¿Quieres preparar una simulación de demanda inicial de alimentos para menores?', choices: ['Sí', 'No, otro procedimiento'], value: () => data.procedure === 'ALIMENTOS_NNA' ? 'Sí' : 'Otro procedimiento' },
    { id: 'relation', label: 'Relación', question: '¿Eres la madre, el padre u otra persona respecto del menor?', choices: ['Madre', 'Padre', 'Otra persona'], value: () => data.applicantRelation },
    { id: 'claims', label: 'Otras pretensiones', question: '¿Deseas pedir también filiación, tenencia u otra pretensión en el mismo caso?', choices: ['No', 'Sí'], value: () => data.otherClaims ? 'Sí' : 'No' },
    { id: 'risk', label: 'Situación urgente', question: '¿Existe una situación urgente o de riesgo que requiera atención inmediata?', choices: ['No', 'Sí'], value: () => data.urgentRisk ? 'Sí' : 'No' },
    { id: 'applicantName', label: 'Solicitante', question: '¿Cuál es el nombre ficticio de quien presentaría la demanda?', value: () => data.applicantName },
    { id: 'applicantDocument', label: 'Documento', question: '¿Qué número de documento ficticio usaremos para la simulación?', value: () => data.applicantDocument },
    { id: 'applicantAddress', label: 'Domicilio', question: '¿Cuál sería el domicilio ficticio de esa persona?', value: () => data.applicantAddress },
    { id: 'courtDistrict', label: 'Distrito judicial', question: '¿A qué distrito judicial se dirigiría esta simulación? Si aún no lo sabes, responde “no sé”.', value: () => data.courtDistrict },
    { id: 'applicantLocation', label: 'Ubicación de solicitante', question: 'Indica departamento, provincia y distrito ficticios de la persona solicitante, separados por comas.', value: () => [data.applicantDepartment, data.applicantProvince, data.applicantDistrict].filter(Boolean).join(', ') },
    { id: 'applicantPhone', label: 'Teléfono', question: '¿Qué teléfono ficticio pondrías como contacto?', value: () => data.applicantPhone },
    { id: 'applicantEmail', label: 'Correo de contacto', question: '¿Qué correo ficticio pondrías como contacto?', value: () => data.applicantEmail },
    { id: 'respondentName', label: 'Demandado', question: '¿Cuál es el nombre ficticio de la persona demandada?', value: () => data.respondentName },
    { id: 'respondentDocument', label: 'Documento del demandado', question: '¿Qué documento ficticio corresponde a la persona demandada? Si no lo sabes, responde “no sé”.', value: () => data.respondentDocument },
    { id: 'respondentAddress', label: 'Domicilio demandado', question: '¿Cuál sería su domicilio ficticio? Puedes responder “no sé”.', value: () => data.respondentAddressUnknown ? 'No sé' : data.respondentAddress },
    { id: 'childrenCount', label: 'Número de menores', question: '¿Para cuántos menores se solicitarían alimentos? Puedes indicar entre 1 y 5.', choices: ['1', '2', '3'], value: () => String(data.children?.length || 1) }
  ];
  const count = Math.max(1, Math.min(5, data.children?.length || 1));
  for (let i = 0; i < count; i++) {
    list.push({ id: `childName-${i}`, label: `Menor ${i + 1}`, question: `¿Cuál es el nombre ficticio del menor ${i + 1}?`, value: () => data.children?.[i]?.name });
    list.push({ id: `childDate-${i}`, label: `Nacimiento ${i + 1}`, question: `¿Cuál es su fecha de nacimiento? Escribe AAAA-MM-DD.`, value: () => data.children?.[i]?.birthDate });
    list.push({ id: `childRelation-${i}`, label: `Vínculo ${i + 1}`, question: `¿Qué vínculo ficticio tiene el menor ${i + 1} con la persona demandada? Por ejemplo, hijo o hija.`, value: () => data.children?.[i]?.relationToRespondent });
  }
  list.push(
    { id: 'amount', label: 'Monto', question: '¿Qué monto mensual total en soles deseas solicitar en esta simulación? Escribe solo el número.', value: () => data.requestedAmount > 0 ? `S/ ${data.requestedAmount}` : 'No indicado' },
    { id: 'facts', label: 'Hechos', question: 'Cuéntame con tus palabras qué ocurrió y por qué se solicitarían alimentos. No inventes hechos.', value: () => data.factDescription },
    { id: 'expenses', label: 'Gastos', question: '¿Qué necesidades y gastos mensuales tienen los menores? Describe solo lo que conoces.', value: () => data.expenseDescription },
    { id: 'evidence', label: 'Documentos', question: '¿Qué documentos o pruebas ficticias tienes disponibles? Sepáralos con comas; puedes responder “ninguno”.', value: () => data.evidence?.length ? data.evidence.join(', ') : 'Ninguno' },
    { id: 'review', label: 'Confirmación', question: 'Revisa el resumen de la derecha. ¿Confirmas que refleja lo que declaraste y autorizas crear un borrador de simulación?', choices: ['Sí, confirmo', 'No, quiero corregir'], value: () => data.reviewConfirmed ? 'Sí, confirmo' : 'Pendiente' }
  );
  return list;
}
function completed(id) { return data.chatCompleted?.includes(id); }
function currentStep() { return steps().find(step => !completed(step.id)); }
function blocked() {
  if (completed('consent') && !data.isFictional) return 'Esta versión solo acepta datos ficticios. No continuaré con información real.';
  if (completed('procedure') && data.procedure !== 'ALIMENTOS_NNA') return 'Este piloto solo contempla la demanda inicial de alimentos para menores.';
  if (completed('relation') && !['madre', 'padre'].includes(data.applicantRelation)) return 'Este supuesto necesita revisión humana antes de continuar.';
  if (completed('claims') && data.otherClaims) return 'Las pretensiones adicionales requieren un flujo jurídico distinto.';
  if (completed('risk') && data.urgentRisk) return 'Una situación urgente necesita orientación humana; esta simulación debe detenerse.';
  return '';
}
function restoreLegacyAnswers() {
  if (data.chatCompleted?.length || !data.applicantName) return;
  const ids = ['consent', 'procedure', 'relation', 'claims', 'risk', 'applicantName', 'applicantDocument', 'applicantAddress', 'respondentName', 'respondentAddress', 'childrenCount'];
  const values = [data.isFictional, data.procedure, data.applicantRelation, true, true, data.applicantName, data.applicantDocument, data.applicantAddress, data.respondentName, data.respondentAddress || data.respondentAddressUnknown, data.children?.length];
  data.chatCompleted = ids.filter((_, i) => Boolean(values[i]));
  data.children?.forEach((child, i) => { if (child.name) data.chatCompleted.push(`childName-${i}`); if (child.birthDate) data.chatCompleted.push(`childDate-${i}`); if (child.relationToRespondent) data.chatCompleted.push(`childRelation-${i}`); });
  if (data.requestedAmount > 0) data.chatCompleted.push('amount');
  if (data.factDescription) data.chatCompleted.push('facts');
  if (data.expenseDescription) data.chatCompleted.push('expenses');
  if (data.evidenceConfirmed || data.factDescription && data.expenseDescription) data.chatCompleted.push('evidence');
  if (data.reviewConfirmed) data.chatCompleted.push('review');
}
function addMessage(role, content) {
  const element = document.createElement('div');
  element.className = `message ${role}`;
  element.innerHTML = `<div class="avatar">${role === 'assistant' ? 'A+' : 'Tú'}</div><div class="bubble">${esc(content)}</div>`;
  $('#messages').append(element);
  return element;
}
function renderQaConversation() {
  const thread = $('#messages'); thread.innerHTML = '';
  addMessage('assistant', 'Hola. Pregúntame libremente sobre la biblioteca o cualquier tema. Si la consulta es jurídica, mostraré los PDF y páginas utilizados; confirma siempre la vigencia en la fuente oficial.');
  for (const turn of qaHistory) {
    addMessage('user', turn.question);
    const bubble = addMessage('assistant', turn.answer).querySelector('.bubble');
    if (turn.references?.length) {
      const details = document.createElement('details'); details.className = 'qa-reference';
      details.innerHTML = `<summary>Fuentes locales consultadas (${turn.references.length})</summary>${turn.references.map(ref => `<p><strong>${esc(ref.ref)} · ${esc(ref.title)} · pág. ${esc(ref.page)}</strong><br>${esc(ref.excerpt)}</p>`).join('')}`;
      bubble.append(details);
    }
    const note = document.createElement('small'); note.className = 'qa-note'; note.textContent = turn.notice || 'Respuesta automática; verifica el PDF y la vigencia.'; bubble.append(note);
  }
  $('#choices').innerHTML = '';
  $('#composer').hidden = false;
  $('#answer').disabled = false; $('#answer').maxLength = 1200;
  $('#answer').placeholder = 'Escribe cualquier pregunta sin datos personales…';
  $('#send').disabled = busy;
  thread.scrollTop = qaHistory.length ? thread.scrollHeight : 0;
}
function renderConversation() {
  if (mode === 'qa') return renderQaConversation();
  const thread = $('#messages'); thread.innerHTML = '';
  addMessage('assistant', 'Hola. Te acompañaré en una simulación de demanda de alimentos. Haré una pregunta por turno y podrás corregir cualquier respuesta. Esta herramienta no sustituye asesoría jurídica.');
  for (const step of steps()) if (completed(step.id)) {
    addMessage('assistant', step.question);
    addMessage('user', step.value() || 'No sé');
  }
  for (const message of extras) addMessage('assistant', message);
  const stop = blocked();
  const active = editing ? steps().find(step => step.id === editing) : currentStep();
  if (stop && !editing) addMessage('assistant', `${stop} Puedes corregir una respuesta desde el resumen.`);
  else if (active) addMessage('assistant', active.question);
  else addMessage('assistant', evaluation?.status === 'draft_ready' ? 'Gracias. El caso quedó confirmado para revisión. Puedes ver el borrador y descargar el PDF de simulación.' : `Gracias. Antes del borrador falta revisar: ${evaluation?.missing?.join('; ') || evaluation?.blocks?.join('; ') || 'datos pendientes'}. Usa «Corregir» en el resumen.`);
  $('#choices').innerHTML = !stop || editing ? (active?.choices || []).map(choice => `<button type="button" data-choice="${esc(choice)}">${esc(choice)}</button>`).join('') : '';
  const canAnswer = Boolean(active && (!stop || editing));
  $('#answer').disabled = !canAnswer; $('#send').disabled = !canAnswer;
  $('#composer').hidden = !canAnswer;
  $('#answer').placeholder = active?.id === 'review' ? 'Escribe sí o no…' : 'Escribe tu respuesta…';
  $('#answer').maxLength = 1800;
  thread.scrollTop = thread.scrollHeight;
}
function parseAnswer(step, answer) {
  const value = answer.trim();
  if (!value) throw new Error('Escribe una respuesta antes de continuar.');
  if (step.id === 'consent') { if (!yes(value) && !no(value)) throw new Error('Responde sí o no.'); data.isFictional = yes(value); }
  else if (step.id === 'procedure') { if (!yes(value) && !no(value)) throw new Error('Responde sí o no.'); data.procedure = yes(value) ? 'ALIMENTOS_NNA' : 'OTRO'; }
  else if (step.id === 'relation') { const relation = value.toLowerCase(); data.applicantRelation = relation.startsWith('madre') ? 'madre' : relation.startsWith('padre') ? 'padre' : 'otro'; }
  else if (step.id === 'claims' || step.id === 'risk') { if (!yes(value) && !no(value)) throw new Error('Responde sí o no.'); data[step.id === 'claims' ? 'otherClaims' : 'urgentRisk'] = yes(value); }
  else if (step.id === 'respondentAddress') { data.respondentAddressUnknown = unknown(value); data.respondentAddress = data.respondentAddressUnknown ? '' : value.slice(0, 220); }
  else if (step.id === 'childrenCount') {
    const count = Number(value); if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Indica un número entre 1 y 5.');
    data.children = Array.from({ length: count }, (_, i) => data.children?.[i] || { name: '', birthDate: '' });
    data.chatCompleted = data.chatCompleted.filter(id => !/^child(Name|Date|Relation)-/.test(id) || Number(id.split('-')[1]) < count);
  } else if (step.id.startsWith('childName-')) data.children[Number(step.id.split('-')[1])].name = unknown(value) ? '' : value.slice(0, 120);
  else if (step.id.startsWith('childRelation-')) data.children[Number(step.id.split('-')[1])].relationToRespondent = unknown(value) ? '' : value.slice(0, 80);
  else if (step.id.startsWith('childDate-')) {
    if (!unknown(value) && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Usa la fecha AAAA-MM-DD o responde “no sé”.');
    data.children[Number(step.id.split('-')[1])].birthDate = unknown(value) ? '' : value;
  } else if (step.id === 'amount') { const amount = Number(value.replace(/S\/?\s*/gi, '').replace(',', '.')); if (!(amount > 0)) throw new Error('Indica un monto mensual mayor que cero.'); data.requestedAmount = amount; }
  else if (step.id === 'applicantLocation') {
    const parts = value.split(',').map(part => part.trim());
    if (parts.length !== 3 || parts.some(part => !part || unknown(part))) throw new Error('Escribe departamento, provincia y distrito separados por comas.');
    [data.applicantDepartment, data.applicantProvince, data.applicantDistrict] = parts.map(part => part.slice(0, 80));
  }
  else if (step.id === 'applicantEmail') { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Indica un correo ficticio válido.'); data.applicantEmail = value.slice(0, 120); }
  else if (step.id === 'facts') data.factDescription = unknown(value) ? '' : value.slice(0, 1600);
  else if (step.id === 'expenses') data.expenseDescription = unknown(value) ? '' : value.slice(0, 1200);
  else if (step.id === 'evidence') { data.evidence = /^(ningun[oa]|no tengo|no s[eé])$/i.test(value) ? [] : value.split(/[,\n]/).map(x => x.trim().slice(0, 140)).filter(Boolean).slice(0, 12); data.evidenceConfirmed = true; }
  else if (step.id === 'review') {
    if (!yes(value) && !no(value)) throw new Error('Responde sí o no.');
    if (no(value)) { extras = ['Puedes usar los botones «Corregir» del resumen y después volveré a pedir tu confirmación.']; return false; }
    data.reviewConfirmed = true;
  } else data[step.id] = unknown(value) ? '' : value.slice(0, step.id === 'applicantDocument' ? 30 : 220);
  if (!completed(step.id)) data.chatCompleted.push(step.id);
  if (step.id !== 'review') { data.reviewConfirmed = false; data.chatCompleted = data.chatCompleted.filter(id => id !== 'review'); }
  return true;
}
async function saveCase() {
  const response = caseId ? await api(`/api/cases/${caseId}`, { method: 'PUT', data }) : await api('/api/cases', { method: 'POST', data });
  caseId = response.case.id; data = response.case.data; documents = response.case.documents || documents;
  evaluation = await api(`/api/cases/${caseId}/evaluate`);
  $('#case-label').textContent = `Caso ${caseId.slice(0, 8)}`;
  $('.top-actions a').href = `./formulario.html?case=${encodeURIComponent(caseId)}`;
  await loadCases();
  await refreshFormats();
}
async function refreshFormats() {
  formats = (await api(caseId ? `/api/cases/${caseId}/formats` : '/api/formats')).formats;
  const select = $('#format-select'), selected = select.value;
  select.innerHTML = formats.map(format => `<option value="${esc(format.code)}">${esc(format.entity)} · ${esc(format.version)}</option>`).join('');
  if (formats.some(format => format.code === selected)) select.value = selected;
  renderFormat();
}
function renderFormat() {
  const format = formats.find(item => item.code === $('#format-select').value);
  if (!format) { $('#format-detail').textContent = 'No hay formatos disponibles.'; return; }
  const missing = format.assessment?.missing || [];
  $('#format-detail').innerHTML = `<p><strong>Destino:</strong> ${esc(format.destination)}<br><strong>Trámite:</strong> ${esc(format.procedure)}<br><strong>Canal:</strong> ${esc(format.channel)}</p><p>${esc(format.note)}</p><p>${format.mode === 'filled_preview' ? 'Vista previa con datos superpuestos' : 'Referencia sin completar'} · ${format.available ? 'PDF local disponible' : 'PDF local no encontrado'}</p>${missing.length ? `<p><strong>Falta para completar:</strong> ${esc(missing.join(', '))}</p>` : ''}<p><a href="${esc(format.sourceUrl)}" target="_blank" rel="noopener noreferrer">Ver fuente oficial ↗</a></p>`;
  $('#format-preview').textContent = format.mode === 'filled_preview' ? 'Descargar versión completada' : 'Descargar referencia sin completar';
}
async function loadCases() {
  const { cases } = await api('/api/cases');
  $('#case-list').innerHTML = cases.length ? cases.map(item => `<div class="case-row ${item.id === caseId ? 'active' : ''}"><button type="button" data-open="${esc(item.id)}">Caso ${esc(item.id.slice(0, 8))}<small>${esc(new Date(item.updated_at).toLocaleDateString('es-PE'))}</small></button><button type="button" data-delete="${esc(item.id)}" aria-label="Eliminar caso">×</button></div>`).join('') : '<p>Aún no hay conversaciones.</p>';
  return cases;
}
async function openCase(id) {
  const result = await api(`/api/cases/${id}`);
  caseId = id; data = result.case.data; documents = result.case.documents || []; editing = null; extras = [];
  restoreLegacyAnswers();
  evaluation = await api(`/api/cases/${caseId}/evaluate`);
  $('#case-label').textContent = `Caso ${id.slice(0, 8)}`;
  $('.top-actions a').href = `./formulario.html?case=${encodeURIComponent(id)}`;
  await loadCases(); await refreshFormats(); render();
}
function newCase() {
  mode = 'case';
  caseId = null; data = initial(); documents = []; editing = null; extras = []; evaluation = null;
  $('#case-label').textContent = 'Conversación nueva'; $('.top-actions a').href = './formulario.html';
  loadCases().catch(error => showError(error.message)); refreshFormats().catch(error => showError(error.message)); render();
}
function showError(text) { $('#chat-error').textContent = text; }
function render() {
  document.body.dataset.mode = mode;
  document.body.dataset.hasQa = qaHistory.length ? 'yes' : 'no';
  $('#workspace-title').textContent = mode === 'qa' ? 'Consulta libre de la biblioteca' : 'Demanda de alimentos para menores';
  $('#intro-eyebrow').textContent = mode === 'qa' ? 'CONSULTA LIBRE' : 'ENTREVISTA GUIADA';
  $('#intro-title').innerHTML = mode === 'qa' ? 'Pregunta sobre las leyes<br><em>de tu biblioteca.</em>' : 'Cuéntame tu caso,<br><em>paso a paso.</em>';
  $('#intro-description').textContent = mode === 'qa'
    ? 'Puedes preguntar con tus palabras. Groq recibe tu pregunta y fragmentos pertinentes de los PDF, no todos los archivos completos. Las respuestas jurídicas necesitan verificación de fuente y vigencia.'
    : 'Una pregunta por turno. Puedes responder con tus palabras o elegir una opción. Escribe «ayuda» si necesitas una explicación. Usa únicamente datos inventados.';
  if (mode === 'qa') { $('#case-label').textContent = 'Chat con Groq y tus PDF'; renderQaConversation(); return; }
  $('#case-label').textContent = caseId ? `Caso ${caseId.slice(0, 8)}` : 'Conversación nueva';
  renderConversation();
  const all = steps(), answered = all.filter(step => completed(step.id)).length;
  $('#progress-title').textContent = blocked() ? 'Necesita atención humana' : data.reviewConfirmed ? 'Listo para revisar' : `${answered} de ${all.length} respuestas`;
  $('#progress-detail').textContent = blocked() || (data.reviewConfirmed ? evaluation?.status === 'draft_ready' ? 'Confirmaste el resumen. El PDF sigue siendo una simulación.' : `Pendiente: ${evaluation?.missing?.join('; ') || evaluation?.blocks?.join('; ') || 'revisar datos'}.` : 'Tu avance se guarda después de cada respuesta.');
  $('#checklist').innerHTML = [
    ['Alcance', ['consent','procedure','relation','claims','risk'].every(completed)],
    ['Personas', ['applicantName','applicantDocument','applicantAddress','courtDistrict','applicantLocation','applicantPhone','applicantEmail','respondentName','respondentDocument','respondentAddress'].every(completed)],
    ['Menores', completed('childrenCount') && data.children?.every((_, i) => completed(`childName-${i}`) && completed(`childDate-${i}`) && completed(`childRelation-${i}`))],
    ['Solicitud y revisión', ['amount','facts','expenses','evidence','review'].every(completed)]
  ].map(([label, done]) => `<div class="checkitem ${done ? 'done' : ''}">${label}</div>`).join('');
  $('#summary').innerHTML = all.filter(step => completed(step.id) && step.id !== 'review').map(step => `<div class="summary-row"><button type="button" data-edit="${esc(step.id)}">Corregir</button><strong>${esc(step.label)}</strong><span>${esc(step.value() || 'No indicado')}</span></div>`).join('') || '<p>El resumen aparecerá conforme respondas.</p>';
  $('#documents').innerHTML = documents.map(doc => `<div class="doc-row"><span>${esc(doc.original_name)}</span><button type="button" data-download="${esc(doc.id)}">Descargar</button></div>`).join('');
  const ready = data.reviewConfirmed && !blocked() && evaluation?.status === 'draft_ready' && all.every(step => completed(step.id)) && Boolean(caseId);
  $('#draft-button').disabled = !ready; $('#pdf-button').disabled = !ready;
  $('#groq-button').disabled = !caseId || !data.isFictional || !data.factDescription || !data.expenseDescription;
  $('#format-preview').disabled = !ready;
  renderFormat();
}
async function submitAnswer(value) {
  if (busy) return;
  const step = editing ? steps().find(item => item.id === editing) : currentStep();
  if (!step) return;
  if (/^(\/?ayuda|¿?qu[eé] (es|significa))\b/i.test(value.trim())) {
    const explanation = step.id === 'claims' ? 'Una pretensión es lo que solicitas al juzgado. Aquí preguntamos si además de alimentos quieres pedir otra cosa, como tenencia o filiación.' : step.id === 'evidence' ? 'Los medios probatorios son documentos u otros elementos con los que se busca respaldar los hechos. Menciona solo los que realmente tendrías en esta simulación.' : step.id === 'amount' ? 'El monto es la cantidad mensual total de alimentos que deseas solicitar en esta simulación. Esta herramienta no calcula ni garantiza una pensión.' : 'Responde con lo que sabes. Si no conoces un dato, escribe “no sé”; quedará pendiente para revisión.';
    extras.push(explanation); render(); $('#answer').value = ''; return;
  }
  busy = true; $('#send').disabled = true; showError('');
  const before = structuredClone(data), previousEditing = editing;
  try {
    if (!parseAnswer(step, value)) { render(); return; }
    await saveCase(); editing = null; extras = [];
    render(); $('#answer').value = '';
  } catch (error) { data = before; editing = previousEditing; showError(error.message); render(); }
  finally { busy = false; $('#send').disabled = false; }
}
async function submitQa(value) {
  const question = value.trim();
  if (busy || !question) return;
  if (!$('#qa-consent').checked) { showError('Marca la casilla para confirmar el envío de la pregunta y los extractos a Groq.'); return; }
  busy = true; showError(''); $('#send').disabled = true;
  addMessage('user', question);
  const pending = addMessage('assistant', 'Buscando en los PDF y consultando Groq…');
  $('#answer').value = '';
  try {
    const { turn } = await api('/api/qa', { method: 'POST', data: { question, consent: true } });
    qaHistory.push(turn); render();
  } catch (error) {
    pending.remove(); showError(error.message);
    $('#answer').value = question;
  } finally { busy = false; $('#send').disabled = false; }
}
function toBase64(bytes) { let out = ''; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(out); }
async function download(route, name) {
  const response = await fetch(route, { credentials: 'same-origin' });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'No se pudo descargar.');
  const link = document.createElement('a'); link.href = URL.createObjectURL(await response.blob()); link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}
async function status() {
  const value = await api('/api/status');
  $('#groq-status').textContent = value.groqConfigured ? 'Groq configurado' : 'Groq sin clave';
  $('#library-status').textContent = value.ingestion.running ? `Leyendo PDF ${value.ingestion.processed}/${value.ingestion.total}…` : `Biblioteca: ${value.sourceCount} ${value.sourceCount === 1 ? 'PDF indexado' : 'PDF indexados'}.`;
  $('#qa-status').textContent = value.ingestion.running
    ? `Indexando PDF ${value.ingestion.processed}/${value.ingestion.total}…` : `${value.searchableCount} de ${value.sourceCount} PDF con texto buscable · ${value.chunkCount} ${value.chunkCount === 1 ? 'fragmento' : 'fragmentos'}. ${value.groqConfigured ? `Groq listo (${value.groqModel}).` : 'Falta GROQ_API_KEY en mvp/.env.'}`;
}
async function showApp() {
  $('#auth-screen').hidden = true; $('#workspace').hidden = false;
  await status(); const [cases, chat] = await Promise.all([loadCases(), api('/api/qa')]); qaHistory = chat.turns;
  const requestedCase = new URLSearchParams(location.search).get('case');
  if (/^[a-f0-9-]{36}$/.test(requestedCase || '')) { mode = 'case'; await openCase(requestedCase).catch(error => showError(error.message)); }
  else if (cases.length) await openCase(cases[0].id);
  else { refreshFormats().catch(error => showError(error.message)); render(); }
  setInterval(() => status().catch(() => {}), 5000);
}
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); const input = new FormData(event.currentTarget);
  try { await api(setupRequired ? '/api/auth/register' : '/api/auth/login', { method: 'POST', data: { email: input.get('email'), password: input.get('password') } }); $('#auth-error').textContent = ''; await showApp(); }
  catch (error) { $('#auth-error').textContent = error.message; }
});
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); });
$('#new-case').addEventListener('click', newCase);
function switchToQa() { mode = 'qa'; showError(''); render(); $('#answer').focus(); }
$('#qa-mode').addEventListener('click', switchToQa);
$('#qa-tab').addEventListener('click', switchToQa);
$('#case-tab').addEventListener('click', () => { if (caseId) { mode = 'case'; render(); } else newCase(); $('#answer').focus(); });
$('#qa-clear').addEventListener('click', async () => {
  if (!confirm('¿Borrar tu historial de consultas a Groq?')) return;
  try { await api('/api/qa', { method: 'DELETE' }); qaHistory = []; render(); }
  catch (error) { showError(error.message); }
});
$('#case-list').addEventListener('click', async event => {
  const open = event.target.closest('[data-open]'), remove = event.target.closest('[data-delete]');
  try { if (open) { mode = 'case'; await openCase(open.dataset.open); } if (remove && confirm('¿Eliminar este caso y sus anexos?')) { await api(`/api/cases/${remove.dataset.delete}`, { method: 'DELETE' }); if (caseId === remove.dataset.delete) { if (mode === 'qa') { caseId = null; await loadCases(); render(); } else newCase(); } else await loadCases(); } }
  catch (error) { showError(error.message); }
});
$('#composer').addEventListener('submit', event => { event.preventDefault(); if (mode === 'qa') submitQa($('#answer').value); else submitAnswer($('#answer').value); });
$('#answer').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (mode === 'qa') submitQa($('#answer').value); else submitAnswer($('#answer').value); } });
$('#choices').addEventListener('click', event => { const choice = event.target.closest('[data-choice]'); if (choice) submitAnswer(choice.dataset.choice); });
$('#summary').addEventListener('click', event => { const button = event.target.closest('[data-edit]'); if (!button) return; editing = button.dataset.edit; data.reviewConfirmed = false; data.chatCompleted = data.chatCompleted.filter(id => id !== 'review'); extras = []; render(); $('#answer').focus(); });
$('#document-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 5_000_000) throw new Error('El archivo supera 5 MB.'); if (!data.isFictional) throw new Error('Confirma primero que usarás datos ficticios.'); await saveCase(); await api(`/api/cases/${caseId}/documents`, { method: 'POST', data: { name: file.name, data: toBase64(new Uint8Array(await file.arrayBuffer())) } }); documents = (await api(`/api/cases/${caseId}/documents`)).documents; render(); showError('Anexo guardado.'); }
  catch (error) { showError(error.message); } finally { event.target.value = ''; }
});
$('#documents').addEventListener('click', async event => { const button = event.target.closest('[data-download]'); if (!button) return; try { const doc = documents.find(x => x.id === button.dataset.download); await download(`/api/cases/${caseId}/documents/${doc.id}`, doc.original_name); } catch (error) { showError(error.message); } });
$('#draft-button').addEventListener('click', async () => {
  try { const result = await api(`/api/cases/${caseId}/draft`); const d = result.draft; if (!d) throw new Error('Faltan datos para el borrador.'); $('#draft-content').innerHTML = `<h2>${esc(d.title)}</h2><p><strong>SIMULACIÓN · NO PRESENTAR</strong></p><p>${esc(d.notice)}</p><h3>Personas</h3><p>${esc(d.applicant)}<br>${esc(d.respondent)}<br>${esc(d.child)}</p><h3>Petitorio</h3><p>${esc(d.petition)}</p><h3>Hechos</h3>${d.facts.map(x => `<p>${esc(x)}</p>`).join('')}<h3>Documentos</h3><p>${result.documents.map(x => esc(x.original_name)).join(', ') || 'Ninguno'}</p><h3>Base jurídica</h3><p>${esc(d.legalBasis)}</p><p>Los fragmentos localizados no constituyen citas aprobadas.</p>`; $('#draft-dialog').showModal(); }
  catch (error) { $('#tool-result').textContent = error.message; }
});
$('#close-draft').addEventListener('click', () => $('#draft-dialog').close());
$('#pdf-button').addEventListener('click', async () => { try { await download(`/api/cases/${caseId}/pdf`, `borrador-${caseId.slice(0,8)}.pdf`); } catch (error) { $('#tool-result').textContent = error.message; } });
$('#format-select').addEventListener('change', renderFormat);
$('#format-preview').addEventListener('click', async () => {
  const format = formats.find(item => item.code === $('#format-select').value);
  if (!format) return;
  try { await download(`/api/cases/${caseId}/formats/${format.code}/preview`, `simulacion-${format.code}-${caseId.slice(0,8)}.pdf`); }
  catch (error) { $('#format-detail').insertAdjacentHTML('beforeend', `<p class="error">${esc(error.message)}</p>`); }
});
$('#groq-button').addEventListener('click', async () => {
  const box = $('#tool-result'); box.textContent = 'Consultando Groq…';
  try { const { suggestion } = await api(`/api/cases/${caseId}/ai`, { method: 'POST' }); box.innerHTML = `<p><strong>Sugerencia para revisar</strong></p><p>Hechos: ${esc(suggestion.hechos)}</p><p>Gastos: ${esc(suggestion.gastos)}</p><small>${esc(suggestion.warning)}</small><p><button type="button" id="apply-suggestion">Aplicar y revisar</button></p>`; $('#apply-suggestion').addEventListener('click', async () => { try { data.factDescription = suggestion.hechos; data.expenseDescription = suggestion.gastos; data.reviewConfirmed = false; data.chatCompleted = [...new Set([...data.chatCompleted.filter(id => id !== 'review'), 'facts', 'expenses'])]; await saveCase(); render(); box.textContent = 'Sugerencia aplicada. Revisa y confirma el resumen antes del PDF.'; } catch (error) { box.textContent = error.message; } }); }
  catch (error) { box.textContent = error.message; }
});
$('#source-search').addEventListener('submit', async event => { event.preventDefault(); const q = $('#source-query').value.trim(); if (!q) return; try { const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`); $('#search-results').innerHTML = results.length ? results.slice(0, 5).map(x => `<div class="source-hit"><strong>${esc(x.title)} · pág. ${x.page}</strong><p>${esc(x.content.slice(0, 350))}</p><small>Verificar en el PDF original</small></div>`).join('') : '<p>Sin resultados textuales. Algunos PDF necesitan OCR.</p>'; } catch (error) { $('#search-results').textContent = error.message; } });
$('#reindex-button').addEventListener('click', async () => { try { await api('/api/reindex', { method: 'POST' }); await status(); } catch (error) { $('#search-results').textContent = error.message; } });
(async () => {
  try { const [state, session] = await Promise.all([api('/api/status'), api('/api/auth/me')]); setupRequired = state.setupRequired; if (session.user) await showApp(); else { $('#auth-title').textContent = setupRequired ? 'Crea tu cuenta local' : 'Inicia sesión'; $('#auth-description').textContent = setupRequired ? 'La primera cuenta administra este espacio de prueba.' : 'Continúa tu conversación guardada.'; $('#auth-button').textContent = setupRequired ? 'Crear cuenta →' : 'Entrar →'; } }
  catch (error) { $('#auth-error').textContent = `No se pudo conectar al servidor: ${error.message}`; }
})();
