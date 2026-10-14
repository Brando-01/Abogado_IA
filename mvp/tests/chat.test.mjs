import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from '../server.mjs';
import { answerQuestionWithGroq, interpretMessageWithGroq } from '../src/services/groq-chat.mjs';
import { initialCase, applyStep } from '../src/chat/workflow.mjs';
import { retrieveContext } from '../src/services/rag.mjs';
import { Store } from '../src/storage.mjs';
import { ensureConversations, handleConversationMessage } from '../src/chat/conversation.mjs';

const config = { groqApiKey: 'ficticia', groqModel: 'openai/gpt-oss-120b' };
const response = value => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) });
const source = { source_id: 'fuente', title: 'Ley de prueba', file_name: 'ley.pdf', page: 1, content: 'El texto de prueba regula alimentos para menores.' };

test('RAG se abstiene sin extractos y rechaza citas inventadas o referencias inexistentes', async () => {
  let calls = 0;
  const absent = await answerQuestionWithGroq('¿Qué plazo establece la ley?', [], [], config, async () => { calls++; });
  assert.equal(absent.grounding, 'insufficient'); assert.equal(calls, 0);
  for (const claim of [
    null,
    { text: 'Existe un plazo de 48 horas.', ref: 'F1', quote: 'La ley concede un plazo de 48 horas.' },
    { text: 'El texto regula alimentos.', ref: 'F99', quote: source.content }
  ]) {
    const result = await answerQuestionWithGroq('¿Qué dice la ley?', [source], [], config, async () => response({ domain: 'legal', sufficient: true, answer: '', claims: [claim] }));
    assert.equal(result.grounding, 'insufficient'); assert.equal(result.references.length, 0);
    assert.ok(!result.answer.includes('48 horas'));
  }
});
test('una conversación general no necesita citas jurídicas y usa esquema estricto con Groq compatible', async () => {
  let sent;
  const result = await answerQuestionWithGroq('Dame ideas para organizar mi semana.', [], [], config, async (_url, options) => {
    sent = JSON.parse(options.body); return response({ domain: 'general', sufficient: true, answer: 'Anota tus prioridades y reserva descansos.', claims: [] });
  });
  assert.equal(result.grounding, 'general'); assert.equal(result.engine, 'Groq'); assert.equal(sent.response_format.json_schema.strict, true);
});
test('la extracción de datos rechaza valores que no fueron declarados y no concede consentimientos', async () => {
  const steps = [{ id: 'applicantName', label: 'Nombre' }, { id: 'consent', label: 'Consentimiento' }];
  for (const proposal of [
    null,
    { stepId: 'applicantName', value: 'Otra Persona', quote: 'Ana Ejemplo' },
    { stepId: 'consent', value: 'Ana Ejemplo', quote: 'Ana Ejemplo' }
  ]) {
    const result = await interpretMessageWithGroq('Soy Ana Ejemplo', steps, steps[0], config, async () => response({ intent: 'provide_data', proposals: [proposal] }));
    assert.deepEqual(result.proposals, []);
  }
});
test('la recuperación conserva el tema de seguimiento y diversifica páginas y documentos', () => {
  let query;
  const selected = retrieveContext({ search(value) { query = value; return [source, source, { ...source, page: 2 }, { ...source, page: 3 }, { ...source, source_id: 'otra', page: 1 }]; } }, '¿Y si no cumple?', [{ question: '¿Qué dice la ley de alimentos?' }]);
  assert.match(query, /ley de alimentos/); assert.equal(selected.length, 3);
});
test('la confirmación exige elegibilidad y las correcciones invalidan el resumen', () => {
  assert.throws(() => applyStep(initialCase(), 'review', 'Sí'), /Confirma primero/);
  const changed = applyStep({ ...initialCase(), reviewConfirmed: true, chatCompleted: ['review'] }, 'amount', 'S/ 600,50');
  assert.equal(changed.requestedAmount, 600.5); assert.equal(changed.reviewConfirmed, false); assert.ok(!changed.chatCompleted.includes('review'));
  assert.equal(applyStep(initialCase(), 'amount', '600 soles al mes').requestedAmount, 600);
  const children = applyStep(initialCase(), 'childrenCount', 'dos');
  assert.equal(applyStep(children, 'childName-1', 'Lucía Ejemplo').children[1].name, 'Lucía Ejemplo');
  assert.throws(() => applyStep(initialCase(), 'childDate-0', '31/02/2018'), /no es válida/);
});

test('el historial anterior migra una vez y los mensajes eliminados no reaparecen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abogadoia-migration-'));
  const store = new Store({ dbPath: path.join(dir, 'test.sqlite'), privateDir: dir, secret: crypto.randomBytes(32) });
  try {
    const user = store.createUser('migracion@example.test', 'contraseña-migracion-prueba');
    store.addQaTurn(user.id, { question: 'Mi pregunta anterior', answer: 'Respuesta anterior' });
    ensureConversations(store, user.id);
    let list = store.listConversations(user.id);
    assert.equal(list.length, 1); assert.equal(store.getConversation(user.id, list[0].id).turns.length, 2);
    assert.equal(store.qaTurns(user.id).length, 0);
    store.deleteConversation(user.id, list[0].id); ensureConversations(store, user.id);
    list = store.listConversations(user.id);
    assert.equal(store.getConversation(user.id, list[0].id).turns.length, 1);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sin clave de Groq se pueden confirmar datos literales sin enviarlos a IA', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abogadoia-offline-'));
  const store = new Store({ dbPath: path.join(dir, 'test.sqlite'), privateDir: dir, secret: crypto.randomBytes(32) });
  try {
    const user = store.createUser('offline@example.test', 'contraseña-offline-prueba');
    const conversation = store.createConversation(user.id);
    const send = body => handleConversationMessage(store, user.id, conversation.id, body, { groqApiKey: '' }, () => { throw new Error('No debe haber una llamada externa'); });
    for (const body of [{ action: 'start_draft' }, { action: 'confirm_procedure' }, { message: 'Sí' }, { message: 'Madre' }, { message: 'No' }, { message: 'No' }]) await send(body);
    const proposed = await send({ message: 'Ana Ejemplo' });
    assert.equal(proposed.case.data.applicantName, ''); assert.equal(proposed.turns.at(-1).engine, 'Asistente');
    const confirmed = await send({ action: 'confirm_data' });
    assert.equal(confirmed.case.data.applicantName, 'Ana Ejemplo');
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('un único hilo permite consulta, demanda, confirmación, PDF, corrección y recuperación aislada por usuario', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abogadoia-chat-'));
  const proposals = [
    ['applicantAddress', 'Av. Prueba 100'], ['respondentName', 'Luis Ejemplo'], ['respondentAddress', 'Jr. Demo 200'],
    ['childName-0', 'Carla Ejemplo'], ['childDate-0', '10/03/2018'], ['childRelation-0', 'hija'],
    ['amount', '600'], ['facts', 'No aporta desde enero.'], ['expenses', 'Comida y útiles.'], ['evidence', 'Partida, recibos']
  ];
  const fakeFetch = async (_url, options) => {
    const sent = JSON.parse(options.body), payload = JSON.parse(sent.messages[1].content);
    if (sent.response_format.json_schema.name === 'declared_data') {
      const fields = payload.message.startsWith('Soy') ? [['relation', 'madre'], ['applicantName', 'Ana Ejemplo']] : proposals;
      return response({ intent: 'provide_data', proposals: fields.map(([stepId, value]) => ({ stepId, value, quote: value })) });
    }
    return response({ domain: 'general', sufficient: true, answer: 'Podemos ordenar tu semana por prioridades.', claims: [] });
  };
  const server = createServer({ ...config, dbPath: path.join(dir, 'test.sqlite'), privateDir: dir, secret: crypto.randomBytes(32), groqFetch: fakeFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const register = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'chat@example.test', password: 'contraseña-local-prueba' }) });
    const cookie = register.headers.get('set-cookie').split(';')[0];
    const call = async (route, method = 'GET', data) => { const result = await fetch(`${base}${route}`, { method, headers: { Cookie: cookie, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }); return { status: result.status, body: result.headers.get('content-type').includes('json') ? await result.json() : await result.arrayBuffer() }; };
    await call('/api/conversations');
    let chat = (await call('/api/conversations', 'POST', {})).body;
    const conversationId = chat.id;
    const send = async data => { const result = await call(`/api/conversations/${conversationId}/messages`, 'POST', data); assert.equal(result.status, 200, JSON.stringify(result.body)); chat = result.body; return chat; };
    await send({ message: 'Hola', consent: true });
    await send({ message: 'Quiero preparar una demanda de divorcio', consent: true });
    assert.equal(chat.case, null);
    await send({ action: 'start_draft' });
    assert.equal(chat.case, null);
    await send({ action: 'confirm_procedure' });
    const caseId = chat.case.id;
    await send({ message: 'Sí' });
    await send({ message: 'Soy la madre, me llamo Ana Ejemplo', consent: true });
    assert.equal(chat.case.data.applicantName, ''); assert.equal(chat.state.pending.length, 2);
    await send({ action: 'confirm_data' }); assert.equal(chat.case.data.applicantName, 'Ana Ejemplo');
    await send({ action: 'pause_draft' });
    await send({ message: '¿Cómo organizo mi semana?', consent: true });
    assert.equal(chat.case.id, caseId); assert.equal(chat.state.paused, true);
    await send({ action: 'resume_draft' }); await send({ message: 'No' }); await send({ message: 'Sí' });
    assert.ok(chat.progress.blocked);
    await send({ action: 'edit', stepId: 'risk' }); await send({ message: 'No' });
    assert.equal(chat.progress.blocked, '');
    await send({ message: 'DEMO12345' });
    await send({ message: proposals.map(([, value]) => value).join('; '), consent: true });
    assert.equal(chat.case.data.requestedAmount, 0);
    await send({ message: 'Sí' });
    assert.equal(chat.case.data.requestedAmount, 600); assert.equal(chat.case.data.children[0].birthDate, '2018-03-10');
    assert.equal((await call(`/api/cases/${caseId}/pdf`)).status, 409);
    await send({ action: 'confirm_review' });
    await send({ message: '¿Qué monto registré?' });
    assert.match(chat.turns.at(-1).answer, /600.00/); assert.equal(chat.turns.at(-1).engine, 'Asistente');
    assert.equal((await call(`/api/cases/${caseId}/pdf`)).status, 200);
    assert.equal((await call(`/api/cases/${caseId}/documents`, 'POST', { name: 'prueba.pdf', data: Buffer.from('%PDF-1.4 demo').toString('base64') })).status, 201);
    assert.equal((await call(`/api/cases/${caseId}/pdf`)).status, 409);
    await send({ action: 'confirm_review' });
    await send({ message: '¿Cómo puedo organizar mi semana?', consent: true });
    assert.equal(chat.case.data.reviewConfirmed, true);
    await send({ action: 'edit', stepId: 'amount' }); await send({ message: '700' });
    assert.equal(chat.case.data.reviewConfirmed, false); assert.equal((await call(`/api/cases/${caseId}/pdf`)).status, 409);
    const restored = (await call(`/api/conversations/${conversationId}`)).body;
    assert.equal(restored.turns.length, chat.turns.length); assert.equal(restored.case.data.requestedAmount, 700);
    const user = server.appStore.createUser('otro@example.test', 'otra-contraseña-segura');
    assert.equal(server.appStore.getConversation(user.id, conversationId), null);
    const stored = server.appStore.db.prepare('SELECT encrypted_json FROM conversation_turns WHERE conversation_id=?').all(conversationId);
    assert.ok(stored.every(row => !row.encrypted_json.includes('Ana Ejemplo')));
  } finally { await new Promise(resolve => server.close(resolve)); server.appStore.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
