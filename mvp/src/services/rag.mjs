import { answerQuestionWithGroq } from './groq-chat.mjs';
import { topicSearch, resolveConsultContext } from './legal-query.mjs';
import { phoneTheftGuidance } from './phone-theft-guidance.mjs';

// Recuperación léxica FTS5; no es una búsqueda semántica con embeddings.
export function retrieveContext(store, question, history = []) {
  const resolved = resolveConsultContext(question, history);
  const search = topicSearch(resolved.retrievalQuestion);
  const options = { requiredAny: search.requiredAny };
  const query = search.topic ? `${search.query} ${resolved.retrievalQuestion}` : resolved.retrievalQuestion;
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
  const guidance = phoneTheftGuidance(question, resolveConsultContext(question, history));
  if (guidance) return guidance;
  const sources = retrieveContext(store, question, history);
  return answerQuestionWithGroq(question, sources, history, config, fetchImpl);
}
