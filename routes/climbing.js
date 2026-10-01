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
const WEATHER_TTL_MS = 15 * 60 * 1000;
const weatherCache = new Map();

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
  nwr["sport"="climbing"](around:${radiusMeters},${lat},${lon});
  nwr["climbing"~"^(crag|boulder|area|sport|indoor)$"](around:${radiusMeters},${lat},${lon});
  nwr["climbing:sport"="yes"](around:${radiusMeters},${lat},${lon});
  nwr["climbing:boulder"="yes"](around:${radiusMeters},${lat},${lon});
  nwr["leisure"="sports_centre"]["sport"="climbing"](around:${radiusMeters},${lat},${lon});
  nwr["leisure"="fitness_centre"]["sport"="climbing"](around:${radiusMeters},${lat},${lon});
);
out center tags 200;`;
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

function isBadWeather({ code, temperature, wind }) {
  return code >= 51 || wind > 35 || temperature < 3 || temperature > 33;
}

function weatherPenalty({ code, temperature, wind }) {
  return Math.min(code, 60) / 10 + wind / 5 + Math.abs(temperature - 17) / 3;
}

async function fetchWeather(locations) {
  const params = new URLSearchParams({
    latitude: locations.map((location) => location.lat.toFixed(4)).join(","),
    longitude: locations.map((location) => location.lon.toFixed(4)).join(","),
    current: "temperature_2m,wind_speed_10m,weather_code",
    timezone: "auto",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);

  const data = await response.json();
  const forecasts = Array.isArray(data) ? data : [data];
  return forecasts.map((location) => {
    if (!location.current) return null;
    const weather = {
      code: location.current.weather_code,
      temperature: Math.round(location.current.temperature_2m),
      wind: Math.round(location.current.wind_speed_10m),
    };
    return { ...weather, good: !isBadWeather(weather) };
  });
}

async function withWeather(cacheKey, areas, center) {
  let weatherByLocation;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.time < WEATHER_TTL_MS) {
    weatherByLocation = cached.data;
  } else {
    try {
      weatherByLocation = await fetchWeather([center, ...areas]);
      weatherCache.set(cacheKey, { time: Date.now(), data: weatherByLocation });
    } catch (error) {
      log.warn("No se pudo obtener el tiempo de las zonas", { error: error.message });
      weatherByLocation = [null, ...areas.map(() => null)];
    }
  }

  const referenceWeather = weatherByLocation[0] || null;
  const results = areas.map((area, index) => ({
    ...area,
    weather: weatherByLocation[index + 1] || null,
    best: false,
  }));
  const mode = referenceWeather
    ? isBadWeather(referenceWeather) ? "indoor" : "outdoor"
    : null;
  let filtered = mode === "indoor"
    ? results.filter((area) => area.indoor)
    : mode === "outdoor"
      ? results.filter((area) => !area.indoor)
      : results;
  let modeFallback = false;
  if (mode && filtered.length === 0 && results.length > 0) {
    filtered = results;
    modeFallback = true;
  }

  const candidates = mode === "outdoor"
    ? filtered.filter((area) => area.weather?.good)
    : [];
  let bestId = null;
  if (candidates.length > 0) {
    const best = candidates.reduce((first, second) =>
      weatherPenalty(first.weather) <= weatherPenalty(second.weather) ? first : second
    );
    best.best = true;
    bestId = best.id;
  }
  return { results: filtered.slice(0, MAX_RESULTS), bestId, mode, modeFallback, referenceWeather };
}

router.get("/", async (req, res) => {
  const ip = req.ip || "desconocida";
  const lat = Number.parseFloat(req.query.lat);
  const lon = Number.parseFloat(req.query.lon);
  const requestedRadius = Number.parseFloat(req.query.radius);
  const radius = Number.isFinite(requestedRadius)
    ? Math.min(Math.max(requestedRadius, 1), MAX_RADIUS_KM)
    : DEFAULT_RADIUS_KM;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: "Parámetros lat y lon no válidos" });
  }

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

    const { results, bestId, mode, modeFallback, referenceWeather } = await withWeather(
      cacheKey,
      areas,
      { lat, lon }
    );
    const payload = {
      center: { lat, lon },
      radius_km: radius,
      count: results.length,
      best_id: bestId,
      mode,
      mode_fallback: modeFallback,
      reference_weather: referenceWeather,
      source: "OpenStreetMap contributors (ODbL) · Open-Meteo",
      results,
    };

    log.info("Consulta de zonas de escalada", {
      accion: "climbing_consulta",
      ip,
      lat,
      lon,
      radio_km: radius,
      resultados: results.length,
      modo: mode,
      fallback_modo: modeFallback,
      mejor: bestId,
    });
    return res.json({
      ...payload,
      cached: Boolean(cached && Date.now() - cached.time < CACHE_TTL_MS),
    });
  } catch (error) {
    log.error("Error consultando zonas de escalada", { error: error.message, ip });
    return res.status(502).json({ error: "No se pudo consultar las zonas de escalada" });
  }
});

export default router;