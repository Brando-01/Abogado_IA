import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './config.mjs';

const dataDir = path.resolve(PROJECT_ROOT, '../Data de Leyes');

export const FORMATS = Object.freeze([
  {
    code: 'pj-ra-2024', entity: 'Poder Judicial', destination: 'Juzgado de Paz Letrado competente',
    procedure: 'Demanda inicial de alimentos para menores de edad',
    version: 'Formulario aprobado por R. A. 000111-2024-CE-PJ',
    mode: 'filled_preview', fileName: 'RESOLUCION+ADMINISTRATIVA-000111-2024-CE.pdf', pages: [3, 4],
    sourceUrl: 'https://www.pj.gob.pe/wps/wcm/connect/d0f498804f7cce5a8a849ae9e95470c5/RESOLUCION%2BADMINISTRATIVA-000111-2024-CE.pdf?CACHEID=d0f498804f7cce5a8a849ae9e95470c5&MOD=AJPERES',
    channel: 'Mesa de Partes Electrónica o física, según distrito judicial y requisitos vigentes',
    note: 'Vista previa con datos ficticios superpuestos. Requiere cotejo jurídico de vigencia, competencia y anexos.'
  },
  {
    code: 'pj-portal-menores', entity: 'Poder Judicial', destination: 'Juzgado de Paz Letrado competente',
    procedure: 'Demanda inicial de alimentos para menores de edad',
    version: 'Formulario del portal de formatos del Poder Judicial',
    mode: 'blank_reference', fileName: 'DEMANDA+DE+ALIMENTOS+PARA+MENORES+DE+EDAD.pdf', pages: [2, 3],
    sourceUrl: 'https://www.pj.gob.pe/wps/wcm/connect/8f790d8043278669bce7fdc55454d062/DEMANDA%2BDE%2BALIMENTOS%2BPARA%2BMENORES%2BDE%2BEDAD.pdf?CACHEID=8f790d8043278669bce7fdc55454d062&MOD=AJPERES',
    channel: 'Mesa de Partes Electrónica o física, según distrito judicial y requisitos vigentes',
    note: 'Ejemplar de referencia sin datos superpuestos; no se atribuye una fecha de aprobación a esta versión.'
  }
]);

export function listFormats() {
  return FORMATS.map(({ fileName, pages, ...format }) => ({ ...format, available: fs.existsSync(path.join(dataDir, fileName)) }));
}

export function getFormat(code) {
  return FORMATS.find(format => format.code === code) || null;
}

export function formatSourcePath(format) {
  return path.join(dataDir, format.fileName);
}

export function assessFormat(data, format) {
  if (!format) return { available: false, missing: [], warnings: ['Formato desconocido.'] };
  const missing = [];
  if (format.mode === 'filled_preview') {
    for (const [key, label] of [
      ['courtDistrict', 'distrito judicial'], ['applicantDepartment', 'departamento de la parte demandante'],
      ['applicantProvince', 'provincia de la parte demandante'], ['applicantDistrict', 'distrito de la parte demandante'],
      ['applicantPhone', 'teléfono de contacto'], ['applicantEmail', 'correo de contacto'],
      ['respondentDocument', 'documento de identidad de la parte demandada']
    ]) if (!data[key]) missing.push(label);
    (data.children || []).forEach((child, i) => { if (!child.relationToRespondent) missing.push(`vínculo del menor ${i + 1} con la parte demandada`); });
  }
  return {
    available: fs.existsSync(formatSourcePath(format)), missing,
    warnings: [
      'Documento de simulación; no se ha validado su aceptación para una presentación real.',
      'La competencia territorial, el canal, los requisitos, la vigencia y el contenido necesitan revisión jurídica.'
    ]
  };
}
