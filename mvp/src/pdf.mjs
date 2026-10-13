import fs from 'node:fs';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { formatSourcePath } from './formats.mjs';

const safe = value => String(value ?? '').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\u0009\u000a\u000d\u0020-\u007e\u00a0-\u00ff]/g, '');

export async function makeDraftPdf(draft, documents = [], references = []) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Borrador de simulación de demanda de alimentos');
  pdf.setSubject('Documento de prueba sin validez para presentación');
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const width = 595.28, height = 841.89, margin = 56;
  let page, y;
  function newPage() {
    page = pdf.addPage([width, height]);
    y = height - margin;
    page.drawRectangle({ x: margin, y: y - 24, width: width - margin * 2, height: 24, borderColor: rgb(.65, .25, .22), borderWidth: 1 });
    page.drawText('SIMULACIÓN - NO PRESENTAR', { x: margin + 124, y: y - 17, size: 11, font: sans, color: rgb(.65, .25, .22) });
    y -= 48;
  }
  function line(text = '', font = regular, size = 11, indent = 0, gap = 4) {
    const maxWidth = width - 2 * margin - indent;
    const words = safe(text).split(/\s+/).filter(Boolean);
    let current = '';
    const lines = [];
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
      else {
        if (current) lines.push(current);
        current = word;
        while (font.widthOfTextAtSize(current, size) > maxWidth && current.length > 1) {
          let end = current.length - 1;
          while (end > 1 && font.widthOfTextAtSize(current.slice(0, end), size) > maxWidth) end--;
          lines.push(current.slice(0, end));
          current = current.slice(end);
        }
      }
    }
    if (current) lines.push(current);
    for (const segment of lines.length ? lines : ['']) {
      if (y < margin + 42) newPage();
      if (segment) page.drawText(segment, { x: margin + indent, y, size, font, color: rgb(.13, .18, .21) });
      y -= size + gap;
    }
  }
  function heading(text) { y -= 8; line(text.toUpperCase(), bold, 11, 0, 6); }
  newPage();
  line(draft.title, bold, 14, 0, 7);
  line(draft.notice, regular, 10);
  heading('Personas');
  line(`Solicitante: ${draft.applicant}`);
  line(`Persona demandada: ${draft.respondent}`);
  line(`Menor: ${draft.child}`);
  heading('Petitorio declarado'); line(draft.petition);
  heading('Hechos declarados'); draft.facts.forEach((fact, index) => line(`${index + 1}. ${fact}`));
  heading('Documentos adjuntados a este caso');
  if (documents.length) documents.forEach((doc, index) => line(`${index + 1}. ${doc.original_name} (SHA-256: ${doc.sha256.slice(0, 16)}...)`));
  else line('No se adjuntaron documentos.');
  heading('Fundamentos jurídicos'); line(draft.legalBasis);
  heading('Fuentes localizadas para revisión');
  if (references.length) references.slice(0, 6).forEach((ref, index) => line(`${index + 1}. ${ref.title}, página ${ref.page}. Pendiente de validación jurídica.`));
  else line('No se localizaron fuentes textuales suficientes.');
  y -= 12;
  line(`Plantilla ${draft.templateVersion}. No contiene firma ni constancia de presentación.`, sans, 8);
  const total = pdf.getPageCount();
  pdf.getPages().forEach((item, i) => item.drawText(`Página ${i + 1} de ${total}`, { x: width - margin - 65, y: 25, size: 8, font: sans, color: rgb(.45, .49, .51) }));
  return Buffer.from(await pdf.save());
}

// The approved 2024 PJ resolution includes the official form on PDF pages 4-5.
// This preview keeps those pages intact and overlays only declared values.
export async function makeOfficialFormPreview(data, documents = [], format) {
  if (!format) throw new Error('Selecciona un formato válido.');
  const source = formatSourcePath(format);
  const original = await PDFDocument.load(fs.readFileSync(source));
  const pdf = await PDFDocument.create();
  const [first, second] = await pdf.copyPages(original, format.pages);
  pdf.addPage(first); pdf.addPage(second);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const color = rgb(.08, .24, .36);
  function put(page, value, x, top, width, size = 7) {
    const text = safe(value).replace(/\s+/g, ' ').trim();
    if (!text) return;
    const max = text.length > 250 ? 250 : text.length;
    let output = text.slice(0, max);
    while (output.length > 1 && font.widthOfTextAtSize(output, size) > width) output = output.slice(0, -1);
    if (output.length < text.length) output = output.slice(0, -1) + '...';
    page.drawText(output, { x, y: page.getHeight() - top - size, size, font, color });
  }
  function stamp(page) {
    page.drawText('BORRADOR DE SIMULACION - NO PRESENTAR', { x: 128, y: 455, size: 22, font: bold, color: rgb(.69, .19, .16), rotate: degrees(45), opacity: .26 });
    page.drawText('Verificar version, requisitos, competencia y canal antes de uso real', { x: 175, y: 33, size: 6.5, font, color: rgb(.55, .25, .20) });
  }
  stamp(first); stamp(second);
  if (format.mode === 'blank_reference') {
    pdf.setTitle('Referencia del formulario PJ para menores - simulacion');
    pdf.setSubject('Ejemplar sin completar; no presentar');
    return Buffer.from(await pdf.save());
  }
  put(first, data.courtDistrict, 412, 132, 143, 7);
  put(first, data.applicantName, 176, 169, 150);
  put(first, data.applicantDocument, 455, 204, 100);
  put(first, data.applicantAddress, 176, 232, 374);
  put(first, data.applicantDepartment, 185, 258, 90);
  put(first, data.applicantProvince, 283, 258, 143);
  put(first, data.applicantDistrict, 430, 258, 120);
  put(first, data.applicantPhone, 185, 283, 82);
  put(first, data.applicantEmail, 280, 283, 139);
  put(first, data.applicantElectronicMailbox, 428, 283, 120);
  (data.children || []).slice(0, 3).forEach((child, i) => {
    const top = 327 + i * 53;
    put(first, child.name, 176, top, 220);
    if (child.birthDate) {
      const years = Math.floor((Date.now() - new Date(child.birthDate + 'T00:00:00').getTime()) / 31557600000);
      if (years >= 0 && years < 18) put(first, String(years), 404, top, 25);
    }
    put(first, child.relationToRespondent, 440, top, 110);
  });
  put(first, data.respondentName, 176, 487, 150);
  put(first, data.respondentDocument, 455, 526, 100);
  put(first, data.respondentAddressUnknown ? 'Domicilio desconocido; revisar' : data.respondentAddress, 176, 561, 374);
  put(first, data.respondentDepartment, 185, 587, 90);
  put(first, data.respondentProvince, 283, 587, 143);
  put(first, data.respondentDistrict, 430, 587, 120);
  put(first, data.requestedAmount > 0 ? Number(data.requestedAmount).toFixed(2) : '', 410, 669, 62, 7);
  put(second, data.respondentEmployer, 176, 140, 370);
  put(second, data.respondentOccupation, 176, 211, 370);
  put(second, data.respondentIncome ? `S/ ${data.respondentIncome}` : '', 176, 236, 370);
  documents.slice(0, 5).forEach((doc, i) => put(second, `${i + 1}. ${doc.original_name}`, 183, 349 + i * 14, 350, 6.6));
  put(second, new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima' }), 391, 440, 80);
  let page, y;
  function continuation() {
    page = pdf.addPage([595.32, 841.92]); y = 750;
    page.drawText('HOJA DE CONTINUACION - BORRADOR DE SIMULACION', { x: 56, y: 785, size: 12, font: bold, color });
    stamp(page);
  }
  function writeLine(value = '') {
    if (y < 75) continuation();
    if (value) page.drawText(safe(value), { x: 56, y, size: 9, font, color });
    y -= value ? 17 : 9;
  }
  continuation();
  const lines = [
    'Datos declarados; cotejar con la plantilla, documentos y firma:',
    ...(data.children || []).map((child, i) => `${i + 1}. ${child.name || '[sin nombre]'}; nacimiento: ${child.birthDate || '[desconocido]'}; vinculo: ${child.relationToRespondent || '[sin confirmar]'}`),
    '', 'Hechos declarados:', data.factDescription || '[sin declarar]', '',
    'Necesidades y gastos declarados:', data.expenseDescription || '[sin declarar]', '',
    'Archivos efectivamente adjuntados:', ...documents.map((doc, i) => `${i + 1}. ${doc.original_name}`),
    '', 'Esta hoja no sustituye los campos, anexos ni firmas que exija el juzgado.'
  ];
  for (const paragraph of lines) {
    const words = safe(paragraph).split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, 9) > 480 && line) { writeLine(line); line = word; }
      else line = next;
    }
    writeLine(line);
  }
  pdf.setTitle('Vista previa del formulario oficial PJ - simulacion');
  pdf.setSubject('Requiere comprobacion de vigencia y revision juridica; no presentar');
  return Buffer.from(await pdf.save());
}
