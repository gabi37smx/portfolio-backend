🔧 portfolio-backend · API del portfolio de Gabriel Vidal Badia

Backend de la web personal gabi37smx.github.io/mi-web, construido desde cero como parte del ciclo de Desarrollo de Aplicaciones Multiplataforma (DAM) en el IES Simarro (Xàtiva, Valencia).

Frontend en HTML, CSS y JS puros. Backend propio con Node.js, MongoDB, Resend, Winston y WebAuthn.

🌐 API en producción: https://portfolio-backend-m07q.onrender.com 🎛️ Panel de administración: https://portfolio-backend-m07q.onrender.com/admin 🧗 Frontend (repo separado): https://github.com/gabi37smx/mi-web

📖 ¿Qué hace este backend?

Gestiona cinco cosas del portfolio:

Formulario de contacto: recibe mensajes de la web pública, los guarda en MongoDB, avisa al dueño por email y envía una auto-respuesta al visitante.
Panel de administración: permite ver los mensajes, marcarlos como leídos, consultar los logs y gestionar las passkeys.
Autenticación del admin: sistema híbrido, passkeys con WebAuthn (huella, Face ID, Windows Hello, llave física) y contraseña como fallback.
Proxy del chatbot "Cordada": recibe las preguntas del visitante y las reenvía a una API de IA externa, con rate limit, caché y fallback.
Proxy de noticias de IA: sirve los últimos artículos sobre inteligencia artificial obtenidos de GNews, con caché de 30 minutos.
🛠️ Stack técnico
Tecnología	Uso
Node.js 24	Runtime
Express 4	Servidor HTTP y rutas
MongoDB Atlas	Base de datos (colecciones messages, passkeys, logs)
Mongoose	ODM para MongoDB
Resend	Envío de emails transaccionales
Winston + winston-mongodb	Logs en consola y en MongoDB con TTL de 30 días
SimpleWebAuthn v9	Implementación de WebAuthn (passkeys)
express-rate-limit	Protección contra spam (formulario y chatbot)
node-cache	Caché en memoria (noticias IA)
CORS	Control de acceso desde el frontend de GitHub Pages
dotenv	Variables de entorno
🔗 APIs externas integradas

El backend actúa como proxy/caché de varias APIs públicas:

API	Uso	Auth	Caché
Open-Meteo	Tiempo actual de las zonas consultadas	Sin autenticación	15 min
OpenBeta (GraphQL)	Zonas de escalada por nombre de ciudad	Sin autenticación	24 h
GitHub API	Actividad pública del usuario	Con GITHUB_TOKEN	30 min
API de IA del chatbot (Gemini, con modelos de reserva)	Respuestas del chatbot Cordada	Con clave de API (variable de entorno en Render)	30 min
GNews API	Noticias de IA de la última semana	Con GNEWS_API_KEY	30 min
🔌 Endpoints disponibles
Formulario y mensajes (/api/contact)
Método	Ruta	Auth	Descripción
POST	/api/contact	❌	Recibe el formulario, guarda en BD y envía 2 emails (aviso al dueño y confirmación al visitante)
GET	/api/contact/messages	✅	Devuelve los mensajes (admin)
PATCH	/api/contact/messages/:id/leido	✅	Marca un mensaje como leído
GET	/api/contact/logs	✅	Últimos 100 logs (admin, filtrable con ?nivel=info|warn|error)
Chatbot (/api/chat)
Método	Ruta	Descripción
GET	/api/chat/health	Endpoint para "despertar" Render antes de la petición real (el frontend lo llama al pasar el ratón por el botón del chat)
POST	/api/chat	Proxy del chatbot Cordada. Rate limit: 10 peticiones / 15 min por IP. Caché: 30 min por pregunta + idioma

Body esperado:

json
{
  "instrucciones": "texto del prompt de sistema del bot",
  "historial": ["(visitante) hola", "(Cordada) ¡Hola! Soy Cordada..."],
  "pregunta": "¿Qué estudias?",
  "idioma": "es"
}

idioma puede ser es, val o en.

Respuesta correcta:

json
{ "ok": true, "respuesta": "texto generado por la IA" }

Respuesta en caso de error:

json
{ "ok": false, "error": "mensaje amable en español" }
Noticias de IA (/api/news)
Método	Ruta	Descripción
GET	/api/news/ai	Últimos artículos sobre IA de la última semana. Filtra por lang=es, ordena por fecha y limita a 10. Caché: 30 min

Ejemplo de respuesta:

json
{
  "date": "2026-10-17",
  "events": [
    {
      "title": "Panamá mira hacia la inteligencia artificial para vigilar los fondos de pensiones",
      "url": "https://www.infobae.com/panama/2026/10/06/...",
      "domain": "infobae",
      "publishedAt": "2026-10-06T01:27:43Z"
    }
  ],
  "total": 10,
  "cached_at": "2026-10-17T14:42:42.744Z"
}

Fallback: si GNews falla (cuota agotada, red caída o timeout), el endpoint devuelve { events: [], total: 0, error: "service_unavailable" } con estado 200. El frontend muestra "No hay noticias disponibles" y el visitante nunca ve un error.

Passkeys (/api/passkey)
Método	Ruta	Descripción
POST	/api/passkey/register/options	Genera las opciones de registro
POST	/api/passkey/register/verify	Verifica la respuesta del navegador y guarda la credencial
POST	/api/passkey/login/options	Genera las opciones de autenticación
POST	/api/passkey/login/verify	Verifica la firma y devuelve la contraseña del admin
GET	/api/passkey/list	Lista las passkeys registradas (admin)
DELETE	/api/passkey/:credentialID	Borra una passkey (admin)
Otros
Método	Ruta	Descripción
GET	/	Estado del servicio
GET	/admin	Panel de administración (HTML)
GET	/vendor/simplewebauthn.js	Librería SimpleWebAuthn vendorizada
🤖 Chatbot Cordada · arquitectura

El endpoint /api/chat es un proxy. El frontend nunca llama directamente a la API de IA externa. Ventajas:

Rate limit por IP: máximo 10 peticiones / 15 min.
Caché por pregunta + idioma: si alguien repite la misma pregunta, se sirve al instante.
Validación: rechaza preguntas de más de 500 caracteres o instrucciones de más de 4.000.
Logs con Winston: registra idioma, longitud y si hubo caché, sin guardar el texto de la pregunta.
Manejo de errores: si la IA externa falla, devuelve un JSON amable con estado 502 y el frontend cae al árbol de decisión.

Evolución del proveedor de IA durante el desarrollo:

Pollinations: cerró su endpoint legacy con error 500 (ENOSPC).
KeylessAI: el dominio dejó de existir (NXDOMAIN).
Gemini (API gratuita) con modelos de reserva: commits v:13 a v:13.3. El 12 de octubre se probó el endpoint oficial (v13.3) y se revirtió. Es el proveedor que usa hoy el chatbot en producción.

En los tres casos el chatbot siguió funcionando gracias al árbol de decisión del frontend.

📰 Noticias IA · arquitectura

El endpoint /api/news/ai también es un proxy. El frontend nunca llama directamente a GNews.

Caché de 30 minutos: una sola llamada a GNews sirve a todos los visitantes durante media hora.
Filtro en servidor: la query con comillas exactas ("inteligencia artificial" OR "artificial intelligence"), idioma es, ventana de 7 días y sortby=publishedAt se construye en el backend, no en el navegador.
Fallback silencioso: si GNews devuelve error (401, 403, 429, timeout), el backend responde con events: [] y estado 200.
Detección de entorno en el frontend: noticias.js usa localhost:3000 en local y la URL de Render en GitHub Pages.
🔐 Autenticación híbrida (passkeys + contraseña)

El admin puede entrar de dos formas:

Con passkey (recomendado): huella, Face ID, Windows Hello, PIN o llave física USB.
Con contraseña: método tradicional, útil si pierdes el dispositivo con la passkey.

Por qué híbrido y no solo passkey: si perdiera el único dispositivo donde registré la passkey, me quedaría fuera del admin sin forma de recuperarlo. Con el fallback de contraseña nunca me bloqueo.

Estándar: WebAuthn (W3C), el mismo que usan Google, GitHub, Microsoft y Apple.
Vendorizado: @simplewebauthn/browser se sirve desde /vendor/simplewebauthn.js, no desde un CDN externo.
📋 Sistema de logs

Los eventos importantes se registran con Winston y se guardan en:

Consola: visibles en los logs de Render.
MongoDB: colección logs, con TTL de 30 días (borrado automático).
Nivel	Cuándo se usa
info	Todo va bien (arranque, conexión a BD, mensaje guardado, chat recibido, noticias desde caché...)
warn	Algo raro pero no rompe (contraseña incorrecta, la IA del chatbot falló, GNews devolvió error...)
error	Algo se ha roto (fallo de email, excepción no controlada...)

Cómo consultarlos: panel admin → pestaña Logs, con filtros por nivel.

📁 Estructura del proyecto
text
portfolio-backend/
├── middleware/
│   └── auth.js              ← Autenticación del panel admin
├── models/
│   ├── Message.js           ← Esquema de mensajes del formulario
│   └── Passkey.js           ← Esquema de credenciales WebAuthn
├── routes/
│   ├── contact.js           ← Formulario, emails y logs
│   ├── passkey.js           ← Endpoints de WebAuthn
│   ├── chat.js              ← Proxy del chatbot Cordada
│   ├── news.js              ← Proxy de noticias IA (GNews)
│   ├── climbing.js          ← Zonas de escalada (OpenBeta)
│   └── github.js            ← Actividad de GitHub
├── vendor/
│   ├── simplewebauthn.js    ← Librería SimpleWebAuthn vendorizada
│   └── SIMPLEWEBAUTHN-LICENSE.md
├── admin.html               ← Panel de administración
├── logger.js                ← Configuración de Winston
├── loadEnv.js               ← Carga de variables de entorno
├── server.js                ← Servidor Express principal
├── package.json · package-lock.json
├── .env                     ← Variables locales (NO se sube)
├── .env.example             ← Plantilla de variables
└── README.md
🏗️ Decisiones de arquitectura (ADR)
ADR 1 · Autenticación híbrida (contraseña + passkey)
Situación. El panel admin necesitaba autenticación seria. La contraseña clásica es simple pero vulnerable; la passkey es segura pero bloquea al usuario si pierde el dispositivo.
Decisión. Autenticación híbrida: passkey como método principal y contraseña como fallback.
Consecuencia. Ganas la seguridad de WebAuthn sin quedarte nunca bloqueado. Es el enfoque que usan GitHub, Google, Microsoft y Apple.
ADR 2 · Winston con transporte a MongoDB en lugar de archivos .log
Situación. Necesitaba diagnosticar problemas desde cualquier sitio sin abrir la consola de Render. En Render Free el filesystem es efímero.
Decisión. Winston con dos transportes: consola y MongoDB.
Consecuencia. Los logs sobreviven a cada deploy, se consultan desde el panel admin y se borran solos a los 30 días por el TTL de MongoDB.
ADR 3 · Vendorizar SimpleWebAuthn en lugar de usar un CDN
Situación. @simplewebauthn/browser es necesaria para hablar con Windows Hello / Face ID. Lo más rápido era cargarla desde unpkg.com.
Decisión. Descargarla y servirla desde el propio backend en /vendor/simplewebauthn.js.
Consecuencia. El admin no depende de unpkg. Si el CDN cae, el admin sigue funcionando y puedo auditar qué versión sirvo.
ADR 4 · Proxy del chatbot con rate limit, caché y fallback
Situación. El chatbot necesita una API de IA externa, pero el frontend no puede llamarla directamente: (1) el rate limit se repartiría por visitante y no por IP real, (2) las instrucciones del bot se verían en el navegador, (3) no habría caché compartida entre visitantes.
Decisión. Un endpoint /api/chat en el backend que actúa de proxy: rate limit de 10 peticiones / 15 min por IP, caché por idioma + pregunta (30 min), validación, logs con Winston y errores 502.
Consecuencia. El chatbot es resiliente: tres proveedores de IA gratuitos han fallado o cambiado durante el desarrollo y el chatbot siguió funcionando gracias al árbol del frontend. Los visitantes nunca ven un error técnico.
ADR 5 · Proxy de noticias IA con GNews tras descartar GDELT y Horizon
Situación. Quería titulares reales de IA con enlace al artículo original. GDELT DOC 2.0 aplica un rate limit de 1 petición cada 5 segundos y bloqueaba desde la red del instituto; Horizon AI Intelligence no devuelve URLs reales.
Decisión. GNews API con el plan de estudiante (1.000 peticiones/día), con title, url, source.name y publishedAt reales, filtro lang=es y ventana de 7 días.
Consecuencia. El widget muestra noticias reales, en español, actualizadas a diario. La caché de 30 minutos deja margen de sobra sobre las 1.000 peticiones/día y, si GNews falla, el fallback silencioso mantiene la web intacta.
ADR 6 · No enviar la confirmación a dominios que rechazan nuestro correo (gva.es)
Situación. El correo de la Generalitat (gva.es, edu.gva.es, alu.edu.gva.es) rechaza los envíos de este servidor con el error 550 #5.7.1. Cada rebote daña la reputación del dominio de envío.
Decisión. Una lista DOMINIOS_QUE_RECHAZAN en routes/contact.js: el mensaje se guarda y el aviso al dueño se envía igual, pero la auto-respuesta se omite (queda registrado en los logs como confirmacion_omitida).
Consecuencia. No se acumulan rebotes y la respuesta de la API incluye confirmacion: false para que el frontend lo sepa. Coste: los visitantes con correo gva.es no reciben copia de su mensaje.
🕰️ Historial de versiones
Versión	Fecha	Descripción
v1	27 sep 2026	Backend base: Express + MongoDB + Resend. Formulario con guardado en BD y doble email
v2	27 sep 2026	Panel de administración con estética topo, tema claro/oscuro y estadísticas
v2.1	28 sep 2026	Auto-respuesta por email al visitante
v2.2	29 sep 2026	Fix: el rate limit solo afecta al POST del formulario, no al panel admin
v3 / v3.1	1 oct 2026	Sistema de logs con Winston y visor en el panel admin
v3.2 / v4	1 oct 2026	Endpoints de passkey, vendorización de SimpleWebAuthn y autenticación híbrida
v5-v9.2	2-3 oct 2026	Zonas de escalada: OpenStreetMap/Overpass con rotación de servidores, searchLinks y TheTopo
v10	3 oct 2026	Sustituye Overpass/OSM por OpenBeta GraphQL
v10.1-v10.3	3 oct 2026	/api/github/activity con caché de 30 min, GITHUB_TOKEN, timeout de OpenBeta y trust proxy
v11	4 oct 2026	/api/chat como proxy del chatbot: rate limit, caché, validación, logs y errores 502
v12	6 oct 2026	/api/news/ai como proxy de GNews con caché, filtro de idioma y fallback silencioso (ADR 5)
v12.1	8 oct 2026	Contacto: no se envía la confirmación a dominios gva.es (ADR 6)
v13 - v13.2	semana del 5-11 oct 2026	Chat con IA gratuita (Gemini) con modelos de reserva; conversión de chat.js a ESM y arreglo del bug del chat
v13.3	12 oct 2026	Intento de usar el endpoint oficial de Gemini; se revierte (52b71a3)
v13.4	17 oct 2026	Endpoint /api/chat/health para despertar Render
⚙️ Variables de entorno

Copia .env.example a .env y rellena:

env
# Servidor
PORT=3000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/portfolio

# Resend
RESEND_API_KEY=re_xxxxxxxxxxxx
FROM_EMAIL=hola@gabrielvidalbadia.es
NOTIFY_EMAIL=gabvidbad@alu.edu.gva.es

# Admin
ADMIN_PASSWORD=tu_contraseña_segura

# CORS
ALLOWED_ORIGIN=https://gabi37smx.github.io

# GitHub API
GITHUB_TOKEN=github_pat_xxxxxxxxxxxx

# GNews API (noticias IA)
GNEWS_API_KEY=xxxxxxxxxxxxxxxxxxxx

# Logs (opcional)
LOG_LEVEL=info

En producción estas variables están configuradas en el panel de Render → Environment.

🚀 Cómo ejecutarlo en local

Requisitos: Node.js 18 o superior, cuenta de MongoDB Atlas (gratuita), cuenta de Resend (gratuita) y cuenta de GNews con plan estudiante (1.000 peticiones/día).

bash
# 1. Clonar el repo
git clone https://github.com/gabi37smx/portfolio-backend.git
cd portfolio-backend

# 2. Instalar dependencias
npm install

# 3. Crear .env a partir de .env.example y rellenar
cp .env.example .env

# 4. Arrancar en modo desarrollo
npm run dev

El servidor estará en http://localhost:3000 y el panel admin en http://localhost:3000/admin.

⚠️ Passkeys en local: funcionan solo en http://localhost, no en 127.0.0.1. Y las passkeys registradas en local no sirven en producción.

⚠️ Noticias IA en local: el frontend debe servirse por HTTP (no file://) para que el navegador permita las llamadas fetch. Opciones: python3 -m http.server 5500 en la carpeta del frontend, o Live Server de VS Code.

📦 Despliegue en producción
Plataforma: Render (plan gratuito)
Build Command: npm install
Start Command: npm start
URL pública: https://portfolio-backend-m07q.onrender.com
Limitación: Render duerme el servicio tras 15 min sin uso; la primera petición tarda ~30 s en despertarlo (por eso existe /api/chat/health).
🔗 Proyectos relacionados
Frontend: gabi37smx/mi-web, HTML, CSS y JS puros desplegado en GitHub Pages.
Web en producción: https://gabi37smx.github.io/mi-web/
👤 Autor

Gabriel Vidal Badia

🎓 1º DAM · IES Simarro (Xàtiva, Valencia)
💼 Técnico Superior en Sistemas de Telecomunicación e Informáticos · CFGM SMR · 11 años de experiencia en mantenimiento industrial
🎯 Enfoque: programación, inteligencia artificial y agentes
📫 Contacto: gabvidbad@alu.edu.gva.es
🐙 GitHub: @gabi37smx