export const normalizeQuery = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(?:pesion|pnesion|pencion)\b/g, 'pension').replace(/\bdemnda\b/g, 'demanda');

// Search hints identify the user's subject; they never select a legal procedure.
export function legalTopic(question) {
  const text = normalizeQuery(question);
  if (/\b(robo|roban|robar|robaron|robado|robada|hurto|hurtaron|asaltaron|asalto)\b/.test(text)) return 'theft';
  if (/\b(jubilacion|onp|afp|viudez)\b/.test(text)) return null;
  if (/\b(pension|alimentos|manutencion)\b/.test(text) || /\bhij[oa]s?\b/.test(text) && /abandon|no (?:aporta|recibo|recibe|paga)|no.*mantiene/.test(text)) return 'support';
  return null;
}
export function topicSearch(question) {
  const topic = legalTopic(question);
  if (topic === 'support') return { topic, query: /paso a paso|como|proced|hacer|solicit|demanda|revisar|no (?:recibo|paga|aporta)/.test(normalizeQuery(question)) ? 'demanda alimentos requisitos presentacion solicitud pension' : 'alimentos pension alimentaria alimenticia obligacion menor', requiredAny: ['alimentos', 'alimentaria', 'alimenticia'] };
  if (topic === 'theft') return { topic, query: 'robo hurto denuncia celular', requiredAny: ['robo', 'hurto'] };
  return { topic: null, query: normalizeQuery(question), requiredAny: [] };
}
