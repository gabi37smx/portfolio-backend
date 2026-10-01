/* ============================================================
   logger.js · Sistema de logs centralizado con Winston
   Guarda los logs en consola y en MongoDB (colección "logs")
   ============================================================ */

import winston from "winston";
import "winston-mongodb";

// Nivel mínimo según el entorno
const level = process.env.LOG_LEVEL || "info";

const logger = winston.createLogger({
  level,
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { servicio: "portfolio-backend" },
  transports: [
    // 1) Consola (se ve en Render → Logs)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const { servicio, ...rest } = meta;
          const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
          return `[${timestamp}] ${level}: ${message}${extra}`;
        })
      ),
    }),

    // 2) MongoDB (se consulta desde el panel admin)
    new winston.transports.MongoDB({
      db: process.env.MONGODB_URI,
      collection: "logs",
      level: "info",
      tryReconnect: true,
      // Expiración opcional: los logs se borran solos a los 30 días
      expireAfterSeconds: 60 * 60 * 24 * 30,
      // Solo guardamos los campos que nos interesan
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      metaKey: "meta",
    }),
  ],
});

/* Helper para no repetir en cada log */
export const log = {
  info: (message, meta = {}) => logger.info(message, meta),
  warn: (message, meta = {}) => logger.warn(message, meta),
  error: (message, meta = {}) => logger.error(message, meta),
};

export default logger;
