import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getVoiceConfig } from '../src/config.mjs';
import { transcribeAudio, synthesizeAnswer, audioFormat, spokenText } from '../src/services/voice.mjs';
import { createServer } from '../server.mjs';
import { VoiceSession } from '../public/js/voice.js';

const config = { fishApiKey: 'secret-test-only', fishVoiceId: 'voice-test-only', fishModel: 's2.1-pro-free' };
test('la configuración de voz admite aliases, recarga .env y respeta variables del proceso', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-config-')), file = path.join(dir, '.env');
  try {
    fs.writeFileSync(file, 'FISH_API_KEY=primera\nFISH_REFERENCE_ID="voz-prueba"');
    assert.equal(getVoiceConfig(file, {}).fishVoiceId, 'voz-prueba');
    fs.writeFileSync(file, 'FISH_AUDIO_API_KEY=segunda\nFISH_AUDIO_MODEL=s2.1-pro');
    assert.equal(getVoiceConfig(file, {}).fishApiKey, 'segunda');
    assert.equal(getVoiceConfig(file, { FISH_AUDIO_API_KEY: 'proceso' }).fishApiKey, 'proceso');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('ASR envía WebM como multipart al modelo compatible y quita marcadores de hablante', async () => {
  const result = await transcribeAudio(Buffer.from('fake audio'), 'audio/webm;codecs=opus', config, undefined, async (url, options) => {
    assert.equal(url, 'https://api.fish.audio/v1/asr');
    assert.equal(options.headers.model, 'transcribe-1-pro');
    assert.equal(options.headers.Authorization, `Bearer ${config.fishApiKey}`);
    assert.equal(options.body.get('audio').name, 'mensaje.webm');
    assert.equal(options.body.get('tag_audio_events'), 'false');
    assert.equal(options.body.get('language'), 'es');
    return Response.json({ text: '<|speaker:0|>Hola, ¿cómo estás?' });
  });
  assert.equal(result.text, 'Hola, ¿cómo estás?');
  assert.throws(() => audioFormat('text/html'), /Formato/);
  await assert.rejects(transcribeAudio(Buffer.alloc(0), 'audio/webm', config), /entre/);
});
test('TTS lee la respuesta existente sin inventar texto y los errores no exponen la clave', async () => {
  await synthesizeAnswer('Hola **amigo** [F1].', config, undefined, async (url, options) => {
    assert.equal(url, 'https://api.fish.audio/v1/tts');
    const body = JSON.parse(options.body);
    assert.equal(body.reference_id, config.fishVoiceId); assert.equal(body.text, 'Hola amigo .');
    assert.equal(body.format, 'mp3'); return new Response('audio');
  });
  assert.equal(spokenText('[Fuente](https://example.test) https://example.test'), 'Fuente');
  await assert.rejects(synthesizeAnswer('Hola', config, undefined, async () => new Response(config.fishApiKey, { status: 402 })), /saldo/);
  await assert.rejects(transcribeAudio(Buffer.from('audio'), 'audio/webm', config, undefined, async () => { throw new Error(config.fishApiKey); }), error => !error.message.includes(config.fishApiKey));
});
test('voz requiere sesión, consentimiento y propiedad del turno; no guarda archivos de audio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-server-')); let calls = 0;
  const server = createServer({ ...config, privateDir: dir, dbPath: path.join(dir, 'db.sqlite'), secret: crypto.randomBytes(32), voiceFetch: async url => { calls++; return url.endsWith('/asr') ? Response.json({ text: 'Hola' }) : new Response(Buffer.from('ID3-audio-prueba'), { headers: { 'Content-Type': 'audio/mpeg' } }); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const user = server.appStore.createUser('voice@example.test', 'contraseña-voz-prueba');
    const other = server.appStore.createUser('other@example.test', 'contraseña-otra-prueba');
    const cookie = `abogadoia_session=${server.appStore.createSession(user.id)}`;
    const conversation = server.appStore.createConversation(user.id);
    const turn = server.appStore.addConversationTurn(user.id, conversation.id, { answer: 'Hola de prueba.' });
    const otherConversation = server.appStore.createConversation(other.id);
    const otherTurn = server.appStore.addConversationTurn(other.id, otherConversation.id, { answer: 'Respuesta privada.' });
    const call = (route, body, consent = true, auth = true, mime = 'application/json') => fetch(base + route, { method: 'POST', headers: { ...(auth ? { Cookie: cookie } : {}), ...(consent ? { 'X-Voice-Consent': 'true' } : {}), 'Content-Type': mime }, body });
    const speech = JSON.stringify({ conversationId: conversation.id, turnId: turn.id });
    assert.equal((await call('/api/voice/speech', speech, true, false)).status, 401);
    assert.equal((await call('/api/voice/speech', speech, false)).status, 400);
    assert.equal((await call('/api/voice/speech', JSON.stringify({ conversationId: otherConversation.id, turnId: otherTurn.id }))).status, 404);
    assert.equal((await call('/api/voice/speech', JSON.stringify({ text: 'Arbitrary text' }))).status, 404);
    assert.equal((await call('/api/voice/transcribe', 'audio', true, true, 'text/html')).status, 415);
    assert.equal(calls, 0);
    const asr = await call('/api/voice/transcribe', Buffer.from('webm fake'), true, true, 'audio/webm');
    assert.deepEqual(await asr.json(), { text: 'Hola' });
    const audio = await call('/api/voice/speech', speech);
    assert.equal(audio.headers.get('content-type'), 'audio/mpeg'); assert.equal(await audio.text(), 'ID3-audio-prueba');
    const status = await (await fetch(base + '/api/status')).text();
    assert.ok(!status.includes(config.fishApiKey)); assert.ok(!status.includes(config.fishVoiceId));
    assert.ok(fs.readdirSync(dir).every(file => !/\.(mp3|webm|wav)$/i.test(file)));
    assert.equal(server.appStore.getConversation(user.id, conversation.id).turns.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); server.appStore.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('terminar voz libera dispositivos, aborta solicitudes y descarta un permiso tardío', async () => {
  let resolvePermission, stopped = 0, lastState;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const voice = new VoiceSession({ onState: state => { lastState = state; }, onTranscript() { assert.fail('No debe transcribir'); }, send() { assert.fail('No debe enviar'); }, getConversation: () => null, getConsent: () => true,
    mediaDevices: { getUserMedia: () => new Promise(resolve => { resolvePermission = resolve; }) }, Recorder: class {}, Context: class {}, AudioPlayer: class {}, fetchImpl: async () => Response.json({ voice: { configured: true, transcriptionConfigured: true } }) });
  const pending = voice.start('conversation');
  while (!resolvePermission) await new Promise(resolve => setImmediate(resolve));
  voice.stop(); resolvePermission(stream); await pending;
  assert.equal(stopped, 1); assert.equal(lastState.phase, 'idle'); assert.equal(voice.active, false);
  const controller = new AbortController(); voice.request = controller; voice.active = true; voice.stream = stream;
  voice.stop(); assert.equal(controller.signal.aborted, true); assert.equal(stopped, 2);
});

test('voz transcribe, envía al mismo chat, lee ese turno y permite interrumpir estando silenciado', async () => {
  const conversation = { id: 'same-chat', turns: [{ id: 'reply', answer: 'Hola de prueba' }] };
  let sent, speechBody, played = 0, paused = 0, lastState;
  class Player {
    play() { played++; return Promise.resolve(); }
    pause() { paused++; }
    removeAttribute() {} load() {}
  }
  const session = new VoiceSession({ onState: value => { lastState = value; }, onTranscript: text => { assert.equal(text, 'Hola'); },
    getConversation: () => conversation, getConsent: () => true, send: async text => { sent = text; return conversation; }, mediaDevices: {}, Recorder: class {}, Context: class {}, AudioPlayer: Player,
    fetchImpl: async (route, options) => {
      assert.equal(options.headers['X-Voice-Consent'], 'true');
      if (route.endsWith('transcribe')) return Response.json({ text: 'Hola' });
      speechBody = JSON.parse(options.body); return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
    } });
  session.active = true; session.mode = 'conversation';
  await session.process(new Blob(['audio'], { type: 'audio/webm' }), session.generation);
  assert.equal(sent, 'Hola'); assert.deepEqual(speechBody, { conversationId: conversation.id, turnId: 'reply' });
  assert.equal(played, 1); assert.equal(lastState.phase, 'speaking'); assert.equal(session.stream, undefined);
  session.toggleMute(); session.interrupt();
  assert.equal(lastState.phase, 'muted'); assert.equal(paused, 1); assert.equal(session.audioUrl, null);
  session.stop(); assert.equal(lastState.active, false);
});

test('terminar durante la transcripción impide enviar el texto tardío al chat', async () => {
  let resolveFetch, sends = 0, transcriptions = 0;
  const session = new VoiceSession({ onState() {}, onTranscript() { transcriptions++; }, send() { sends++; }, getConversation: () => null, getConsent: () => true,
    mediaDevices: {}, Recorder: class {}, Context: class {}, AudioPlayer: class {}, fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; }) });
  session.active = true; session.mode = 'conversation';
  const pending = session.process(new Blob(['audio'], { type: 'audio/webm' }), session.generation);
  session.stop(); resolveFetch(Response.json({ text: 'Respuesta tardía' })); await pending;
  assert.equal(sends, 0); assert.equal(transcriptions, 0);
});

test('apagar y activar mientras se espera un permiso descarta la captura anterior', async () => {
  const resolvers = []; let stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const session = new VoiceSession({ onState() {}, onTranscript() {}, send() {}, getConversation: () => null, getConsent: () => true,
    mediaDevices: { getUserMedia: () => new Promise(resolve => resolvers.push(resolve)) }, Recorder: class {}, Context: class {}, AudioPlayer: class {} });
  session.active = true; const first = session.listen(session.generation);
  session.toggleMute(); session.toggleMute();
  assert.equal(resolvers.length, 2);
  resolvers[0](stream); await first; assert.equal(stopped, 1);
  session.stop(); resolvers[1](stream); await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, 2);
});
