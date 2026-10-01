# 🔧 portfolio-backend · API del portfolio de Gabriel Vidal Badia

Backend de la web personal [gabi37smx.github.io/mi-web](https://gabi37smx.github.io/mi-web/), construido desde cero como parte del ciclo de **Desarrollo de Aplicaciones Multiplataforma (DAM)** en el IES Simarro (Xàtiva, Valencia).

> Frontend en HTML, CSS y JS puros. Backend propio con Node.js, MongoDB, Resend, Winston y WebAuthn.

🌐 **API en producción:** https://portfolio-backend-m07q.onrender.com
🎛️ **Panel de administración:** https://portfolio-backend-m07q.onrender.com/admin

---

## 📖 ¿Qué hace este backend?

Gestiona tres cosas del portfolio:

1. **Formulario de contacto** — recibe mensajes de la web pública, los guarda en MongoDB, avisa al dueño por email y envía una auto-respuesta al usuario.
2. **Panel de administración** — permite al dueño ver los mensajes, marcarlos como leídos, consultar los logs y gestionar sus passkeys.
3. **Autenticación del admin** — sistema híbrido: **contraseña tradicional** (fallback) + **passkeys con WebAuthn** (huella, Face ID, Windows Hello, llave física).

Todo desplegado en **Render** (plan gratuito) con MongoDB Atlas.

---

## 🛠️ Stack técnico

| Tecnología | Uso |
|---|---|
| **Node.js 24** | Runtime |
| **Express 4** | Servidor HTTP y rutas |
| **MongoDB Atlas** | Base de datos (colección `messages`, `passkeys`, `logs`) |
| **Mongoose** | ODM para MongoDB |
| **Resend** | Envío de emails transaccionales |
| **Winston** | Sistema de logs (consola + MongoDB) |
| **winston-mongodb** | Transporte de logs a MongoDB con TTL |
| **SimpleWebAuthn v9** | Implementación de WebAuthn (passkeys) |
| **express-rate-limit** | Protección contra spam en el formulario |
| **CORS** | Control de acceso desde el frontend de GitHub Pages |
| **dotenv** | Variables de entorno |

---

## 🔌 Endpoints disponibles

### Formulario y mensajes (`/api/contact`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/contact` | ❌ | Recibe el formulario, guarda en BD y envía 2 emails |
| GET | `/api/contact/messages` | ✅ | Devuelve todos los mensajes (admin) |
| PATCH | `/api/contact/messages/:id/leido` | ✅ | Marca un mensaje como leído |
| GET | `/api/contact/logs` | ✅ | Devuelve los últimos 100 logs (admin, filtrable por `?nivel=info|warn|error`) |

### Passkeys (`/api/passkey`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/passkey/register/options` | Genera las opciones de registro |
| POST | `/api/passkey/register/verify` | Verifica la respuesta del navegador y guarda la credencial |
| POST | `/api/passkey/login/options` | Genera las opciones de autenticación |
| POST | `/api/passkey/login/verify` | Verifica la firma y devuelve la contraseña del admin |
| GET | `/api/passkey/list` | Lista las passkeys registradas (admin) |
| DELETE | `/api/passkey/:credentialID` | Borra una passkey (admin) |

### Otros

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Estado del servicio |
| GET | `/admin` | Panel de administración (HTML) |
| GET | `/vendor/simplewebauthn.js` | Librería SimpleWebAuthn vendorizada |

---

## 🔐 Autenticación híbrida (passkeys + contraseña)

El admin puede entrar de **dos formas**:

1. **Con passkey** (recomendado) — usando huella, Face ID, Windows Hello, PIN o llave física USB.
2. **Con contraseña** — método tradicional, útil si pierdes el dispositivo con la passkey.

**Por qué híbrido y no solo passkey:** si perdieras el único dispositivo donde registraste la passkey, te quedarías fuera del admin sin forma de recuperarlo. Con el fallback de contraseña **nunca te bloqueas**.

**Cómo funciona el flujo:**

```
1. Usuario pulsa "Entrar con passkey" en el admin
2. Frontend → POST /api/passkey/login/options
3. Backend genera challenge y lista de credenciales permitidas
4. Navegador → WebAuthn API → Windows Hello / Face ID / Touch ID
5. Frontend → POST /api/passkey/login/verify con la firma
6. Backend verifica la firma con la clave pública guardada en MongoDB
7. Backend devuelve la contraseña del admin (que el frontend usa como antes)
```

**Estándar:** WebAuthn (W3C). El mismo que usan Google, GitHub, Microsoft y Apple.

**Vendorizado:** la librería `@simplewebauthn/browser` está en `/vendor/simplewebauthn.js`, **no se carga desde CDN externo**. Así el admin no depende de `unpkg.com` ni de terceros.

---

## 📋 Sistema de logs

Los eventos importantes del backend se registran con **Winston** y se guardan en:

1. **Consola** — visibles en los logs de Render.
2. **MongoDB** — colección `logs`, con TTL de 30 días (borrado automático).

**Niveles usados:**

| Nivel | Cuándo se usa |
|---|---|
| `info` | Todo va bien (arranque, conexión a BD, mensaje guardado, login correcto...) |
| `warn` | Algo raro pero no rompe (contraseña incorrecta, mensaje rechazado...) |
| `error` | Algo se ha roto (fallo de email, excepción no controlada...) |

**Cómo consultarlos:** panel admin → pestaña **Logs**, con filtros por nivel (`Todos` / `Info` / `Warn` / `Error`).

---

## 📁 Estructura del proyecto

```
portfolio-backend/
├── middleware/
│   └── auth.js              ← Middleware de autenticación admin (contraseña)
├── models/
│   ├── Message.js           ← Esquema de mensajes del formulario
│   └── Passkey.js           ← Esquema de credenciales WebAuthn
├── routes/
│   ├── contact.js           ← Endpoints del formulario + logs
│   └── passkey.js           ← Endpoints de registro y login con WebAuthn
├── vendor/
│   ├── simplewebauthn.js    ← Librería SimpleWebAuthn (browser) vendorizada
│   └── SIMPLEWEBAUTHN-LICENSE.md
├── admin.html               ← Panel de administración (HTML+CSS+JS embebido)
├── logger.js                ← Configuración de Winston (consola + MongoDB)
├── loadEnv.js               ← Carga de variables de entorno
├── server.js                ← Servidor Express principal
├── package.json
├── package-lock.json
├── .env                     ← Variables locales (NO se sube)
├── .env.example             ← Plantilla de variables
├── .gitignore
└── README.md                ← Este archivo
```

---

## 🏗️ Decisiones de arquitectura (ADR)

### ADR 1 · Autenticación híbrida (contraseña + passkey) en lugar de solo uno

**Situación.** El panel admin necesitaba una autenticación seria. Las opciones eran: contraseña clásica (simple pero vulnerable) o passkeys con WebAuthn (seguras pero con riesgo de bloqueo si pierdes el dispositivo).

**Decisión.** Implementar **autenticación híbrida**: passkey como método principal y contraseña como fallback.

**Consecuencia.**
- ✅ Ganas la seguridad de WebAuthn (imposible de phishing, sin secretos compartidos).
- ✅ Nunca te quedas bloqueado: si pierdes el móvil o el portátil, entras con la contraseña.
- ✅ Puedes registrar varias passkeys (un dispositivo por passkey) y borrarlas cuando quieras.
- ⚠️ El código tiene que mantener los dos flujos, así que hay un poco más de superficie que cubrir.

Este es el enfoque que usan GitHub, Google, Microsoft y Apple: passkeys primero, pero siempre con métodos alternativos.

---

### ADR 2 · Winston con transporte a MongoDB en lugar de archivos .log

**Situación.** Necesitaba un sistema de logs que me permitiera diagnosticar problemas desde cualquier sitio (mi PC, el móvil, en clase) sin tener que abrir la consola de Render.

**Decisión.** Usar **Winston** con **dos transportes**: consola y **MongoDB** (colección `logs`).

**Consecuencia.**
- ✅ Los logs sobreviven a cada deploy de Render (antes se perdían porque Render borra el filesystem).
- ✅ Se consultan desde el panel admin (pestaña Logs), filtrables por nivel.
- ✅ Se borran automáticamente a los 30 días gracias al TTL de MongoDB. La colección no crece sin control.
- ⚠️ Depende de que la conexión a MongoDB esté activa; si se cae, los logs se quedan solo en consola.

Alternativa descartada: guardar en ficheros `.log` en el servidor. En Render Free el sistema de archivos es efímero, así que se perderían en cada reinicio.

---

### ADR 3 · Vendorizar SimpleWebAuthn en lugar de usar un CDN

**Situación.** La librería `@simplewebauthn/browser` es necesaria en el panel admin para hablar con Windows Hello / Face ID / Touch ID. Lo más rápido era cargarla desde `unpkg.com`.

**Decisión.** **Descargarla y servirla desde el propio backend**, en `/vendor/simplewebauthn.js`.

**Consecuencia.**
- ✅ El admin no depende de que `unpkg.com` esté disponible.
- ✅ Si unpkg cae (ha pasado), cambia su URL o cambia su versión, mi admin sigue funcionando igual.
- ✅ Puedo auditar exactamente qué versión estoy sirviendo.
- ✅ La licencia MIT se preserva en `vendor/SIMPLEWEBAUTHN-LICENSE.md`.
- ⚠️ Cuando quiera actualizar la librería, tengo que sustituir el archivo a mano.

Esta es la práctica recomendada para cualquier dependencia crítica de seguridad. Los proyectos serios no confían en CDNs de terceros para autenticación.

---

## 🕰️ Historial de versiones

| Versión | Fecha | Descripción |
|---|---|---|
| v1 | 27 sep 2026 | Backend base: Express + MongoDB + Resend. Formulario de contacto funcional con guardado en BD y doble email (aviso al dueño + auto-respuesta al usuario). |
| v2 | 27 sep 2026 | Panel de administración con estética topo, tema claro/oscuro y estadísticas. |
| v2.1 | 28 sep 2026 | Auto-respuesta por email al usuario que envía el formulario. |
| v2.2 | 29 sep 2026 | Fix: rate limit solo afecta al POST del formulario, no al panel admin. |
| v3 | 1 oct 2026 | Sistema de logs con Winston y visor en el panel admin (pestaña Logs con filtros por nivel). |
| v3.1 | 1 oct 2026 | Fix: limpieza de warnings y duplicidad en el visor de logs. |
| v3.2 | 1 oct 2026 | Endpoints de passkey (`/api/passkey/*`) y vendorización de SimpleWebAuthn. |
| v4 | 1 oct 2026 | Passkeys con WebAuthn (híbrido: contraseña + passkey). Pantalla de login, pestaña Passkeys, botón "Registrar passkey" y borrado de credenciales. |

---

## ⚙️ Variables de entorno

Copia `.env.example` a `.env` y rellena:

```env
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

# Logs (opcional)
LOG_LEVEL=info
```

En producción estas variables están configuradas en el panel de **Render** → Environment.

---

## 🚀 Cómo ejecutarlo en local

### Requisitos

- Node.js 18 o superior
- Cuenta de MongoDB Atlas (gratuita)
- Cuenta de Resend (gratuita)

### Pasos

```bash
# 1. Clonar el repo
git clone https://github.com/gabi37smx/portfolio-backend.git
cd portfolio-backend

# 2. Instalar dependencias
npm install

# 3. Crear .env a partir de .env.example y rellenar
cp .env.example .env

# 4. Arrancar en modo desarrollo (auto-reload con --watch)
npm run dev
```

El servidor estará en `http://localhost:3000` y el panel admin en `http://localhost:3000/admin`.

> ⚠️ **Passkeys en local:** funcionan solo en `http://localhost`. No valen en `127.0.0.1`. Y las passkeys registradas en local **no sirven en producción**, porque WebAuthn distingue por dominio (RP ID).

---

## 📦 Despliegue en producción

- **Plataforma:** Render (plan gratuito)
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Variables de entorno:** configuradas en el panel de Render
- **URL pública:** https://portfolio-backend-m07q.onrender.com
- **Limitaciones del plan gratuito:** Render duerme el servicio tras 15 min sin uso. La primera petición tarda ~30 s en "despertarlo". Después va rápido.

---

## 👤 Autor

**Gabriel Vidal Badia**

- 🎓 1º DAM · IES Simarro (Xàtiva, Valencia)
- 💼 Técnico Superior en Sistemas de Telecomunicación e Informáticos · CFGM SMR · 11 años de experiencia en mantenimiento industrial
- 🎯 Enfoque: programación, inteligencia artificial y agentes
- 📫 Contacto: gabvidbad@alu.edu.gva.es
- 🐙 GitHub: [@gabi37smx](https://github.com/gabi37smx)
- 💼 LinkedIn: [gabriel-vidal-badia](https://www.linkedin.com/in/gabriel-vidal-badia-19122a43b)

---

## 📄 Licencia

Proyecto personal con fines educativos. Todos los derechos reservados.

La librería `@simplewebauthn/browser` incluida en `vendor/` está bajo licencia MIT (ver `vendor/SIMPLEWEBAUTHN-LICENSE.md`).
