import express from "express";
import rateLimit from "express-rate-limit";
import { log } from "../logger.js";

const router = express.Router();

const OVERPASS_ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const DEFAULT_RADIUS_KM = 30;
const MAX_RADIUS_KM = 60;
const MAX_RESULTS = 12;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: "Demasiadas consultas. Inténtalo más tarde." },
}));

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function buildQuery(lat, lon, radiusKm) {
  const radiusMeters = Math.round(radiusKm * 1000);
  return `[out:json][timeout:20];
(
  node["sport"="climbing"](around:${radiusMeters},${lat},${lon});
  way["sport"="climbing"](around:${radiusMeters},${lat},${lon});
  node["climbing"="crag"](around:${radiusMeters},${lat},${lon});
  way["climbing"="crag"](around:${radiusMeters},${lat},${lon});
  node["climbing"="boulder"](around:${radiusMeters},${lat},${lon});
  way["climbing"="boulder"](around:${radiusMeters},${lat},${lon});
  node["climbing"="area"](around:${radiusMeters},${lat},${lon});
  way["climbing"="area"](around:${radiusMeters},${lat},${lon});
  node["climbing:sport"="yes"](around:${radiusMeters},${lat},${lon});
  way["climbing:sport"="yes"](around:${radiusMeters},${lat},${lon});
  node["climbing:boulder"="yes"](around:${radiusMeters},${lat},${lon});
  way["climbing:boulder"="yes"](around:${radiusMeters},${lat},${lon});
);
out center tags;`;
}

function googleSite(site, name) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} escalada site:${site}`)}`;
}

function isIndoor(tags) {
  return (
    tags.leisure === "sports_centre" ||
    tags.leisure === "fitness_centre" ||
    tags.indoor === "yes" ||
    tags["climbing:indoor"] === "yes" ||
    tags.climbing === "indoor"
  );
}

async function queryOverpass(query) {
  let lastError;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      log.info("Consultando Overpass", { url });
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "portfolio-backend/1.0 (+https://gabrielvidal.dev)",
          Referer: "https://gabrielvidal.dev/",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error(`Overpass respondió ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("json")) {
        const text = await response.text();
        throw new Error(`Overpass devolvió ${contentType || "sin Content-Type"}: ${text.slice(0, 300)}`);
      }
      const data = await response.json();
      log.info("Overpass respondió correctamente", { url, elementos: data.elements?.length || 0 });
      return data;
    } catch (error) {
      lastError = error;
      log.warn("Fallo en un servidor Overpass", { url, error: error.message });
    }
  }
  throw lastError;
}

function parseElements(elements, lat, lon) {
  const ignoredClimbingTags = new Set(["route", "route_bottom", "route_top", "pitch"]);
  const seen = new Set();
  const results = [];

  for (const element of elements) {
    const tags = element.tags || {};
    if (ignoredClimbingTags.has(tags.climbing)) continue;

    const areaLat = element.lat ?? element.center?.lat;
    const areaLon = element.lon ?? element.center?.lon;
    if (areaLat == null || areaLon == null) continue;

    const rawName = typeof tags.name === "string" ? tags.name.trim() : "";
    const indoor = isIndoor(tags);
    const fallbackName = indoor
      ? "Rocódromo"
      : tags.climbing === "boulder" || tags["climbing:boulder"] === "yes"
        ? "Zona de búlder"
        : tags.climbing === "crag"
          ? "Zona de escalada"
          : tags.climbing === "area"
            ? "Área de escalada"
            : "Zona de escalada";
    const name = rawName || fallbackName;
    const key = `${name.toLowerCase()}|${areaLat.toFixed(3)}|${areaLon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const types = [];
    if (tags["climbing:sport"] === "yes" || tags.climbing === "sport") types.push("sport");
    if (tags["climbing:boulder"] === "yes" || tags.climbing === "boulder") types.push("boulder");
    if (tags["climbing:trad"] === "yes") types.push("trad");
    if (tags["climbing:toprope"] === "yes") types.push("toprope");

    const routes = Number.parseInt(tags["climbing:routes"], 10);
    results.push({
      id: `${element.type}/${element.id}`,
      name,
      lat: areaLat,
      lon: areaLon,
      indoor,
      distance_km: Math.round(haversineKm(lat, lon, areaLat, areaLon) * 10) / 10,
      types,
      routes: Number.isFinite(routes) ? routes : null,
      website: tags.website || tags["contact:website"] || null,
      osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${areaLat},${areaLon}`,
      directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${areaLat},${areaLon}&travelmode=driving`,
      topoLinks: {
        thecrag: googleSite("thecrag.com", name),
        crags27: googleSite("27crags.com", name),
      },
    });
  }

  results.sort((first, second) => first.distance_km - second.distance_km);
  return results.slice(0, MAX_RESULTS * 2);
}


router.get("/", async (req, res) => {
  const ip = req.ip || "desconocida";
  const lat = Number.parseFloat(req.query.lat);
  const lon = Number.parseFloat(req.query.lon);
  const requestedRadius = Number.parseFloat(req.query.radius);
  const cityName = typeof req.query.city === "string" ? req.query.city.trim() : "";
  const radius = Number.isFinite(requestedRadius)
    ? Math.min(Math.max(requestedRadius, 1), MAX_RADIUS_KM)
    : DEFAULT_RADIUS_KM;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: "Parámetros lat y lon no válidos" });
  }

  const searchLinks = cityName
    ? {
        thecrag: `https://www.thecrag.com/es/climbing/search?q=${encodeURIComponent(cityName)}`,
        crags27: `https://27crags.com/search?q=${encodeURIComponent(cityName)}`,
        google: `https://www.google.com/search?q=${encodeURIComponent(`escalada ${cityName}`)}`,
      }
    : null;

  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)},${radius}`;
  try {
    let areas;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      areas = cached.areas;
    } else {
      const data = await queryOverpass(buildQuery(lat, lon, radius));
      areas = parseElements(data.elements || [], lat, lon);
      cache.set(cacheKey, { time: Date.now(), areas });
    }

    const results = areas.slice(0, MAX_RESULTS);
    const payload = {
      center: { lat, lon },
      city: cityName || null,
      radius_km: radius,
      count: results.length,
      source: "OpenStreetMap contributors (ODbL)",
      searchLinks,
      results,
    };

    log.info("Consulta de zonas de escalada", {
      accion: "climbing_consulta",
      ip,
      lat,
      lon,
      radio_km: radius,
      resultados: results.length,
      ciudad: cityName || "(sin nombre)",
    });

    return res.json({
      ...payload,
      cached: Boolean(cached && Date.now() - cached.time < CACHE_TTL_MS),
    });
  } catch (error) {
    log.error("Error consultando zonas de escalada", { error: error.message, ip });
    return res.status(200).json({
      center: { lat, lon },
      city: cityName || null,
      radius_km: radius,
      count: 0,
      source: "OpenStreetMap contributors (ODbL)",
      searchLinks,
      results: [],
      error: "No se pudo consultar Overpass en este momento",
    });
  }
});

export default router;