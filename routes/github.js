import express from "express";
import rateLimit from "express-rate-limit";
import { log } from "../logger.js";

const router = express.Router();

const GITHUB_USER = "gabi37smx";
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Demasiadas consultas. Inténtalo más tarde." },
}));

async function fetchGitHub(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      "User-Agent": "portfolio-backend",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}`);
  return response.json();
}

router.get("/activity", async (req, res) => {
  const cached = cache.get("activity");
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const [user, repos] = await Promise.all([
      fetchGitHub(`/users/${GITHUB_USER}`),
      fetchGitHub(`/users/${GITHUB_USER}/repos?sort=updated&per_page=20`),
    ]);

    const cleanRepos = repos
      .filter((repo) => !repo.fork)
      .sort((first, second) => new Date(second.updated_at) - new Date(first.updated_at))
      .slice(0, 6)
      .map((repo) => ({
        name: repo.name,
        description: repo.description,
        url: repo.html_url,
        language: repo.language,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        updatedAt: repo.updated_at,
      }));

    const payload = {
      user: {
        login: user.login,
        name: user.name,
        avatar: user.avatar_url,
        bio: user.bio,
        publicRepos: user.public_repos,
        followers: user.followers,
        url: user.html_url,
      },
      repos: cleanRepos,
    };

    cache.set("activity", { time: Date.now(), data: payload });
    log.info("GitHub: consulta correcta", {
      repos: cleanRepos.length,
      user: user.login,
    });
    return res.json({ ...payload, cached: false });
  } catch (error) {
    log.error("Error consultando GitHub", { error: error.message });
    return res.status(500).json({ error: "No se pudo consultar GitHub" });
  }
});

export default router;