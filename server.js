import "./loadEnv.js";
import { log } from "./logger.js";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import contactRouter from "./routes/contact.js";
import passkeyRouter from "./routes/passkey.js";
import climbingRouter from "./routes/climbing.js";
import githubRouter from "./routes/github.js";
import chatRouter from "./routes/chat.js";
import newsRouter from "./routes/news.js"; // ← NUEVO: noticias IA
import sessionRouter from "./routes/session.js";
import { ipCliente } from "./utils/clientIp.js";
import { asegurarRetencionLogs } from "./utils/retencionLogs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Cabeceras de seguridad (comprobadas con: dam check-headers https://portfolio-backend-m07q.onrender.com)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],                                         // sin scripts en línea: admin usa /admin-static/*.js
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], // el <style> de admin.html
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],                                    // nadie puede meter el admin en un iframe
    },
  },
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
}));
app.use((req, res, next) => {
  // Apaga lo que el backend no usa; deja las passkeys (WebAuthn) del login de admin
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  next();
});

app.use(express.json({ limit: "50kb" }));

// CORS: acepta producción + desarrollo local
app.use(cors({
  origin: [
    process.env.ALLOWED_ORIGIN || "https://gabi37smx.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ],
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Demasiados envíos. Inténtalo más tarde." },
  skip: (req) => req.method !== "POST",
  keyGenerator: (req) => ipCliente(req), // IP real del visitante, no la del proxy de Render
});
app.use("/api/contact", limiter);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ MongoDB conectado");
    log.info("Servidor conectado a MongoDB", { accion: "db_conectada" });
    asegurarRetencionLogs();
  })
  .catch((err) => {
    console.error("❌ Error MongoDB:", err.message);
    log.error("Error de conexión a MongoDB", { error: err.message });
  });

app.use("/vendor", express.static(path.join(__dirname, "vendor")));
app.use("/admin-static", express.static(path.join(__dirname, "public")));
app.use("/api/contact", contactRouter);
app.use("/api/session", sessionRouter);
app.use("/api/passkey", passkeyRouter);
app.use("/api/climbing", climbingRouter);
app.use("/api/github", githubRouter);
app.use("/api/chat", chatRouter);
app.use("/api/news", newsRouter); // ← NUEVO: noticias IA

app.get("/", (req, res) => {
  res.json({ ok: true, servicio: "portfolio-backend", version: "1.0" });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  log.info("Servidor arrancado", { puerto: PORT, entorno: process.env.NODE_ENV || "development" });
});