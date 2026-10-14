export async function api(route, options = {}) {
  const response = await fetch(route, { method: options.method || 'GET', headers: options.data === undefined ? {} : { 'Content-Type': 'application/json' }, body: options.data === undefined ? undefined : JSON.stringify(options.data), credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || `Error HTTP ${response.status}`), { status: response.status });
  return result;
}
export async function download(route, fileName) {
  const response = await fetch(route, { credentials: 'same-origin' });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'No se pudo descargar el archivo.'); }
  const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
  link.href = url; link.download = fileName; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
