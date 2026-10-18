/* ============================================================
   utils/clientIp.js · IP real del visitante detrás de los proxies de Render
   ------------------------------------------------------------
   En Render, req.ip suele ser una IP INTERNA del proxy (10.x.x.x), no la del
   visitante. Si los límites de uso se calculan con esa IP, todos los visitantes
   comparten el mismo contador. Aquí se busca la IP real en las cabeceras que
   añaden los proxies, y solo si no hay ninguna se usa req.ip.
   ============================================================ */

const PRIVADA = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80)/i;

function cabecera(req, nombre) {
  const v = req.headers && req.headers[nombre];
  return Array.isArray(v) ? v[0] : v;
}

function limpiar(ip) {
  return String(ip || "").trim().replace(/^::ffff:/i, "");
}

export function fuenteIp(req) {
  if (cabecera(req, "cf-connecting-ip")) return "cf-connecting-ip";
  if (cabecera(req, "true-client-ip")) return "true-client-ip";
  const xff = cabecera(req, "x-forwarded-for");
  if (xff && String(xff).split(",").some((p) => p.trim() && !PRIVADA.test(limpiar(p)))) return "x-forwarded-for";
  return "req.ip";
}

export function ipCliente(req) {
  const cf = cabecera(req, "cf-connecting-ip") || cabecera(req, "true-client-ip");
  if (cf && limpiar(cf)) return limpiar(cf);

  const xff = cabecera(req, "x-forwarded-for");
  if (xff) {
    const publica = String(xff).split(",").map(limpiar).find((ip) => ip && !PRIVADA.test(ip));
    if (publica) return publica;
  }
  return limpiar(req.ip || (req.socket && req.socket.remoteAddress)) || "desconocida";
}