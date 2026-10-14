const error = (message, status = 502) => Object.assign(new Error(message), { status });
export const AUDIO_LIMIT = 5_000_000;
const formats = new Map([['audio/webm', 'webm'], ['video/webm', 'webm'], ['audio/mp4', 'm4a'], ['video/mp4', 'mp4'], ['audio/ogg', 'ogg'], ['audio/wav', 'wav'], ['audio/mpeg', 'mp3']]);

export function audioFormat(contentType = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (!formats.has(mime)) throw error('Formato de audio no admitido. Usa WebM, MP4, Ogg, WAV o MP3.', 415);
  return { mime, extension: formats.get(mime) };
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
      const messages = { 401: 'Fish Audio rechazó la clave API.', 403: 'Fish Audio no permite usar esta voz o modelo.', 402: 'Fish Audio requiere saldo o un plan compatible.', 429: 'Fish Audio alcanzó su límite. Intenta de nuevo en un momento.', 400: 'Fish Audio rechazó el audio o la configuración de voz.', 404: 'Fish Audio no encontró la voz o el modelo configurado.' };
      throw error(messages[response.status] || 'Fish Audio no pudo procesar la voz. Intenta nuevamente.');
    }
    return response;
  } catch (cause) {
    if (cause.status) throw cause;
    if (options.signal?.aborted) throw error('La solicitud de voz terminó o superó el tiempo de espera.', 408);
    throw error('No se pudo conectar con Fish Audio. Comprueba tu conexión.');
  }
}
export async function transcribeAudio(bytes, contentType, config, signal, fetchImpl = fetch) {
  requireConfig(config);
  const { mime, extension } = audioFormat(contentType);
  if (!bytes.length || bytes.length > AUDIO_LIMIT) throw error('El audio debe ocupar entre 1 byte y 5 MB.', 413);
  const form = new FormData();
  form.append('audio', new Blob([bytes], { type: mime }), `mensaje.${extension}`);
  form.append('language', 'es'); form.append('ignore_timestamps', 'true'); form.append('tag_audio_events', 'false'); form.append('diarize', 'false');
  const response = await fishRequest('asr', { method: 'POST', headers: { Authorization: `Bearer ${config.fishApiKey}`, model: 'transcribe-1-pro' }, body: form, signal }, fetchImpl);
  let result;
  try { result = await response.json(); } catch { throw error('Fish Audio devolvió una transcripción inválida.'); }
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
