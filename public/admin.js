/* ============================================================
   TEMA
   ============================================================ */
const themeBtn = document.getElementById("themeToggle");
const metaTheme = document.getElementById("metaTheme");
const root = document.documentElement;
const DARK_COLOR = "#151310";
const LIGHT_COLOR = "#f2ede3";

const applyTheme = (theme) => {
  root.setAttribute("data-theme", theme);
  if (metaTheme) metaTheme.setAttribute("content", theme === "light" ? LIGHT_COLOR : DARK_COLOR);
  try { localStorage.setItem("theme", theme); } catch (e) {}
};
applyTheme(root.getAttribute("data-theme") || "light");
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}

/* ============================================================
   SESIÓN
   ============================================================ */
const loginScreen = document.getElementById("loginScreen");
const adminScreen = document.getElementById("adminScreen");

/* La contraseña ya no viaja por la URL: el panel guarda solo un token de sesión (caduca a las 8 h) */
if (location.search.includes("password=")) history.replaceState(null, "", location.pathname);

let sessionToken = null;
try { sessionToken = sessionStorage.getItem("adminToken"); } catch (e) {}

function guardarToken(token) {
  sessionToken = token;
  try { sessionStorage.setItem("adminToken", token); } catch (e) {}
  programarCaducidad();
}
function borrarToken() {
  sessionToken = null;
  try { sessionStorage.removeItem("adminToken"); } catch (e) {}
}
// fetch con el token en la cabecera; si el servidor dice 401, vuelve a la pantalla de login
function authFetch(url, opciones = {}) {
  const headers = { ...(opciones.headers || {}), Authorization: "Bearer " + (sessionToken || "") };
  return fetch(url, { ...opciones, headers }).then((res) => {
    if (res.status === 401) cerrarSesion("Tu sesión ha caducado. Vuelve a entrar.");
    return res;
  });
}

function showAdmin() {
  loginScreen.hidden = true;
  adminScreen.hidden = false;
  cargarMensajes();
  cargarLogs();
  cargarPasskeys();
}

function showLogin() {
  loginScreen.hidden = false;
  adminScreen.hidden = true;
}

/* ---------- Cerrar sesión ----------
   Borra el token, vacía los datos que había en pantalla y vuelve al login.
   (El token es sin estado: no se revoca en el servidor, simplemente se descarta
   y caduca solo a las 8 h.) */
let temporizadorCaducidad = null;

function cerrarSesion(mensaje) {
  borrarToken();
  clearTimeout(temporizadorCaducidad);
  content.innerHTML = "";
  logsContent.innerHTML = "";
  passkeysContent.innerHTML = "";
  stats.hidden = true;
  document.getElementById("bulkBar").hidden = true;
  showLogin();
  loginPasskeyStatus.textContent = "";
  loginPasswordStatus.className = "login-status";
  loginPasswordStatus.textContent = mensaje || "Sesión cerrada.";
  inputLoginPassword.value = "";
}

// Cierra la sesión sola cuando caduca el token (la fecha viaja dentro del propio token)
function programarCaducidad() {
  clearTimeout(temporizadorCaducidad);
  if (!sessionToken) return;
  try {
    const b64 = sessionToken.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    const ms = exp - Date.now();
    if (ms <= 0) { cerrarSesion("Tu sesión ha caducado. Vuelve a entrar."); return; }
    temporizadorCaducidad = setTimeout(() => cerrarSesion("Tu sesión ha caducado. Vuelve a entrar."), Math.min(ms, 2147483000));
  } catch (e) { /* si no se puede leer, el servidor seguirá rechazándolo con 401 */ }
}

document.getElementById("btnLogout").addEventListener("click", () => cerrarSesion("Sesión cerrada."));

// Pantalla inicial. Los datos se cargan al final del script, cuando ya existen todas las variables.
if (sessionToken) {
  loginScreen.hidden = true;
  adminScreen.hidden = false;
} else {
  showLogin();
}

/* ============================================================
   LOGIN CON PASSKEY
   ============================================================ */
const btnLoginPasskey = document.getElementById("btnLoginPasskey");
const loginPasskeyStatus = document.getElementById("loginPasskeyStatus");

if (btnLoginPasskey) {
  btnLoginPasskey.addEventListener("click", async () => {
    loginPasskeyStatus.textContent = "";
    loginPasskeyStatus.className = "login-status";

    if (!window.SimpleWebAuthnBrowser) {
      loginPasskeyStatus.textContent = "El navegador no soporta passkeys.";
      loginPasskeyStatus.classList.add("is-error");
      return;
    }

    try {
      const optionsRes = await fetch("/api/passkey/login/options", { method: "POST" });
      if (!optionsRes.ok) {
        const err = await optionsRes.json().catch(() => ({}));
        throw new Error(err.error || "Error pidiendo opciones");
      }
      const options = await optionsRes.json();

      const authResp = await SimpleWebAuthnBrowser.startAuthentication(options);

      const verifyRes = await fetch("/api/passkey/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authResp),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error || "Verificación fallida");
      }

      guardarToken(verifyData.token);
      loginPasskeyStatus.textContent = "Acceso correcto. Entrando…";
      loginPasskeyStatus.classList.add("is-success");
      setTimeout(showAdmin, 400);
    } catch (err) {
      console.error(err);
      if (err.name === "NotAllowedError") {
        loginPasskeyStatus.textContent = "Operación cancelada o expirada.";
      } else {
        loginPasskeyStatus.textContent = err.message || "No se pudo autenticar.";
      }
      loginPasskeyStatus.classList.add("is-error");
    }
  });
}

/* ============================================================
   LOGIN CON CONTRASEÑA
   ============================================================ */
const formLoginPassword = document.getElementById("formLoginPassword");
const inputLoginPassword = document.getElementById("inputLoginPassword");
const loginPasswordStatus = document.getElementById("loginPasswordStatus");

if (formLoginPassword) {
  formLoginPassword.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginPasswordStatus.textContent = "";
    loginPasswordStatus.className = "login-status";

    const candidate = inputLoginPassword.value;
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: candidate }),
      });
      if (res.status === 429) {
        loginPasswordStatus.textContent = "Demasiados intentos. Espera unos minutos.";
        loginPasswordStatus.classList.add("is-error");
        return;
      }
      if (!res.ok) {
        loginPasswordStatus.textContent = "Contraseña incorrecta.";
        loginPasswordStatus.classList.add("is-error");
        return;
      }
      const datos = await res.json();
      guardarToken(datos.token);
      inputLoginPassword.value = "";
      loginPasswordStatus.textContent = "Acceso correcto. Entrando…";
      loginPasswordStatus.classList.add("is-success");
      setTimeout(showAdmin, 400);
    } catch (err) {
      loginPasswordStatus.textContent = "Error de conexión.";
      loginPasswordStatus.classList.add("is-error");
    }
  });
}

/* ============================================================
   REGISTRAR PASSKEY
   ============================================================ */
const btnRegisterPasskey = document.getElementById("btnRegisterPasskey");
if (btnRegisterPasskey) {
  btnRegisterPasskey.addEventListener("click", async () => {
    if (!window.SimpleWebAuthnBrowser) {
      alert("El navegador no soporta passkeys.");
      return;
    }
    try {
      const optionsRes = await authFetch("/api/passkey/register/options", { method: "POST" });
      if (!optionsRes.ok) throw new Error("Error pidiendo opciones de registro");
      const options = await optionsRes.json();

      const nombre = prompt("Nombre para este dispositivo (ej: Mi MacBook, iPhone de Gabriel):", "Mi dispositivo") || "Dispositivo sin nombre";

      const regResp = await SimpleWebAuthnBrowser.startRegistration(options);
      regResp.nombre = nombre;

      const verifyRes = await authFetch("/api/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regResp),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error || "Verificación fallida");
      }
      alert("Passkey registrada correctamente. La próxima vez puedes entrar sin contraseña.");
      cargarPasskeys();
    } catch (err) {
      console.error(err);
      if (err.name === "InvalidStateError") {
        alert("Este dispositivo ya tiene una passkey registrada.");
      } else if (err.name === "NotAllowedError") {
        alert("Operación cancelada.");
      } else {
        alert("No se pudo registrar la passkey: " + err.message);
      }
    }
  });
}

/* ============================================================
   PESTAÑAS
   ============================================================ */
document.querySelectorAll(".admin-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".admin-tab").forEach((t) => {
      const active = t.dataset.tab === target;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".admin-panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === target);
    });
  });
});

/* ============================================================
   MENSAJES
   ============================================================ */
const content = document.getElementById("content");
const stats = document.getElementById("stats");

async function cargarMensajes() {
  content.innerHTML = '<div class="empty"><span class="loader"></span> Cargando mensajes…</div>';
  try {
    const res = await authFetch("/api/contact/messages");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      content.innerHTML = `<div class="error-msg"><strong>Error ${res.status}:</strong> ${escapeHtml(err.error || "No autorizado")}</div>`;
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      stats.hidden = true;
      document.getElementById("bulkBar").hidden = true;
      content.innerHTML = `<div class="empty"><strong>No hay mensajes todavía.</strong></div>`;
      return;
    }
    document.getElementById("totalCount").textContent = data.length;
    document.getElementById("unreadCount").textContent = data.filter(m => !m.leido).length;
    document.getElementById("callCount").textContent = data.filter(m => m.quiereLlamada).length;
    stats.hidden = false;
    content.innerHTML = `<div class="messages">${data.map(renderCard).join("")}</div>`;
    content.querySelectorAll("[data-mark-read]").forEach(btn => {
      btn.addEventListener("click", () => marcar(btn.dataset.markRead));
    });
    content.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", () => borrarMensajes([btn.dataset.delete]));
    });
    content.querySelectorAll("[data-select]").forEach(chk => {
      chk.addEventListener("change", actualizarSeleccion);
    });
    document.getElementById("bulkBar").hidden = false;
    actualizarSeleccion();
  } catch (err) {
    content.innerHTML = `<div class="error-msg">Error de conexión: ${err.message}</div>`;
  }
}

function renderCard(m) {
  const fecha = new Date(m.createdAt).toLocaleString("es-ES", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
  return `
    <article class="card ${m.leido ? "leido" : "no-leido"}">
      <header class="card__header">
        <div class="card__title-wrap">
          <label class="card__check"><input type="checkbox" data-select="${m._id}" data-leido="${m.leido ? "1" : "0"}" aria-label="Seleccionar mensaje de ${escapeHtml(m.nombre)}" /></label>
          <h2 class="card__title">${escapeHtml(m.asunto)}</h2>
        </div>
        <span class="badge ${m.leido ? "" : "badge--new"}">${m.leido ? "Leído" : "Nuevo"}</span>
      </header>
      <div class="card__meta">
        <div class="card__meta-item"><span class="card__meta-label">Nombre</span><span class="card__meta-value">${escapeHtml(m.nombre)}</span></div>
        <div class="card__meta-item"><span class="card__meta-label">Email</span><span class="card__meta-value"><a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a></span></div>
        ${m.quiereLlamada && m.telefono ? `<div class="card__meta-item"><span class="card__meta-label">📞 Quiere llamada</span><span class="card__meta-value"><a href="tel:${escapeHtml(m.telefono)}">${escapeHtml(m.telefono)}</a></span></div>` : ""}
        <div class="card__meta-item"><span class="card__meta-label">Fecha</span><span class="card__meta-value">${fecha}</span></div>
      </div>
      <div class="card__message">${escapeHtml(m.mensaje)}</div>
      <footer class="card__footer">
        <span class="card__date">ID: ${m._id}</span>
        <div class="card__actions">
          ${!m.leido ? `<button class="btn btn--primary" data-mark-read="${m._id}">Marcar como leído</button>` : ""}
          <button class="btn btn--danger" data-delete="${m._id}">Borrar</button>
        </div>
      </footer>
    </article>
  `;
}

/* ---------- Selección y borrado de mensajes ---------- */
function casillas() { return [...content.querySelectorAll("[data-select]")]; }

function actualizarSeleccion() {
  const todas = casillas();
  const marcadas = todas.filter(c => c.checked);
  todas.forEach(c => c.closest(".card").classList.toggle("is-selected", c.checked));
  document.getElementById("selectedCount").textContent = marcadas.length;
  document.getElementById("deleteSelected").disabled = marcadas.length === 0;
  const todos = document.getElementById("selectAll");
  todos.checked = todas.length > 0 && marcadas.length === todas.length;
  todos.indeterminate = marcadas.length > 0 && marcadas.length < todas.length;
}

async function borrarMensajes(ids) {
  if (!ids.length) return;
  const texto = ids.length === 1
    ? "¿Borrar este mensaje? Esta acción no se puede deshacer."
    : `¿Borrar ${ids.length} mensajes? Esta acción no se puede deshacer.`;
  if (!confirm(texto)) return;
  try {
    const res = await authFetch("/api/contact/messages/borrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (res.ok) { cargarMensajes(); }
    else if (res.status !== 401) { alert("No se pudo borrar. Inténtalo de nuevo."); }
  } catch (err) { alert("Error de conexión al borrar."); }
}

document.getElementById("selectAll").addEventListener("change", (e) => {
  casillas().forEach(c => { c.checked = e.target.checked; });
  actualizarSeleccion();
});
document.getElementById("selectRead").addEventListener("click", () => {
  casillas().forEach(c => { c.checked = c.dataset.leido === "1"; });
  actualizarSeleccion();
});
document.getElementById("deleteSelected").addEventListener("click", () => {
  borrarMensajes(casillas().filter(c => c.checked).map(c => c.dataset.select));
});

async function marcar(id) {
  try {
    const res = await authFetch(`/api/contact/messages/${id}/leido`, { method: "PATCH" });
    if (res.ok) cargarMensajes();
  } catch (err) { console.error(err); }
}

/* ============================================================
   LOGS
   ============================================================ */
const logsContent = document.getElementById("logsContent");
let currentLevel = "all";

async function cargarLogs() {
  logsContent.innerHTML = '<div class="empty"><span class="loader"></span> Cargando logs…</div>';
  try {
    const params = new URLSearchParams();
    if (currentLevel !== "all") params.set("nivel", currentLevel);

    const res = await authFetch(`/api/contact/logs?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      logsContent.innerHTML = `<div class="error-msg"><strong>Error ${res.status}:</strong> ${escapeHtml(err.error || "No autorizado")}</div>`;
      return;
    }
    const logs = await res.json();
    if (!Array.isArray(logs) || logs.length === 0) {
      logsContent.innerHTML = `<div class="empty"><strong>No hay logs todavía.</strong></div>`;
      return;
    }
    logsContent.innerHTML = logs.map(renderLog).join("");
  } catch (err) {
    logsContent.innerHTML = `<div class="error-msg">Error de conexión: ${err.message}</div>`;
  }
}

function renderLog(l) {
  const fecha = new Date(l.timestamp).toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const meta = l.meta && typeof l.meta === "object"
    ? Object.entries(l.meta)
        .filter(([k]) => k !== "servicio")
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ")
    : "";
  return `
    <div class="log-card log-${l.level}">
      <span class="log-card__date">${fecha}</span>
      <span class="log-card__level">${l.level}</span>
      <span class="log-card__message">${escapeHtml(l.message || "")}</span>
      ${meta ? `<span class="log-card__meta">${escapeHtml(meta)}</span>` : ""}
    </div>
  `;
}

document.querySelectorAll(".filter-btn-logs").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentLevel = btn.dataset.level;
    document.querySelectorAll(".filter-btn-logs").forEach((b) => b.classList.toggle("is-active", b === btn));
    cargarLogs();
  });
});

/* ============================================================
   PASSKEYS
   ============================================================ */
const passkeysContent = document.getElementById("passkeysContent");

async function cargarPasskeys() {
  passkeysContent.innerHTML = '<div class="empty"><span class="loader"></span> Cargando passkeys…</div>';
  try {
    const res = await authFetch("/api/passkey/list");
    if (!res.ok) {
      passkeysContent.innerHTML = `<div class="error-msg">Error cargando passkeys</div>`;
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      passkeysContent.innerHTML = `<div class="empty"><strong>No hay passkeys registradas.</strong><br><br>Pulsa "🔑 Registrar passkey" para añadir este dispositivo.</div>`;
      return;
    }
    passkeysContent.innerHTML = data.map(renderPasskey).join("");
    passkeysContent.querySelectorAll("[data-delete-passkey]").forEach(btn => {
      btn.addEventListener("click", () => borrarPasskey(btn.dataset.deletePasskey, btn.dataset.name));
    });
  } catch (err) {
    passkeysContent.innerHTML = `<div class="error-msg">Error de conexión: ${err.message}</div>`;
  }
}

function renderPasskey(p) {
  const fecha = new Date(p.lastUsedAt || p.createdAt).toLocaleString("es-ES", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
  const backed = p.backedUp ? "Sincronizada" : "Solo este dispositivo";
  const device = p.deviceType === "multiDevice" ? "Multi-dispositivo" : "Un dispositivo";
  return `
    <div class="passkey-card">
      <div class="passkey-card__info">
        <span class="passkey-card__name">🔑 ${escapeHtml(p.nombre)}</span>
        <span class="passkey-card__meta">${device} · ${backed} · Último uso: ${fecha}</span>
        <span class="passkey-card__meta">ID: ${escapeHtml(p.credentialID).slice(0, 24)}…</span>
      </div>
      <button class="passkey-card__delete" data-delete-passkey="${escapeHtml(p.credentialID)}" data-name="${escapeHtml(p.nombre)}">Borrar</button>
    </div>
  `;
}

async function borrarPasskey(id, nombre) {
  if (!confirm(`¿Seguro que quieres borrar la passkey "${nombre}"? Si pierdes el dispositivo, no podrás entrar con él.`)) return;
  try {
    const res = await authFetch(`/api/passkey/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      cargarPasskeys();
    } else {
      alert("No se pudo borrar la passkey.");
    }
  } catch (err) {
    alert("Error de conexión: " + err.message);
  }
}

/* ============================================================
   UTILIDADES
   ============================================================ */
document.getElementById("refreshBtn")?.addEventListener("click", () => {
  if (sessionToken) { cargarMensajes(); cargarLogs(); cargarPasskeys(); }
});

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ============================================================
   ARRANQUE (al final: ya existen todas las variables y funciones)
   ============================================================ */
programarCaducidad();
if (sessionToken) { cargarMensajes(); cargarLogs(); cargarPasskeys(); }
