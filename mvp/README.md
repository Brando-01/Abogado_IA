# AbogadoIA · Chat y documentos

Un solo chat para conversar de cualquier tema, consultar la biblioteca PDF y preparar una simulación de demanda inicial de alimentos para menores en Perú. La demanda se vincula a la conversación: puedes hacer una pregunta durante la preparación, retomar el documento, corregir datos y descargar el PDF sin cambiar de chat.

## Inicio

Requiere Node.js 24 o superior. La [guía de clonación](../README.md) explica la instalación en otra computadora.

```powershell
cd mvp
npm ci
Copy-Item .env.example .env
```

Edita `.env`, coloca `GROQ_API_KEY=tu_clave` y ejecuta `npm start`. Abre `http://127.0.0.1:4173/`. Si ya estás en la carpeta `mvp`, omite `cd mvp`. En Linux/macOS usa `cp .env.example .env`. No abras `public/` con Live Server: la aplicación necesita su API Node.

La clave se lee solo en el servidor, se actualiza al editar `.env` y está excluida de Git. El selector `GROQ_MODEL` tiene por defecto `openai/gpt-oss-120b`. Los modelos GPT OSS compatibles utilizan salida JSON con esquema estricto; otros modelos usan modo JSON con validación local. Si Groq rechaza la clave, supera su límite o falla la conexión, el chat muestra la causa sin exponer la clave.

## Cómo usar el chat

- Crea la cuenta inicial o inicia sesión. Las conversaciones anteriores y los casos se importan a la nueva estructura al primer acceso.
- Escribe y envía directamente: no hay una casilla que activar. Al enviar, Groq procesa el mensaje y los extractos recuperados. Un aviso breve identifica ese uso. La respuesta muestra si proviene de Groq o de un control local.
- Escribe una pregunta general o jurídica. En respuestas jurídicas, abre **Ver respaldo** para leer las citas literales y abrir el PDF original en su página.
- Pulsa **Preparar una demanda** o solicita un documento en el chat. Primero se aclara el asunto y se confirma explícitamente **alimentos para menores** antes de crear el caso. Preguntas como «cómo procedo si me robaron el celular» siguen siendo consultas; mencionar «demanda» no activa una entrevista de alimentos. La preparación requiere datos ficticios.
- Puedes declarar varios datos en un mensaje. Groq propone los campos y el servidor comprueba que cada valor proceda literalmente del mensaje; los incorpora solo después de que confirmes la propuesta. Las opciones de sí/no, los montos y fechas simples se validan localmente.
- Sin clave de Groq, el documento puede completarse paso a paso con respuestas literales confirmadas localmente. La interpretación de varios datos y la conversación libre requieren la IA.
- Puedes preguntar cualquier cosa durante el proceso. **Pausar** y **Retomar** controlan la entrevista; los datos permanecen guardados. **Mi documento** muestra el resumen y permite corregirlo desde el chat.
- Completa el caso y confirma el resumen antes del PDF. Cambiar un dato o los anexos invalida esa confirmación. Los formatos del Poder Judicial se seleccionan en el mismo panel; sus datos adicionales se piden en el chat.

El diseño usa una conversación central, un menú de historial y un panel de documento que se abre cuando lo necesitas. En celular, el menú y el documento se presentan como paneles sobre el chat; el cuadro de mensaje permanece al pie. Los diálogos y los controles admiten teclado.

## Voz y dictado

El diálogo usa un **personaje Rive original** con estados de escuchar, pensar, hablar, celebrar, silenciado y error. Mueve cabeza y brazos, parpadea y abre la boca siguiendo el audio real de la respuesta. Pulsa **Ver cómo se mueve** para probarlo sin encender el micrófono: se reproduce la última respuesta del chat y no se envía un mensaje nuevo. El archivo animado ya viene en el repositorio; `npm ci` instala su reproductor. Consulta [las fuentes y la recompilación del personaje](animations/assistant/README.md).

En `mvp/.env`, añade tu configuración privada:

```dotenv
FISH_AUDIO_API_KEY=tu_clave
FISH_AUDIO_VOICE_ID=id_de_tu_voz
FISH_AUDIO_MODEL=s2.1-pro-free
VOICE_STT_PROVIDER=groq
GROQ_STT_MODEL=whisper-large-v3-turbo
```

Se admiten también `FISH_API_KEY`, `FISH_VOICE_ID` y `FISH_REFERENCE_ID`. La configuración se vuelve a leer al usar la voz. Por defecto, **Groq transcribe el micrófono** con tu `GROQ_API_KEY` y el modelo `whisper-large-v3-turbo`; **Fish Audio genera la voz** con `s2.1-pro-free` y tu ID. No se usa el servicio ASR de Fish en esta configuración. Los límites o costos de Groq y Fish dependen de sus cuentas y modelos; el modelo Free de Fish para generar voz no convierte su servicio de transcripción en gratuito. Puedes elegir explícitamente `VOICE_STT_PROVIDER=fish` para transcribir con `transcribe-1-pro` si tu cuenta de Fish dispone de crédito de API. No se cambia de proveedor automáticamente ante un error.

- **Voz** abre el personaje. Pulsa **Iniciar conversación**, autoriza el micrófono y habla. Después de una pausa de aproximadamente 1,3 segundos se transcribe tu mensaje, se envía al mismo chat y se reproduce la respuesta con tu voz configurada. La máquina de estados de Rive cambia los gestos según el paso de la conversación; Web Audio controla la apertura de la boca con el volumen real de Fish. Cerrar la interacción libera la captura, el audio y la instancia de Rive.
- **Apagar micrófono** libera la captura; **Activar micrófono** la retoma. **Interrumpir respuesta** detiene la reproducción. **Terminar**, cerrar el diálogo, cambiar de conversación o pasar la aplicación a segundo plano detiene la interacción y libera el micrófono. Una respuesta del chat ya solicitada puede terminar y quedar guardada aunque hayas terminado la voz.
- El botón de **micrófono** junto a **Voz** permite dictar y pulsar **Usar dictado**. El texto queda en el cuadro de mensaje para revisarlo y enviarlo con el botón habitual.
- Si el navegador bloquea la reproducción automática, pulsa **Escuchar respuesta**. Si deniega el micrófono, habilítalo en sus permisos.

La interacción es continua **por turnos**, con latencia de transcripción, Groq y síntesis; no es audio bidireccional simultáneo. La captura se pausa mientras se procesa o reproduce una respuesta. Cada grabación dura hasta 45 segundos y tiene un límite de 5 MB. El audio se procesa en memoria, sin guardarlo en SQLite ni en archivos. **Con la configuración por defecto, Groq recibe el audio del micrófono y el texto del chat; Fish Audio recibe el texto de las respuestas para ponerles voz.** Si eliges `VOICE_STT_PROVIDER=fish`, Fish recibe también el audio. El diálogo indica el proveedor al iniciar. Si cambia mientras grabas, se rechaza el envío hasta que reinicies la interacción. El manejo de datos de esos proveedores depende de sus políticas. Las transcripciones pueden equivocarse: revisa los datos del documento antes de confirmarlos.

Usa un navegador actualizado con micrófono (Chrome, Edge o Safari). En esta computadora funciona con `localhost` o `127.0.0.1`. **En un celular conectado por una dirección IP local necesitas HTTPS** para que el navegador habilite el micrófono. No basta con abrir una IP por HTTP. No hay que instalar paquetes de audio, PostgreSQL ni convertir las grabaciones manualmente.

Contratos de API: [transcripción de Groq](https://console.groq.com/docs/speech-to-text), [transcripción opcional de Fish Audio](https://docs.fish.audio/features/speech-to-text) y [síntesis de voz](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech).

### Si la voz falla con 402

El modelo `s2.1-pro-free` corresponde a **texto a voz**, no a reconocimiento del micrófono. Si `/api/voice/transcribe` falla con 402 de Fish aunque uses ese modelo Free, configura `VOICE_STT_PROVIDER=groq` para transcribir con tu clave de Groq. Si elegiste ASR de Fish o un modelo de voz que exige crédito, revisa el [panel de desarrolladores y saldo de API](https://fish.audio/app/developers): ese crédito se administra por separado del saldo de la plataforma. La aplicación lee cambios de `.env` al iniciar de nuevo la voz. Si modificas código del servidor, sí debes reiniciar `npm start` y recargar la página.

## Cómo funciona el RAG

1. El servidor lee los PDF de `../Data de Leyes`, extrae texto por página y lo divide en fragmentos con un pequeño solapamiento.
2. SQLite FTS5 indexa ese texto. La recuperación es **léxica**, no utiliza embeddings ni un servicio de vectores externo. Conserva el tema de preguntas cortas de seguimiento y limita repeticiones de páginas y fuentes. Reconoce algunas variantes como «pesion» y busca términos de alimentos en consultas sobre pensión; en consultas sobre robo exige coincidencias del tema y evita traer formularios de alimentos solo por la palabra «demanda». Prioriza normas frente a formularios. Si falta respaldo, pregunta por datos concretos del asunto sin inventar una conclusión jurídica ni iniciar una demanda automáticamente.
3. Groq recibe la pregunta, un historial limitado y hasta seis fragmentos. No recibe todos los PDF completos. Las instrucciones le exigen tratar los documentos como datos, usar solo esos extractos para afirmaciones jurídicas y reconocer información insuficiente.
4. La respuesta jurídica incluye afirmaciones, identificadores de fuente y citas literales. El servidor comprueba que las referencias existan y que las citas estén dentro del texto enviado; descarta cada afirmación cuya comprobación falle. Si quedan afirmaciones comprobadas, muestra únicamente esas y marca el respaldo como parcial; si no queda ninguna, muestra información insuficiente con una aclaración relacionada con el asunto.
5. La interfaz permite revisar archivo, página y cita en el PDF original. Las consultas generales pueden responderse sin referencias jurídicas.

**No existe una garantía de cero alucinaciones.** El esquema estricto controla la estructura de la respuesta, no su verdad. Comprobar una cita literal acredita su presencia en el extracto; no prueba que el modelo la haya interpretado correctamente. La recuperación puede omitir una norma relevante y la biblioteca no tiene todavía un catálogo de vigencia aprobado. La interpretación, vigencia y suficiencia jurídica requieren revisión profesional.

La carpeta contiene 23 PDF; 20 tenían texto buscable en la comprobación local. Los tres sin texto requieren OCR. No necesitas transformarlos manualmente a Word. Puedes añadir PDF con texto a `Data de Leyes/` y pulsar **Actualizar biblioteca**, o ejecutar `npm run ingest`. Los anexos de casos son archivos privados para el borrador; no se incorporan automáticamente al índice jurídico ni se envían como PDF a Groq.

## Estructura del código

```text
server.mjs                  HTTP, autenticación y rutas
src/chat/conversation.mjs   Conversación, acciones y confirmación de datos
src/chat/workflow.mjs       Preguntas y validación del formulario
src/services/rag.mjs        Recuperación de contexto desde FTS5
src/services/groq-chat.mjs  Prompts, esquema JSON y comprobación de respaldo
src/storage.mjs             SQLite, cifrado y aislamiento por usuario
src/ingest.mjs              Extracción e indexación de los PDF
src/procedure.mjs           Evaluación del caso y borrador determinista
src/pdf.mjs                 PDF de simulación y vista sobre formato oficial
public/chat.js              Coordinación de la interfaz unificada
public/js/                  Cliente HTTP y presentación de mensajes
tests/                      Pruebas del recorrido y de los controles
```

El editor `public/formulario.html` y las rutas antiguas se conservan por compatibilidad; el recorrido principal es el chat unificado.

## Datos y alcance

SQLite ya está incluido a través de Node (`node:sqlite`). La aplicación crea `private/abogadoia.sqlite` y `private/server.key`; no necesita PostgreSQL. Usuarios, sesiones y fuentes se guardan en SQLite; casos, conversaciones, mensajes y anexos se cifran con AES-256-GCM. Las contraseñas se derivan con `scrypt`. `.env`, `private/`, dependencias y archivos generados están excluidos de Git.

Para trasladar los datos, detén el servidor y copia `private/` completo de forma privada, incluido `server.key`. Con el servidor activo usa una copia de seguridad consistente de SQLite. Eliminar una conversación elimina sus mensajes, caso vinculado y anexos; no hay recuperación desde la interfaz.

Los anexos admiten PDF, PNG y JPEG de hasta 5 MB, con comprobación básica de firma; falta antivirus. El piloto admite hasta cinco menores, exige confirmación del resumen y bloquea supuestos fuera del alcance, pretensiones acumuladas, urgencia y personas adultas. El PDF usa únicamente datos declarados y lleva **SIMULACIÓN - NO PRESENTAR**. Los formatos disponibles corresponden a dos versiones del Poder Judicial para alimentos de menores; su canal, competencia y adaptación requieren revisión. No hay presentación automática.

El estado de las 40 historias y los pendientes está en [HU_ESTADO.md](HU_ESTADO.md). La aplicación no está habilitada para expedientes reales ni exposición pública: siguen pendientes aprobación jurídica de normas y plantillas, protección de datos, retención, antivirus, auditoría por documento, seguridad y HTTPS.

## Verificación

```powershell
npm test
```

Las pruebas cubren el hilo unificado (consulta → demanda → confirmación → PDF → corrección), aislamiento y cifrado, respaldo ausente o inventado, extracción de datos no declarados, reanudación, anexos y formatos.
