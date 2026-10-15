import { initialCase, allSteps, steps, currentStep, applyStep, directAnswer, workflowBlock, stepValue } from './workflow.mjs';
import { evaluateCase, normalizeCase } from '../procedure.mjs';
import { interpretMessageWithGroq } from '../services/groq-chat.mjs';
import { askLibrary } from '../services/rag.mjs';
import { draftIntent, procedureConfirmation } from './intent.mjs';

const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const actions = (...items) => items.map(([id, label]) => ({ id, label }));
export const welcome = { question: '', answer: 'Hola, soy AbogadoIA. Podemos conversar, consultar tu biblioteca de leyes o preparar una demanda de prueba aquí mismo. ¿En qué te ayudo?', engine: 'Asistente', actions: actions(['start_draft', 'Preparar una demanda'], ['library_question', 'Consultar mis leyes']) };

export function conversationView(store, userId, conversationId) {
  const conversation = store.getConversation(userId, conversationId);
  if (!conversation) throw failure('Conversación no encontrada.', 404);
  const item = conversation.state.caseId ? store.getCase(userId, conversation.state.caseId) : null;
  if (item) item.data = normalizeCase(item.data);
  const data = item?.data;
  const emptyCase = data && !data.chatCompleted.length && !item.documents.length &&
    ![data.applicantName, data.applicantDocument, data.respondentName, data.factDescription, data.expenseDescription].some(Boolean) &&
    !data.children.some(child => child.name || child.birthDate) && !(data.requestedAmount > 0);
  if (emptyCase && !conversation.state.procedureConfirmed && !conversation.state.procedureSelectionRepair) {
    conversation.state.paused = true; conversation.state.procedureSelectionRepair = true;
    store.updateConversation(userId, conversationId, conversation.state);
    conversation.turns.push(store.addConversationTurn(userId, conversationId, { question: '', engine: 'Asistente',
      answer: 'La preparación del documento quedó pausada: todavía no se confirmó el procedimiento. Podemos seguir consultando sobre tu asunto en este chat. Al elegir un documento, te pediré confirmar su tipo antes de tomar datos.', actions: actions(['start_draft', 'Elegir un documento']) }));
  }
  return { ...conversation, case: item, evaluation: data ? evaluateCase(data, { hasDocuments: item.documents.length > 0 }) : null,
    fields: data ? allSteps(data).filter(step => step.id !== 'review').map(step => ({ ...step,
      value: !data.chatCompleted.includes(step.id) && ['consent', 'claims', 'risk', 'childrenCount', 'evidence'].includes(step.id) ? '' : stepValue(data, step.id), complete: data.chatCompleted.includes(step.id) })) : [],
    progress: data ? { completed: steps(data).filter(x => data.chatCompleted.includes(x.id)).length, total: steps(data).length,
      paused: conversation.state.paused, blocked: workflowBlock(data), next: currentStep(data, conversation.state) } : null };
}

export function ensureConversations(store, userId) {
  if (store.listConversations(userId).length) return;
  const migrated = store.db.prepare('SELECT 1 FROM chat_migrations WHERE user_id=?').get(userId);
  if (migrated) {
    const first = store.createConversation(userId);
    store.addConversationTurn(userId, first.id, welcome);
    return;
  }
  const old = store.qaTurns(userId, 100);
  const first = store.createConversation(userId, { title: old.length ? 'Conversación anterior' : 'Nueva conversación' });
  store.addConversationTurn(userId, first.id, welcome);
  for (const turn of old) store.addConversationTurn(userId, first.id, turn);
  for (const item of store.listCases(userId)) {
    const conversation = store.createConversation(userId, { title: `Demanda anterior · ${item.id.slice(0, 8)}`, caseId: item.id, paused: true });
    store.addConversationTurn(userId, conversation.id, { question: '', answer: 'Importé tu caso anterior. Puedes revisar sus datos en «Mi documento», continuar la preparación o hacer cualquier consulta aquí.', engine: 'Asistente', actions: actions(['resume_draft', 'Continuar documento'], ['show_document', 'Revisar datos']) });
  }
  store.db.prepare('INSERT INTO chat_migrations(user_id) VALUES(?)').run(userId);
  store.clearQaTurns(userId);
}

function redactKnown(text, data) {
  let result = String(text || '');
  const entries = [data?.applicantName, data?.respondentName, data?.applicantAddress, data?.respondentAddress, data?.applicantDocument, data?.respondentDocument, data?.applicantPhone, data?.applicantEmail, ...(data?.children || []).map(x => x.name)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const value of entries) result = result.replaceAll(value, '[DATO DEL EJEMPLO]');
  return result.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[CORREO]').replace(/\b\d{8,9}\b/g, '[DOCUMENTO O TELÉFONO]');
}
function nextResponse(data, state) {
  const block = workflowBlock(data);
  if (block && !state.editing) return { answer: `${block} Puedes corregir los datos en «Mi documento» y también seguir preguntándome aquí.`, actions: actions(['show_document', 'Revisar datos']) };
  if (state.pending?.length) return { answer: 'Antes de seguir, revisa los datos que quedaron pendientes de tu confirmación.',
    proposals: state.pending.map(proposal => ({ ...proposal, label: allSteps({ ...data, children: Array.from({ length: 5 }, (_, i) => data.children[i] || {}) }).find(step => step.id === proposal.stepId)?.label })),
    actions: actions(['confirm_data', 'Registrar estos datos'], ['reject_data', 'Descartar la propuesta']) };
  const next = currentStep(data, state);
  if (next) return { answer: next.question, actions: next.choices.map(label => ({ id: 'answer', label, value: label })) };
  if (state.formatDetails) return { answer: 'Registré los datos adicionales del formato. Revisa de nuevo el resumen antes de descargarlo.', actions: actions(['show_document', 'Revisar documento'], ['confirm_review', 'Confirmar resumen']) };
  return { answer: 'El resumen quedó confirmado. Tu borrador de simulación está listo. Puedes revisarlo y descargarlo, o seguir conversando conmigo.', actions: actions(['show_draft', 'Ver borrador'], ['download_pdf', 'Descargar PDF']) };
}
export async function handleConversationMessage(store, userId, conversationId, body, config, fetchImpl) {
  const conversation = store.getConversation(userId, conversationId);
  if (!conversation) throw failure('Conversación no encontrada.', 404);
  const state = { ...conversation.state };
  let item = state.caseId ? store.getCase(userId, state.caseId) : null;
  let data = item ? normalizeCase(item.data) : null, message = String(body.message || '').trim(), action = String(body.action || '');
  if (message.length > 4000) throw failure('Escribe un mensaje de hasta 4000 caracteres.');
  const text = clean(message);
  const intent = draftIntent(message, state.choosingDocumentType);
  if (!action && /^(ya )?no quiero.*\b(demanda|documento|entrevista)\b/.test(text)) action = 'pause_draft';
  if (!action && state.pending?.length && conversation.turns.at(-1)?.proposals?.length && /^(si|confirmo|si, confirmo)\.?$/.test(text)) action = 'confirm_data';
  if (!action && state.pending?.length && conversation.turns.at(-1)?.proposals?.length && /^(no|descartar)\.?$/.test(text)) action = 'reject_data';
  if (!action && ['confirm_alimentos', 'choose_document', 'other_document'].includes(intent)) action = 'select_procedure';
  if (!action && state.awaitingProcedure === 'ALIMENTOS_NNA' && conversation.turns.at(-1)?.proposedProcedure === 'ALIMENTOS_NNA') {
    if (/^(si|si, alimentos para menores|confirmo)\.?$/.test(text)) action = 'confirm_procedure';
    else if (/^(no|no, seguir conversando)\.?$/.test(text)) action = 'cancel_procedure';
  }
  if (!action && /^(pausa|pausar|deten|dejar).*\b(demanda|documento|entrevista)\b/.test(text)) action = 'pause_draft';
  if (!action && /^(continuar|continua|retomar|sigamos|seguir|reanudar).*\b(demanda|documento|entrevista)\b/.test(text)) action = 'resume_draft';
  if (!action && /^(ver|mostrar|descargar).*(borrador|pdf|resumen|documento)/.test(text)) action = 'show_document';
  if (!message && !action) throw failure('Escribe un mensaje para continuar.');
  if (!message) message = ({ start_draft: 'Quiero preparar una demanda de prueba.', confirm_procedure: 'Sí, quiero preparar alimentos para menores.', cancel_procedure: 'No, quiero seguir conversando.', pause_draft: 'Pausar la preparación del documento.', resume_draft: 'Continuar la preparación del documento.', confirm_data: 'Sí, registrar los datos propuestos.', reject_data: 'No, descartar los datos propuestos.', confirm_review: 'He revisado el resumen y lo confirmo.', format_details: 'Completar datos del formato oficial.', edit: `Corregir ${body.stepId || 'un dato'}.`, show_document: 'Revisar mi documento.' })[action] || 'Continuar';
  let response;
  const saveData = next => { data = next; item = store.updateCase(userId, state.caseId, data); };
  if (action === 'start_draft' || action === 'select_procedure') {
    if (action === 'select_procedure' && intent === 'other_document') {
      state.choosingDocumentType = false; state.awaitingProcedure = null;
      response = { answer: 'Podemos revisar ese asunto en el chat. El generador de PDF disponible cubre alimentos para menores; el documento que mencionas requiere otro procedimiento. ¿Qué necesitas aclarar sobre ese asunto?', actions: actions(['library_question', 'Consultar mi biblioteca']) };
    } else if (action === 'select_procedure' && intent === 'choose_document') {
      state.choosingDocumentType = true; state.awaitingProcedure = null;
      response = { answer: '¿Sobre qué asunto quieres preparar el documento? Primero aclaremos el procedimiento. El PDF disponible en este piloto es la demanda de alimentos para menores.', actions: actions(['start_draft', 'Elegir alimentos para menores']) };
    } else {
      state.choosingDocumentType = false; state.awaitingProcedure = 'ALIMENTOS_NNA';
      response = procedureConfirmation();
    }
  } else if (action === 'confirm_procedure') {
    if (state.awaitingProcedure !== 'ALIMENTOS_NNA' || conversation.turns.at(-1)?.proposedProcedure !== 'ALIMENTOS_NNA') throw failure('Primero selecciona y confirma el procedimiento que quieres preparar.');
    state.awaitingProcedure = null; state.choosingDocumentType = false; state.procedureConfirmed = true;
      if (!item) { item = store.createCase(userId, initialCase()); state.caseId = item.id; data = item.data; }
      state.paused = false;
      response = { ...nextResponse(data, state), answer: `Podemos preparar una demanda inicial de alimentos para menores, como simulación. Iremos reuniendo los datos en esta misma conversación; puedes preguntar o pausar cuando quieras.\n\n${nextResponse(data, state).answer}` };
  } else if (action === 'cancel_procedure') {
    state.awaitingProcedure = null; state.choosingDocumentType = false;
    response = { answer: 'Seguimos en el chat. Cuéntame el asunto que quieres consultar.', actions: actions(['library_question', 'Consultar mi biblioteca']) };
  } else if (action === 'pause_draft') {
    state.paused = true; state.editing = null;
    response = { answer: 'La preparación queda pausada y tus datos están guardados. Podemos conversar de cualquier tema. Cuando quieras, retomamos aquí.', actions: item ? actions(['resume_draft', 'Retomar documento']) : [] };
  } else if (action === 'resume_draft' || action === 'format_details') {
    if (!item) throw failure('Primero inicia un documento en esta conversación.');
    if (action === 'format_details' && evaluateCase(data).status !== 'draft_ready') throw failure('Completa primero los datos principales de la demanda.');
    if (!data.chatCompleted.length && !state.procedureConfirmed) {
      state.awaitingProcedure = 'ALIMENTOS_NNA'; response = procedureConfirmation();
    } else {
      state.paused = false;
      if (action === 'format_details') state.formatDetails = true;
      response = nextResponse(data, state);
    }
  } else if (action === 'edit') {
    if (!item || !allSteps(data).some(step => step.id === body.stepId && step.id !== 'review')) throw failure('No se encontró ese dato.');
    state.pending = null; state.editing = body.stepId; state.paused = false;
    response = nextResponse(data, state);
  } else if (action === 'confirm_data') {
    if (!item || !state.pending?.length) throw failure('Ya no hay una propuesta pendiente.');
    let next = data;
    try { for (const proposal of state.pending) next = applyStep(next, proposal.stepId, proposal.value); }
    catch (cause) { throw failure(cause.message); }
    saveData(next); state.pending = null; state.editing = null; state.paused = false;
    response = { ...nextResponse(data, state), answer: `Registré los datos que confirmaste.\n\n${nextResponse(data, state).answer}` };
  } else if (action === 'reject_data') {
    if (!item || !state.pending?.length) throw failure('Ya no hay una propuesta pendiente.');
    state.pending = null;
    response = { ...nextResponse(data, state), answer: `Descarté la propuesta.\n\n${nextResponse(data, state).answer}` };
  } else if (action === 'confirm_review') {
    if (!item) throw failure('No hay un documento para confirmar.');
    try { saveData(applyStep(data, 'review', 'Sí')); } catch (cause) { throw failure(cause.message); }
    state.paused = true; state.editing = null; state.formatDetails = false;
    response = nextResponse(data, state);
  } else if (action === 'show_document') {
    response = { answer: item ? 'Abre «Mi documento» para revisar tus datos, corregirlos y elegir el PDF. La descarga se habilita al completar y confirmar el resumen.' : 'Podemos empezar a preparar el documento aquí. Por ahora no hay una demanda en esta conversación.', actions: actions([item ? 'show_document' : 'start_draft', item ? 'Abrir mi documento' : 'Preparar demanda']) };
  } else if (action && action !== 'answer') throw failure('Acción no reconocida.');
  else {
    const pending = item && !state.paused && (!workflowBlock(data) || state.editing) ? currentStep(data, state) : null;
    if (item && /\b(que monto|cuanto)\b.*\b(pedi|pedimos|registre|solicite|anotaste|pusimos)\b/.test(text)) {
      response = { answer: data.requestedAmount > 0 ? `El monto que declaraste para este documento es S/ ${data.requestedAmount.toFixed(2)} mensuales en total.` : 'Todavía no declaraste un monto mensual para este documento.', actions: actions(['show_document', 'Revisar datos']) };
    } else
    if (pending && directAnswer(pending, message)) {
      try { saveData(applyStep(data, pending.id, message)); } catch (cause) { throw failure(cause.message); }
      state.editing = null; state.pending = null;
      if (pending.id === 'review') { state.paused = true; state.formatDetails = false; }
      response = nextResponse(data, state);
    } else {
      if (pending && !config.groqApiKey && !/[¿?]/.test(message) && !/^(que|como|por que|cuando|donde|cual|explica|dime|cuentame|hola|gracias)\b/.test(text)) {
        try { applyStep(data, pending.id, message); } catch (cause) { throw failure(cause.message); }
        state.pending = [{ stepId: pending.id, value: message, quote: message }];
        response = { answer: `La IA no está configurada. Puedo tomar tu texto literalmente como respuesta a «${pending.label}». Confirma que corresponde a ese dato.`,
          proposals: [{ ...state.pending[0], label: pending.label }], actions: actions(['confirm_data', 'Sí, registrar este dato'], ['reject_data', 'Corregir mi mensaje']) };
      } else {
      const safetyStep = pending && ['consent', 'claims', 'risk', 'review'].includes(pending.id);
      const questionLike = /[¿?]/.test(message) || /^(que|como|por que|cuando|donde|cual|explica|dime|cuentame|hola|gracias)\b/.test(text);
      const extractionSteps = item ? allSteps({ ...data, children: Array.from({ length: 5 }, (_, i) => data.children[i] || {}) }) : [];
      const interpretation = item && data.isFictional && !safetyStep && !questionLike
        ? await interpretMessageWithGroq(message, extractionSteps, pending, config, fetchImpl) : { intent: 'question', proposals: [] };
      if (interpretation.intent === 'provide_data' && interpretation.proposals.length) {
        interpretation.proposals.sort((a, b) => (a.stepId === 'childrenCount' ? -1 : b.stepId === 'childrenCount' ? 1 : 0));
        let preview = data;
        try { for (const proposal of interpretation.proposals) preview = applyStep(preview, proposal.stepId, proposal.value); }
        catch (cause) { throw failure(`Ese dato necesita aclaración: ${cause.message}`); }
        state.pending = interpretation.proposals;
        response = { answer: 'Entendí estos datos de tu mensaje. Revísalos antes de incorporarlos al documento:', proposals: state.pending.map(proposal => ({ ...proposal, label: allSteps(preview).find(step => step.id === proposal.stepId)?.label })),
          engine: 'Groq', model: config.groqModel, actions: actions(['confirm_data', 'Sí, registrar estos datos'], ['reject_data', 'Corregir mi mensaje']) };
      } else {
        const history = conversation.turns.filter(turn => turn.question).map(turn => ({ ...turn, question: redactKnown(turn.question, data), answer: redactKnown(turn.answer, data) }));
        response = await askLibrary(store, redactKnown(message, data), history, config, fetchImpl);
        if (state.pending?.length) response.actions = actions(['resume_draft', 'Revisar datos pendientes'], ['show_document', 'Mi documento']);
        else if (item) response.actions = actions(['resume_draft', 'Seguir con el documento'], ['show_document', 'Mi documento']);
        else response.actions = [];
      }
      }
    }
  }
  if (state.title === 'Nueva conversación') state.title = action === 'confirm_procedure' ? 'Demanda de alimentos' : message.slice(0, 60);
  store.updateConversation(userId, conversationId, state);
  store.addConversationTurn(userId, conversationId, { question: message, engine: 'Asistente', ...response });
  return conversationView(store, userId, conversationId);
}
