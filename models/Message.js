import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    nombre:   { type: String, required: true, trim: true },
    email:    { type: String, required: true, trim: true, lowercase: true },
    asunto:   { type: String, required: true, trim: true },
    mensaje:  { type: String, required: true, trim: true },
    telefono: { type: String, default: null },
    quiereLlamada: { type: Boolean, default: false },
    ip:       { type: String, default: null },
    userAgent:{ type: String, default: null },
    leido:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Message", MessageSchema);