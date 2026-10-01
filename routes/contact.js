import express from "express";
import mongoose from "mongoose";
import { Resend } from "resend";
import Message from "../models/Message.js";
import { log } from "../logger.js";
import { adminAuth } from "../middleware/auth.js";

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/contact — recibe el formulario
router.post("/", async (req, res) => {
  const ip = req.ip || "desconocida";

  try {
    const { nombre, email, asunto, mensaje, telefono, quiereLlamada } = req.body;

    log.info("Nuevo intento de envío de formulario", {
      accion: "formulario_recibido",
      ip,
    });

    if (!nombre || !email || !asunto || !mensaje) {
      log.warn("Formulario rechazado: faltan campos obligatorios", { ip });
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    if (mensaje.length < 10) {
      log.warn("Formulario rechazado: mensaje demasiado corto", {
        ip,
        longitud: mensaje.length,
      });
      return res.status(400).json({ error: "El mensaje es demasiado corto" });
    }

    const nuevo = await Message.create({
      nombre,
      email,
      asunto,
      mensaje,
      telefono: quiereLlamada ? telefono : null,
      quiereLlamada: !!quiereLlamada,
      ip,
      userAgent: req.get("user-agent"),
    });
    log.info("Mensaje guardado en MongoDB", {
      accion: "mensaje_guardado",
      id: nuevo._id.toString(),
    });

    // --- 1) Email de aviso para mí (el dueño) ---
    try {
      await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: process.env.NOTIFY_EMAIL,
        subject: `📬 Nuevo mensaje: ${asunto}`,
        html: `
          <h2>Nuevo mensaje desde el portfolio</h2>
          <p><strong>Nombre:</strong> ${escapeHtml(nombre)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          ${quiereLlamada ? `<p><strong>Teléfono:</strong> ${escapeHtml(telefono)}</p>` : ""}
          <p><strong>Asunto:</strong> ${escapeHtml(asunto)}</p>
          <hr>
          <p>${escapeHtml(mensaje).replace(/\n/g, "<br>")}</p>
          <hr>
          <small>Guardado en MongoDB con ID ${nuevo._id}</small>
        `,
      });
      log.info("Email de aviso enviado al dueño", { id: nuevo._id.toString() });
    } catch (emailErr) {
      log.error("Error enviando email al dueño", {
        accion: "email_aviso_fallido",
        mensajeId: nuevo._id.toString(),
        error: emailErr.message,
      });
    }

    // --- 2) Email de auto-respuesta para el usuario que escribió ---
    try {
      await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: email,
        replyTo: process.env.NOTIFY_EMAIL,
        subject: `He recibido tu mensaje, ${escapeHtml(nombre.split(" ")[0])}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a; line-height: 1.6;">

            <div style="border: 2px solid #1a1a1a; padding: 24px; background: #faf6ed; box-shadow: 4px 4px 0 #1a1a1a;">

              <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 24px; margin: 0 0 16px; color: #1a1a1a;">
                Hola, ${escapeHtml(nombre.split(" ")[0])} 👋
              </h1>

              <p style="margin: 0 0 16px;">
                Soy <strong>Gabriel Vidal</strong>. He recibido tu mensaje desde mi portfolio y te lo confirmo por aquí para que tengas constancia.
              </p>

              <p style="margin: 0 0 16px;">
                Te contestaré personalmente en <strong>24–48 horas</strong>. Si es urgente, puedes responderme directamente a este mismo correo.
              </p>

              <hr style="border: none; border-top: 1px dashed #c9c0ad; margin: 24px 0;">

              <p style="font-size: 13px; color: #6b6b6b; margin: 0 0 8px; font-family: 'Courier New', monospace; text-transform: uppercase; letter-spacing: 0.05em;">
                Copia de tu mensaje
              </p>

              <div style="background: #f2ede3; padding: 12px 16px; border-left: 3px solid #c1272d; font-size: 14px; color: #4a4a4a;">
                <p style="margin: 0 0 8px;"><strong>Asunto:</strong> ${escapeHtml(asunto)}</p>
                <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(mensaje)}</p>
              </div>

              <hr style="border: none; border-top: 1px dashed #c9c0ad; margin: 24px 0;">

              <p style="margin: 0 0 8px; font-size: 14px;">
                Un saludo,<br>
                <strong>Gabriel Vidal Badia</strong>
              </p>

              <p style="margin: 0; font-size: 13px; color: #6b6b6b;">
                🧗 Portfolio: <a href="https://gabi37smx.github.io/mi-web/" style="color: #c1272d; text-decoration: none;">gabi37smx.github.io/mi-web</a><br>
                🐙 GitHub: <a href="https://github.com/gabi37smx" style="color: #c1272d; text-decoration: none;">github.com/gabi37smx</a><br>
                💼 LinkedIn: <a href="https://www.linkedin.com/in/gabriel-vidal-badia-19122a43b" style="color: #c1272d; text-decoration: none;">linkedin.com/in/gabriel-vidal-badia</a>
              </p>

            </div>

            <p style="text-align: center; font-size: 11px; color: #8a8175; margin: 16px 0 0;">
              Este correo se ha enviado automáticamente al recibir tu mensaje desde el portfolio.
            </p>

          </div>
        `,
      });
      log.info("Email de auto-respuesta enviado al usuario", { id: nuevo._id.toString() });
    } catch (emailErr) {
      log.error("Error enviando auto-respuesta al usuario", {
        accion: "email_confirmacion_fallida",
        mensajeId: nuevo._id.toString(),
        error: emailErr.message,
      });
    }

    return res.status(201).json({ ok: true, id: nuevo._id });
  } catch (err) {
    log.error("Error inesperado en /api/contact", {
      error: err.message,
      stack: err.stack,
      ip,
    });
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /api/contact/messages — solo admin
router.get("/messages", adminAuth, async (req, res) => {
  try {
    const mensajes = await Message.find().sort({ createdAt: -1 }).limit(200);
    res.json(mensajes);
  } catch (err) {
    log.error("Error al leer mensajes de contacto", { error: err.message });
    res.status(500).json({ error: "Error al leer mensajes" });
  }
});

// GET /api/contact/logs — solo admin, últimos 100 logs
router.get("/logs", adminAuth, async (req, res) => {
  try {
    const { nivel } = req.query;
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB no está conectado");

    const filtro = {};
    if (nivel && ["info", "warn", "error"].includes(nivel)) {
      filtro.level = nivel;
    }

    const logs = await db
      .collection("logs")
      .find(filtro)
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();

    res.json(logs);
  } catch (err) {
    log.error("Error leyendo logs", { error: err.message });
    res.status(500).json({ error: "Error al leer logs" });
  }
});

// PATCH /api/contact/messages/:id/leido
router.patch("/messages/:id/leido", adminAuth, async (req, res) => {
  try {
    await Message.findByIdAndUpdate(req.params.id, { leido: true });
    res.json({ ok: true });
  } catch (err) {
    log.error("Error al actualizar mensaje de contacto", {
      mensajeId: req.params.id,
      error: err.message,
    });
    res.status(500).json({ error: "Error al actualizar" });
  }
});

// Helper para escapar HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export default router;