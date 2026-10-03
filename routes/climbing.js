import express from "express";
import rateLimit from "express-rate-limit";
import { log } from "../logger.js";

const router = express.Router();

const OPENBETA_URL = "https://api.openbeta.io/graphql";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 10;
const cache = new Map();

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: "Demasiadas consultas. Inténtalo más tarde." },
}));

async function queryOpenBeta(city) {
  const query = `
    query SearchAreas($search: String!) {
      areas(filter: { area_name: { match: $search } }) {
        area_name
        metadata { lat lng }
        totalClimbs
      }
    }
  `;

  const response = await fetch(OPENBETA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { search: city } }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`OpenBeta respondió ${response.status}`);
  const data = await response.json();
  if (data.errors?.length) throw new Error(`OpenBeta error: ${data.errors[0].message}`);
  return data.data?.areas || [];
}

function buildSearchLinks(city) {
  const query = encodeURIComponent(city);
  return {
    thecrag: `https://www.thecrag.com/search?q=${query}`,
    thetopo: `https://thetopo.com/site/search?qs=${query}`,
    google: `https://www.google.com/search?q=escalada%20${query}`,
  };
}

router.get("/zones", async (req, res) => {
  const ip = req.ip || "desconocida";
  const city = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!city) return res.status(400).json({ error: "Falta el parámetro q" });

  const cacheKey = city.toLocaleLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    log.info("OpenBeta: respuesta desde caché", { city, ip });
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const areas = await queryOpenBeta(city);
    const results = areas
      .filter((area) => area.area_name && area.metadata?.lat != null && area.metadata?.lng != null)
      .sort((first, second) => (second.totalClimbs || 0) - (first.totalClimbs || 0))
      .slice(0, MAX_RESULTS)
      .map((area) => {
        const { lat, lng } = area.metadata;
        return {
          name: area.area_name,
          lat,
          lng,
          totalClimbs: area.totalClimbs || 0,
          mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
          directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
        };
      });

    const payload = {
      city,
      count: results.length,
      searchLinks: buildSearchLinks(city),
      results,
      source: "OpenBeta (openbeta.io)",
    };
    cache.set(cacheKey, { time: Date.now(), data: payload });
    log.info("OpenBeta: consulta correcta", { city, ip, zonas: results.length });
    return res.json({ ...payload, cached: false });
  } catch (error) {
    log.error("Error consultando OpenBeta", { error: error.message, city, ip });
    return res.status(200).json({
      city,
      count: 0,
      searchLinks: buildSearchLinks(city),
      results: [],
      source: "OpenBeta (openbeta.io)",
      error: "No se pudo consultar OpenBeta en este momento",
    });
  }
});

export default router;