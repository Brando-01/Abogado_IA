export function audioEnergy(samples) {
  if (!samples.length) return 0;
  return Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) * 4);
}

// Reads the actual Web Audio signal, including silence and pauses in the reply.
export class AudioVisualizer {
  constructor(canvas, orb, { frame = callback => requestAnimationFrame(callback), cancel = id => cancelAnimationFrame(id), reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
    Object.assign(this, { canvas, orb, frame, cancel, reducedMotion });
    this.context = canvas?.getContext('2d'); this.level = 0;
  }
  connect(analyser, kind) {
    this.stop();
    if (!analyser || !this.context) return;
    this.reduced = this.reducedMotion();
    this.analyser = analyser; this.kind = kind; this.samples = new Float32Array(analyser.fftSize);
    this.orb.dataset.audioReactive = 'true';
    this.draw();
  }
  disconnect(kind) { if (this.kind === kind) this.stop(); }
  draw() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.samples);
    this.level = this.level * .65 + audioEnergy(this.samples) * .35;
    this.orb.style.setProperty('--voice-energy', this.level.toFixed(3));
    const ctx = this.context, width = this.canvas.width, height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.save(); ctx.scale(width / 280, height / 230); ctx.translate(140, 110);
    for (let ring = 0; ring < 2; ring++) {
      ctx.beginPath();
      for (let i = 0; i <= 128; i++) {
        const angle = i / 128 * Math.PI * 2;
        const sample = this.samples[Math.floor(i % 128 / 128 * this.samples.length)];
        const radius = 88 + ring * 12 + (this.reduced ? 0 : this.level * 9 + sample * (ring ? 28 : 40));
        const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.strokeStyle = ring ? '#8abf9e77' : '#3c978dbb'; ctx.lineWidth = ring ? 1 : 1.6; ctx.stroke();
    }
    // Small bars make the changing volume readable even on a phone screen.
    for (let bar = 0; bar < 17; bar++) {
      const sample = Math.abs(this.samples[Math.floor(bar / 17 * this.samples.length)]);
      const amplitude = 2 + Math.min(14, sample * 34 + this.level * 8);
      ctx.beginPath(); ctx.moveTo((bar - 8) * 6, 103 - amplitude / 2); ctx.lineTo((bar - 8) * 6, 103 + amplitude / 2);
      ctx.strokeStyle = '#397e6b'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
    this.frameId = this.frame(() => this.draw());
  }
  stop() {
    if (this.frameId !== undefined) this.cancel(this.frameId);
    this.frameId = undefined; this.analyser = null; this.kind = null; this.level = 0;
    if (this.orb) { delete this.orb.dataset.audioReactive; this.orb.style.removeProperty('--voice-energy'); }
    this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
