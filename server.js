import "./loadEnv.js";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import contactRouter from "./routes/contact.js";
import { adminAuth } from "./middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: "50kb" }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Demasiados envíos. Inténtalo más tarde." },
  // Solo cuentan las peticiones POST
  skip: (req) => req.method !== "POST",
});
app.use("/api/contact", limiter);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Error MongoDB:", err.message));

app.use("/api/contact", contactRouter);

app.get("/", (req, res) => {
  res.json({ ok: true, servicio: "portfolio-backend", version: "1.0" });
});

app.get("/admin", adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
});