/* ============================================================
   middleware/auth.js · Autenticación del panel de administración
   ------------------------------------------------------------
   · La contraseña ya NO se acepta por la URL (?password=), solo en la
     cabecera "x-admin-password" o al canjearla en POST /api/session.
   · El login con passkey y el login con contraseña devuelven un TOKEN de
     sesión firmado (HMAC) que caduca a las 8 horas. El panel lo manda en
     la cabecera "Authorization: Bearer <token>".
   · Si alguien falla la contraseña demasiadas veces, su IP se bloquea un rato.
   ============================================================ */

import crypto from "crypto";
import { log } from "../logger.js";
import { ipCliente } from "../utils/clientIp.js";

const DURACION_TOKEN_MS = 8 * 60 * 60 * 1000;   // 8 horas
const MAX_FALLOS = 8;                           // fallos permitidos...
const VENTANA_MS = 15 * 60 * 1000;              // ...en 15 minutos

/* ---------- Utilidades ---------- */
const sha256 = (txt) => crypto.createHash("sha256").update(String(txt)).digest();
const b64url = (buf) => Buffer.from(buf).toString("base64url");

function iguales(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function claveSecreta() {
  const base = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!base) return null;
  return sha256("admin-session:" + base);
}

export function passwordConfigurada() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function comprobarPassword(candidata) {
  if (!passwordConfigurada() || typeof candidata !== "string" || !candidata) return false;
  return iguales(candidata, process.env.ADMIN_PASSWORD);
}

/* ---------- Tokens de sesión ---------- */
export function crearToken() {
  const clave = claveSecreta();
  if (!clave) throw new Error("ADMIN_PASSWORD no configurada");
  const payload = b64url(JSON.stringify({ exp: Date.now() + DURACION_TOKEN_MS }));
  const firma = b64url(crypto.createHmac("sha256", clave).update(payload).digest());
  return `${payload}.${firma}`;
}

export function verificarToken(token) {
  const clave = claveSecreta();
  if (!clave || typeof token !== "string") return false;
  const [payload, firma] = token.split(".");
  if (!payload || !firma) return false;
  const esperada = b64url(crypto.createHmac("sha256", clave).update(payload).digest());
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}

export const duracionTokenSegundos = DURACION_TOKEN_MS / 1000;

/* ---------- Bloqueo por intentos fallidos ---------- */
const fallos = new Map(); // ip -> [instantes]

function recientes(ip) {
  const ahora = Date.now();
  const lista = (fallos.get(ip) || []).filter((t) => ahora - t < VENTANA_MS);
  if (lista.length) fallos.set(ip, lista); else fallos.delete(ip);
  return lista;
}

export function estaBloqueada(ip) {
  return recientes(ip).length >= MAX_FALLOS;
}

export function registrarFallo(ip) {
  const lista = recientes(ip);
  lista.push(Date.now());
  fallos.set(ip, lista);
}

setInterval(() => { for (const ip of [...fallos.keys()]) recientes(ip); }, VENTANA_MS).unref();

/* ---------- Middleware ---------- */
export function adminAuth(req, res, next) {
  const ip = ipCliente(req);
  const ruta = `${req.baseUrl}${req.path}`;

  if (!passwordConfigurada()) {
    log.error("Admin: falta ADMIN_PASSWORD en el servidor", { ruta });
    return res.status(500).json({ error: "Servidor sin configurar" });
  }
  if (estaBloqueada(ip)) {
    log.warn("Admin: IP bloqueada por demasiados intentos fallidos", { ip, ruta });
    return res.status(429).json({ error: "Demasiados intentos. Inténtalo más tarde." });
  }

  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  const password = req.headers["x-admin-password"];

  if (!bearer && !password) {
    log.warn("Acceso al admin sin credenciales", { ip, ruta });
    return res.status(401).json({ error: "No autorizado" });
  }

  if ((bearer && verificarToken(bearer[1])) || (password && comprobarPassword(password))) {
    log.info("Acceso al admin correcto", { ip, ruta });
    return next();
  }

  registrarFallo(ip);
  log.warn("Intento de acceso al admin con credenciales incorrectas", { ip, ruta });
  return res.status(401).json({ error: "No autorizado" });
}