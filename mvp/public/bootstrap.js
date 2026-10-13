const appUrl = 'http://127.0.0.1:4173/';

async function isAppServer(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return false;
    return (await response.json()).ok === true;
  } catch {
    return false;
  }
}

if (await isAppServer('/api/health')) {
  await import(`./${document.body.dataset.appModule || 'app.js'}`);
} else {
  try {
    // A static preview cannot serve the API. Check the local app without reading
    // its cross-origin response, then send the browser to the correct address.
    await fetch(`${appUrl}api/health`, { mode: 'no-cors', cache: 'no-store' });
    window.location.replace(appUrl);
  } catch {
    document.querySelector('#auth-title').textContent = 'Inicia el servidor local';
    document.querySelector('#auth-description').textContent = 'Esta vista previa solo muestra archivos. Abre una terminal en la carpeta mvp y ejecuta npm start.';
    document.querySelector('#auth-form').hidden = true;
    const link = document.createElement('a');
    link.href = appUrl;
    link.textContent = 'Abrir AbogadoIA en 127.0.0.1:4173';
    link.className = 'button button-primary primary';
    document.querySelector('#auth-error').replaceWith(link);
  }
}
