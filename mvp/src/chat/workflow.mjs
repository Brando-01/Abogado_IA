import { normalizeCase, evaluateCase } from '../procedure.mjs';

export const initialCase = () => normalizeCase({ procedure: 'ALIMENTOS_NNA', children: [{ name: '', birthDate: '' }] });
const plain = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const isUnknown = value => /^(no se|desconozco|no lo se|omitir|no tengo(?: (?:documentos|pruebas))?|ningun[oa]?(?: (?:documento|prueba))?|domicilio desconocido|no conozco(?: su (?:direccion|domicilio))?)\.?$/.test(plain(value));
const boolean = value => {
  const text = plain(value);
  if (/^(si\b|confirmo\b|afirmativo\b)/.test(text)) return true;
  if (/^(no\b|negativo\b)/.test(text)) return false;
  throw new Error('Necesito un sí o un no explícito para registrar esa respuesta.');
};

export function steps(data) {
  const items = [
    ['consent', 'Datos ficticios', '¿Confirmas que usaremos solo datos y documentos ficticios?', ['Sí, solo datos ficticios', 'No']],
    ['relation', 'Relación con los menores', '¿Eres la madre o el padre de los menores?', ['Madre', 'Padre', 'Otra persona']],
    ['claims', 'Otras solicitudes', '¿Quieres incluir también filiación, tenencia u otra solicitud en la demanda?', ['No', 'Sí']],
    ['risk', 'Situación urgente', '¿Existe una situación urgente o de riesgo que requiera atención inmediata?', ['No', 'Sí']],
    ['applicantName', 'Nombre de solicitante', '¿Qué nombre ficticio tendrá la persona que presenta la demanda?'],
    ['applicantDocument', 'Documento de solicitante', '¿Qué documento de identidad ficticio usaremos?'],
    ['applicantAddress', 'Domicilio de solicitante', '¿Cuál es su domicilio ficticio?'],
    ['respondentName', 'Nombre de demandado', '¿Cómo se llama la persona demandada en este ejemplo?'],
    ['respondentAddress', 'Domicilio de demandado', '¿Cuál es su domicilio ficticio? Si lo desconoces, escribe «no sé».'],
    ['childrenCount', 'Número de menores', '¿Para cuántos menores se solicitan alimentos? Entre 1 y 5.', ['1', '2', '3']]
  ];
  for (let i = 0; i < (data.children?.length || 1); i++) items.push(
    [`childName-${i}`, `Nombre del menor ${i + 1}`, `¿Qué nombre ficticio tendrá el menor ${i + 1}?`],
    [`childDate-${i}`, `Nacimiento del menor ${i + 1}`, '¿Cuál es su fecha de nacimiento? Puedes escribir AAAA-MM-DD o DD/MM/AAAA.'],
    [`childRelation-${i}`, `Vínculo del menor ${i + 1}`, '¿Qué vínculo tiene con la persona demandada? Por ejemplo, hijo o hija.']
  );
  items.push(
    ['amount', 'Pensión mensual total', '¿Qué monto mensual total en soles deseas solicitar?'],
    ['facts', 'Hechos declarados', 'Cuéntame qué ocurrió y por qué se solicitarían alimentos. Puedes escribirlo con tus palabras.'],
    ['expenses', 'Necesidades y gastos', '¿Qué necesidades y gastos tienen los menores? Describe únicamente lo que conoces.'],
    ['evidence', 'Pruebas declaradas', '¿Qué pruebas o documentos ficticios tienes? Sepáralos con comas o escribe «ninguno».'],
    ['review', 'Revisión del resumen', 'Ya reunimos los datos. Abre «Mi documento», revisa el resumen y confirma si refleja lo que declaraste.', ['Sí, confirmo', 'Quiero corregir']]
  );
  return items.map(([id, label, question, choices = []]) => ({ id, label, question, choices }));
}

export const formatSteps = [
  { id: 'courtDistrict', label: 'Distrito judicial', question: '¿Qué distrito judicial pondremos? Si falta verificarlo, escribe «no sé».' },
  { id: 'applicantLocation', label: 'Ubicación de solicitante', question: 'Indica departamento, provincia y distrito ficticios separados por comas.' },
  { id: 'applicantPhone', label: 'Teléfono de contacto', question: '¿Qué teléfono ficticio usaremos? Puedes responder «no sé».' },
  { id: 'applicantEmail', label: 'Correo de contacto', question: '¿Qué correo ficticio usaremos? Puedes responder «no sé».' },
  { id: 'respondentDocument', label: 'Documento del demandado', question: '¿Qué documento ficticio tiene la persona demandada? Puedes responder «no sé».' }
];
export function allSteps(data) { return [...steps(data), ...formatSteps]; }
export function currentStep(data, state) {
  if (state.editing) return allSteps(data).find(x => x.id === state.editing);
  if (state.formatDetails) return formatSteps.find(x => !data.chatCompleted.includes(x.id));
  return steps(data).find(x => !data.chatCompleted.includes(x.id));
}
export function workflowBlock(data) {
  const done = id => data.chatCompleted.includes(id);
  if (done('consent') && !data.isFictional) return 'Esta versión solo permite una simulación con datos ficticios.';
  if (done('relation') && !['madre', 'padre'].includes(data.applicantRelation)) return 'Este supuesto necesita revisión profesional antes de elaborar un documento.';
  if (done('claims') && data.otherClaims) return 'Las pretensiones acumuladas necesitan otro flujo jurídico. Podemos seguir conversando y revisando la biblioteca.';
  if (done('risk') && data.urgentRisk) return 'Una situación urgente requiere atención humana. La elaboración del documento queda detenida.';
  const dateBlocks = evaluateCase(data).blocks.filter(x => /fecha|18 años/.test(x));
  return dateBlocks.join(' ');
}
export function stepValue(data, id) {
  if (id === 'consent') return data.isFictional ? 'Sí, datos ficticios' : 'No';
  if (id === 'relation') return data.applicantRelation;
  if (id === 'claims') return data.otherClaims ? 'Sí' : 'No';
  if (id === 'risk') return data.urgentRisk ? 'Sí' : 'No';
  if (id === 'childrenCount') return String(data.children.length);
  if (id.startsWith('childName-')) return data.children[Number(id.split('-')[1])]?.name;
  if (id.startsWith('childDate-')) return data.children[Number(id.split('-')[1])]?.birthDate;
  if (id.startsWith('childRelation-')) return data.children[Number(id.split('-')[1])]?.relationToRespondent;
  if (id === 'amount') return Number.isFinite(data.requestedAmount) ? `S/ ${data.requestedAmount}` : '';
  if (id === 'facts') return data.factDescription;
  if (id === 'expenses') return data.expenseDescription;
  if (id === 'evidence') return data.evidence.join(', ') || 'Ninguno';
  if (id === 'review') return data.reviewConfirmed ? 'Confirmado' : 'Pendiente';
  if (id === 'applicantLocation') return [data.applicantDepartment, data.applicantProvince, data.applicantDistrict].filter(Boolean).join(', ');
  if (id === 'respondentAddress' && data.respondentAddressUnknown) return 'Domicilio desconocido';
  return data[id] || '';
}

export function applyStep(raw, id, answer) {
  const data = normalizeCase(raw), value = String(answer || '').trim();
  if (!allSteps(data).some(step => step.id === id)) throw new Error('Ese dato no pertenece al formulario del piloto.');
  if (!value) throw new Error('Necesito una respuesta antes de registrar ese dato.');
  if (id === 'consent') data.isFictional = boolean(value);
  else if (id === 'relation') data.applicantRelation = /\b(madre|mama)\b/.test(plain(value)) ? 'madre' : /\b(padre|papa)\b/.test(plain(value)) ? 'padre' : 'otro';
  else if (id === 'claims' || id === 'risk') data[id === 'claims' ? 'otherClaims' : 'urgentRisk'] = boolean(value);
  else if (id === 'respondentAddress') { data.respondentAddressUnknown = isUnknown(value); data.respondentAddress = data.respondentAddressUnknown ? '' : value.slice(0, 220); }
  else if (id === 'childrenCount') {
    const count = ({ uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 })[plain(value)] || Number(value); if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('Indica entre 1 y 5 menores.');
    data.children = Array.from({ length: count }, (_, i) => data.children[i] || { name: '', birthDate: '', relationToRespondent: '' });
    data.chatCompleted = data.chatCompleted.filter(x => !/^child(Name|Date|Relation)-/.test(x) || Number(x.split('-')[1]) < count);
  } else if (id.startsWith('childDate-')) {
    let date = value;
    const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    if (local) date = `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Indica una fecha completa: AAAA-MM-DD o DD/MM/AAAA.');
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Esa fecha no es válida.');
    data.children[Number(id.split('-')[1])].birthDate = date;
  } else if (id.startsWith('childName-') || id.startsWith('childRelation-')) {
    data.children[Number(id.split('-')[1])][id.startsWith('childName-') ? 'name' : 'relationToRespondent'] = isUnknown(value) ? '' : value.slice(0, 120);
  } else if (id === 'amount') {
    const amount = Number(value.replace(/^S\/?\.?\s*/i, '').replace(/\b(soles|mensuales|mensual|al mes|por mes)\b/gi, '').trim().replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new Error('Indica un monto mensual válido en soles, por ejemplo 600.');
    data.requestedAmount = amount;
  } else if (id === 'facts') data.factDescription = isUnknown(value) ? '' : value.slice(0, 1600);
  else if (id === 'expenses') data.expenseDescription = isUnknown(value) ? '' : value.slice(0, 1200);
  else if (id === 'evidence') { data.evidence = isUnknown(value) ? [] : value.split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, 12); data.evidenceConfirmed = true; }
  else if (id === 'applicantLocation') {
    if (!isUnknown(value)) {
      const parts = value.split(',').map(x => x.trim());
      if (parts.length !== 3 || parts.some(x => !x)) throw new Error('Indica departamento, provincia y distrito separados por comas.');
      [data.applicantDepartment, data.applicantProvince, data.applicantDistrict] = parts;
    }
  } else if (id === 'review') {
    if (!boolean(value)) throw new Error('Puedes corregir cualquier dato desde «Mi documento». Después vuelve a confirmar.');
    if (!['consent', 'relation', 'claims', 'risk'].every(id => data.chatCompleted.includes(id))) throw new Error('Confirma primero los datos ficticios, la relación, las otras solicitudes y la situación de riesgo en el chat.');
    if (evaluateCase(data).status !== 'draft_ready') throw new Error('Aún hay datos pendientes o bloqueos. Revisa el resumen antes de confirmar.');
    data.reviewConfirmed = true;
  } else {
    if (id === 'applicantEmail' && !isUnknown(value) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Indica un correo válido para el ejemplo o escribe «no sé».');
    data[id] = isUnknown(value) ? '' : value;
  }
  if (!data.chatCompleted.includes(id)) data.chatCompleted.push(id);
  if (id !== 'review') { data.reviewConfirmed = false; data.chatCompleted = data.chatCompleted.filter(x => x !== 'review'); }
  return normalizeCase(data);
}

export function directAnswer(step, message) {
  if (!step) return false;
  if (step.choices?.some(x => plain(x) === plain(message))) return true;
  if (['consent', 'claims', 'risk', 'review'].includes(step.id)) return !/[?¿]/.test(message) && /^(si\b|no\b|confirmo\b)/.test(plain(message));
  if (step.id === 'relation') return /^(madre|padre|mama|papa|otra persona)$/.test(plain(message));
  if (step.id === 'childrenCount') return /^[1-5]$/.test(message);
  if (step.id === 'amount') return /^(?:S\/?\.?\s*)?\d+(?:[.,]\d{1,2})?$/.test(message);
  if (step.id.startsWith('childDate-')) return /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{4}$/.test(message);
  if (step.id === 'applicantDocument' || step.id === 'respondentDocument') return /^[A-Za-z0-9-]{5,30}$/.test(message);
  if (['respondentAddress', 'respondentDocument', 'evidence', 'courtDistrict', 'applicantPhone', 'applicantEmail', 'applicantLocation'].includes(step.id)) return isUnknown(message);
  return false;
}
