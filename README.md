# AbogadoIA

MVP local de asistente legal para Perú. En **una misma conversación** puedes hablar de cualquier tema, consultar tus PDF con Groq, preparar una demanda ficticia de alimentos para menores, revisar sus datos y descargar un PDF de **simulación**. Interfaz adaptable a computadora y celular. El estado de las historias de usuario y los límites del piloto están en [mvp/HU_ESTADO.md](mvp/HU_ESTADO.md).

## Instalar en otra computadora

Necesitas:

1. [Git](https://git-scm.com/downloads) para clonar el repositorio (o descargar el ZIP desde GitHub).
2. [Node.js 24 o superior](https://nodejs.org/) con npm. Comprueba la instalación con `node --version` y `npm --version`.
3. Una [clave de API de Groq](https://console.groq.com/keys) para la consulta libre y las sugerencias de IA. El resto del MVP puede funcionar sin esa clave.
4. Conexión a Internet para instalar dependencias y, al usar la IA, comunicarse con Groq. **No** necesitas instalar PostgreSQL, SQLite ni un servidor web adicional.

Para la voz, necesitas además una clave de [Fish Audio](https://fish.audio/) y el ID de tu voz. Configura `FISH_AUDIO_API_KEY`, `FISH_AUDIO_VOICE_ID` y `FISH_AUDIO_MODEL=s2.1-pro-free` en `mvp/.env`. **Groq transcribe el micrófono y responde; Fish genera la voz.** La transcripción usa tu clave de Groq con `VOICE_STT_PROVIDER=groq` y `GROQ_STT_MODEL=whisper-large-v3-turbo`. El botón **Voz** conversa en el mismo chat y el botón de micrófono dicta texto para revisar antes de enviarlo. En un celular, el micrófono requiere HTTPS. Consulta las instrucciones y límites de voz en [mvp/README.md](mvp/README.md#voz-y-dictado).

Clona e instala desde una terminal:

```bash
git clone https://github.com/Brando-01/Abogado_IA.git
cd Abogado_IA/mvp
npm ci
```

Crea `mvp/.env` a partir del ejemplo. En PowerShell:

```powershell
Copy-Item .env.example .env
```

En macOS o Linux:

```bash
cp .env.example .env
```

Abre `.env` en un editor y escribe tu clave en `GROQ_API_KEY=`. Guarda el archivo y ejecuta:

```bash
npm start
```

Abre [http://127.0.0.1:4173/](http://127.0.0.1:4173/) y crea la primera cuenta local. No abras `mvp/public/` directamente ni con Live Server: la aplicación necesita su servidor Node. Para detenerlo, pulsa `Ctrl+C` en la terminal.

La carpeta `Data de Leyes/` viene en el repositorio. En el primer arranque se crea automáticamente `mvp/private/abogadoia.sqlite` y se indexan los PDF. La primera indexación puede tardar varios minutos. Los PDF sin texto seleccionable requieren OCR para poder buscarse; la aplicación los señala. Si agregas PDF, ponlos en `Data de Leyes/` y pulsa **Actualizar biblioteca** o ejecuta `npm run ingest` desde `mvp/`.

## Qué se guarda solo en tu equipo

`mvp/.env`, `mvp/private/`, las dependencias y los PDF generados están excluidos de Git. Cada instalación crea su propia base SQLite y su propia clave local de cifrado. Clonar el repositorio en otra computadora **no traslada** cuentas, casos, anexos ni historial. Si necesitas mover esos datos, detén la aplicación y copia de forma privada la carpeta `mvp/private/` completa; nunca la subas a GitHub. Conserva su `server.key`, porque los casos y anexos cifrados dependen de esa clave.

## Alcance

Este MVP usa **datos ficticios**. Las respuestas de Groq se basan en extractos recuperados de los PDF, cuyo contenido y vigencia deben verificarse. Los PDF de demanda llevan la marca **SIMULACIÓN - NO PRESENTAR** y no se envían al Poder Judicial. Lee [mvp/README.md](mvp/README.md) para funciones, pruebas y límites, y [mvp/HU_ESTADO.md](mvp/HU_ESTADO.md) para el avance de cada historia.
