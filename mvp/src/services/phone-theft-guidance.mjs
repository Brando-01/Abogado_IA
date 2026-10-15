import { normalizeQuery } from './legal-query.mjs';

// Curated practical guidance, reviewed 2026-10-15. No live web search or legal
// classification is implied. Keep these separate from the local PDF evidence.
export const phoneTheftSources = [
  { ref: 'O1', kind: 'official_web', title: 'PNP · Contacto y números de emergencia', url: 'https://www.gob.pe/institucion/pnp/contacto-y-numeros-de-emergencias', excerpt: 'La PNP publica el 105 como central de emergencia policial.' },
  { ref: 'O2', kind: 'official_web', title: 'Ministerio del Interior · Presentar una denuncia por robo', url: 'https://www.gob.pe/institucion/mininter/pages/706-presentar-una-denuncia-por-robo', excerpt: 'Orienta a denunciar ante la comisaría. Llamar previamente al 105 no es obligatorio para denunciar.' },
  { ref: 'O3', kind: 'official_web', title: 'OSIPTEL · Mi celu seguro', url: 'https://www.osiptel.gob.pe/portal-del-usuario/noticias/mi-celu-seguro-qu%C3%A9-hacer-si-te-roban-tu-celular-en-estas-fiestas-de-fin-de-a%C3%B1o/', excerpt: 'Recomienda proteger accesos bancarios, reportar el robo al operador para bloquear el equipo y suspender la línea, y denunciar ante la PNP.' },
  { ref: 'O4', kind: 'official_web', title: 'OSIPTEL · Bloqueo del equipo móvil por robo o pérdida', url: 'https://www.osiptel.gob.pe/portal-del-usuario/lo-que-debes-saber/derechos/', excerpt: 'Pide al operador el código de bloqueo y consérvalo.' }
].map(source => ({ ...source, reviewedAt: '2026-10-15' }));

export function phoneTheftGuidance(question, context) {
  if (context.topic !== 'theft' || !context.phone) return null;
  const text = normalizeQuery(question);
  // Statutes, sanctions, deadlines and legal requirements still go through RAG.
  if (/\b(articulo|ley|codigo|pena|penal|sancion|plazo|prescri\w*|requisito\w*|derecho\w*|obliga\w*|indemniza\w*|jurisprudencia)\b/.test(text)) return null;
  const help = /\b(robaron|roban|robado|robada|asaltaron|asalto|que hago|que hacer|procedo|proceder|denunci\w*|bloque\w*|paso a paso)\b/.test(text) || context.followUp;
  if (!help) return null;
  if (context.country !== 'PE') return {
    answer: `La guía que tengo verificada corresponde a Perú${context.countryName ? `; mencionas ${context.countryName}` : ''}. Si sigues en peligro, busca un lugar seguro y pide ayuda a los servicios de emergencia locales. Necesito una fuente oficial de ese país para indicarte un número o trámite concreto.\n\n${context.countryName ? '¿Estás ahora a salvo?' : '¿En qué país ocurrió el robo?'}`,
    engine: 'Orientación', grounding: 'location_needed', references: [], notice: 'No se aplicaron números ni trámites peruanos a otro país.'
  };
  const opening = context.violence === true
    ? `Entiendo: te robaron el celular${context.street ? ' en la calle' : ''} y hubo violencia.`
    : context.street ? 'Entiendo: te robaron el celular en la calle.' : 'Lamento lo que pasó con tu celular.';
  const safety = context.safe === true
    ? 'Me indicas que ya estás a salvo.'
    : 'Ponte a salvo y evita confrontar a quien te robó. Si necesitas intervención policial inmediata y estás en Perú, pide ayuda para llamar al 105 de la PNP desde otro teléfono. [O1]';
  let next;
  if (context.injured === true && !context.asked.includes('medical')) next = ['medical', 'Si estás herido/a, busca atención médica. ¿Tienes a alguien cerca que pueda acompañarte?'];
  else if (context.safe === null && !context.asked.includes('safety')) next = ['safety', '¿Estás ahora en un lugar seguro?'];
  else if (context.violence === null && !context.asked.includes('violence')) next = ['violence', '¿Te quitaron el celular con golpes o amenazas, o lo tomaron sin que lo notaras?'];
  else if (context.violence === true && context.injured === null && !context.asked.includes('injury')) next = ['injury', '¿Te lastimaron o necesitas atención médica?'];
  else if (!context.asked.includes('protection')) next = ['protection', '¿Ya pudiste reportarlo a tu operador y proteger tus accesos bancarios?'];
  else if (!context.asked.includes('report')) next = ['report', '¿Ya presentaste la denuncia o quieres ordenar lo ocurrido para explicarlo en la comisaría?'];
  const steps = !context.priorGuide
    ? 'Desde un equipo de confianza:\n1. Si tenías banca o billeteras en el celular, contacta a tu entidad por sus canales oficiales para bloquear tarjetas y accesos digitales. [O3]\n2. Reporta el robo a tu operadora para bloquear el equipo y suspender la línea. Pide y guarda el código de bloqueo. [O3, O4]\n3. Acude a una comisaría para denunciar el hecho; puedes hacerlo aunque no hayas llamado antes al 105. [O2]'
    : context.injured === true ? 'Podemos continuar con el reporte cuando hayas recibido ayuda.'
    : /denunci/.test(text) ? 'La orientación del Ministerio del Interior remite a la comisaría para presentar la denuncia. Podemos ordenar tu relato con el lugar, la hora aproximada y lo que recuerdas, sin completar datos que no hayas indicado. [O2]'
    : 'Si aún falta, reporta el robo a tu operadora para bloquear el equipo y suspender la línea, y protege tus accesos bancarios con tu entidad. Después puedes denunciar en la comisaría. [O2, O3, O4]';
  const answer = [opening, safety, steps, next?.[1]].filter(Boolean).join('\n\n');
  return { answer, engine: 'Guía práctica · Perú', grounding: 'official_guidance', practicalQuestion: next?.[0] || null,
    references: phoneTheftSources.filter(source => new RegExp(`\\b${source.ref}\\b`).test(answer)),
    notice: 'Orientación práctica basada en páginas oficiales, revisadas el 15/10/2026. Los artículos, plazos y la calificación jurídica requieren respaldo específico.' };
}
