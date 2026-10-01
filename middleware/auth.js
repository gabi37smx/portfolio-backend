import { log } from "../logger.js";

export function adminAuth(req, res, next) {
  const password = req.headers["x-admin-password"] || req.query.password;
  const ip = req.ip || "desconocida";
  const ruta = `${req.baseUrl}${req.path}`;

  if (!password) {
    log.warn("Acceso al admin sin contraseña", { ip, ruta });
    return res.status(401).json({ error: "No autorizado" });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    log.warn("Intento de acceso al admin con contraseña incorrecta", { ip, ruta });
    return res.status(401).json({ error: "No autorizado" });
  }

  log.info("Acceso al admin correcto", { ip, ruta });
  next();
}