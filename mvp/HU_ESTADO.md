# Estado frente a las 40 historias de usuario del plan

Fecha de revisión: 2026-10-15. Este registro distingue la función observable de los criterios de aceptación completos. **Parcial** significa que falta al menos una condición del documento. La ejecución actual es un laboratorio local con datos ficticios; ninguna historia implica aprobación jurídica o habilitación para presentar demandas reales.

Función adicional: voz por turnos y dictado en el mismo chat; Groq transcribe y responde, Fish Audio genera la voz. Incluye animación reactiva a las muestras reales del audio, chat directo sin casilla de activación, apagado del micrófono, interrupción de respuesta y cierre. Requiere claves de Groq y Fish, ID de voz, permisos del navegador y HTTPS en celulares remotos. ASR de Fish es opcional y utiliza un crédito distinto del modelo Free de texto a voz. No habilita otros procedimientos ni elimina las confirmaciones del documento. Las pruebas con API real y audio sintético deben distinguirse de la verificación con micrófono físico.

| HU | Estado | Evidencia o pendiente principal |
|---|---|---|
| 01 Alcance y límites | Parcial | Aviso visible y confirmación de datos ficticios; falta consentimiento informado y política aprobada. |
| 02 Cuenta y sesión | Parcial | Alta inicial, login y cookie persistente; falta recuperación de cuenta. |
| 03 Caso independiente | Parcial | UUID, propietario, fechas y aislamiento por usuario; falta estado explícito versionado. |
| 04 Procedimiento disponible | Implementada para piloto | Lista blanca de una demanda inicial de alimentos para menores. |
| 05 Hechos en lenguaje natural | Parcial | Groq extrae varios datos con valor y cita literal del mensaje, sujetos a confirmación; falta un registro jurídico de procedencia completo. |
| 06 Confirmar clasificación | Parcial | Distingue consulta de petición directa; pregunta el asunto y confirma explícitamente alimentos para menores antes de crear un caso. Falta clasificación jurídica administrable para otros procedimientos. |
| 07 Caso no soportado | Implementada | Las reglas detienen el flujo y la generación. |
| 08 Admite autogestión | Pendiente | Falta regla jurídica aprobada con fecha, alcance y fuente. |
| 09 Preguntas comprensibles | Implementada para piloto | Chat guiado, una pregunta por turno. |
| 10 Respuesta libre | Parcial | Un solo chat acepta consultas y datos; extracción JSON validada con propuestas confirmables. Faltan criterios exhaustivos de interpretación. |
| 11 Retomar caso | Implementada | Historial y estado del documento cifrados en SQLite; pausa y reanudación en el mismo hilo. |
| 12 Pendientes | Parcial | Checklist y datos faltantes; faltan condiciones jurídicas configurables. |
| 13 Corrección | Implementada para piloto | Corregir desde el chat o cambiar anexos invalida la confirmación y reevalúa. |
| 14 Resumen | Implementada | Vista de datos y confirmación explícita antes del PDF. |
| 15 Subir anexos | Parcial | PDF, PNG y JPEG privados, límite de tamaño y firma básica; falta antivirus. |
| 16 Obligatorios y opcionales | Pendiente | Falta catálogo de anexos aprobado por procedimiento. |
| 17 Anexos ausentes | Parcial | Advierte ausencia genérica sin inventar requisitos; falta regla aprobada. |
| 18 Contradicciones | Parcial | Valida edad, fechas, alcance y urgencia; faltan reglas de contradicción exhaustivas. |
| 19 Redacción basada en fuentes | Parcial | RAG léxico, citas literales comprobadas, PDF y página visibles; abstención ante respaldo ausente o inválido. Falta aprobación y auditoría jurídica de fuentes e interpretación. |
| 20 Referencias normativas | Pendiente | No inserta artículo y URL verificados en el escrito. |
| 21 Vigencia aprobada | Parcial | No utiliza fragmentos como autoridad aprobada; falta flujo de vigencia y bloqueo administrable. |
| 22 Borrador estructurado | Parcial | Genera objeto de borrador con datos declarados; falta esquema jurídico completo aprobado. |
| 23 Plantilla estable | Parcial | PDF local y dos versiones oficiales diferenciadas; falta publicación y aprobación de plantillas. |
| 24 Vista previa completa | Parcial | Borrador visible y PDF de referencia descargable; falta previsualización completa antes de descargar. |
| 25 Editar desde vista previa | Parcial | Se corrige desde el resumen y se regenera; falta edición directa en una vista completa. |
| 26 PDF legible | Implementada para simulación | PDF A4 y vista previa sobre formulario oficial, con marca de no presentación. |
| 27 Índice de anexos | Parcial | Enumera solo archivos efectivamente cargados; falta control de anexos obligatorio/opcional. |
| 28 Instrucciones oficiales | Parcial | Enlaces y ruta general del Poder Judicial; faltan pasos por distrito, canal y revisión jurídica. |
| 29 Historial | Implementada | Lista privada de conversaciones con documento asociado, historial persistente y migración de casos anteriores. |
| 30 Eliminación de datos | Parcial | Elimina conversación, caso vinculado y anexos tras confirmación; falta política de conservación y atención de solicitudes. |
| 31 Alta de procedimiento | Pendiente | No existe consola ni ficha administrable. |
| 32 Regla de no patrocinio | Pendiente | Falta fuente, alcance y bloqueo administrable. |
| 33 Preguntas y anexos | Pendiente | Están codificados para piloto; falta configuración versionada. |
| 34 Incorporar normas | Parcial | Ingesta PDF con archivo y hash; falta procedencia oficial y aprobación administrable. |
| 35 Vincular artículos | Pendiente | No hay relaciones jurídicas verificadas por procedimiento. |
| 36 Vigencia de normas | Pendiente | No hay historial de vigencia y aprobaciones. |
| 37 Versionar plantillas | Parcial | Catálogo fijo de dos versiones; falta publicación aprobada e historial. |
| 38 Suspender procedimiento | Pendiente | No hay control administrativo inmediato. |
| 39 Auditar versión jurídica | Pendiente | No se guarda snapshot inmutable de norma, plantilla y revisión por cada PDF. |
| 40 Errores anonimizados | Pendiente | No hay panel de errores anónimos. |

## Condiciones para uso real

Antes de habilitar casos reales se necesitan, como mínimo, revisión profesional de competencia, normas, formulario y anexos por distrito judicial; tratamiento de datos personales de menores; antivirus y controles de archivos; política de conservación y eliminación; auditoría por documento; y verificación del canal de presentación. La herramienta no presenta la demanda ni reemplaza al órgano receptor.
