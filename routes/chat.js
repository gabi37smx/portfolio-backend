// routes/chat.js
// Proxy del chatbot "Cordada".
// La web NUNCA habla directamente con el servicio de IA externo: habla con
// este servidor, y este servidor habla con el servicio. Así podemos limitar
// abusos, reutilizar respuestas repetidas y no exponer nada al visitante.
// (En server.js este router se monta en /api/chat, así que aquí la ruta es "/").

import express from "express";
import rateLimit from "express-rate-limit";
import { log } from "../logger.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// AJUSTES
// Van juntos y con nombre para poder cambiarlos sin buscar números sueltos
// por todo el fichero.
// ---------------------------------------------------------------------------
const API_URL = "https://text.pollinations.ai/";
const TIMEOUT_MS = 20 * 1000;          // esperamos 20 segundos como máximo
const MAX_PREGUNTA = 500;              // caracteres
const MAX_INSTRUCCIONES = 4000;        // caracteres
const MAX_HISTORIAL_ITEMS = 4;         // solo las últimas 4 frases
const MAX_HISTORIAL_FRASE = 500;       // tope por frase (evita colar textos enormes por aquí)
const CACHE_TTL_MS = 30 * 60 * 1000;   // 30 minutos
const CACHE_MAX_ENTRADAS = 100;        // a partir de aquí limpiamos
const IDIOMAS_VALIDOS = ["es", "val", "en"];

// ---------------------------------------------------------------------------
// LIMITADOR DE PETICIONES
// Evita que una sola persona (o un programa automático) llene el servicio de
// preguntas. Aquí: 10 peticiones por IP cada 15 minutos. Está declarado fuera
// del handler para que vaya contando entre visitas distintas.
// ---------------------------------------------------------------------------
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      error: "Demasiadas peticiones, inténtalo en un rato",
    });
  },
});

// ---------------------------------------------------------------------------
// CACHÉ EN MEMORIA
// Si dos visitantes hacen la misma pregunta, la segunda vez respondemos al
// instante con lo guardado: es más rápido y no gastamos el servicio gratuito.
// Está FUERA del handler a propósito: si estuviera dentro, se vaciaría en
// cada petición y no serviría para nada.
// Se pierde al reiniciar el servidor, y no pasa nada: solo es un atajo.
// ---------------------------------------------------------------------------
const cache = new Map(); // clave: pregunta normalizada → { respuesta, timestamp }

// Deja la pregunta "limpia" para que "Hola  " y "hola" cuenten como la misma.
function normalizar(texto) {
  return texto.trim().toLowerCase().replace(/\s+/g, " ");
}

// Evita que la memoria crezca sin control: cuando hay demasiadas entradas,
// borra primero las caducadas y, si aun así sigue lleno, las más antiguas.
function limpiarCache() {
  if (cache.size <= CACHE_MAX_ENTRADAS) return;

  const ahora = Date.now();
  for (const [clave, valor] of cache) {
    if (ahora - valor.timestamp > CACHE_TTL_MS) cache.delete(clave);
  }

  // Un Map recuerda el orden de inserción: las primeras son las más viejas.
  while (cache.size > CACHE_MAX_ENTRADAS) {
    const masAntigua = cache.keys().next().value;
    cache.delete(masAntigua);
  }
}

// ---------------------------------------------------------------------------
// LLAMADA AL SERVICIO EXTERNO
// Va en su propia función para que el endpoint se lea de arriba abajo sin
// perderse en detalles técnicos.
// ---------------------------------------------------------------------------
async function preguntarAlBot(textoCompleto) {
  // El "controlador" nos permite cortar la petición si tarda demasiado.
  // Sin esto, un servicio colgado dejaría al visitante esperando para siempre.
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const respuestaHttp = await fetch(API_URL + encodeURIComponent(textoCompleto), {
      method: "GET",
      signal: controlador.signal,
    });

    // Cualquier cosa distinta de 200 la tratamos como fallo del servicio.
    if (respuestaHttp.status !== 200) {
      throw new Error(`La API externa respondió con estado ${respuestaHttp.status}`);
    }

    // La respuesta es texto normal, no JSON.
    const texto = (await respuestaHttp.text()).trim();

    // Una respuesta vacía no le sirve a nadie: la tratamos como fallo.
    if (!texto) {
      throw new Error("La API externa devolvió una respuesta vacía");
    }

    return texto;
  } finally {
    // Pase lo que pase, apagamos el temporizador para no dejar tareas colgadas.
    clearTimeout(temporizador);
  }
}

// ---------------------------------------------------------------------------
// ENDPOINT: POST /api/chat
// ---------------------------------------------------------------------------
router.post("/", chatLimiter, async (req, res) => {
  try {
    // "|| {}" evita un fallo si alguien envía la petición sin cuerpo.
    const { instrucciones, historial, pregunta, idioma } = req.body || {};

    // --- Validación -------------------------------------------------------
    // Comprobamos todo ANTES de gastar recursos llamando al servicio externo.

    // Faltan datos obligatorios (o no son texto).
    if (
      typeof instrucciones !== "string" || !instrucciones.trim() ||
      typeof pregunta !== "string" || !pregunta.trim()
    ) {
      return res.status(400).json({ ok: false, error: "Faltan datos" });
    }

    // Pregunta demasiado larga.
    if (pregunta.length > MAX_PREGUNTA) {
      return res.status(400).json({ ok: false, error: "Pregunta demasiado larga" });
    }

    // Instrucciones demasiado largas: protege contra quien intente usar este
    // endpoint como pasarela gratuita para textos enormes.
    if (instrucciones.length > MAX_INSTRUCCIONES) {
      return res.status(400).json({ ok: false, error: "Instrucciones demasiado largas" });
    }

    // Si el historial no es una lista, lo ignoramos en vez de dar error:
    // el chat sigue funcionando, solo que sin memoria de lo anterior.
    // Además nos quedamos solo con textos, las últimas 4 frases y con tope de tamaño.
    const historialLimpio = Array.isArray(historial)
      ? historial
          .filter((frase) => typeof frase === "string")
          .slice(-MAX_HISTORIAL_ITEMS)
          .map((frase) => frase.slice(0, MAX_HISTORIAL_FRASE))
      : [];

    // Si el idioma no es uno de los esperados, usamos español.
    const idiomaFinal = IDIOMAS_VALIDOS.includes(idioma) ? idioma : "es";

    // --- Caché ------------------------------------------------------------
    const clave = normalizar(pregunta);
    const guardada = cache.get(clave);
    const hayCacheValida = Boolean(guardada) && Date.now() - guardada.timestamp < CACHE_TTL_MS;

    // Registro de la petición. Solo guardamos la LONGITUD de la pregunta,
    // nunca el texto: lo que escribe un visitante es privado.
    log.info("Petición de chat recibida", {
      accion: "chat_recibido",
      idioma: idiomaFinal,
      longitudPregunta: pregunta.length,
      cacheHit: hayCacheValida,
    });

    if (hayCacheValida) {
      return res.json({ ok: true, respuesta: guardada.respuesta });
    }

    // Si estaba caducada, la quitamos para no acumular basura.
    if (guardada) cache.delete(clave);

    // --- Llamada al servicio externo ----------------------------------------
    // Montamos un único texto con las instrucciones, la conversación reciente
    // y la pregunta, porque este servicio solo acepta texto en la dirección web.
    const textoCompleto =
      instrucciones +
      "\n\nHISTORIAL:\n" + historialLimpio.join("\n") +
      "\n\nVISITANTE: " + pregunta;

    let respuesta;
    try {
      respuesta = await preguntarAlBot(textoCompleto);
    } catch (errorExterno) {
      // Aquí NO es un fallo nuestro: el servicio externo está lento o caído.
      // Es un aviso (warn) y no un error grave. Tampoco registramos la pregunta.
      const fueTimeout = errorExterno.name === "AbortError";
      log.warn(
        fueTimeout ? "La API del chatbot tardó demasiado (timeout)" : "La API del chatbot falló",
        {
          accion: fueTimeout ? "chat_timeout" : "chat_api_fallida",
          idioma: idiomaFinal,
          longitudPregunta: pregunta.length,
          error: fueTimeout ? "timeout" : errorExterno.message,
        }
      );

      return res.status(502).json({
        ok: false,
        error: "Cordada no puede responder ahora mismo. Inténtalo de nuevo en unos minutos.",
      });
    }

    // --- Guardar en caché y responder ---------------------------------------
    cache.set(clave, { respuesta, timestamp: Date.now() });
    limpiarCache();

    return res.json({ ok: true, respuesta });
  } catch (error) {
    // Cualquier fallo inesperado de nuestro propio código acaba aquí.
    // Es lo único que merece "error", porque nos toca a nosotros revisarlo.
    log.error("Error no controlado en /api/chat", {
      accion: "chat_error_inesperado",
      error: error.message,
    });

    return res.status(500).json({
      ok: false,
      error: "Ha ocurrido un problema inesperado. Inténtalo de nuevo más tarde.",
    });
  }
});

export default router;