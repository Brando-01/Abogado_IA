import { answerQuestionWithGroq, isLegalQuestion } from './groq-chat.mjs';
import { topicSearch } from './legal-query.mjs';

// Recuperación léxica FTS5; no es una búsqueda semántica con embeddings.
export function retrieveContext(store, question, history = []) {
  const followUp = question.length < 90 && /^(y |eso|esa |ese |entonces|en ese|cu[aá]nt|por qu[eé]|c[oó]mo)/i.test(question.replace(/^[¿¡\s]+/, ''));
  const previous = followUp ? history.slice(-3).filter(turn => isLegalQuestion(turn.question || '')).map(turn => turn.question).join(' ') : '';
  const search = topicSearch(`${question} ${previous}`);
  const options = { requiredAny: search.requiredAny };
  const query = search.topic ? `${search.query} ${question} ${previous}` : `${question} ${previous}`;
  const primary = search.topic ? store.search(query, 24, ['core', 'support'], options) : [];
  const candidates = [...primary, ...store.search(query, 30, null, options)];
  const selected = [], perSource = new Map();
  for (const candidate of candidates) {
    const count = perSource.get(candidate.source_id) || 0;
    if (count >= 2 || selected.some(item => item.source_id === candidate.source_id && item.page === candidate.page)) continue;
    selected.push(candidate); perSource.set(candidate.source_id, count + 1);
    if (selected.length === 6) break;
  }
  return selected;
}
export async function askLibrary(store, question, history, config, fetchImpl) {
  const sources = retrieveContext(store, question, history);
  return answerQuestionWithGroq(question, sources, history, config, fetchImpl);
}
