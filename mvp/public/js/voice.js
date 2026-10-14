// Audio is kept in memory. A session number invalidates late network/device results.
export class VoiceSession {
  constructor({ onState, onTranscript, send, getConversation, getConsent, fetchImpl = (...args) => globalThis.fetch(...args), mediaDevices = navigator.mediaDevices, Recorder = globalThis.MediaRecorder, Context = globalThis.AudioContext || globalThis.webkitAudioContext, AudioPlayer = globalThis.Audio }) {
    Object.assign(this, { onState, onTranscript, send, getConversation, getConsent, fetchImpl, mediaDevices, Recorder, Context, AudioPlayer });
    this.generation = 0; this.captureEpoch = 0; this.active = false; this.muted = false; this.phase = 'idle';
  }
  state(phase, detail = '') { this.phase = phase; this.detail = detail; this.onState({ phase, detail, active: this.active, muted: this.muted, mode: this.mode }); }
  async start(mode) {
    this.stop(); this.mode = mode; this.active = true; this.muted = false;
    const generation = this.generation;
    try {
      if (!this.getConsent()) throw new Error('Activa el permiso de Groq en el chat antes de usar la voz.');
      if (!this.mediaDevices?.getUserMedia || !this.Recorder || !this.Context) throw new Error('Tu navegador no admite grabación aquí. Usa Chrome, Edge o Safari actualizado y abre localhost o HTTPS.');
      this.state('connecting', 'Comprobando la configuración…');
      this.request = new AbortController();
      const response = await this.fetchImpl('/api/status', { signal: this.request.signal });
      if (!response.ok) throw new Error('No se pudo comprobar la configuración de voz.');
      const status = await response.json();
      if (!status.voice?.transcriptionConfigured || mode === 'conversation' && !status.voice?.configured) throw new Error('Falta configurar Fish Audio en mvp/.env: FISH_AUDIO_API_KEY y FISH_AUDIO_VOICE_ID.');
      if (!this.alive(generation)) return;
      await this.listen(generation);
    } catch (error) { this.failure(error, generation); }
  }
  alive(generation) { return this.active && generation === this.generation; }
  async listen(generation) {
    if (!this.alive(generation) || this.muted) return;
    const capture = ++this.captureEpoch;
    this.state('connecting', 'Permite el acceso al micrófono…');
    let stream;
    try { stream = await this.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
    catch (error) { if (!this.alive(generation) || capture !== this.captureEpoch) return; throw error; }
    if (!this.alive(generation) || this.muted || capture !== this.captureEpoch) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    this.context = new this.Context();
    await this.context.resume();
    if (!this.alive(generation) || this.muted || capture !== this.captureEpoch) return;
    const source = this.context.createMediaStreamSource(stream), analyser = this.context.createAnalyser();
    analyser.fftSize = 1024; source.connect(analyser);
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(type => this.Recorder.isTypeSupported(type));
    const recorder = new this.Recorder(stream, mime ? { mimeType: mime } : {});
    const chunks = []; this.recorder = recorder;
    const start = performance.now(); let lastSpeech = start, speechMs = 0, threshold = .015, noiseSum = 0, samples = 0;
    this.detectedSpeech = false;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { if (capture === this.captureEpoch) this.failure(new Error('El navegador no pudo grabar audio. Revisa el micrófono.'), generation); };
    recorder.onstop = () => {
      if (capture !== this.captureEpoch) return;
      const submit = this.submitRecording; this.submitRecording = false;
      const hasSpeech = this.detectedSpeech;
      this.releaseCapture();
      if (!this.alive(generation) || this.muted) return;
      if (submit && hasSpeech) this.process(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' }), generation).catch(error => this.failure(error, generation));
      else this.listen(generation).catch(error => this.failure(error, generation));
    };
    recorder.start(250); this.state('listening', this.mode === 'dictate' ? 'Dicta tu mensaje. Pulsa «Usar dictado» al terminar.' : 'Te escucho. Haz una pausa para enviar tu mensaje.');
    const data = new Float32Array(analyser.fftSize);
    this.monitor = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length), now = performance.now();
      if (now - start < 500) { noiseSum += rms; samples++; threshold = Math.min(.04, Math.max(.012, noiseSum / samples * 2.5)); }
      if (rms > threshold) { lastSpeech = now; speechMs += 80; if (speechMs >= 160) this.detectedSpeech = true; }
      if (now - start > 45000 || this.mode === 'conversation' && this.detectedSpeech && now - lastSpeech > 1300) this.finishRecording(true);
      // Recycle silent buffers without sending them to an external service.
      else if (!this.detectedSpeech && now - start > 15000) this.finishRecording(false);
    }, 80);
  }
  finishRecording(submit = true) {
    if (this.recorder?.state !== 'recording') return;
    this.submitRecording = submit;
    if (submit && this.mode === 'dictate') this.detectedSpeech = true;
    clearInterval(this.monitor); this.monitor = null;
    this.recorder.stop();
  }
  releaseCapture() {
    this.captureEpoch++;
    clearInterval(this.monitor); this.monitor = null;
    if (this.recorder) { this.recorder.onstop = null; this.recorder.ondataavailable = null; this.recorder.onerror = null; if (this.recorder.state === 'recording') this.recorder.stop(); this.recorder = null; }
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.context?.close().catch(() => {}); this.context = null;
  }
  async call(route, options, generation) {
    if (!this.alive(generation)) throw new DOMException('Cancelado', 'AbortError');
    this.request = new AbortController();
    const response = await this.fetchImpl(route, { credentials: 'same-origin', ...options, headers: { 'X-Voice-Consent': 'true', ...options.headers }, signal: this.request.signal });
    if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'No se pudo procesar la voz.'); }
    return response;
  }
  async process(blob, generation) {
    this.state('transcribing', 'Convirtiendo tu voz en texto…');
    const response = await this.call('/api/voice/transcribe', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } }, generation);
    const { text } = await response.json();
    if (!this.alive(generation)) return;
    if (!text?.trim()) { this.state('listening', 'No reconocí palabras. Inténtalo de nuevo.'); if (!this.muted) await this.listen(generation); return; }
    this.onTranscript(text, this.mode);
    if (this.mode === 'dictate') { this.stop(); return; }
    this.state('thinking', 'Preparando tu respuesta…');
    const conversation = await this.send(text);
    if (!this.alive(generation)) return;
    if (!conversation) throw new Error('No se pudo enviar el mensaje. Revisa el chat y vuelve a iniciar la voz.');
    const turn = conversation.turns.at(-1);
    if (!turn?.answer || this.getConversation()?.id !== conversation.id) { this.stop(); return; }
    this.state('loading', 'Preparando la voz de tu asistente…');
    const audio = await this.call('/api/voice/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: conversation.id, turnId: turn.id }) }, generation);
    const bytes = await audio.blob();
    if (!this.alive(generation)) return;
    this.audioUrl = URL.createObjectURL(bytes); this.player = new this.AudioPlayer(this.audioUrl);
    this.player.onended = () => this.afterSpeech(generation);
    this.player.onerror = () => this.failure(new Error('No se pudo reproducir la respuesta. Está disponible en el chat.'), generation);
    await this.play(generation);
  }
  async play(generation = this.generation) {
    if (!this.alive(generation) || !this.player) return;
    try { await this.player.play(); if (this.alive(generation)) this.state('speaking', 'Tu asistente está hablando…'); }
    catch { if (this.alive(generation)) this.state('playback', 'Pulsa «Escuchar respuesta» para permitir el audio.'); }
  }
  releaseAudio() {
    if (this.player) { this.player.onended = null; this.player.onerror = null; this.player.pause(); this.player.removeAttribute('src'); this.player.load(); this.player = null; }
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl); this.audioUrl = null;
  }
  afterSpeech(generation) {
    this.releaseAudio();
    if (!this.alive(generation)) return;
    if (this.muted) this.state('muted', 'Micrófono apagado. Actívalo para seguir hablando.');
    else this.listen(generation).catch(error => this.failure(error, generation));
  }
  interrupt() { if (['speaking', 'playback'].includes(this.phase)) this.afterSpeech(this.generation); }
  toggleMute() {
    const generation = this.generation;
    this.muted = !this.muted;
    if (this.muted) { this.releaseCapture(); if (['listening', 'connecting'].includes(this.phase)) this.state('muted', 'Micrófono apagado.'); else this.state(this.phase, this.detail); }
    else if (this.phase === 'muted') this.listen(generation).catch(error => this.failure(error, generation));
    else this.state(this.phase, this.detail);
  }
  stop() {
    this.generation++; this.active = false; this.request?.abort(); this.request = null;
    this.releaseCapture(); this.releaseAudio(); this.state('idle');
  }
  failure(error, generation) {
    if (!this.alive(generation)) return;
    const permission = ['NotAllowedError', 'SecurityError'].includes(error.name);
    this.stop(); this.state('error', permission ? 'No se permitió el micrófono. Habilítalo en los permisos del navegador y vuelve a intentar.' : error.name === 'NotFoundError' ? 'No encontré un micrófono conectado.' : error.message);
  }
}

export function attachVoice({ send, getConversation, getConsent, onDictation }) {
  const $ = id => document.getElementById(id), dialog = $('voice-dialog');
  let mode = 'conversation';
  const session = new VoiceSession({ send, getConversation, getConsent,
    onTranscript(text, type) { $('voice-transcript').textContent = text; if (type === 'dictate') { onDictation(text); dialog.close(); } },
    onState({ phase, detail, active, muted, mode: currentMode }) {
      dialog.dataset.phase = phase;
      $('voice-status').textContent = detail || (phase === 'idle' ? 'Listo para hablar' : '');
      $('voice-start').hidden = active;
      $('voice-mute').hidden = !active; $('voice-mute').textContent = muted ? 'Activar micrófono' : 'Apagar micrófono'; $('voice-mute').setAttribute('aria-pressed', String(muted));
      $('voice-finish-dictation').hidden = !(active && currentMode === 'dictate' && phase === 'listening');
      $('voice-interrupt').hidden = !['speaking', 'playback'].includes(phase);
      $('voice-interrupt').textContent = phase === 'playback' ? 'Escuchar respuesta' : 'Interrumpir respuesta';
    }
  });
  function open(type) {
    if (!getConversation()) return;
    session.stop(); mode = type; $('voice-transcript').textContent = '';
    $('voice-title').textContent = type === 'dictate' ? 'Dicta tu mensaje' : 'Conversemos por voz';
    $('voice-description').textContent = type === 'dictate' ? 'Tu audio se envía a Fish Audio para transcribirlo. Revisa el texto en el chat antes de enviarlo.' : 'Tu audio se transcribe con Fish Audio; Groq responde en este mismo chat y Fish Audio pone la voz. Haz una pausa para enviar cada mensaje.';
    $('voice-start').textContent = type === 'dictate' ? 'Iniciar dictado' : 'Iniciar conversación';
    dialog.showModal();
  }
  $('voice-button').addEventListener('click', () => open('conversation'));
  $('dictate-button').addEventListener('click', () => open('dictate'));
  $('voice-start').addEventListener('click', () => session.start(mode));
  $('voice-mute').addEventListener('click', () => session.toggleMute());
  $('voice-finish-dictation').addEventListener('click', () => session.finishRecording());
  $('voice-interrupt').addEventListener('click', () => session.phase === 'playback' ? session.play() : session.interrupt());
  const end = () => { session.stop(); if (dialog.open) dialog.close(); };
  $('voice-end').addEventListener('click', end); $('voice-close').addEventListener('click', end);
  dialog.addEventListener('cancel', end); dialog.addEventListener('close', () => { if (session.active) session.stop(); });
  window.addEventListener('pagehide', end);
  document.addEventListener('visibilitychange', () => { if (document.hidden) end(); });
  return { stop: end };
}
