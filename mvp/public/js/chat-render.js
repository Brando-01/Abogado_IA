export const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const prose = text => esc(text).split(/\n\n+/).map(paragraph => `<p>${paragraph.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`).join('');
export function appendMessage(container, role, text, turn = {}, active = true) {
  const node = document.createElement('article'); node.className = `message ${role}`;
  node.innerHTML = `<div class="avatar" aria-hidden="true">A</div><div class="message-content"><div class="message-meta">AbogadoIA ${turn.engine ? `<span class="engine-label">${esc(turn.engine)}</span>` : ''}</div><div class="bubble">${role === 'user' ? esc(text) : prose(text)}</div></div>`;
  const content = node.querySelector('.message-content');
  if (turn.proposals?.length) content.insertAdjacentHTML('beforeend', `<div class="proposal-list">${turn.proposals.map(item => `<div class="proposal-row"><strong>${esc(item.label)}</strong><span>${esc(item.value)}</span></div>`).join('')}</div>`);
  if (turn.references?.length) content.insertAdjacentHTML('beforeend', `<details class="reference-details"><summary>▤ Ver respaldo en ${turn.references.length} ${turn.references.length === 1 ? 'fuente' : 'fuentes'}</summary>${turn.references.map(ref => `<div class="reference-item"><strong>${esc(ref.ref)} · ${esc(ref.title)} · Página ${esc(ref.page)}</strong>${(ref.quotes || []).map(quote => `<blockquote>${esc(quote)}</blockquote>`).join('')}<p>${esc(ref.excerpt)}</p>${ref.sourceId ? `<a href="/api/sources/${encodeURIComponent(ref.sourceId)}/pdf#page=${Number(ref.page) || 1}" target="_blank" rel="noopener noreferrer">Abrir PDF original ↗</a>` : ''}</div>`).join('')}</details>`);
  if (turn.notice) content.insertAdjacentHTML('beforeend', `<small class="response-note">${esc(turn.notice)}</small>`);
  if (turn.actions?.length) content.insertAdjacentHTML('beforeend', `<div class="turn-actions">${turn.actions.map(action => `<button type="button" data-action="${esc(action.id)}" ${action.value ? `data-value="${esc(action.value)}"` : ''} ${!active && ['confirm_data', 'reject_data', 'answer', 'confirm_review'].includes(action.id) ? 'disabled' : ''}>${esc(action.label)}</button>`).join('')}</div>`);
  container.append(node); return node;
}
