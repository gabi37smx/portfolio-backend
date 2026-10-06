🔧 portfolio-backend · API del portfolio de Gabriel Vidal Badia
Backend de la web personal gabi37smx.github.io/mi-web, construido desde cero como parte del ciclo de Desarrollo de Aplicaciones Multiplataforma (DAM) en el IES Simarro (Xàtiva, Valencia).

Frontend en HTML, CSS y JS puros. Backend propio con Node.js, MongoDB, Resend, Winston y WebAuthn.

🌐 API en producción: https://portfolio-backend-m07q.onrender.com 🎛️ Panel de administración: https://portfolio-backend-m07q.onrender.com/admin

📖 ¿Qué hace este backend?
Gestiona cinco cosas del portfolio:

- **Formulario de contacto** — recibe mensajes de la web pública, los guarda en MongoDB, avisa al dueño por email y envía una auto-respuesta al usuario.
- **Panel de administración** — permite al dueño ver los mensajes, marcarlos como leídos, consultar los logs y gestionar sus passkeys.
- **Autenticación del admin** — sistema híbrido: contraseña tradicional (fallback) + passkeys con WebAuthn (huella, Face ID, Windows Hello, llave física).
- **Proxy del chatbot "Cordada"** — recibe las preguntas del visitante y las reenvía a una API de IA externa, con rate limit, caché y fallback.
- **Proxy de noticias de IA** — sirve los últimos artículos sobre inteligencia artificial obtenidos de GNews, con caché de 30 minutos.

Todo desplegado en Render (plan gratuito) con MongoDB Atlas.

🛠️ Stack técnico
| Tecnología | Uso |
| --- | --- |
| Node.js 24 | Runtime |
| Express 4 | Servidor HTTP y rutas |
| MongoDB Atlas | Base de datos (colecciones messages, passkeys, logs) |
| Mongoose | ODM para MongoDB |
| Resend | Envío de emails transaccionales |
| Winston | Sistema de logs (consola + MongoDB) |
| winston-mongodb | Transporte de logs a MongoDB con TTL |
| SimpleWebAuthn v9 | Implementación de WebAuthn (passkeys) |
| express-rate-limit | Protección contra spam (formulario + chatbot) |
| node-cache | Caché en memoria (noticias IA) |
| CORS | Control de acceso desde el frontend de GitHub Pages |
| dotenv | Variables de entorno |

🔗 APIs externas integradas
El backend actúa como proxy/caché de cinco APIs públicas:

| API | Uso | Auth | Caché |
| --- | --- | --- | --- |
| Open-Meteo | Tiempo actual de las zonas consultadas | Sin autenticación | 15 min |
| OpenBeta (GraphQL) | Zonas de escalada por nombre de ciudad | Sin autenticación | 24 h |
| GitHub API | Actividad pública del usuario | Con `GITHUB_TOKEN` | 30 min |
| API de IA del chatbot | Respuestas del chatbot Cordada | Sin autenticación | 30 min |
| **GNews API** | **Noticias de IA de la última semana** | **Con `GNEWS_API_KEY`** | **30 min** |

🔌 Endpoints disponibles

Formulario y mensajes (`/api/contact`)

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| POST | `/api/contact` | ❌ | Recibe el formulario, guarda en BD y envía 2 emails |
| GET | `/api/contact/messages` | ✅ | Devuelve todos los mensajes (admin) |
| PATCH | `/api/contact/messages/:id/leido` | ✅ | Marca un mensaje como leído |
| GET | `/api/contact/logs` | ✅ | Devuelve los últimos 100 logs (admin, filtrable por `?nivel=info\|warn\|error`) |

Chatbot (`/api/chat`)

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/api/chat` | Proxy del chatbot Cordada. Recibe la pregunta, la envía a la IA externa y devuelve la respuesta. Rate limit: 10 peticiones / 15 min por IP. Caché: 30 min por pregunta + idioma. |

Body esperado:

```json
{
  "instrucciones": "texto del prompt de sistema del bot",
  "historial": ["(visitante) hola", "(Cordada) ¡Hola! Soy Cordada..."],
  "pregunta": "¿Qué estudias?",
  "idioma": "es" | "val" | "en"
}
Respuesta:

json
{ "ok": true, "respuesta": "texto generado por la IA" }
O en caso de error:

json
{ "ok": false, "error": "mensaje amable en español" }
Noticias de IA (/api/news)

Método	Ruta	Descripción
GET	/api/news/ai	Devuelve los últimos artículos sobre inteligencia artificial publicados en la última semana. Filtra por lang=es, ordena por fecha descendente y limita a 10 resultados. Caché: 30 min.
Ejemplo de respuesta:

json
{
  "date": "2026-10-06",
  "events": [
    {
      "title": "Panamá mira hacia la inteligencia artificial para vigilar los fondos de pensiones",
      "url": "https://www.infobae.com/panama/2026/10/06/...",
      "domain": "infobae",
      "publishedAt": "2026-10-06T01:27:43Z"
    }
  ],
  "total": 10,
  "cached_at": "2026-10-06T14:42:42.744Z"
}
Fallback: si GNews falla (por cuota agotada, red caída o timeout), el endpoint devuelve { events: [], total: 0, error: "service_unavailable" } sin lanzar error 5xx. El frontend muestra "No hay noticias disponibles" sin romperse. El visitante nunca ve un error técnico.

Frontend consumidor: noticias.html + noticias.js, que detecta el entorno automáticamente (localhost:3000 en local, URL de Render en producción).

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

Validación: rechaza preguntas > 500 caracteres o instrucciones > 4.000 caracteres.

Logs con Winston: registra cada petición (idioma, longitud, cache hit) sin guardar el texto de la pregunta.

Manejo de errores: si la IA externa falla, devuelve un JSON amable con estado 502. El frontend cae al árbol de decisión.

Nota sobre la IA externa: durante el desarrollo, dos servicios gratuitos de IA dejaron de funcionar (Pollinations y KeylessAI). El chatbot sigue funcionando gracias al árbol de decisión del frontend. Cuando haya un servicio fiable disponible, se conectará sin tocar el frontend.

📰 Noticias IA · arquitectura
El endpoint /api/news/ai también es un proxy. El frontend nunca llama directamente a GNews.

Caché de 30 minutos: una sola llamada a GNews sirve a todos los visitantes durante media hora.

Filtro en servidor: la query con comillas exactas ("inteligencia artificial" OR "artificial intelligence"), idioma es, ventana de 7 días y sortby=publishedAt se construye en el backend, no en el navegador.

Fallback silencioso: si GNews devuelve error (401, 403, 429, timeout), el backend responde con events: [] y estado 200. El frontend muestra un mensaje neutro.

Detección de entorno en el frontend: noticias.js usa localhost:3000 cuando se sirve desde local y la URL de Render cuando se sirve desde GitHub Pages. Sin tocar el código entre entornos.

Historia de la decisión (ADR 5): ver más abajo.

🔐 Autenticación híbrida (passkeys + contraseña)
El admin puede entrar de dos formas:

Con passkey (recomendado) — usando huella, Face ID, Windows Hello, PIN o llave física USB.

Con contraseña — método tradicional, útil si pierdes el dispositivo con la passkey.

Por qué híbrido y no solo passkey: si perdieras el único dispositivo donde registraste la passkey, te quedarías fuera del admin sin forma de recuperarlo. Con el fallback de contraseña nunca te bloqueas.

Estándar: WebAuthn (W3C). El mismo que usan Google, GitHub, Microsoft y Apple.

Vendorizado: la librería @simplewebauthn/browser está en /vendor/simplewebauthn.js, no se carga desde CDN externo.

📋 Sistema de logs
Los eventos importantes del backend se registran con Winston y se guardan en:

Consola — visibles en los logs de Render.

MongoDB — colección logs, con TTL de 30 días (borrado automático).

Niveles usados:

Nivel	Cuándo se usa
info	Todo va bien (arranque, conexión a BD, mensaje guardado, chat recibido, noticias servidas desde caché...)
warn	Algo raro pero no rompe (contraseña incorrecta, la IA del chatbot falló, GNews devolvió error...)
error	Algo se ha roto (fallo de email, excepción no controlada...)
Cómo consultarlos: panel admin → pestaña Logs, con filtros por nivel.

📁 Estructura del proyecto

text
portfolio-backend/
├── middleware/
│   └── auth.js              ← Middleware de autenticación admin (contraseña)
├── models/
│   ├── Message.js           ← Esquema de mensajes del formulario
│   └── Passkey.js           ← Esquema de credenciales WebAuthn
├── routes/
│   ├── contact.js           ← Endpoints del formulario + logs
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
├── package.json
├── package-lock.json
├── .env                     ← Variables locales (NO se sube)
├── .env.example             ← Plantilla de variables
└── README.md                ← Este archivo
🏗️ Decisiones de arquitectura (ADR)

ADR 1 · Autenticación híbrida (contraseña + passkey)
Situación. El panel admin necesitaba autenticación seria. Contraseña clásica es simple pero vulnerable; passkey es segura pero bloquea al usuario si pierde el dispositivo.

Decisión. Autenticación híbrida: passkey como método principal y contraseña como fallback.

Consecuencia. Ganas la seguridad de WebAuthn sin quedarte nunca bloqueado. Es el enfoque que usan GitHub, Google, Microsoft y Apple.

ADR 2 · Winston con transporte a MongoDB en lugar de archivos .log
Situación. Necesitaba diagnosticar problemas desde cualquier sitio sin abrir la consola de Render. En Render Free, el filesystem es efímero.

Decisión. Usar Winston con dos transportes: consola y MongoDB.

Consecuencia. Los logs sobreviven a cada deploy, se consultan desde el panel admin, y se borran automáticamente a los 30 días por el TTL de MongoDB.

ADR 3 · Vendorizar SimpleWebAuthn en lugar de usar un CDN
Situación. La librería @simplewebauthn/browser es necesaria para hablar con Windows Hello / Face ID. Lo más rápido era cargarla desde unpkg.com.

Decisión. Descargarla y servirla desde el propio backend en /vendor/simplewebauthn.js.

Consecuencia. El admin no depende de unpkg. Si el CDN cae, mi admin sigue funcionando. Puedo auditar qué versión sirvo.

ADR 4 · Proxy del chatbot con rate limit, caché y fallback
Situación. El chatbot necesita consultar una API de IA externa. Pero el frontend no puede llamarla directamente por tres razones: (1) el rate limit se repartiría por visitante y no por IP real, (2) las instrucciones del bot se verían en el navegador, (3) no habría caché global entre visitantes.

Decisión. Añadir un endpoint /api/chat en el backend que actúe como proxy:

Rate limit de 10 peticiones / 15 min por IP.

Caché por idioma + pregunta con TTL de 30 min.

Validación: rechazo de textos demasiado largos (> 4.000 chars instrucciones, > 500 chars pregunta).

Logs con Winston sin guardar el texto de la pregunta.

Manejo de errores: si la IA falla, devuelve 502 y el frontend cae al árbol de decisión.

Consecuencia. El chatbot es resiliente: dos APIs de IA cayeron durante el desarrollo (Pollinations y KeylessAI) y el chatbot siguió funcionando gracias al árbol del frontend. Los usuarios nunca ven un error técnico.

ADR 5 · Proxy de noticias IA con GNews tras descartar GDELT y Horizon
Situación. Quería mostrar en el portfolio titulares reales de IA con enlace al artículo original. Ninguna de las APIs probadas inicialmente servía:

GDELT DOC 2.0: devuelve artículos reales, pero su infraestructura legacy está saturada y aplica un rate limit de 1 petición cada 5 segundos, con mensajes explícitos pidiendo a los usuarios de alto tráfico que se pasen a su dataset de ngrams. En pruebas desde red compartida (instituto) bloqueó casi todas las peticiones.

Horizon AI Intelligence: especializada en IA, sin API key, pero su endpoint público devuelve "movers" (empresas y modelos con momentum) sin URLs de artículos. Los clics acababan en búsquedas de Google, no en noticias reales.

Decisión. Usar GNews API con el plan de estudiante:

1.000 peticiones/día gratuitas (vs 100 del plan normal).

Devuelve title, url, source.name y publishedAt reales.

Filtro de idioma (lang=es), ventana temporal (from = últimos 7 días) y orden por fecha.

CORS habilitado para todos los orígenes, aunque no lo necesitamos porque el frontend va por el backend.

Consecuencia. El widget muestra noticias reales, en español, actualizadas a diario, con enlace directo al artículo. La caché de 30 minutos convierte 1.000 peticiones/día en margen más que suficiente. Si GNews falla, el fallback silencioso mantiene la web intacta. Toda la decisión queda documentada aquí, incluidas las dos alternativas descartadas y por qué.

🕰️ Historial de versiones

Versión	Fecha	Descripción
v1	27 sep 2026	Backend base: Express + MongoDB + Resend. Formulario de contacto con guardado en BD y doble email.
v2	27 sep 2026	Panel de administración con estética topo, tema claro/oscuro y estadísticas.
v2.1	28 sep 2026	Auto-respuesta por email al usuario que envía el formulario.
v2.2	29 sep 2026	Fix: rate limit solo afecta al POST del formulario, no al panel admin.
v3	1 oct 2026	Sistema de logs con Winston y visor en el panel admin.
v3.1	1 oct 2026	Fix: limpieza de warnings y duplicidad en el visor de logs.
v3.2	1 oct 2026	Endpoints de passkey y vendorización de SimpleWebAuthn.
v4	1 oct 2026	Passkeys con WebAuthn (híbrido: contraseña + passkey).
v5	2 oct 2026	Primer endpoint de zonas de escalada (OpenStreetMap / Overpass).
v6	2 oct 2026	Mejora búsqueda y respaldo de zonas OSM.
v7	2 oct 2026	Fallbacks y logs para Overpass (rotación entre 3 servidores).
v8	2 oct 2026	Query OSM ampliada + filtro por tiempo (roca/rocódromo).
v9	3 oct 2026	Simplifica zonas de escalada y añade searchLinks.
v9.1	3 oct 2026	Simplifica respuesta y añade searchLinks (limpieza).
v9.2	3 oct 2026	Corrige URLs de búsqueda externa y añade TheTopo.
v10	3 oct 2026	Sustituye Overpass/OSM por OpenBeta GraphQL.
v10.1	3 oct 2026	Añade /api/github/activity con caché de 30 min.
v10.2	3 oct 2026	Autenticación con GITHUB_TOKEN. Timeout OpenBeta 25 s. trust proxy.
v10.3	3 oct 2026	Actualiza README con nuevas versiones y APIs externas.
v11	4 oct 2026	Nuevo endpoint /api/chat como proxy del chatbot Cordada. Rate limit (10/15min), caché (30 min), validación, logs Winston, manejo de errores 502.
v12	6 oct 2026	Nuevo endpoint /api/news/ai como proxy de GNews. Caché 30 min, filtro lang=es, últimos 7 días, 10 artículos. CORS multi-origen (producción + localhost + 127.0.0.1). Fallback silencioso. Documenta ADR 5.
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

Requisitos

Node.js 18 o superior

Cuenta de MongoDB Atlas (gratuita)

Cuenta de Resend (gratuita)

Cuenta de GNews con plan estudiante (gratuita, 1.000 peticiones/día)

Pasos

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

⚠️ Passkeys en local: funcionan solo en http://localhost. No valen en 127.0.0.1. Y las passkeys registradas en local no sirven en producción.

⚠️ Noticias IA en local: el frontend debe servirse por HTTP (no file://) para que el navegador permita las llamadas fetch. Opciones: python3 -m http.server 5500 en la carpeta del frontend, o Live Server de VS Code. El navegador bloqueará las peticiones si abres el HTML como fichero local.

📦 Despliegue en producción

Plataforma: Render (plan gratuito)

Build Command: npm install

Start Command: npm start

URL pública: https://portfolio-backend-m07q.onrender.com

Limitaciones: Render duerme el servicio tras 15 min sin uso. La primera petición tarda ~30 s en despertarlo.

👤 Autor
Gabriel Vidal Badia

🎓 1º DAM · IES Simarro (Xàtiva, Valencia)
💼 Técnico Superior en Sistemas de Telecomunicación e Informáticos · CFGM SMR · 11 años de experiencia en mantenimiento industrial
🎯 Enfoque: programación, inteligencia artificial y agentes

📫 Contacto: gabvidbad@alu.edu.gva.es
🐙 GitHub: @gabi37smx
💼 LinkedIn: gabriel-vidal-badia

📄 Licencia
Proyecto personal con fines educativos. Todos los derechos reservados.

La librería @simplewebauthn/browser incluida en vendor/ está bajo licencia MIT (ver vendor/SIMPLEWEBAUTHN-LICENSE.md).

Última actualización: 6 de octubre de 2026 a las 19:20.
