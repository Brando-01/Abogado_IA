import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(import.meta.dirname, '../../Data de Leyes');

const catalog = [
  { id: 'ley-27337', title: 'Código de los Niños y Adolescentes', file: '7858302-codigo_de_los_ninhos_y_adolescentes.pdf', kind: 'norma', priority: 'P0' },
  { id: 'ley-31464', title: 'Ley 31464', file: '31464-TXM.pdf', kind: 'norma modificatoria', priority: 'P0' },
  { id: 'cpc', title: 'Código Procesal Civil', file: 'código+procesal+civil.pdf', kind: 'texto único ordenado histórico', priority: 'P0' },
  { id: 'cc', title: 'Código Civil', file: 'Codigo-Civil.pdf', kind: 'edición de 2015', priority: 'P0' },
  { id: 'ley-30466', title: 'Ley 30466', file: '30466-TXM.pdf', kind: 'norma', priority: 'P1' },
  { id: 'ds-002-2018-mimp', title: 'Reglamento de la Ley 30466', file: 'ds_002_2018_mimp.pdf', kind: 'reglamento', priority: 'P1' },
  { id: 'formulario-2024', title: 'Formulario de alimentos y asignación anticipada', file: 'RESOLUCION+ADMINISTRATIVA-000111-2024-CE.pdf', kind: 'resolución y formulario', priority: 'P0' }
];

export function getLegalCatalog() {
  return catalog.map(item => {
    const filePath = path.join(DATA_DIR, item.file);
    const exists = fs.existsSync(filePath);
    return {
      ...item,
      exists,
      sha256: exists ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') : null,
      reviewStatus: 'pending_human_review',
      approvedForCitation: false
    };
  });
}
