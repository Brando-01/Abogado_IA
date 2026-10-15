import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createDraft, evaluateCase } from '../src/procedure.mjs';
import { getLegalCatalog } from '../src/legal-catalog.mjs';
import { Store } from '../src/storage.mjs';
import { suggestWithGroq, answerQuestionWithGroq } from '../src/groq.mjs';
import { getGroqConfig } from '../src/config.mjs';
import { createServer } from '../server.mjs';
import { getFormat, listFormats, assessFormat } from '../src/formats.mjs';
import { makeOfficialFormPreview } from '../src/pdf.mjs';
import { PDFDocument } from 'pdf-lib';

const fixture = {
  procedure: 'ALIMENTOS_NNA', applicantRelation: 'madre', otherClaims: false,
  urgentRisk: false, isFictional: true,
  applicantName: 'Ana Ejemplo', applicantDocument: 'DEMO12345', applicantAddress: 'Calle Ficticia 100',
  respondentName: 'Bruno Ejemplo', respondentAddress: 'Av. Simulada 250',
  childName: 'Carla Ejemplo', childBirthDate: '2018-03-10',
  requestedAmount: 850, factDescription: 'La persona demandada no aporta a los gastos declarados.',
  expenseDescription: 'Alimentos y útiles escolares: S/ 850 al mes.',
  evidence: ['Recibos ficticios']
};

test('un caso ficticio completo genera solo hechos y monto declarados', () => {
  const result = createDraft(fixture);
  assert.equal(result.status, 'draft_ready');
  assert.match(result.draft.petition, /850\.00/);
  assert.deepEqual(result.draft.facts, [fixture.factDescription, `Necesidades y gastos declarados: ${fixture.expenseDescription}`]);
  assert.deepEqual(result.draft.evidence, fixture.evidence);
  assert.match(result.draft.legalBasis, /Pendiente de revisión jurídica/);
});

test('casos fuera de alcance y datos reales quedan bloqueados', () => {
  for (const variation of [
    { procedure: 'OTRO' }, { applicantRelation: 'tutor' }, { otherClaims: true },
    { urgentRisk: true }, { isFictional: false }, { childBirthDate: '2000-01-01' }
  ]) {
    const result = createDraft({ ...fixture, ...variation });
    assert.equal(result.status, 'blocked');
    assert.equal(result.draft, null);
  }
});

test('no inventa domicilio desconocido ni documentos ausentes', () => {
  const result = createDraft({ ...fixture, respondentAddress: '', respondentAddressUnknown: true, evidence: [] });
  assert.equal(result.status, 'draft_ready');
  assert.match(result.draft.respondent, /pendiente de revisión/);
  assert.deepEqual(result.draft.evidence, []);
  assert.ok(result.warnings.some(x => x.includes('domicilio desconocido')));
});

test('incluye dos menores declarados sin alterar el monto total', () => {
  const result = createDraft({ ...fixture, children: [
    { name: 'Carla Ejemplo', birthDate: '2018-03-10' },
    { name: 'Diego Ejemplo', birthDate: '2020-05-12' }
  ] });
  assert.equal(result.status, 'draft_ready');
  assert.match(result.draft.child, /Diego Ejemplo/);
  assert.match(result.draft.petition, /850\.00/);
  assert.match(result.draft.petition, /Carla Ejemplo, Diego Ejemplo/);
});

test('datos obligatorios ausentes impiden el borrador', () => {
  const result = evaluateCase({ ...fixture, requestedAmount: '', childName: '' });
  assert.equal(result.status, 'incomplete');
  assert.ok(result.missing.some(x => x.includes('Monto')));
  assert.ok(result.missing.some(x => x.includes('Nombre del menor')));
});

test('catálogo detecta los archivos nuevos sin aprobar citas automáticamente', () => {
  const sources = getLegalCatalog();
  assert.ok(sources.every(x => x.exists));
  assert.ok(sources.every(x => x.approvedForCitation === false && /^[a-f0-9]{64}$/.test(x.sha256)));
});

test('los formatos distinguen la versión y solo la resolución se superpone', async () => {
  const formats = listFormats();
  assert.equal(formats.length, 2);
  assert.ok(formats.every(x => x.entity === 'Poder Judicial' && x.available));
  assert.equal(getFormat('pj-portal-menores').mode, 'blank_reference');
  assert.ok(assessFormat(fixture, getFormat('pj-ra-2024')).missing.includes('distrito judicial'));
  const complete = {
    ...fixture, courtDistrict: 'Lima', applicantDepartment: 'Lima', applicantProvince: 'Lima',
    applicantDistrict: 'Cercado', applicantPhone: '999000111', applicantEmail: 'ana@example.test',
    respondentDocument: 'DEMO67890', children: [{ name: 'Carla Ejemplo', birthDate: '2018-03-10', relationToRespondent: 'Hija' }]
  };
  assert.deepEqual(assessFormat(complete, getFormat('pj-ra-2024')).missing, []);
  const pdf = await PDFDocument.load(await makeOfficialFormPreview(complete, [], getFormat('pj-ra-2024')));
  assert.equal(pdf.getPageCount(), 3);
  const blank = await PDFDocument.load(await makeOfficialFormPreview(complete, [], getFormat('pj-portal-menores')));
  assert.equal(blank.getPageCount(), 2);
});

test('Groq recibe seudónimos y devuelve una sugerencia para revisión', async () => {
  const previousFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = options;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ hechos: 'Hechos para revisar.', gastos: 'Gastos para revisar.', preguntas: ['¿Falta algo?'] }) } }] }) };
  };
  try {
    const suggestion = await suggestWithGroq(fixture, [{ title: 'Ley de prueba', page: 1, content: 'Texto de prueba' }], { groqApiKey: 'clave-ficticia', groqModel: 'modelo-prueba' });
    assert.equal(suggestion.hechos, 'Hechos para revisar.');
    assert.equal(suggestion.context[0].page, 1);
    const sent = JSON.stringify(JSON.parse(request.body));
    assert.ok(!sent.includes(fixture.applicantName));
    assert.ok(!sent.includes(fixture.childName));
    assert.equal(request.headers.Authorization, 'Bearer clave-ficticia');
  } finally { globalThis.fetch = previousFetch; }
});

test('consulta libre usa extractos recuperados y valida las referencias de Groq', async () => {
  let request;
  const fakeFetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ domain: 'legal', sufficient: true, answer: '', claims: [{ text: 'El extracto menciona alimentos.', ref: 'F1', quote: 'El artículo trata de alimentos.' }] }) } }] }) };
  };
  const response = await answerQuestionWithGroq('¿Qué dice la ley sobre alimentos?', [
    { title: 'Ley de prueba', file_name: 'ley.pdf', page: 3, content: 'El artículo trata de alimentos.' }
  ], [], { groqApiKey: 'clave-ficticia', groqModel: 'modelo-prueba' }, fakeFetch);
  assert.equal(response.references.length, 1);
  assert.equal(response.references[0].file, 'ley.pdf');
  assert.ok(JSON.stringify(request).includes('El artículo trata de alimentos.'));
  assert.ok(!JSON.stringify(request).includes('clave-ficticia'));
});

test('la configuración de Groq se actualiza al editar .env sin reiniciar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abogadoia-config-'));
  const envFile = path.join(dir, '.env');
  try {
    fs.writeFileSync(envFile, 'GROQ_API_KEY=\nGROQ_MODEL=modelo-uno\n');
    assert.equal(getGroqConfig(envFile, {}).groqApiKey, '');
    fs.writeFileSync(envFile, 'GROQ_API_KEY=clave-de-prueba\nGROQ_MODEL=modelo-dos\n');
    assert.deepEqual(getGroqConfig(envFile, {}), { groqApiKey: 'clave-de-prueba', groqModel: 'modelo-dos' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('los fallos de Groq muestran una causa útil sin exponer la clave', async () => {
  await assert.rejects(suggestWithGroq(fixture, [], { groqApiKey: '' }), error => error.status === 503);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'secret' } }) });
  try {
    await assert.rejects(suggestWithGroq(fixture, [], { groqApiKey: 'clave-de-prueba', groqModel: 'modelo-prueba' }), error =>
      error.status === 502 && /rechazó la clave/.test(error.message) && !error.message.includes('clave-de-prueba'));
  } finally { globalThis.fetch = previousFetch; }
});

test('almacenamiento cifra casos y aísla usuarios', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abogadoia-store-'));
  const store = new Store({ dbPath: path.join(dir, 'test.sqlite'), privateDir: dir, secret: crypto.randomBytes(32) });
  try {
    const one = store.createUser('uno@example.test', 'contraseña-larga-uno');
    const two = store.createUser('dos@example.test', 'contraseña-larga-dos');
    const item = store.createCase(one.id, fixture);
    assert.equal(store.getCase(one.id, item.id).data.applicantName, fixture.applicantName);
    assert.equal(store.getCase(two.id, item.id), null);
    assert.equal(store.verifyPassword(store.userByEmail('uno@example.test'), 'incorrecta'), false);
    assert.equal(store.verifyPassword(store.userByEmail('uno@example.test'), 'contraseña-larga-uno'), true);
    const row = store.db.prepare('SELECT encrypted_json FROM cases WHERE id=?').get(item.id);
    assert.ok(!row.encrypted_json.includes(fixture.applicantName));
    store.addQaTurn(one.id, { question: 'Pregunta privada', answer: 'Respuesta privada', references: [] });
    assert.equal(store.qaTurns(one.id).length, 1);
    assert.equal(store.qaTurns(two.id).length, 0);
    assert.ok(!store.db.prepare('SELECT encrypted_json FROM qa_turns LIMIT 1').get().encrypted_json.includes('Pregunta privada'));
    assert.equal(store.clearQaTurns(one.id), 1);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('API completa: cuenta, caso, anexo privado y PDF', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abogadoia-api-'));
  const server = createServer({ dbPath: path.join(dir, 'test.sqlite'), privateDir: dir, secret: crypto.randomBytes(32), groqApiKey: 'clave-ficticia', dataDir: path.resolve('../Data de Leyes'), groqFetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ domain: 'legal', sufficient: true, answer: '', claims: [{ text: 'El extracto trata de alimentos para menores.', ref: 'F1', quote: 'La prueba contiene información sobre alimentos para menores.' }] }) } }] }) }) });
  server.appStore.replaceSource({ fileName: 'prueba.pdf', sha256: 'a'.repeat(64), title: 'Ley de prueba', category: 'core', pages: 1, chunks: [{ page: 1, content: 'La prueba contiene información sobre alimentos para menores.' }], warning: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const register = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@example.test', password: 'clave-local-segura' }) });
    assert.equal(register.status, 201);
    const cookie = register.headers.get('set-cookie').split(';')[0];
    const call = (route, method = 'GET', data) => fetch(`${base}${route}`, { method, headers: { Cookie: cookie, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    const qa = await call('/api/qa', 'POST', { question: '¿Qué dice sobre alimentos?' });
    assert.equal(qa.status, 200);
    assert.equal((await qa.json()).turn.references[0].page, 1);
    assert.equal((await (await call('/api/qa')).json()).turns.length, 1);
    const created = await (await call('/api/cases', 'POST', fixture)).json();
    const caseId = created.case.id;
    const draftResponse = await call(`/api/cases/${caseId}/draft`);
    assert.equal(draftResponse.status, 200);
    assert.equal((await draftResponse.json()).draft.templateVersion, 'demo-0.1');
    const upload = await call(`/api/cases/${caseId}/documents`, 'POST', { name: 'anexo-ficticio.pdf', data: Buffer.from('%PDF-1.4 demo').toString('base64') });
    assert.equal(upload.status, 201);
    const doc = (await upload.json()).document;
    assert.equal((await call(`/api/cases/${caseId}/documents/${doc.id}`)).status, 200);
    const pdfResponse = await call(`/api/cases/${caseId}/pdf`);
    assert.equal(pdfResponse.status, 409);
    await call(`/api/cases/${caseId}`, 'PUT', { ...fixture, reviewConfirmed: true });
    const confirmedPdf = await call(`/api/cases/${caseId}/pdf`);
    assert.equal(confirmedPdf.status, 200);
    assert.equal(Buffer.from(await confirmedPdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    const formatOptions = await (await call(`/api/cases/${caseId}/formats`)).json();
    assert.equal(formatOptions.formats.length, 2);
    assert.ok(formatOptions.formats.find(x => x.code === 'pj-ra-2024').assessment.missing.includes('distrito judicial'));
    assert.equal((await call(`/api/cases/${caseId}/formats/pj-ra-2024/preview`)).status, 409);
    assert.equal((await call(`/api/cases/${caseId}/formats/pj-portal-menores/preview`)).status, 200);
    await call(`/api/cases/${caseId}`, 'PUT', {
      ...fixture, reviewConfirmed: true, courtDistrict: 'Lima', applicantDepartment: 'Lima', applicantProvince: 'Lima',
      applicantDistrict: 'Cercado', applicantPhone: '999000111', applicantEmail: 'ana@example.test',
      respondentDocument: 'DEMO67890', children: [{ name: 'Carla Ejemplo', birthDate: '2018-03-10', relationToRespondent: 'Hija' }]
    });
    const officialPreview = await call(`/api/cases/${caseId}/formats/pj-ra-2024/preview`);
    assert.equal(officialPreview.status, 200);
    assert.equal(Buffer.from(await officialPreview.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await fetch(`${base}/api/cases/${caseId}`)).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    server.appStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
