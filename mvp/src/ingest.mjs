import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const ingestionStatus = { running: false, current: '', processed: 0, total: 0, errors: [], completedAt: null };
let activePromise = null;

function classify(fileName) {
  const name = fileName.toLowerCase();
  if (/c[oó]digo.?procesal.?civil/.test(name)) return { title: 'Código Procesal Civil', category: 'core' };
  if (/codigo-civil/.test(name)) return { title: 'Código Civil', category: 'core' };
  if (/27337|ninhos.y.adolescentes/.test(name) && !/apu simi/.test(name)) return { title: 'Código de los Niños y Adolescentes', category: 'core' };
  if (/31464/.test(name)) return { title: 'Ley 31464', category: 'core' };
  if (/30466/.test(name)) return { title: 'Ley 30466', category: 'support' };
  if (/ds_002_2018_mimp/.test(name)) return { title: 'Reglamento de la Ley 30466', category: 'support' };
  if (/000111-2024-ce/.test(name)) return { title: 'Formulario aprobado por RA 000111-2024-CE-PJ', category: 'form' };
  if (/demanda.de.alimentos.para.menores/.test(name)) return { title: 'Formulario anterior de alimentos para menores', category: 'form-old' };
  if (/constitucion/.test(name)) return { title: 'Constitución Política del Perú', category: 'support' };
  return { title: fileName.replace(/\.pdf$/i, '').replace(/[+_-]/g, ' '), category: 'other' };
}

function chunksForPage(text, page) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(' '), result = [];
  let segment = '';
  for (const word of words) {
    if (segment.length + word.length > 1000 && segment) {
      result.push({ page, content: segment.trim() });
      segment = segment.slice(-120) + ' ';
    }
    segment += word + ' ';
  }
  if (segment.trim()) result.push({ page, content: segment.trim() });
  return result;
}

async function ingestOne(store, filePath) {
  const fileName = path.basename(filePath), bytes = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const info = classify(fileName), previous = store.sourceByName(fileName);
  if (previous?.sha256 === sha256 && previous.category === info.category && previous.title === info.title) return 'unchanged';
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
  const chunks = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str || '').join(' ');
      chunks.push(...chunksForPage(text, pageNumber));
      page.cleanup();
    }
    store.replaceSource({ fileName, sha256, ...info, pages: document.numPages, chunks,
      warning: chunks.length === 0 ? 'Sin texto extraíble; requiere OCR o revisión visual.' : null });
    return chunks.length ? 'indexed' : 'no-text';
  } finally { await document.destroy(); }
}

export function startIngestion(store, dataDir) {
  if (activePromise) return activePromise;
  activePromise = (async () => {
    const files = fs.readdirSync(dataDir).filter(x => x.toLowerCase().endsWith('.pdf')).sort();
    Object.assign(ingestionStatus, { running: true, current: '', processed: 0, total: files.length, errors: [], completedAt: null });
    for (const file of files) {
      ingestionStatus.current = file;
      try { await ingestOne(store, path.join(dataDir, file)); }
      catch (error) { ingestionStatus.errors.push({ file, message: error.message }); }
      ingestionStatus.processed++;
      await new Promise(resolve => setImmediate(resolve));
    }
    ingestionStatus.running = false;
    ingestionStatus.current = '';
    ingestionStatus.completedAt = new Date().toISOString();
    activePromise = null;
    return { ...ingestionStatus };
  })();
  return activePromise;
}
