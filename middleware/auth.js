export function adminAuth(req, res, next) {
  const password = req.headers["x-admin-password"] || req.query.password;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}