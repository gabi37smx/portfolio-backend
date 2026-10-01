/* ============================================================
   models/Passkey.js · Credenciales de passkey registradas
   ============================================================ */

import mongoose from "mongoose";

const PasskeySchema = new mongoose.Schema(
  {
    // ID de la credencial (base64url). Es la clave primaria lógica.
    credentialID: { type: String, required: true, unique: true, index: true },

    // Clave pública (bytes en base64url). SimpleWebAuthn la devuelve como Uint8Array.
    credentialPublicKey: { type: String, required: true },

    // Contador de firmas (para detectar clonación). Los passkeys sincronizados lo dejan en 0.
    counter: { type: Number, default: 0 },

    // Transportes soportados (usb, nfc, ble, internal, hybrid).
    transports: { type: [String], default: [] },

    // Tipo de dispositivo: 'singleDevice' o 'multiDevice'
    deviceType: { type: String, default: "singleDevice" },

    // ¿Está sincronizada (iCloud Keychain, Google Password Manager)?
    backedUp: { type: Boolean, default: false },

    // Nombre amigable para el usuario ("Mi MacBook", "iPhone de Gabriel")
    nombre: { type: String, default: "Dispositivo sin nombre" },

    // Fecha del último uso (para saber qué passkey está activa)
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("Passkey", PasskeySchema);
