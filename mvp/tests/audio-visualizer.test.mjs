import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioVisualizer, audioEnergy } from '../public/js/audio-visualizer.js';
import { VoiceSession } from '../public/js/voice.js';

test('la visualización cambia con el volumen real y vuelve a cero al detenerse', () => {
  assert.equal(audioEnergy(new Float32Array(32)), 0);
  assert.ok(audioEnergy(Float32Array.from([.1, -.1, .2, -.2])) > 0);
  const properties = new Map(); let frame, cancelled = 0;
  const ctx = Object.fromEntries(['clearRect', 'save', 'scale', 'translate', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'restore'].map(name => [name, () => {}]));
  const canvas = { width: 560, height: 460, getContext: () => ctx };
  const orb = { dataset: {}, style: { setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name) } };
  let volume = 0;
  const analyser = { fftSize: 32, getFloatTimeDomainData(buffer) { buffer.fill(volume); } };
  const visualizer = new AudioVisualizer(canvas, orb, { frame: callback => { frame = callback; return 1; }, cancel: () => { cancelled++; }, reducedMotion: () => false });
  visualizer.connect(analyser, 'output'); assert.equal(Number(properties.get('--voice-energy')), 0);
  volume = .2; frame(); const loud = Number(properties.get('--voice-energy')); assert.ok(loud > 0);
  volume = 0; frame(); assert.ok(Number(properties.get('--voice-energy')) < loud);
  visualizer.disconnect('input'); assert.equal(orb.dataset.audioReactive, 'true');
  visualizer.disconnect('output'); assert.equal(orb.dataset.audioReactive, undefined); assert.equal(properties.size, 0); assert.ok(cancelled > 0);
});

test('el analizador recibe el mismo reproductor de la respuesta y se libera al terminar', async () => {
  let analysedPlayer, disconnected = 0, closed = 0, connectedTo, lastAnalyser;
  const analyser = { fftSize: 1024 };
  class Context {
    destination = {};
    resume() { return Promise.resolve(); }
    close() { closed++; return Promise.resolve(); }
    createMediaElementSource(player) { analysedPlayer = player; return { connect(target) { connectedTo = target; }, disconnect() { disconnected++; } }; }
    createAnalyser() { return analyser; }
  }
  const session = new VoiceSession({ onState() {}, onTranscript() {}, onAnalyser(value, kind) { if (kind === 'output') lastAnalyser = value; }, send() {}, getConversation() {}, mediaDevices: {}, Recorder: class {}, Context });
  const player = { pause() {}, removeAttribute() {}, load() {} };
  session.player = player; session.connectPlayback();
  assert.equal(analysedPlayer, player); assert.equal(lastAnalyser, analyser); assert.equal(connectedTo, analyser);
  session.stop(); assert.equal(lastAnalyser, null); assert.equal(disconnected, 1); assert.equal(closed, 1);
});
