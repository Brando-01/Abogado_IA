export const PROCEDURE_CODE = 'ALIMENTOS_NNA';

export const FIELD_LABELS = {
  applicantName: 'Nombre de quien presenta la demanda',
  applicantDocument: 'Documento de identidad de quien presenta la demanda',
  applicantAddress: 'Domicilio de quien presenta la demanda',
  respondentName: 'Nombre de la persona demandada',
  respondentAddress: 'Domicilio conocido de la persona demandada',
  childName: 'Nombre de la niña, niño o adolescente',
  childBirthDate: 'Fecha de nacimiento de la niña, niño o adolescente',
  requestedAmount: 'Monto mensual solicitado',
  expenseDescription: 'Descripción de las necesidades y gastos',
  factDescription: 'Hechos que sustentan la solicitud'
};

const clean = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const money = value => Number.isFinite(Number(value)) ? Number(value) : NaN;

export function normalizeCase(raw = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const children = (Array.isArray(value.children) ? value.children : [{ name: value.childName, birthDate: value.childBirthDate }])
    .slice(0, 5).map(child => ({ name: clean(child?.name, 120), birthDate: clean(child?.birthDate, 20), relationToRespondent: clean(child?.relationToRespondent, 80) }));
  return {
    procedure: clean(value.procedure, 40),
    applicantRelation: clean(value.applicantRelation, 30),
    otherClaims: value.otherClaims === true,
    urgentRisk: value.urgentRisk === true,
    isFictional: value.isFictional === true,
    applicantName: clean(value.applicantName, 120),
    applicantDocument: clean(value.applicantDocument, 30),
    applicantAddress: clean(value.applicantAddress, 220),
    courtDistrict: clean(value.courtDistrict, 100),
    applicantDepartment: clean(value.applicantDepartment, 80),
    applicantProvince: clean(value.applicantProvince, 80),
    applicantDistrict: clean(value.applicantDistrict, 80),
    applicantPhone: clean(value.applicantPhone, 30),
    applicantEmail: clean(value.applicantEmail, 120),
    applicantElectronicMailbox: clean(value.applicantElectronicMailbox, 60),
    respondentName: clean(value.respondentName, 120),
    respondentDocument: clean(value.respondentDocument, 30),
    respondentAddress: clean(value.respondentAddress, 220),
    respondentAddressUnknown: value.respondentAddressUnknown === true,
    respondentDepartment: clean(value.respondentDepartment, 80),
    respondentProvince: clean(value.respondentProvince, 80),
    respondentDistrict: clean(value.respondentDistrict, 80),
    respondentEmployer: clean(value.respondentEmployer, 150),
    respondentOccupation: clean(value.respondentOccupation, 100),
    respondentIncome: clean(value.respondentIncome, 30),
    childName: children[0]?.name || '',
    childBirthDate: children[0]?.birthDate || '',
    children,
    requestedAmount: money(value.requestedAmount),
    expenseDescription: clean(value.expenseDescription, 1200),
    factDescription: clean(value.factDescription, 1600),
    evidence: Array.isArray(value.evidence) ? value.evidence.map(x => clean(x, 140)).filter(Boolean).slice(0, 12) : [],
    evidenceConfirmed: value.evidenceConfirmed === true,
    reviewConfirmed: value.reviewConfirmed === true,
    chatCompleted: Array.isArray(value.chatCompleted) ? value.chatCompleted.filter(x => typeof x === 'string' && /^[a-zA-Z0-9-]{1,30}$/.test(x)).slice(0, 64) : []
  };
}

export function evaluateCase(raw, { hasDocuments = false } = {}) {
  const data = normalizeCase(raw);
  const blocks = [];
  const missing = [];
  const warnings = [];

  if (!data.isFictional) blocks.push('Esta versión solo admite datos y documentos ficticios.');
  if (data.procedure !== PROCEDURE_CODE) blocks.push('El único procedimiento incluido en esta demo es la demanda inicial de alimentos para menores.');
  if (!['madre', 'padre'].includes(data.applicantRelation)) blocks.push('La relación indicada requiere revisión humana antes de continuar.');
  if (data.otherClaims) blocks.push('Las pretensiones acumuladas requieren un flujo jurídico distinto.');
  if (data.urgentRisk) blocks.push('Una situación urgente requiere orientación humana y no debe depender de esta demo.');

  for (const key of ['applicantName', 'applicantDocument', 'applicantAddress', 'respondentName', 'expenseDescription', 'factDescription']) {
    if (!data[key]) missing.push(FIELD_LABELS[key]);
  }
  if (!data.respondentAddress && !data.respondentAddressUnknown) missing.push(FIELD_LABELS.respondentAddress + ' o indicar que se desconoce');
  if (data.respondentAddressUnknown) warnings.push('El domicilio desconocido necesita una revisión específica del canal y los requisitos aplicables.');
  if (!Number.isFinite(data.requestedAmount) || data.requestedAmount <= 0) missing.push(FIELD_LABELS.requestedAmount);

  if (!data.children.length) missing.push('Datos de al menos una persona menor de edad');
  data.children.forEach((child, index) => {
    if (!child.name) missing.push(`Nombre del menor ${index + 1}`);
    if (!child.birthDate) missing.push(`Fecha de nacimiento del menor ${index + 1}`);
    if (child.birthDate) {
      const birthday = new Date(`${child.birthDate}T00:00:00`);
      if (Number.isNaN(birthday.getTime()) || birthday.toISOString().slice(0, 10) !== child.birthDate) {
        blocks.push(`La fecha de nacimiento del menor ${index + 1} no es válida.`);
      } else {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (birthday > today) blocks.push(`La fecha de nacimiento del menor ${index + 1} no puede estar en el futuro.`);
        const adultDate = new Date(birthday.getFullYear() + 18, birthday.getMonth(), birthday.getDate());
        if (adultDate <= today) blocks.push(`La persona ${index + 1} tiene 18 años o más; este flujo es solo para menores.`);
      }
    }
  });
  if (data.applicantDocument && !/^[A-Za-z0-9 -]{5,30}$/.test(data.applicantDocument)) {
    warnings.push('Revisa el formato del documento de identidad.');
  }
  if (data.evidence.length === 0 && !hasDocuments) warnings.push('No se registraron medios probatorios; revisa qué documentos existen antes de usar el borrador.');

  return {
    status: blocks.length ? 'blocked' : missing.length ? 'incomplete' : 'draft_ready',
    blocks,
    missing,
    warnings,
    legalReviewRequired: true,
    data
  };
}

export function createDraft(raw, options = {}) {
  const evaluation = evaluateCase(raw, options);
  if (evaluation.status !== 'draft_ready') return { ...evaluation, draft: null };
  const d = evaluation.data;
  return {
    ...evaluation,
    draft: {
      title: 'Borrador de simulación — demanda de alimentos para menor',
      notice: 'DEMOSTRACIÓN CON DATOS FICTICIOS. No presentar ante el Poder Judicial. Requiere revisión jurídica, del formulario y del canal correspondiente.',
      applicant: `${d.applicantName}, documento ${d.applicantDocument}, domicilio ${d.applicantAddress}`,
      respondent: `${d.respondentName}, domicilio ${d.respondentAddressUnknown ? '[indicado como desconocido; pendiente de revisión]' : d.respondentAddress}`,
      child: d.children.map(x => `${x.name}, fecha de nacimiento ${x.birthDate}`).join('; '),
      petition: `Se solicita una pensión mensual total de S/ ${d.requestedAmount.toFixed(2)} a favor de ${d.children.map(x => x.name).join(', ')}.`,
      facts: [d.factDescription, `Necesidades y gastos declarados: ${d.expenseDescription}`],
      evidence: d.evidence,
      legalBasis: 'Pendiente de revisión jurídica de artículos, vigencia y versión del formulario.',
      templateVersion: 'demo-0.1'
    }
  };
}
