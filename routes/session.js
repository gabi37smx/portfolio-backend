/* ============================================================
   routes/session.js · Canjear la contraseña del admin por un token de sesión
   POST /api/session   { "password": "..." }  →  { ok, token, expiraEnSegundos }
   (la contraseña viaja en el cuerpo, nunca en la URL)
   ============================================================ */

import express from "express";
import { log } from "../logger.js";
import { ipCliente } from "../utils/clientIp.js";
import {
  comprobarPassword,
  passwordConfigurada,
  crearToken,
  duracionTokenSegundos,
  estaBloqueada,
  registrarFallo,
} from "../middleware/auth.js";

const router = express.Router();

router.post("/", (req, res) => {
  const ip = ipCliente(req);

  if (!passwordConfigurada()) {
    return res.status(500).json({ error: "Servidor sin configurar" });
  }
  if (estaBloqueada(ip)) {
    log.warn("Sesión admin: IP bloqueada por demasiados intentos", { ip });
    return res.status(429).json({ error: "Demasiados intentos. Inténtalo más tarde." });
  }

  const password = req.body && req.body.password;
  if (!comprobarPassword(password)) {
    registrarFallo(ip);
    log.warn("Sesión admin: contraseña incorrecta", { ip });
    return res.status(401).json({ error: "No autorizado" });
  }

  log.info("Sesión admin: contraseña correcta, token emitido", { ip });
  res.json({ ok: true, token: crearToken(), expiraEnSegundos: duracionTokenSegundos });
});

export default router;