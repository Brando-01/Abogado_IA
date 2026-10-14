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
- Activa **Permitir que Groq procese mis mensajes de prueba** para conversar con la IA. La respuesta muestra si proviene de Groq o de un control local.
- Escribe una pregunta general o jurídica. En respuestas jurídicas, abre **Ver respaldo** para leer las citas literales y abrir el PDF original en su página.
- Pulsa **Preparar una demanda** o escribe que quieres preparar una demanda de alimentos. La preparación empieza en ese mismo hilo y requiere datos ficticios.
- Puedes declarar varios datos en un mensaje. Groq propone los campos y el servidor comprueba que cada valor proceda literalmente del mensaje; los incorpora solo después de que confirmes la propuesta. Las opciones de sí/no, los montos y fechas simples se validan localmente.
- Sin clave de Groq, el documento puede completarse paso a paso con respuestas literales confirmadas localmente. La interpretación de varios datos y la conversación libre requieren la IA.
- Puedes preguntar cualquier cosa durante el proceso. **Pausar** y **Retomar** controlan la entrevista; los datos permanecen guardados. **Mi documento** muestra el resumen y permite corregirlo desde el chat.
- Completa el caso y confirma el resumen antes del PDF. Cambiar un dato o los anexos invalida esa confirmación. Los formatos del Poder Judicial se seleccionan en el mismo panel; sus datos adicionales se piden en el chat.

El diseño usa una conversación central, un menú de historial y un panel de documento que se abre cuando lo necesitas. En celular, el menú y el documento se presentan como paneles sobre el chat; el cuadro de mensaje permanece al pie. Los diálogos y los controles admiten teclado.

## Cómo funciona el RAG

1. El servidor lee los PDF de `../Data de Leyes`, extrae texto por página y lo divide en fragmentos con un pequeño solapamiento.
2. SQLite FTS5 indexa ese texto. La recuperación es **léxica**, no utiliza embeddings ni un servicio de vectores externo. Conserva el tema de preguntas cortas de seguimiento y limita repeticiones de páginas y fuentes.
3. Groq recibe la pregunta, un historial limitado y hasta seis fragmentos. No recibe todos los PDF completos. Las instrucciones le exigen tratar los documentos como datos, usar solo esos extractos para afirmaciones jurídicas y reconocer información insuficiente.
4. La respuesta jurídica incluye afirmaciones, identificadores de fuente y citas literales. El servidor comprueba que las referencias existan y que las citas estén dentro del texto enviado; si esa comprobación falla, muestra una respuesta de información insuficiente.
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
