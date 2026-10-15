# Personaje de AbogadoIA en Rive

Personaje vectorial original creado para este proyecto. El archivo `public/assets/assistant.riv` está compilado y versionado: para usarlo basta con `npm ci` y `npm start` desde `mvp`. No se requiere cuenta de Rive ni instalar su editor para ejecutar la aplicación.

## Controles

Un solo artboard `AbogadoAssistant`, una máquina de estados `Assistant` y el View Model `VoiceAssistant`:

| Propiedad | Valores |
|---|---|
| `mode` | 0 reposo, 1 escuchar, 2 pensar, 3 hablar, 4 celebrar, 5 silenciado, 6 error |
| `mouth` | Escala vertical de la boca, alimentada por las muestras reales del audio |

La máquina mezcla posturas con transiciones de 180 ms. Otra capa de la misma máquina mantiene el parpadeo. No contiene scripts ni archivos de audio. Los gestos de hablar y la apertura de boca se controlan por separado: al pausar el sonido, la boca vuelve a cerrarse.

El botón **Ver cómo se mueve** recorre los estados y reproduce la última respuesta del chat con la voz Fish configurada. No abre el micrófono ni envía mensajes nuevos. Las llamadas a Fish conservan los límites del modelo y de la cuenta. Durante una conversación normal, el gesto de celebrar se usa al confirmar por primera vez el resumen del documento de prueba.

## Editar y recompilar

El generador `generate.mjs` conserva el dibujo y las posturas como código. `scene.rml` es la fuente RML del personaje. Para modificarlo instala la [CLI oficial de Rive](https://rive.app/docs/cli/getting-started) y ejecuta desde `mvp`:

```powershell
node animations/assistant/generate.mjs
rive animations/assistant --once
Copy-Item animations/assistant/build/abogado-assistant.riv public/assets/assistant.riv
```

También puedes editar `scene.rml` directamente y omitir la generación. El generador lo sobrescribe al ejecutarse. Para comprobar la escena:

```powershell
rive inspect animations/assistant --summary
rive animations/assistant --screenshot=output/personaje.png --data=mode=3 --data=mouth=1.2 --advance=700ms
```

Creado con Rive CLI 1.6.0; runtime web `@rive-app/canvas-lite` 2.44.2 (MIT). El servidor entrega JavaScript, WASM y `.riv` desde el propio equipo. La CSP permite compilar WASM sin habilitar evaluación arbitraria de JavaScript. No hay dependencias de CDN en la reproducción del personaje. [Documentación del runtime](https://rive.app/docs/runtimes/web/web-js).
