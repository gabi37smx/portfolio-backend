// portfolio-backend/routes/news.js
import express from 'express';
import NodeCache from 'node-cache';

const router = express.Router();
const newsCache = new NodeCache({ stdTTL: 1800 }); // 30 minutos

// GET /api/news/ai
router.get('/ai', async (req, res) => {
  const cacheKey = 'news:ai:gdelt';

  const cached = newsCache.get(cacheKey);
  if (cached) {
    console.log('[News] Cache hit');
    return res.json(cached);
  }

  try {
    // GDELT DOC 2.0 · lista de artículos sobre IA de la última semana
    const params = new URLSearchParams({
      query: '"artificial intelligence" OR "inteligencia artificial"',
      mode: 'ArtList',
      format: 'json',
      maxrecords: '12',
      timespan: '1w',
      sort: 'DateDesc'
    });

    const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error(`GDELT respondió ${response.status}`);
    }

    const text = await response.text();

    // GDELT a veces devuelve respuesta vacía o texto plano cuando no hay resultados
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('GDELT no devolvió JSON válido');
    }

    const articles = Array.isArray(data.articles) ? data.articles : [];

    const simplified = {
      date: new Date().toISOString().slice(0, 10),
      events: articles.map(a => ({
        title: a.title || 'Sin título',
        url: a.url || '#',
        domain: a.domain || '',
        date: a.seendate || null,
        language: a.language || '',
        country: a.sourcecountry || ''
      })),
      total: articles.length,
      cached_at: new Date().toISOString()
    };

    newsCache.set(cacheKey, simplified);
    console.log(`[News] OK: ${simplified.events.length} artículos`);

    res.json(simplified);

  } catch (err) {
    console.error(`[News] Error: ${err.message}`);
    res.json({ events: [], total: 0, error: 'service_unavailable' });
  }
});

export default router;