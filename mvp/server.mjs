import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, getGroqConfig, getVoiceConfig, PROJECT_ROOT } from './src/config.mjs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AUDIO_LIMIT, audioFormat, transcribeAudio, synthesizeAnswer, voiceStatus } from './src/services/voice.mjs';
import { Store } from './src/storage.mjs';
import { normalizeCase, evaluateCase, createDraft } from './src/procedure.mjs';
import { getLegalCatalog } from './src/legal-catalog.mjs';
import { startIngestion, ingestionStatus } from './src/ingest.mjs';
import { suggestWithGroq } from './src/groq.mjs';
import { askLibrary } from './src/services/rag.mjs';
import { ensureConversations, conversationView, handleConversationMessage, welcome } from './src/chat/conversation.mjs';
import { makeDraftPdf, makeOfficialFormPreview } from './src/pdf.mjs';
import { listFormats, getFormat, assessFormat } from './src/formats.mjs';

const publicDir = path.join(PROJECT_ROOT, 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.riv': 'application/octet-stream', '.wasm': 'application/wasm' };
const loginAttempts = new Map();

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function fail(res, status, message) { json(res, status, { error: message }); }
function cookieToken(req) { return /(?:^|;\s*)abogadoia_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1] || ''; }
function sessionCookie(token, req) { return `abogadoia_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${req.socket.encrypted ? '; Secure' : ''}`; }
function clearCookie(req) { return `abogadoia_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${req.socket.encrypted ? '; Secure' : ''}`; }
async function bodyJson(req, limit = 256_000) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Solicitud demasiado grande.'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}
function validOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; }
  catch { return false; }
}
function checkedFile(value) {
  if (!value || typeof value !== 'object') throw Object.assign(new Error('Archivo inválido.'), { status: 400 });
  const name = String(value.name || '').replace(/[\\/\r\n]/g, '').trim().slice(0, 120);
  if (!name) throw Object.assign(new Error('Indica un nombre de archivo.'), { status: 400 });
  const bytes = Buffer.from(String(value.data || ''), 'base64');
  if (!bytes.length || bytes.length > 5_000_000) throw Object.assign(new Error('El archivo debe ocupar entre 1 byte y 5 MB.'), { status: 400 });
  let mime = '';
  if (bytes.subarray(0, 5).toString() === '%PDF-') mime = 'application/pdf';
  else if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = 'image/jpeg';
  if (!mime) throw Object.assign(new Error('Solo se aceptan PDF, PNG y JPEG.'), { status: 400 });
  return { name, mime, bytes };
}
function relevantSources(store, data) {
  return store.search(`alimentos menor pensión demanda necesidades ${data.expenseDescription || ''}`, 8, ['core', 'support', 'form']);
}

export function createServer(overrides = {}) {
  const config = { ...getConfig(), ...overrides };
  const store = new Store(config);
  const activeMessages = new Set();
  const activeVoice = new Set();
  const currentVoiceConfig = () => ({ ...getVoiceConfig(), ...Object.fromEntries(['fishApiKey', 'fishVoiceId', 'fishModel', 'groqApiKey', 'sttProvider', 'sttModel'].filter(key => Object.hasOwn(overrides, key)).map(key => [key, overrides[key]])) });
  const currentGroqConfig = () => ({
    ...getGroqConfig(),
    ...(Object.hasOwn(overrides, 'groqApiKey') ? { groqApiKey: overrides.groqApiKey } : {}),
    ...(Object.hasOwn(overrides, 'groqModel') ? { groqModel: overrides.groqModel } : {})
  });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${config.host}:${config.port}`), route = url.pathname;
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'");
      res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      if (!['GET', 'HEAD'].includes(req.method) && !validOrigin(req)) return fail(res, 403, 'Origen no autorizado.');
      const riveVendor = route.match(/^\/vendor\/rive\/(rive\.js|rive\.wasm|rive_fallback\.wasm)$/);
      if (riveVendor && ['GET', 'HEAD'].includes(req.method)) {
        const file = path.join(PROJECT_ROOT, 'node_modules', '@rive-app', 'canvas-lite', riveVendor[1]);
        if (!fs.existsSync(file)) return fail(res, 503, 'Falta el reproductor de Rive. Ejecuta npm ci desde mvp.');
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Content-Length': fs.statSync(file).size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });
        return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
      }
      if (req.method === 'GET' && route === '/api/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && route === '/api/status') {
        const groq = currentGroqConfig();
        const voice = currentVoiceConfig();
        return json(res, 200, { setupRequired: store.userCount() === 0, groqConfigured: Boolean(groq.groqApiKey), groqModel: groq.groqModel, voice: voiceStatus(voice), ...store.indexStats(), ingestion: ingestionStatus });
      }
      if (req.method === 'POST' && route === '/api/auth/register') {
        if (store.userCount() > 0) return fail(res, 403, 'La cuenta inicial ya fue creada.');
        const body = await bodyJson(req), email = String(body.email || '').trim().toLowerCase(), password = String(body.password || '');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 200) return fail(res, 400, 'Usa un correo válido y una contraseña de al menos 12 caracteres.');
        const user = store.createUser(email, password);
        res.setHeader('Set-Cookie', sessionCookie(store.createSession(user.id), req));
        return json(res, 201, { user });
      }
      if (req.method === 'POST' && route === '/api/auth/login') {
        const address = req.socket.remoteAddress || 'local';
        let attempt = loginAttempts.get(address) || { count: 0, until: 0 };
        if (attempt.until <= Date.now()) attempt = { count: 0, until: 0 };
        if (attempt.count >= 8 && attempt.until > Date.now()) return fail(res, 429, 'Demasiados intentos. Espera 15 minutos.');
        const body = await bodyJson(req), user = store.userByEmail(String(body.email || '').trim());
        if (!store.verifyPassword(user, String(body.password || ''))) {
          loginAttempts.set(address, { count: attempt.count + 1, until: Date.now() + 15 * 60_000 });
          return fail(res, 401, 'Credenciales inválidas.');
        }
        loginAttempts.delete(address);
        res.setHeader('Set-Cookie', sessionCookie(store.createSession(user.id), req));
        return json(res, 200, { user: { id: user.id, email: user.email } });
      }
      const token = cookieToken(req), user = store.userForToken(token);
      if (req.method === 'GET' && route === '/api/auth/me') return json(res, 200, { user });
      if (req.method === 'POST' && route === '/api/auth/logout') { store.revokeSession(token); res.setHeader('Set-Cookie', clearCookie(req)); return json(res, 200, { ok: true }); }
      if (route.startsWith('/api/') && !user) return fail(res, 401, 'Inicia sesión para continuar.');
      if (req.method === 'POST' && ['/api/voice/transcribe', '/api/voice/speech'].includes(route)) {
        if (req.headers['x-voice-consent'] !== 'true') return fail(res, 400, 'Autoriza el procesamiento de voz antes de continuar.');
        if (activeVoice.has(user.id)) return fail(res, 429, 'Ya hay una solicitud de voz en curso.');
        activeVoice.add(user.id);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90_000);
        const cancel = () => { if (!res.writableFinished) controller.abort(); };
        res.on('close', cancel); req.on('aborted', cancel);
        try {
          if (route.endsWith('/transcribe')) {
            const voice = currentVoiceConfig();
            if (req.headers['x-voice-stt-provider'] && req.headers['x-voice-stt-provider'] !== voiceStatus(voice).transcriptionProvider) return fail(res, 409, 'Cambió el proveedor de transcripción. Cierra e inicia de nuevo la voz para revisar el destino del audio.');
            audioFormat(req.headers['content-type']);
            let size = 0; const chunks = [];
            for await (const chunk of req) { size += chunk.length; if (size > AUDIO_LIMIT) throw Object.assign(new Error('El audio supera 5 MB.'), { status: 413 }); chunks.push(chunk); }
            const result = await transcribeAudio(Buffer.concat(chunks), req.headers['content-type'], voice, controller.signal, overrides.voiceFetch || fetch);
            if (!res.destroyed) return json(res, 200, result);
            return;
          }
          const body = await bodyJson(req);
          const conversation = store.getConversation(user.id, String(body.conversationId || ''));
          const turn = conversation?.turns.find(item => item.id === body.turnId);
          if (!turn?.answer) return fail(res, 404, 'Respuesta no encontrada en tu conversación.');
          const audio = await synthesizeAnswer(turn.answer, currentVoiceConfig(), controller.signal, overrides.voiceFetch || fetch);
          if (!audio.body) throw Object.assign(new Error('Fish Audio no devolvió audio.'), { status: 502 });
          res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          await pipeline(Readable.fromWeb(audio.body), res, { signal: controller.signal });
          return;
        } catch (error) {
          if (res.destroyed) return;
          if (res.headersSent) { res.destroy(); return; }
          return fail(res, error.status || 502, error.status ? error.message : 'No se pudo completar la solicitud de voz.');
        } finally { clearTimeout(timer); activeVoice.delete(user.id); res.off('close', cancel); req.off('aborted', cancel); }
      }
      if (route === '/api/conversations' && req.method === 'GET') {
        ensureConversations(store, user.id);
        return json(res, 200, { conversations: store.listConversations(user.id) });
      }
      if (route === '/api/conversations' && req.method === 'POST') {
        const conversation = store.createConversation(user.id);
        store.addConversationTurn(user.id, conversation.id, welcome);
        return json(res, 201, conversationView(store, user.id, conversation.id));
      }
      const conversationMatch = route.match(/^\/api\/conversations\/([a-f0-9-]{36})(?:\/(messages))?$/);
      if (conversationMatch) {
        const conversationId = conversationMatch[1];
        if (!store.getConversation(user.id, conversationId)) return fail(res, 404, 'Conversación no encontrada.');
        if (!conversationMatch[2] && req.method === 'GET') return json(res, 200, conversationView(store, user.id, conversationId));
        if (!conversationMatch[2] && req.method === 'DELETE') {
          if (activeMessages.has(conversationId)) return fail(res, 409, 'Espera a que termine la respuesta antes de eliminar la conversación.');
          return json(res, 200, { deleted: store.deleteConversation(user.id, conversationId) });
        }
        if (conversationMatch[2] && req.method === 'POST') {
          if (activeMessages.has(conversationId)) return fail(res, 409, 'Ya hay una respuesta en curso en esta conversación.');
          activeMessages.add(conversationId);
          try { return json(res, 200, await handleConversationMessage(store, user.id, conversationId, await bodyJson(req), currentGroqConfig(), overrides.groqFetch || globalThis.fetch)); }
          finally { activeMessages.delete(conversationId); }
        }
      }
      if (route === '/api/qa' && req.method === 'GET') return json(res, 200, { turns: store.qaTurns(user.id) });
      if (route === '/api/qa' && req.method === 'DELETE') return json(res, 200, { deleted: store.clearQaTurns(user.id) });
      if (route === '/api/qa' && req.method === 'POST') {
        const body = await bodyJson(req);
        const question = String(body.question || '').trim();
        if (!question || question.length > 1200) return fail(res, 400, 'Escribe una pregunta de hasta 1200 caracteres.');
        if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(question) || /\b\d{8,9}\b/.test(question)) return fail(res, 400, 'Quita correos, DNI y teléfonos de la pregunta antes de enviarla.');
        const history = store.qaTurns(user.id, 4);
        const response = await askLibrary(store, question, history, currentGroqConfig(), overrides.groqFetch || globalThis.fetch);
        const turn = store.addQaTurn(user.id, { question, ...response });
        return json(res, 200, { turn });
      }
      if (req.method === 'GET' && route === '/api/sources') return json(res, 200, { sources: getLegalCatalog(), indexed: store.sources() });
      const sourcePdfMatch = route.match(/^\/api\/sources\/([a-f0-9-]{36})\/pdf$/);
      if (sourcePdfMatch && req.method === 'GET') {
        const source = store.sourceById(sourcePdfMatch[1]);
        if (!source) return fail(res, 404, 'Fuente no encontrada.');
        const file = path.resolve(config.dataDir, source.file_name);
        if (path.dirname(file) !== path.resolve(config.dataDir) || !fs.existsSync(file)) return fail(res, 404, 'PDF no disponible.');
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': fs.statSync(file).size, 'Content-Disposition': 'inline', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return fs.createReadStream(file).pipe(res);
      }
      if (req.method === 'GET' && route === '/api/formats') return json(res, 200, { formats: listFormats() });
      if (req.method === 'POST' && route === '/api/reindex') {
        startIngestion(store, config.dataDir).catch(error => { ingestionStatus.errors.push({ file: '', message: error.message }); ingestionStatus.running = false; });
        return json(res, 202, { ingestion: ingestionStatus });
      }
      if (req.method === 'GET' && route === '/api/search') return json(res, 200, { results: store.search(url.searchParams.get('q') || '', 12) });
      if (req.method === 'GET' && route === '/api/cases') return json(res, 200, { cases: store.listCases(user.id) });
      if (req.method === 'POST' && route === '/api/cases') return json(res, 201, { case: store.createCase(user.id, normalizeCase(await bodyJson(req))) });
      const caseMatch = route.match(/^\/api\/cases\/([a-f0-9-]{36})(?:\/(.*))?$/);
      if (caseMatch) {
        const caseId = caseMatch[1], tail = caseMatch[2] || '', stored = store.getCase(user.id, caseId);
        if (!stored) return fail(res, 404, 'Caso no encontrado.');
        if (!tail && req.method === 'GET') return json(res, 200, { case: stored });
        if (!tail && req.method === 'PUT') return json(res, 200, { case: store.updateCase(user.id, caseId, normalizeCase(await bodyJson(req))) });
        if (!tail && req.method === 'DELETE') return json(res, 200, { deleted: store.deleteCase(user.id, caseId) });
        if (tail === 'evaluate' && req.method === 'GET') return json(res, 200, evaluateCase(stored.data, { hasDocuments: stored.documents.length > 0 }));
        if (tail === 'draft' && req.method === 'GET') {
          const result = createDraft(stored.data, { hasDocuments: stored.documents.length > 0 });
          return json(res, result.draft ? 200 : 409, { ...result, documents: stored.documents, references: relevantSources(store, stored.data).map(({ source_id, title, file_name, page, content }) => ({ source_id, title, file_name, page, excerpt: content.slice(0, 500), approvedForCitation: false })) });
        }
        if (tail === 'ai' && req.method === 'POST') {
          if (!stored.data.isFictional) return fail(res, 403, 'La IA está disponible solo para casos ficticios en esta versión.');
          return json(res, 200, { suggestion: await suggestWithGroq(stored.data, relevantSources(store, stored.data), currentGroqConfig()) });
        }
        if (tail === 'pdf' && req.method === 'GET') {
          if (!stored.data.reviewConfirmed) return fail(res, 409, 'Confirma el resumen del caso antes de descargar el PDF.');
          const result = createDraft(stored.data, { hasDocuments: stored.documents.length > 0 });
          if (!result.draft) return fail(res, 409, 'Completa y revisa el caso antes de generar el PDF.');
          const bytes = await makeDraftPdf(result.draft, stored.documents, relevantSources(store, stored.data));
          res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="borrador-${caseId.slice(0, 8)}.pdf"`, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          return res.end(bytes);
        }
        const formatMatch = tail.match(/^formats\/([a-z0-9-]+)\/preview$/);
        if (formatMatch && req.method === 'GET') {
          const format = getFormat(formatMatch[1]);
          if (!format) return fail(res, 404, 'Formato no encontrado.');
          if (!stored.data.isFictional || !stored.data.reviewConfirmed) return fail(res, 409, 'Confirma primero el caso ficticio y su resumen.');
          const draft = createDraft(stored.data, { hasDocuments: stored.documents.length > 0 });
          if (!draft.draft) return fail(res, 409, 'Completa el caso antes de generar la vista previa.');
          const assessment = assessFormat(stored.data, format);
          if (!assessment.available) return fail(res, 404, 'No se encontró el PDF fuente local.');
          if (format.mode === 'filled_preview' && assessment.missing.length) return fail(res, 409, `Completa para este formato: ${assessment.missing.join(', ')}.`);
          const bytes = await makeOfficialFormPreview(stored.data, stored.documents, format);
          res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="simulacion-${format.code}-${caseId.slice(0, 8)}.pdf"`, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          return res.end(bytes);
        }
        if (tail === 'formats' && req.method === 'GET') return json(res, 200, { formats: listFormats().map(format => ({ ...format, assessment: assessFormat(stored.data, getFormat(format.code)) })) });
        if (tail === 'documents' && req.method === 'GET') return json(res, 200, { documents: stored.documents });
        if (tail === 'documents' && req.method === 'POST') {
          const document = store.addDocument(user.id, caseId, checkedFile(await bodyJson(req, 7_500_000)));
          store.updateCase(user.id, caseId, normalizeCase({ ...stored.data, reviewConfirmed: false, chatCompleted: stored.data.chatCompleted?.filter(id => id !== 'review') }));
          return json(res, 201, { document });
        }
        const documentMatch = tail.match(/^documents\/([a-f0-9-]{36})$/);
        if (documentMatch) {
          const doc = store.document(user.id, caseId, documentMatch[1]);
          if (!doc) return fail(res, 404, 'Documento no encontrado.');
          if (req.method === 'DELETE') {
            const deleted = store.deleteDocument(user.id, caseId, doc.id);
            store.updateCase(user.id, caseId, normalizeCase({ ...stored.data, reviewConfirmed: false, chatCompleted: stored.data.chatCompleted?.filter(id => id !== 'review') }));
            return json(res, 200, { deleted });
          }
          if (req.method === 'GET') {
            const bytes = store.documentBytes(doc);
            res.writeHead(200, { 'Content-Type': doc.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            return res.end(bytes);
          }
        }
      }
      if (route.startsWith('/api/')) return fail(res, 404, 'Ruta no encontrada.');
      if (!['GET', 'HEAD'].includes(req.method)) return fail(res, 405, 'Método no permitido.');
      let relative;
      try { relative = route === '/' ? 'index.html' : decodeURIComponent(route.slice(1)); }
      catch { return fail(res, 400, 'Ruta inválida.'); }
      const file = path.resolve(publicDir, relative);
      if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return fail(res, 403, 'Acceso denegado.');
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile()) throw new Error('not file');
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
      } catch { return fail(res, 404, 'No encontrado.'); }
    } catch (error) {
      console.error(error);
      return fail(res, error.status || 500, error.status ? error.message : 'Error interno. Consulta el registro del servidor.');
    }
  });
  server.appStore = store;
  server.appConfig = config;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(server.appConfig.port, server.appConfig.host, () => {
    console.log(`AbogadoIA disponible en http://${server.appConfig.host}:${server.appConfig.port}`);
    startIngestion(server.appStore, server.appConfig.dataDir).catch(error => console.error('Error de ingesta:', error));
  });
}
