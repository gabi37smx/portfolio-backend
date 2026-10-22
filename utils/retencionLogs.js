/* ============================================================
   utils/retencionLogs.js · Borrado automático de logs antiguos
   ------------------------------------------------------------
   Los logs se guardan en MongoDB (colección "logs"). Para que no llenen el
   cluster gratuito (512 MB), MongoDB los borra solo cuando tienen más de N días
   mediante un índice TTL sobre el campo "timestamp".

   · N sale de la variable de entorno LOG_RETENCION_DIAS (por defecto 14).
   · Se ejecuta al arrancar y es idempotente: si el índice ya está bien, no hace nada.
   · Si ya existía un índice sobre "timestamp" sin TTL (o con otro plazo), lo ajusta.
   ============================================================ */

import mongoose from "mongoose";
import { log } from "../logger.js";

export function diasDeRetencion() {
  const n = Number(process.env.LOG_RETENCION_DIAS);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : 14;
}

/* Recibe la base de datos para poder probarse sin conexión real */
export async function ajustarRetencion(db, dias) {
  const segundos = dias * 24 * 60 * 60;
  const col = db.collection("logs");

  let indices = [];
  try { indices = await col.indexes(); } catch { /* la colección aún no existe: se crea el índice abajo */ }

  const sobreFecha = indices.filter((i) => i.key && Object.keys(i.key).length === 1 && i.key.timestamp !== undefined);
  const conTTL = sobreFecha.find((i) => i.expireAfterSeconds !== undefined);

  if (conTTL && conTTL.expireAfterSeconds === segundos) return "ya_configurada";

  const existente = conTTL || sobreFecha[0];
  if (!existente) {
    await col.createIndex({ timestamp: 1 }, { expireAfterSeconds: segundos, name: "timestamp_ttl" });
    return "creada";
  }

  try {
    // MongoDB 5.1+ permite cambiar el plazo (o convertir un índice normal en TTL) sin recrearlo
    await db.command({ collMod: "logs", index: { keyPattern: existente.key, expireAfterSeconds: segundos } });
    return "ajustada";
  } catch {
    await col.dropIndex(existente.name);
    await col.createIndex({ timestamp: 1 }, { expireAfterSeconds: segundos, name: "timestamp_ttl" });
    return "recreada";
  }
}

export async function asegurarRetencionLogs() {
  const dias = diasDeRetencion();
  try {
    const resultado = await ajustarRetencion(mongoose.connection.db, dias);
    log.info(`Logs: retención de ${dias} días (${resultado})`, { accion: "retencion_logs", dias, resultado });
  } catch (err) {
    log.warn("No se pudo ajustar la retención de logs", { error: err.message });
  }
}