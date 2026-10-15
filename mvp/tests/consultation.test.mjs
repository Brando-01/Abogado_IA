import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store } from '../src/storage.mjs';
import { handleConversationMessage } from '../src/chat/conversation.mjs';
import { resolveConsultContext } from '../src/services/legal-query.mjs';
import { askLibrary, retrieveContext } from '../src/services/rag.mjs';
import { answerQuestionWithGroq, isLegalQuestion } from '../src/services/groq-chat.mjs';
import { officialSourceUrl } from '../public/js/chat-render.js';

const config = { groqApiKey: 'ficticia', groqModel: 'openai/gpt-oss-120b' };
const noFetch = () => assert.fail('Esta orientación verificada no requiere llamadas al modelo');
const empty = { search: () => [] };

test('regresión: robo de celular → calle → con voilenacia conserva contexto, sin 911 ni preguntas repetidas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abogadoia-consult-'));
  const options = { dbPath: path.join(dir, 'test.sqlite'), privateDir: dir, secret: crypto.randomBytes(32) };
  let store = new Store(options);
  try {
    const user = store.createUser('consulta@example.test', 'contraseña-ficticia-prueba');
    const chat = store.createConversation(user.id);
    const send = async message => (await handleConversationMessage(store, user.id, chat.id, { message }, config, noFetch)).turns.at(-1);
    const first = await send('mira me acaban de robar mi celular que hago?');
    assert.equal(first.grounding, 'official_guidance'); assert.match(first.answer, /105.*PNP/);
    assert.match(first.answer, /bloquear el equipo y suspender la línea/);
    assert.equal(first.practicalQuestion, 'safety');
    const second = await send('me robaron en la calle');
    assert.equal(second.practicalQuestion, 'violence'); assert.match(second.answer, /en la calle/);
    // A server restart must preserve the declared facts and the questions asked.
    store.close(); store = new Store(options);
    const third = await send('con voilenacia');
    assert.equal(third.grounding, 'official_guidance'); assert.equal(third.practicalQuestion, 'injury');
    assert.match(third.answer, /celular en la calle y hubo violencia/);
    assert.doesNotMatch(third.answer, /¿Te quitaron|No encontré respaldo|911|albergue|alimentos/);
    assert.equal(store.listCases(user.id).length, 0);
    const answered = await send('no me lastimaron, ya estoy a salvo');
    assert.equal(answered.practicalQuestion, 'protection'); assert.match(answered.answer, /ya estás a salvo/);
    const other = store.createConversation(user.id);
    const isolated = await handleConversationMessage(store, user.id, other.id, { message: 'con voilenacia' }, config, noFetch);
    assert.equal(isolated.turns.at(-1).grounding, 'insufficient');
    const anotherUser = store.createUser('otro-consulta@example.test', 'otra-contraseña-ficticia');
    await assert.rejects(handleConversationMessage(store, anotherUser.id, chat.id, { message: 'con violencia' }, config, noFetch), /no encontrada/);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('el contexto se recupera en chats antiguos y no inventa violencia al negar amenazas', () => {
  const legacy = [{ question: 'Me robaron mi celular', answer: 'Una respuesta antigua incorrecta 911', grounding: 'insufficient' }, { question: 'me robaron en la calle', grounding: 'insufficient' }];
  assert.equal(isLegalQuestion('con voilenacia', legacy), true);
  const context = resolveConsultContext('sin violencia ni amenazas', legacy);
  assert.equal(context.violence, false); assert.equal(context.phone, true); assert.equal(context.street, true);
  const unknown = resolveConsultContext('me robaron en la calle', [{ question: 'Me robaron mi celular' }]);
  assert.equal(unknown.violence, null); assert.equal(unknown.safe, null);
});

test('el cambio de tema libera el chat general y no arrastra el robo a alimentos', async () => {
  const history = [{ question: 'Me robaron mi celular', grounding: 'official_guidance' }, { question: 'con violencia', grounding: 'official_guidance' }];
  for (const question of ['Cambiemos de tema, dame ideas para organizar mi semana', 'Y cómo organizo mi semana', '¿Por qué el cielo es azul?', 'Hola, ¿cómo estás?']) {
    let payload;
    const result = await askLibrary(empty, question, history, config, async (_url, options) => {
      payload = JSON.parse(JSON.parse(options.body).messages[1].content);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ domain: 'general', sufficient: true, answer: 'Ordenemos tus prioridades de la semana.', claims: [] }) } }] });
    });
    assert.equal(result.grounding, 'general'); assert.equal(payload.legalExpected, false); assert.equal(payload.consultation.topic, null);
  }
  const support = resolveConsultContext('Y qué hago si no me paga la pensión', history);
  assert.equal(support.topic, 'support'); assert.doesNotMatch(support.retrievalQuestion, /robaron/);
  assert.equal(resolveConsultContext('con violencia', [...history, { question: 'Dame una receta' }]).topic, null);
});

test('los artículos y penas siguen requiriendo evidencia local y recuperan el tema del robo', async () => {
  const history = [{ question: 'Me robaron el celular', grounding: 'official_guidance' }, { question: 'con violencia', grounding: 'official_guidance' }];
  let query, options;
  retrieveContext({ search(value, _limit, _category, opts) { query = value; options = opts; return []; } }, '¿Y qué artículo y pena corresponden?', history);
  assert.match(query, /robo hurto/); assert.deepEqual(options.requiredAny, ['robo', 'hurto']);
  const result = await askLibrary(empty, '¿Y qué artículo y pena corresponden?', history, config, noFetch);
  assert.equal(result.grounding, 'insufficient'); assert.equal(result.references.length, 0);
  assert.doesNotMatch(result.answer, /¿te lo quitaron|artículo \d|años de prisión/i);
});

test('un país explícito se respeta también en los seguimientos y puede corregirse', async () => {
  const history = [];
  for (const question of ['Me robaron el celular en Chile', 'con violencia']) {
    const result = await askLibrary(empty, question, history, config, noFetch);
    assert.equal(result.grounding, 'location_needed'); assert.doesNotMatch(result.answer, /105|911|comisaría/);
    history.push({ question, ...result });
  }
  const corrected = await askLibrary(empty, 'estoy en Perú', history, config, noFetch);
  assert.equal(corrected.grounding, 'official_guidance'); assert.match(corrected.answer, /105/);
});

test('un seguimiento jurídico no puede salir como general aunque el modelo intente clasificarlo así', async () => {
  const result = await answerQuestionWithGroq('¿Y qué pena corresponde?', [{ source_id: 'prueba', page: 1, content: 'Texto de prueba sin sanciones ni números de emergencia.' }], [{ question: 'Me robaron el celular' }], config, async () => {
    return Response.json({ choices: [{ message: { content: JSON.stringify({ domain: 'general', sufficient: true, answer: 'Respuesta sin respaldo: llama al 911, la pena es de 99 años.', claims: [] }) } }] });
  });
  assert.equal(result.grounding, 'insufficient'); assert.doesNotMatch(result.answer, /911|99 años/);
});

test('los enlaces oficiales no admiten esquemas ni servidores inyectados', () => {
  for (const url of ['javascript:alert(1)', 'https://www.gob.pe.evil.test/x', 'https://evil.test', 'http://www.gob.pe/x', 'https://user:password@www.gob.pe/x', 'https://www.gob.pe:444/x']) assert.equal(officialSourceUrl({ kind: 'official_web', url }), null);
  assert.equal(officialSourceUrl({ kind: 'official_web', url: 'https://www.gob.pe/547-telefonos-de-emergencia' }), 'https://www.gob.pe/547-telefonos-de-emergencia');
  assert.equal(officialSourceUrl({ kind: 'pdf', url: 'https://www.gob.pe/' }), null);
});
