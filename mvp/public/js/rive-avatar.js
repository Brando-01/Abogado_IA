import { audioEnergy } from './audio-visualizer.js';

export const AVATAR_MODES = Object.freeze({ idle: 0, listening: 1, thinking: 2, speaking: 3, celebrating: 4, muted: 5, error: 6 });
export function avatarMode(phase) {
  return AVATAR_MODES[phase] ?? (['connecting', 'transcribing', 'loading'].includes(phase) ? AVATAR_MODES.thinking : AVATAR_MODES.idle);
}
let runtimePromise;
export function loadRiveRuntime() {
  if (!runtimePromise) runtimePromise = new Promise((resolve, reject) => {
    const ready = () => {
      const runtime = globalThis.rive;
      if (!runtime?.Rive) { reject(new Error('Rive no está disponible.')); return; }
      runtime.RuntimeLoader.setWasmUrl('/vendor/rive/rive.wasm');
      runtime.RuntimeLoader.setWasmFallbackUrl('/vendor/rive/rive_fallback.wasm');
      resolve(runtime);
    };
    if (globalThis.rive?.Rive) { ready(); return; }
    const script = document.createElement('script'); script.src = '/vendor/rive/rive.js'; script.async = true;
    script.onload = ready; script.onerror = () => { script.remove(); reject(new Error('No se pudo cargar Rive.')); };
    document.head.append(script);
  }).catch(error => { runtimePromise = null; throw error; });
  return runtimePromise;
}

export class RiveAvatar {
  constructor(canvas, { load = loadRiveRuntime, onReady = () => {}, onError = () => {}, frame = callback => requestAnimationFrame(callback), cancel = id => cancelAnimationFrame(id) } = {}) {
    Object.assign(this, { canvas, load, onReady, onError, frame, cancel });
    this.phase = 'idle'; this.generation = 0; this.level = 0;
  }
  async open() {
    const generation = ++this.generation;
    try {
      const runtime = await this.load();
      if (generation !== this.generation) return;
      this.instance = new runtime.Rive({ src: '/assets/assistant.riv', canvas: this.canvas, artboard: 'AbogadoAssistant', stateMachine: 'Assistant', autoplay: true, autoBind: true,
        shouldDisableRiveListeners: true, automaticallyHandleEvents: false,
        layout: new runtime.Layout({ fit: runtime.Fit.Contain, alignment: runtime.Alignment.Center }),
        onLoad: () => {
          if (generation !== this.generation) return;
          this.mode = this.instance.viewModelInstance?.number('mode');
          this.mouth = this.instance.viewModelInstance?.number('mouth');
          if (!this.mode || !this.mouth) { this.onError(new Error('El personaje no tiene los controles esperados.')); this.close(); return; }
          this.resize(); this.setPhase(this.phase); this.onReady();
        }, onLoadError: () => { if (generation === this.generation) { this.close(); this.onError(new Error('No se pudo abrir el personaje de Rive.')); } }
      });
    } catch (error) { if (generation === this.generation) this.onError(error); }
  }
  resize() { this.instance?.resizeDrawingSurfaceToCanvas(Math.min(globalThis.devicePixelRatio || 1, 2)); }
  setPhase(phase) {
    this.phase = phase;
    if (this.mode) this.mode.value = avatarMode(phase);
    if (this.mouth && phase !== 'speaking') this.mouth.value = phase === 'celebrating' ? .7 : .15;
    if (this.canvas) this.canvas.dataset.avatarState = phase;
  }
  connect(analyser, kind) {
    this.disconnect(this.kind);
    if (!analyser) return;
    this.analyser = analyser; this.kind = kind; this.samples = new Float32Array(analyser.fftSize); this.tick();
  }
  tick() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.samples);
    this.level = this.level * .45 + audioEnergy(this.samples) * .55;
    // A single bound shape opens and closes to the response's real audio.
    if (this.mouth && this.kind === 'output' && this.phase === 'speaking') this.mouth.value = .12 + Math.min(1, this.level) * 1.25;
    if (this.canvas) this.canvas.dataset.audioLevel = this.level.toFixed(3);
    this.frameId = this.frame(() => this.tick());
  }
  disconnect(kind) {
    if (kind !== this.kind) return;
    if (this.frameId !== undefined) this.cancel(this.frameId);
    this.frameId = undefined; this.analyser = null; this.kind = null; this.level = 0;
    if (this.mouth) this.mouth.value = .15;
    if (this.canvas) this.canvas.dataset.audioLevel = '0';
  }
  close() {
    this.generation++; this.disconnect(this.kind); this.instance?.cleanup(); this.instance = null; this.mode = null; this.mouth = null;
  }
}
