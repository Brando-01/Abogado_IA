const plain = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Una consulta puede mencionar «hacer una demanda» sin pedir que se cree un caso.
// Solo una petición directa abre la selección; el procedimiento se confirma aparte.
export function draftIntent(message, choosingType = false) {
  const text = plain(message).replace(/^[¿¡\s]+/, '');
  const question = /[¿?]/.test(message) || /^(dime|explica|explicame|cuentame|como|que|cual|cuando|donde|por que|si |puedo|es posible|se puede)\b/.test(text) ||
    /^(quiero|necesito|deseo) (saber|entender|conocer|consultar|informarme|informacion|orientacion|asesoria)\b/.test(text) ||
    /^ayudame a (saber|entender|conocer)\b/.test(text);
  const direct = /^(?:por favor[ ,]+)?(?:quiero|necesito|deseo|me gustaria|ayudame a|hazme|redacta(?:me)?|prepara(?:me)?|crea(?:me)?|genera|elabora|vamos a)\b/.test(text) && /\b(demanda|documento|borrador|escrito|denuncia|querella|solicitud)\b/.test(text);
  if (question || !direct && !choosingType) return 'consult';
  if (/\b(robo|robaron|robado|robada|hurto|denuncia|divorcio|laboral|desalojo|filiacion|tenencia|adultos?|mayores)\b/.test(text)) return direct ? 'other_document' : 'consult';
  if (/\balimentos\b/.test(text) && !/\bno (?:es|quiero|necesito|busco).*\balimentos\b/.test(text)) return 'confirm_alimentos';
  return direct ? 'choose_document' : 'consult';
}

export const procedureConfirmation = () => ({
  answer: 'El documento disponible es una simulación de demanda inicial de alimentos para menores. ¿Ese es el procedimiento que quieres preparar?',
  proposedProcedure: 'ALIMENTOS_NNA',
  actions: [{ id: 'confirm_procedure', label: 'Sí, alimentos para menores' }, { id: 'cancel_procedure', label: 'No, seguir conversando' }]
});
