export const normalizeQuery = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(?:pesion|pnesion|pencion)\b/g, 'pension').replace(/\bdemnda\b/g, 'demanda')
  .replace(/\b(?:voilenacia|voilencia|violencai|violenica)\b/g, 'violencia');

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

// Resolve from USER messages only. A short factual reply continues the current
// subject; an unrelated question closes it. Old assistant answers are not facts.
export function resolveConsultContext(question, history = []) {
  let current = { topic: null }, country = 'PE', countryName = 'Perú';
  for (const entry of [...history.filter(turn => turn.question), { question }]) {
    const text = normalizeQuery(entry.question).replace(/^[¿¡\s]+/, '').trim();
    if (/\b(?:fuera de|no (?:estoy|ocurrio) en) peru\b|\botro pais\b/.test(text)) { country = 'OTHER'; countryName = ''; }
    else {
      const foreign = text.match(/\b(?:en|desde) (chile|colombia|ecuador|bolivia|argentina|mexico|espana|estados unidos|ee\.?\s?uu\.?|brasil|venezuela)\b/);
      if (foreign) { country = 'OTHER'; countryName = foreign[1]; }
      else if (/\b(?:en|desde) (peru|lima|arequipa|cusco|cuzco|trujillo|piura)\b/.test(text)) { country = 'PE'; countryName = 'Perú'; }
    }
    const explicit = legalTopic(text);
    const reset = /\b(cambiemos de tema|otro tema|olvida (?:eso|lo anterior)|dejemos (?:eso|el robo))\b/.test(text);
    const followUpText = text.replace(/^y\s+/, '');
    const connector = text.length < 180 && /^(?:si\b|entonces\b|eso\b|esa\b|ese\b|en ese caso\b|(?:cuanto|cuando|por que)[?!. ]*$|cuanto (?:tiempo|tarda|debo)\b|como (?:(?:lo|se|puedo) )?(?:hago|hacer|sigo|procedo|denuncio)\b|que (?:sigue|hago|articulo|ley|pena|plazo|documentos|debo hacer)\b|donde denuncio\b)/.test(followUpText);
    const theftFact = current.topic === 'theft' && text.length < 220 && /^(?:(?:fue |si[, ]+)?(?:con|sin) (?:violencia|amenazas|arma|pistola|cuchillo)|(?:me )?(?:golpearon|amenazaron|pegaron|apuntaron)|(?:fue |estaba )?en (?:la calle|el bus|mi casa)|(?:si[, ]+)?(?:ya )?estoy (?:a salvo|segur[oa]|en casa)|no estoy (?:a salvo|segur[oa])|(?:no )?(?:me )?(?:lastimaron|hirieron)|(?:no )?(?:estoy )?herid[oa]|(?:ya |no )?(?:bloquee|denuncie)|(?:mi )?operador|(?:estoy |ocurrio |paso )?en (?:peru|chile|colombia|ecuador|bolivia|argentina|mexico|espana|lima)|no hubo violencia|no tengo (?:heridas|lesiones)|no me lastimaron)\b/.test(text);
    const yesNo = current.topic === 'theft' && current.lastQuestion && /^(si|no)[.! ]*$/.test(text);
    const continuation = !reset && current.topic && (!explicit || explicit === current.topic) && (connector || theftFact || yesNo || explicit === current.topic);
    if (!continuation) current = { topic: explicit, anchor: explicit ? entry.question.slice(0, 700) : '', phone: false, violence: null, safe: null, injured: null, asked: [], priorGuide: false };
    if (current.topic === 'theft') {
      current.phone ||= /\b(celular|telefono|movil|iphone|smartphone)\b/.test(text);
      current.street ||= /\ben la calle\b/.test(text);
      if (/\bsin (?:violencia|amenazas)\b|\bno hubo violencia\b/.test(text)) current.violence = false;
      else if (/\b(?:violencia|amenazas|golpearon|amenazaron|pegaron|apuntaron)|\bcon (?:arma|pistola|cuchillo)\b/.test(text)) current.violence = true;
      if (/\bno estoy (?:a salvo|segur[oa])\b/.test(text)) current.safe = false;
      else if (/\bestoy (?:a salvo|segur[oa]|en casa)\b/.test(text)) current.safe = true;
      if (/\bno (?:me )?(?:lastimaron|hirieron)|\bno (?:estoy herid[oa]|tengo (?:heridas|lesiones))\b/.test(text)) current.injured = false;
      else if (/\b(?:me (?:lastimaron|hirieron)|estoy herid[oa])\b/.test(text)) current.injured = true;
      if (yesNo && ['safety', 'violence', 'injury'].includes(current.lastQuestion)) current[{ safety: 'safe', violence: 'violence', injury: 'injured' }[current.lastQuestion]] = /^si\b/.test(text);
      if (entry.practicalQuestion) current.asked = [...new Set([...current.asked, entry.practicalQuestion])];
      if (entry.grounding === 'official_guidance') current.priorGuide = true;
      current.lastQuestion = entry.practicalQuestion || null;
    }
    current.followUp = Boolean(continuation);
  }
  return { ...current, country, countryName, retrievalQuestion: current.topic && current.followUp ? `${question} ${current.anchor}` : question };
}
