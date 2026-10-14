const error = (message, status = 502) => Object.assign(new Error(message), { status });
export const AUDIO_LIMIT = 5_000_000;
const formats = new Map([['audio/webm', 'webm'], ['video/webm', 'webm'], ['audio/mp4', 'm4a'], ['video/mp4', 'mp4'], ['audio/ogg', 'ogg'], ['audio/wav', 'wav'], ['audio/mpeg', 'mp3']]);

export function audioFormat(contentType = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (!formats.has(mime)) throw error('Formato de audio no admitido. Usa WebM, MP4, Ogg, WAV o MP3.', 415);
  return { mime, extension: formats.get(mime) };
}
export function voiceStatus(config) {
  const transcriptionProvider = config.sttProvider || 'groq';
  const transcriptionConfigured = transcriptionProvider === 'groq' ? Boolean(config.groqApiKey) : transcriptionProvider === 'fish' && Boolean(config.fishApiKey);
  return { transcriptionProvider, transcriptionModel: transcriptionProvider === 'groq' ? config.sttModel || 'whisper-large-v3-turbo' : 'transcribe-1-pro', transcriptionConfigured, configured: Boolean(transcriptionConfigured && config.fishApiKey && config.fishVoiceId), model: config.fishModel };
}
function requireConfig(config, speech = false) {
  if (!config.fishApiKey) throw error('Configura FISH_AUDIO_API_KEY en mvp/.env para activar la voz.', 503);
  if (speech && !config.fishVoiceId) throw error('Configura FISH_AUDIO_VOICE_ID en mvp/.env para escuchar respuestas.', 503);
}
async function fishRequest(endpoint, options, fetchImpl) {
  try {
    const response = await fetchImpl(`https://api.fish.audio/v1/${endpoint}`, options);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const messages = { 401: 'Fish Audio rechazó la clave API.', 403: 'Fish Audio no permite usar esta voz o modelo.', 402: 'Fish Audio no tiene saldo de API disponible (402). El crédito de API es independiente del saldo de la plataforma. Revisa tu saldo en fish.audio/app/developers.', 429: 'Fish Audio alcanzó su límite. Intenta de nuevo en un momento.', 400: 'Fish Audio rechazó el audio o la configuración de voz.', 404: 'Fish Audio no encontró la voz o el modelo configurado.' };
      // Upstream authentication errors must not look like an expired local session.
      throw error(messages[response.status] || 'Fish Audio no pudo procesar la voz. Intenta nuevamente.', [402, 429].includes(response.status) ? response.status : 502);
    }
    return response;
  } catch (cause) {
    if (cause.status) throw cause;
    if (options.signal?.aborted) throw error('La solicitud de voz terminó o superó el tiempo de espera.', 408);
    throw error('No se pudo conectar con Fish Audio. Comprueba tu conexión.');
  }
}
export async function transcribeAudio(bytes, contentType, config, signal, fetchImpl = fetch) {
  const { mime, extension } = audioFormat(contentType);
  if (!bytes.length || bytes.length > AUDIO_LIMIT) throw error('El audio debe ocupar entre 1 byte y 5 MB.', 413);
  const provider = config.sttProvider || 'groq';
  if (!['groq', 'fish'].includes(provider)) throw error('VOICE_STT_PROVIDER debe ser groq o fish en mvp/.env.', 503);
  if (provider === 'fish') requireConfig(config);
  else if (!config.groqApiKey) throw error('Configura GROQ_API_KEY para transcribir el micrófono con Groq.', 503);
  const form = new FormData();
  form.append(provider === 'groq' ? 'file' : 'audio', new Blob([bytes], { type: mime }), `mensaje.${extension}`);
  form.append('language', 'es');
  let response;
  if (provider === 'fish') {
    form.append('ignore_timestamps', 'true'); form.append('tag_audio_events', 'false'); form.append('diarize', 'false');
    response = await fishRequest('asr', { method: 'POST', headers: { Authorization: `Bearer ${config.fishApiKey}`, model: 'transcribe-1-pro' }, body: form, signal }, fetchImpl);
  } else {
    form.append('model', config.sttModel || 'whisper-large-v3-turbo'); form.append('temperature', '0'); form.append('response_format', 'json');
    try {
      response = await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${config.groqApiKey}` }, body: form, signal });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const messages = { 401: 'Groq rechazó la clave de transcripción.', 403: 'Groq no permite usar el modelo de transcripción.', 402: 'Groq no tiene crédito disponible para transcribir.', 429: 'Groq alcanzó su límite de transcripción. Intenta nuevamente en un momento.', 400: 'Groq rechazó el audio o GROQ_STT_MODEL. Revisa la grabación y el modelo.' };
        throw error(messages[response.status] || 'Groq no pudo transcribir el audio.', [402, 429].includes(response.status) ? response.status : 502);
      }
    } catch (cause) {
      if (cause.status) throw cause;
      throw error(signal?.aborted ? 'La transcripción terminó o superó el tiempo de espera.' : 'No se pudo conectar con Groq para transcribir.', signal?.aborted ? 408 : 502);
    }
  }
  let result;
  try { result = await response.json(); } catch { throw error('El proveedor devolvió una transcripción inválida.'); }
  const text = typeof result.text === 'string' ? result.text.replace(/<\|[^>]*\|>/g, '').trim() : '';
  if (text.length > 4000) throw error('El mensaje es demasiado largo. Graba una frase más corta.', 400);
  return { text };
}
export function spokenText(answer) {
  return String(answer || '').replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\[F\d+\]/g, '').replace(/[*#`]/g, '').trim();
}
export async function synthesizeAnswer(answer, config, signal, fetchImpl = fetch) {
  requireConfig(config, true);
  const text = spokenText(answer);
  if (!text || text.length > 12000) throw error('Esta respuesta no se puede reproducir por voz. Puedes leerla en el chat.', 400);
  return fishRequest('tts', { method: 'POST', headers: { Authorization: `Bearer ${config.fishApiKey}`, 'Content-Type': 'application/json', model: config.fishModel }, body: JSON.stringify({ text, reference_id: config.fishVoiceId, format: 'mp3', latency: 'balanced', chunk_length: 200 }), signal }, fetchImpl);
}
