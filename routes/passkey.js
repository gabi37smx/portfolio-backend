/* ============================================================
   routes/passkey.js · Registro y login con WebAuthn (passkeys)
   ============================================================ */

import express from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import Passkey from "../models/Passkey.js";
import { log } from "../logger.js";
import { adminAuth } from "../middleware/auth.js";

const router = express.Router();

/* Configuración del Relying Party.
   El rpID debe ser el dominio sin protocolo ni puerto.
   En local: "localhost". En producción: "portfolio-backend-m07q.onrender.com". */
const RP_NAME = "Portfolio Gabriel Vidal";
function getRpID() {
  if (process.env.NODE_ENV === "production") {
    return "portfolio-backend-m07q.onrender.com";
  }
  return "localhost";
}
function getOrigin() {
  if (process.env.NODE_ENV === "production") {
    return "https://portfolio-backend-m07q.onrender.com";
  }
  return "http://localhost:3000";
}

/* Guardamos el challenge temporalmente en memoria.
   Es suficiente para un solo admin. Dura 5 minutos. */
const challenges = new Map();
function saveChallenge(key, challenge) {
  challenges.set(key, { challenge, expiresAt: Date.now() + 5 * 60 * 1000 });
  // Limpieza automática
  setTimeout(() => challenges.delete(key), 5 * 60 * 1000);
}
function getChallenge(key) {
  const data = challenges.get(key);
  if (!data) return null;
  if (Date.now() > data.expiresAt) { challenges.delete(key); return null; }
  return data.challenge;
}
function clearChallenge(key) {
  challenges.delete(key);
}

/* Convierte Uint8Array / Buffer / string a base64url seguro para el navegador */
function toBase64URL(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^\d+(,\d+)+$/.test(value)) {
      const bytes = value.split(",").map(Number);
      if (bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
        return Buffer.from(bytes).toString("base64url");
      }
    }
    return value;
  }
  return Buffer.from(value).toString("base64url");
}

/* ============================================================
   REGISTRO · Paso 1: generar opciones
   ============================================================ */

router.post("/register/options", async (req, res) => {
  try {
    const existingPasskeys = await Passkey.find();

    const excludeCredentials = existingPasskeys.map((p) => {
      const entry = {
        id: Buffer.from(toBase64URL(p.credentialID), "base64url"),
        type: "public-key",
      };

      if (Array.isArray(p.transports) && p.transports.length > 0) {
        entry.transports = p.transports;
      }

      return entry;
    });

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpID(),
      userID: Buffer.from("admin-gabriel", "utf-8"),
      userName: "admin",
      userDisplayName: "Gabriel Vidal (admin)",
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials,
    });

    /* Normalizamos la respuesta para que el navegador la entienda.
       Convertimos cualquier Uint8Array/Buffer a string base64url. */
    const safeOptions = {
      ...options,
      challenge: toBase64URL(options.challenge),
      user: {
        ...options.user,
        id: toBase64URL(options.user.id),
      },
      excludeCredentials: (options.excludeCredentials || []).map((c) => {
        const entry = {
          id: toBase64URL(c.id),
          type: c.type || "public-key",
        };

        if (Array.isArray(c.transports) && c.transports.length > 0) {
          entry.transports = c.transports;
        }

        return entry;
      }),
    };

    saveChallenge("register", options.challenge);
    log.info("Passkey: opciones de registro generadas");

    res.json(safeOptions);
  } catch (err) {
    log.error("Error generando opciones de registro", {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ error: "Error generando opciones de registro" });
  }
});

/* ============================================================
   REGISTRO · Paso 2: verificar la respuesta del navegador
   ============================================================ */

router.post("/register/verify", async (req, res) => {
  try {
    const expectedChallenge = getChallenge("register");
    if (!expectedChallenge) {
      return res.status(400).json({ error: "Challenge caducado o inexistente" });
    }

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpID(),
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      log.warn("Passkey: verificación de registro fallida");
      return res.status(400).json({ error: "Verificación fallida" });
    }

    /* SimpleWebAuthn v9 devuelve registrationInfo con dos posibles formas:
       - Anidada: { credential: { id, publicKey, counter, transports }, credentialDeviceType, credentialBackedUp }
       - Plana:   { credentialID, credentialPublicKey, counter, transports, credentialDeviceType, credentialBackedUp }
       Soportamos las dos por seguridad. */
    const info = verification.registrationInfo;

    const credentialID = info.credential?.id ?? info.credentialID;
    const credentialPublicKey = info.credential?.publicKey ?? info.credentialPublicKey;
    const counter = info.credential?.counter ?? info.counter ?? 0;
    const transports = info.credential?.transports ?? info.transports ?? [];
    const deviceType = info.credentialDeviceType ?? "singleDevice";
    const backedUp = info.credentialBackedUp ?? false;

    if (!credentialID || !credentialPublicKey) {
      log.error("Passkey: registrationInfo sin credencial válida", {
        keys: Object.keys(info || {}),
      });
      return res.status(500).json({ error: "Respuesta de registro inválida" });
    }

    await Passkey.create({
      credentialID: toBase64URL(credentialID),
      credentialPublicKey: Buffer.from(credentialPublicKey).toString("base64url"),
      counter,
      transports,
      deviceType,
      backedUp,
      nombre: req.body.nombre || "Dispositivo sin nombre",
    });

    clearChallenge("register");
    log.info("Passkey: nueva credencial registrada", {
      credentialID,
      deviceType,
    });

    res.json({ verified: true });
  } catch (err) {
    log.error("Error verificando registro de passkey", {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ error: "Error verificando registro" });
  }
});

/* ============================================================
   LOGIN · Paso 1: generar opciones de autenticación
   ============================================================ */

router.post("/login/options", async (req, res) => {
  try {
    const passkeys = await Passkey.find();

    if (!passkeys.length) {
      return res.status(400).json({ error: "No hay passkeys registradas" });
    }

    const allowCredentials = passkeys.map((p) => {
      const entry = {
        id: Buffer.from(toBase64URL(p.credentialID), "base64url"),
        type: "public-key",
      };

      if (Array.isArray(p.transports) && p.transports.length > 0) {
        entry.transports = p.transports;
      }

      return entry;
    });

    const options = await generateAuthenticationOptions({
      rpID: getRpID(),
      allowCredentials,
      userVerification: "preferred",
    });

    const safeOptions = {
      ...options,
      challenge: toBase64URL(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((c) => {
        const entry = {
          id: toBase64URL(c.id),
          type: c.type || "public-key",
        };

        if (Array.isArray(c.transports) && c.transports.length > 0) {
          entry.transports = c.transports;
        }

        return entry;
      }),
    };

    saveChallenge("login", options.challenge);
    log.info("Passkey: opciones de login generadas");

    res.json(safeOptions);
  } catch (err) {
    log.error("Error generando opciones de login", {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ error: "Error generando opciones de login" });
  }
});

/* ============================================================
   LOGIN · Paso 2: verificar la firma del navegador
   ============================================================ */

router.post("/login/verify", async (req, res) => {
  try {
    const expectedChallenge = getChallenge("login");
    if (!expectedChallenge) {
      return res.status(400).json({ error: "Challenge caducado o inexistente" });
    }

    let passkey = await Passkey.findOne({ credentialID: req.body.id });
    if (!passkey && typeof req.body.id === "string") {
      const savedPasskeys = await Passkey.find();
      passkey = savedPasskeys.find(
        (entry) => toBase64URL(entry.credentialID) === req.body.id
      );
      if (passkey) {
        passkey.credentialID = req.body.id;
        await passkey.save();
      }
    }

    if (!passkey) {
      log.warn("Passkey: credencial no encontrada", { id: req.body.id });
      return res.status(400).json({ error: "Credencial no registrada" });
    }

    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpID(),
      authenticator: {
        credentialID: Buffer.from(passkey.credentialID, "base64url"),
        credentialPublicKey: Buffer.from(passkey.credentialPublicKey, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.authenticationInfo) {
      log.warn("Passkey: verificación de login fallida");
      return res.status(400).json({ error: "Verificación fallida" });
    }

    passkey.counter = verification.authenticationInfo.newCounter ?? passkey.counter;
    passkey.lastUsedAt = new Date();
    await passkey.save();

    clearChallenge("login");
    log.info("Passkey: login correcto", { credentialID: passkey.credentialID });

    res.json({ verified: true, password: process.env.ADMIN_PASSWORD });
  } catch (err) {
    log.error("Error verificando login con passkey", {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ error: "Error verificando login" });
  }
});

/* ============================================================
   LISTAR passkeys registradas (para el admin)
   ============================================================ */

router.get("/list", adminAuth, async (req, res) => {
  try {
    const passkeys = await Passkey.find().select("-credentialPublicKey");
    res.json(passkeys);
  } catch (err) {
    res.status(500).json({ error: "Error listando passkeys" });
  }
});

/* ============================================================
   BORRAR una passkey (por si pierdes un dispositivo)
   ============================================================ */

router.delete("/:credentialID", adminAuth, async (req, res) => {
  try {
    await Passkey.deleteOne({ credentialID: req.params.credentialID });
    log.info("Passkey: credencial eliminada", { id: req.params.credentialID });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error eliminando passkey" });
  }
});

export default router;
