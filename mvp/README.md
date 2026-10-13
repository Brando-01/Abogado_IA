# AbogadoIA MVP local

Aplicación local con **consulta libre a Groq sobre la biblioteca PDF** y entrevista guiada para preparar borradores de simulación de demandas iniciales de alimentos para niñas, niños y adolescentes en Perú. Incluye cuenta local, casos cifrados, hasta cinco menores, anexos privados, búsqueda por página en los PDF de `Data de Leyes`, sugerencias opcionales de Groq y descarga de un PDF A4.

## Inicio rápido

Requiere Node.js 24 o superior. Desde `mvp`:

```powershell
npm ci
npm start
```

Abre `http://127.0.0.1:4173` y crea la primera cuenta. La aplicación leerá automáticamente los PDF de `../Data de Leyes`; el avance aparece en la pantalla. La primera lectura puede tardar unos minutos, según el equipo. Los cambios posteriores pueden actualizarse con **Actualizar biblioteca**.

Abre siempre esa dirección para usar la aplicación. Una vista previa estática como Live Server (`127.0.0.1:5500/public/`) no ejecuta la API; ahora redirige al servidor local si está encendido y, si no, muestra cómo iniciarlo.

La pantalla principal abre en **Consulta libre**: puedes preguntar con tus palabras. La aplicación busca fragmentos pertinentes en SQLite, envía a Groq la pregunta y hasta seis extractos, y muestra archivo y página de las referencias que el modelo seleccione. El historial se cifra en SQLite y puede borrarse desde la interfaz. Marca la casilla de envío a Groq; no incluyas datos personales. **Preparar demanda de prueba** abre el flujo guiado. Cada respuesta se guarda en el caso y la conversación se reconstruye al volver a abrirlo. El panel derecho muestra el avance, permite corregir respuestas, adjuntar archivos y revisar el resumen antes del borrador. El [formulario avanzado](public/formulario.html) queda como editor alternativo del mismo caso.

Para instalar en otra computadora, consulta la [guía de clonación](../README.md).

## Clave de Groq

Copia [`.env.example`](.env.example) a `.env` y pega tu clave después del signo igual:

```text
GROQ_API_KEY=tu_clave_aqui
```

La clave se actualiza desde `.env` al consultar Groq, sin reiniciar el servidor. Se lee solo en el servidor y **no se envía al navegador**. El botón **Pedir sugerencia a Groq** envía el relato y los fragmentos recuperados con sustitución de nombres, domicilios y documento conocidos por seudónimos. La redacción recibida se muestra para revisión; solo entra en el caso cuando pulsas **Aplicar y revisar**. Después debes volver a confirmar el resumen. No pegues datos reales en el relato: la seudonimización automática no puede detectar todos los identificadores.

Si la clave está vacía, la consulta libre y la sugerencia dejan un error claro; entrevista, casos, búsqueda local, anexos y PDF siguen funcionando.

## SQLite y los PDF

SQLite **ya es la base de datos** de este MVP (`mvp/private/abogadoia.sqlite`). Guarda usuarios, sesiones, casos cifrados, historial cifrado de consultas y un índice FTS5 de los PDF. No necesitas instalar PostgreSQL para ejecutar esta versión local. Para una copia sencilla, detén el servidor antes de copiar `mvp/private/`; con el servidor activo usa una copia de seguridad de SQLite en vez de copiar solo el archivo `.sqlite`.

Los PDF no se envían completos a Groq ni se convierten manualmente a Word. El servidor extrae texto por página, lo divide en fragmentos y los indexa; cada pregunta recupera solo los más relevantes. Actualmente hay 23 PDF registrados, 20 con texto buscable. Los tres restantes no tienen texto extraíble y requieren OCR para entrar en las respuestas. El índice no garantiza vigencia jurídica ni convierte los fragmentos en citas aprobadas.

## Funciones incluidas

- La primera cuenta se crea desde la web; después se inicia sesión con correo y contraseña. Las contraseñas se derivan con `scrypt` y los casos/anexos se cifran con AES-256-GCM en `mvp/private/`.
- Las reglas deterministas bloquean procedimientos fuera del piloto, pretensiones acumuladas, situaciones urgentes y personas adultas. Permiten marcar el domicilio de la persona demandada como desconocido con advertencia.
- Los casos y anexos se guardan localmente. Cada anexo admite PDF, PNG o JPEG de hasta 5 MB. Los archivos se descargan desde el caso correspondiente.
- Se indexan todos los PDF de `Data de Leyes` con SQLite FTS5. Cada resultado muestra archivo y página. Los PDF sin capa de texto figuran con una advertencia de OCR.
- El borrador y el PDF incluyen solo hechos y montos declarados. La lista de anexos del PDF incluye únicamente archivos cargados. Los fragmentos recuperados aparecen **sin aprobación jurídica**.
- El PDF lleva la marca **SIMULACIÓN - NO PRESENTAR**. No se firma ni se envía a ningún portal judicial.
- **Formatos por entidad** identifica dos versiones del Poder Judicial para la demanda inicial de alimentos de menores: la incorporada en la R. A. 000111-2024-CE-PJ, con datos ficticios superpuestos y hoja de continuación, y el ejemplar del portal de formatos, como referencia sin completar. Ambos incluyen enlace a su fuente y la indicación del destino y canal por verificar. Otros procedimientos de la carpeta no se ofrecen como formatos equivalentes.
- El panel **Continuar el trámite** enlaza al catálogo y a los tutoriales oficiales del Poder Judicial. No presenta un escrito ni verifica la aceptación de la Mesa de Partes.
- El PDF requiere confirmación explícita del resumen. El chat detiene la entrevista si el caso está fuera del alcance o indica riesgo urgente.

## Pruebas

```powershell
npm test
```

Para rehacer el índice por línea de comandos:

```powershell
npm run ingest
```

## Límites antes de casos reales

Esta versión está configurada para **datos ficticios**. No prueba que un nombre ingresado sea ficticio. No se ha aprobado la vigencia artículo por artículo, la competencia, los requisitos del canal de presentación ni la adaptación completa del formulario de 2024. La sugerencia de Groq no se usa como autoridad jurídica. Tres PDF de la carpeta carecen de texto extraíble y necesitan OCR si se quieren buscar.

El chat implementa el recorrido conversacional del piloto, pero no cubre todavía las 40 historias de usuario del plan. Por ejemplo, faltan administración/versionado jurídico de fuentes, citas con artículos y URL aprobados, validación de malware, política de conservación y revisión profesional. La consulta libre usa Groq con fragmentos recuperados de la biblioteca; la entrevista para la demanda sigue reglas controladas y Groq también puede sugerir redacción. La superposición de datos sobre la R. A. conserva texto preimpreso, casillas y espacios que aún requieren revisión humana; la hoja adicional conserva el relato completo.

El estado verificable de cada historia está en [HU_ESTADO.md](HU_ESTADO.md).

La base es SQLite local para que el piloto funcione sin credenciales externas; el plan de producción propone PostgreSQL. Antes de abrir el servicio al público faltan revisión jurídica profesional, revisión de protección de datos de menores y proveedores, análisis de transferencia internacional, antivirus para archivos, política de retención y borrado, copias de seguridad, pruebas de seguridad y despliegue con HTTPS. No expongas este servidor local a Internet ni lo uses con expedientes reales.
