import express from "express";
import { Resend } from "resend";
import Message from "../models/Message.js";

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/contact — recibe el formulario
router.post("/", async (req, res) => {
  try {
    const { nombre, email, asunto, mensaje, telefono, quiereLlamada } = req.body;

    if (!nombre || !email || !asunto || !mensaje) {
      return res.status(400).json({ error: "Faltan campos obligatorios" });
    }
    if (mensaje.length < 10) {
      return res.status(400).json({ error: "El mensaje es demasiado corto" });
    }

    const nuevo = await Message.create({
      nombre,
      email,
      asunto,
      mensaje,
      telefono: quiereLlamada ? telefono : null,
      quiereLlamada: !!quiereLlamada,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    // Enviar email de aviso (no bloquea si falla)
    try {
      await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: process.env.NOTIFY_EMAIL,
        subject: `📬 Nuevo mensaje: ${asunto}`,
        html: `
          <h2>Nuevo mensaje desde el portfolio</h2>
          <p><strong>Nombre:</strong> ${nombre}</p>
          <p><strong>Email:</strong> ${email}</p>
          ${quiereLlamada ? `<p><strong>Teléfono:</strong> ${telefono}</p>` : ""}
          <p><strong>Asunto:</strong> ${asunto}</p>
          <hr>
          <p>${mensaje.replace(/\n/g, "<br>")}</p>
          <hr>
          <small>Guardado en MongoDB con ID ${nuevo._id}</small>
        `,
      });
    } catch (emailErr) {
      console.error("Error enviando email:", emailErr.message);
    }

    res.status(201).json({ ok: true, id: nuevo._id });
  } catch (err) {
    console.error("Error en /api/contact:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// GET /api/contact/messages — solo admin
router.get("/messages", async (req, res) => {
  try {
    const mensajes = await Message.find().sort({ createdAt: -1 }).limit(200);
    res.json(mensajes);
  } catch (err) {
    res.status(500).json({ error: "Error al leer mensajes" });
  }
});

// PATCH /api/contact/messages/:id/leido
router.patch("/messages/:id/leido", async (req, res) => {
  try {
    await Message.findByIdAndUpdate(req.params.id, { leido: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error al actualizar" });
  }
});

export default router;