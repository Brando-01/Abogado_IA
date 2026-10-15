import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store } from '../src/storage.mjs';
import { draftIntent } from '../src/chat/intent.mjs';
import { initialCase } from '../src/chat/workflow.mjs';
import { handleConversationMessage, conversationView } from '../src/chat/conversation.mjs';

test('preguntas que mencionan hacer una demanda conservan la intención de consulta', () => {
  for (const message of [
    'dime si me robaron mi celular como procedo en hacer mi demanda',
    'dime cómo hacer mi demanda de alimentos',
    '¿Cómo puedo preparar una demanda?',
    'Quiero saber cómo hacer una demanda por robo',
    'Me robaron el celular, necesito saber qué hacer',
    'Explícame cómo crear un documento'
  ]) assert.equal(draftIntent(message), 'consult', message);
  assert.equal(draftIntent('Quiero preparar una demanda de alimentos'), 'confirm_alimentos');
  assert.equal(draftIntent('Quiero preparar una demanda'), 'choose_document');
  assert.equal(draftIntent('Hazme una denuncia por robo'), 'other_document');
});

async function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abogadoia-intent-'));
  const store = new Store({ dbPath: path.join(dir, 'test.sqlite'), privateDir: dir, secret: crypto.randomBytes(32) });
  try { const user = store.createUser('intencion@example.test', 'contraseña-intencion-prueba'); await run(store, user); }
  finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
test('el mensaje exacto de robo va al RAG y no crea un caso de alimentos', async () => withStore(async (store, user) => {
  store.replaceSource({ fileName: 'prueba.pdf', sha256: 'a'.repeat(64), title: 'Prueba de consulta', category: 'other', pages: 1,
    chunks: [{ page: 1, content: 'Texto de prueba sobre robo, denuncia y celular.' }] });
  const conversation = store.createConversation(user.id);
  let calls = 0, question;
  const result = await handleConversationMessage(store, user.id, conversation.id,
    { message: 'dime si me robaron mi celular como procedo en hacer mi demanda', consent: true },
    { groqApiKey: 'ficticia', groqModel: 'modelo-prueba' }, async (_url, options) => {
      calls++; question = JSON.parse(JSON.parse(options.body).messages[1].content).question;
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ domain: 'legal', sufficient: false, answer: 'Falta una fuente penal pertinente.', claims: [] }) } }] }) };
    });
  assert.equal(calls, 1); assert.match(question, /robaron mi celular/);
  assert.equal(result.case, null); assert.equal(store.listCases(user.id).length, 0);
  assert.equal(result.state.awaitingProcedure, undefined);
  assert.ok(!result.turns.at(-1).answer.includes('demanda inicial de alimentos'));
}));

test('la consulta de pensión con errores recupera alimentos sin activar una demanda ni exigir casilla', async () => withStore(async (store, user) => {
  const quote = 'Texto ficticio de prueba sobre alimentos y pensión para un menor.';
  store.replaceSource({ fileName: 'alimentos.pdf', sha256: 'b'.repeat(64), title: 'Fuente de prueba de alimentos', category: 'core', pages: 1, chunks: [{ page: 1, content: quote }] });
  store.replaceSource({ fileName: 'pareja.pdf', sha256: 'c'.repeat(64), title: 'Texto ajeno al tema', category: 'other', pages: 1, chunks: [{ page: 1, content: 'Una pareja comparte otros problemas y habla del paso a paso.' }] });
  const conversation = store.createConversation(user.id);
  const result = await handleConversationMessage(store, user.id, conversation.id, { message: 'dame el paso a paso hacer si tengo problema sobre mi pareja que a abandonado a su hijo y no recibo una pesion' }, { groqApiKey: 'prueba', groqModel: 'modelo-prueba' }, async (_url, options) => {
    const payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(payload.legalExpected, true); assert.ok(payload.unverifiedLocalExcerpts.length);
    assert.ok(payload.unverifiedLocalExcerpts.every(source => source.title === 'Fuente de prueba de alimentos'));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ domain: 'legal', sufficient: true, answer: '', claims: [{ text: 'La fuente de prueba menciona alimentos.', ref: 'F1', quote }] }) } }] });
  });
  assert.equal(result.turns.at(-1).grounding, 'evidence_checked'); assert.equal(result.case, null);
}));

test('sin respaldo, una consulta de robo pregunta por lo ocurrido sin citar fuentes ajenas', async () => withStore(async (store, user) => {
  store.replaceSource({ fileName: 'alimentos.pdf', sha256: 'd'.repeat(64), title: 'Alimentos', category: 'core', pages: 1, chunks: [{ page: 1, content: 'Demanda de alimentos para menores: texto ficticio.' }] });
  const conversation = store.createConversation(user.id);
  const result = await handleConversationMessage(store, user.id, conversation.id, { message: 'si me roban mi celular como porceod ah acer uan demanda' }, { groqApiKey: 'prueba' }, () => assert.fail('No hay fuente pertinente que enviar al modelo'));
  const turn = result.turns.at(-1);
  assert.equal(turn.grounding, 'insufficient'); assert.match(turn.answer, /celular.*amenazas/s);
  assert.equal(turn.references.length, 0); assert.equal(result.case, null);
}));

test('una petición genérica pregunta el tipo y exige confirmación antes de crear el caso', async () => withStore(async (store, user) => {
  const conversation = store.createConversation(user.id);
  const send = body => handleConversationMessage(store, user.id, conversation.id, body, { groqApiKey: '' });
  await assert.rejects(send({ action: 'confirm_procedure' }), /Primero selecciona/);
  let result = await send({ message: 'Quiero preparar una demanda' });
  assert.equal(result.case, null); assert.equal(result.state.choosingDocumentType, true);
  result = await send({ message: 'De alimentos' });
  assert.equal(result.case, null); assert.equal(result.turns.at(-1).proposedProcedure, 'ALIMENTOS_NNA');
  result = await send({ message: 'No' }); assert.equal(result.case, null);
  await send({ action: 'start_draft' });
  result = await send({ message: 'Sí' });
  assert.equal(result.case.data.procedure, 'ALIMENTOS_NNA'); assert.equal(result.state.procedureConfirmed, true);
  assert.equal(result.progress.next.id, 'consent');
}));

test('un documento vacío iniciado por la versión anterior se pausa sin borrar datos ni repetir la reparación', async () => withStore(async (store, user) => {
  const item = store.createCase(user.id, initialCase());
  const conversation = store.createConversation(user.id, { caseId: item.id });
  let result = conversationView(store, user.id, conversation.id);
  assert.equal(result.state.paused, true); assert.equal(result.turns.length, 1);
  assert.ok(store.getCase(user.id, item.id));
  result = conversationView(store, user.id, conversation.id); assert.equal(result.turns.length, 1);
  const confirmation = await handleConversationMessage(store, user.id, conversation.id, { action: 'resume_draft' }, { groqApiKey: '' });
  assert.equal(confirmation.turns.at(-1).proposedProcedure, 'ALIMENTOS_NNA');
  assert.equal(confirmation.state.procedureConfirmed, undefined);
}));
