import test from 'node:test';
import assert from 'node:assert/strict';
import { RiveAvatar, avatarMode } from '../public/js/rive-avatar.js';
import { VoiceSession } from '../public/js/voice.js';

test('el personaje cambia de estado y su boca sigue el audio real del reproductor', async () => {
  let options, cleaned = 0, resized = 0, nextFrame, cancelled = 0;
  const values = { mode: { value: 0 }, mouth: { value: .15 } };
  const canvas = { dataset: {} };
  const runtime = {
    Rive: class { constructor(params) { options = params; this.viewModelInstance = { number: name => values[name] }; } resizeDrawingSurfaceToCanvas() { resized++; } cleanup() { cleaned++; } },
    Layout: class {}, Fit: { Contain: 'contain' }, Alignment: { Center: 'center' }
  };
  const avatar = new RiveAvatar(canvas, { load: async () => runtime, frame: callback => { nextFrame = callback; return 1; }, cancel: () => { cancelled++; } });
  avatar.setPhase('listening'); await avatar.open(); options.onLoad();
  assert.equal(options.stateMachine, 'Assistant'); assert.equal(options.autoBind, true);
  assert.equal(values.mode.value, 1); assert.equal(resized, 1);
  avatar.setPhase('thinking'); assert.equal(values.mode.value, 2);
  avatar.setPhase('speaking'); let volume = .2;
  avatar.connect({ fftSize: 32, getFloatTimeDomainData: buffer => buffer.fill(volume) }, 'output');
  const openMouth = values.mouth.value; assert.ok(openMouth > .15);
  volume = 0; nextFrame(); assert.ok(values.mouth.value < openMouth);
  avatar.disconnect('input'); assert.ok(avatar.analyser);
  avatar.setPhase('muted'); assert.equal(values.mode.value, 5); assert.equal(values.mouth.value, .15);
  avatar.close(); assert.equal(cleaned, 1); assert.ok(cancelled); assert.equal(avatar.analyser, null);
  assert.equal(avatarMode('transcribing'), 2); assert.equal(avatarMode('loading'), 2); assert.equal(avatarMode('celebrating'), 4); assert.equal(avatarMode('error'), 6);
});

test('cerrar antes de cargar Rive evita crear una animación tardía', async () => {
  let resolveRuntime, constructed = 0;
  const avatar = new RiveAvatar({ dataset: {} }, { load: () => new Promise(resolve => { resolveRuntime = resolve; }) });
  const pending = avatar.open(); avatar.close(); resolveRuntime({ Rive: class { constructor() { constructed++; } } }); await pending;
  assert.equal(constructed, 0);
});

test('la prueba del personaje reproduce una respuesta sin grabar ni enviar un mensaje nuevo', async () => {
  const phases = [], routes = []; let plays = 0;
  class Player { play() { plays++; return Promise.resolve(); } pause() {} removeAttribute() {} load() {} }
  const session = new VoiceSession({ onState: value => phases.push(value.phase), onTranscript() { assert.fail('No debe transcribir'); }, send() { assert.fail('No debe enviar un mensaje'); },
    getConversation: () => ({ id: 'conversation', turns: [{ id: 'turn', answer: 'Hola de prueba' }] }), mediaDevices: { getUserMedia() { assert.fail('La prueba no abre el micrófono'); } }, Recorder: class {}, Context: class {}, AudioPlayer: Player,
    fetchImpl: async (route, options) => { routes.push(route); assert.deepEqual(JSON.parse(options.body), { conversationId: 'conversation', turnId: 'turn' }); return new Response('audio'); } });
  session.waitPreview = async () => {};
  await session.preview(); assert.deepEqual(routes, ['/api/voice/speech']); assert.equal(plays, 1);
  session.player.onended(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(phases.includes('listening')); assert.ok(phases.includes('thinking')); assert.ok(phases.includes('speaking')); assert.ok(phases.includes('celebrating')); assert.equal(session.active, false);
});

test('terminar la prueba durante la espera impide reproducir audio después', async () => {
  let calls = 0;
  const session = new VoiceSession({ onState() {}, onTranscript() {}, send() {}, getConversation: () => ({ turns: [{ answer: 'Hola' }] }), mediaDevices: {}, Context: class {}, Recorder: class {}, fetchImpl: async () => { calls++; } });
  const pending = session.preview(); session.stop(); await pending;
  assert.equal(calls, 0); assert.equal(session.active, false);
});
