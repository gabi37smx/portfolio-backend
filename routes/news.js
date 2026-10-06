// portfolio-backend/routes/news.js
import express from 'express';
import NodeCache from 'node-cache';

const router = express.Router();
const newsCache = new NodeCache({ stdTTL: 1800 }); // 30 minutos

// GET /api/news/ai
router.get('/ai', async (req, res) => {
  const cacheKey = 'news:ai:gnews';

  const cached = newsCache.get(cacheKey);
  if (cached) {
    console.log('[News] Cache hit');
    return res.json(cached);
  }

  try {
    const apiKey = process.env.GNEWS_API_KEY;

    if (!apiKey) {
      throw new Error('Falta GNEWS_API_KEY en el .env');
    }

    // GNews: busca noticias de IA, en español, ordenadas por fecha, últimos 7 días
    const params = new URLSearchParams({
      q: '"inteligencia artificial" OR "artificial intelligence"',
      lang: 'es',
      max: '10',
      sortby: 'publishedAt',
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      apikey: apiKey
    });

    const url = `https://gnews.io/api/v4/search?${params.toString()}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GNews respondió ${response.status}: ${errorText.slice(0, 100)}`);
    }

    const data = await response.json();

    const articles = Array.isArray(data.articles) ? data.articles : [];

    const simplified = {
      date: new Date().toISOString().slice(0, 10),
      events: articles.map(a => ({
        title: a.title || 'Sin título',
        url: a.url || '#',
        domain: a.source?.name || '',
        publishedAt: a.publishedAt || null
      })),
      total: articles.length,
      cached_at: new Date().toISOString()
    };

    newsCache.set(cacheKey, simplified);
    console.log(`[News] OK: ${simplified.events.length} artículos de GNews`);

    res.json(simplified);

  } catch (err) {
    console.error(`[News] Error: ${err.message}`);
    res.json({ events: [], total: 0, error: 'service_unavailable' });
  }
});

export default router;