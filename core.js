/* ============================================================
   The Office — shared core.

   Everything every page needs: identity (name + PIN, remembered on
   the device), the sign-in modal, PIN-checked RPC calls, toasts, the
   top nav, and small formatting helpers.

   Load order on every page:
     supabase.js  ->  config.js (if needed)  ->  core.js  ->  <page>.js
   so these globals are defined before the page script runs.

   Pages plug into two hooks:
     onAuthChange  — called when the signed-in user changes (re-render)
     afterWrite    — awaited after a successful write / sign-in (re-fetch)
   ============================================================ */

// ---- shared formatting ----
const CURRENCY = "JD";
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function money(n) { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(2); }
function fmtMoney(n) { return `${money(n)} ${CURRENCY}`; }
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
// "in 3h" / "3h ago" style short relative span
function relShort(iso) {
  const abs = Math.abs(new Date(iso) - Date.now());
  const m = Math.round(abs / 60000), h = Math.round(abs / 3600000), d = Math.round(abs / 86400000);
  return m < 60 ? `${m}m` : h < 48 ? `${h}h` : `${d}d`;
}
function initials(name) {
  const p = String(name).trim().split(/\s+/);
  const s = ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase();
  return s || String(name).slice(0, 2).toUpperCase() || "?";
}
function hashHue(s) { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) % 360; return h; }
function avatarHtml(name) { return `<div class="bid-avatar" style="--h:${hashHue(name)}">${esc(initials(name))}</div>`; }
function emptyBlock(msg) { return `<div class="empty-block">${esc(msg)}</div>`; }

/* ============================================================
   Line icons (inline SVG, currentColor) — no emoji anywhere.
   icon("box") -> <svg>…</svg>. Unknown name falls back to a dot.
   ============================================================ */
const ICON_PATHS = {
  building: '<path d="M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17"/><path d="M14 9h5a1 1 0 0 1 1 1v11"/><path d="M2 21h20"/><path d="M7 7h2M7 11h2M7 15h2"/>',
  broom: '<path d="M19 4l-8 8"/><path d="M14 5l5 5"/><path d="M11 12l-5 5c-1.6 1.6-1.6 4 0 4h1c2 0 3-1.5 3.5-3l1.5-4"/><path d="M8 17l3 3"/>',
  spray: '<path d="M9 10h5a2 2 0 0 1 2 2v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-8a2 2 0 0 1 2-2z"/><path d="M9 10V6h4"/><path d="M14 4h2M17 5h1M15 7h2"/>',
  bucket: '<path d="M4 8h16l-1.4 11a2 2 0 0 1-2 1.7H7.4a2 2 0 0 1-2-1.7z"/><ellipse cx="12" cy="8" rx="8" ry="2.4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  plate: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5"/><path d="M12 12v9"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12.2a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7"/><path d="M10 11v6M14 11v6"/>',
  feather: '<path d="M20 4C11 4 6 9.5 5 18l-1.5 2.5"/><path d="M20 4c0 6.5-3.5 10.5-10 11.5"/><path d="M16.5 7.5L9 15"/>',
  window: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  cup: '<path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16"/><path d="M7 3.5c-.4 1 .4 1.5 0 2.5M11 3.5c-.4 1 .4 1.5 0 2.5"/>',
  bag: '<path d="M6 8h12l-1 11.2a2 2 0 0 1-2 1.8H9a2 2 0 0 1-2-1.8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  rocket: '<path d="M12 3c3 2.2 4.2 5.2 4.2 8.2 0 2.3-1.2 4.3-4.2 6-3-1.7-4.2-3.7-4.2-6C7.8 8.2 9 5.2 12 3z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M8.2 14.5l-2.2 2 1.8 2.8M15.8 14.5l2.2 2-1.8 2.8"/>',
  heart: '<path fill="currentColor" stroke="none" d="M12 21s-7.4-4.6-9.7-9.3A5.2 5.2 0 0 1 12 6.1a5.2 5.2 0 0 1 9.7 5.6C19.4 16.4 12 21 12 21z"/>',
  "dot-moha": '<circle cx="12" cy="12" r="6.5" fill="#c9b38d" stroke="none"/>',
  "dot-malek": '<circle cx="12" cy="12" r="6.5" fill="#c98f87" stroke="none"/>',
};
function icon(name, cls) {
  const p = ICON_PATHS[name] || '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>';
  return `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

// ---- toast ----
const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3400);
}

/* ============================================================
   Top nav (shared across pages). Add a page here once and it shows
   up everywhere. `soon: true` renders a disabled "soon" pill.
   ============================================================ */
const NAV = [
  { key: "hub",       label: "Hub",       href: "index.html" },
  { key: "cleaning",  label: "Cleaning",  href: "cleaning.html" },
  { key: "requests",  label: "Requests",  href: "requests.html" },
  { key: "resources", label: "Resources", href: "resources.html" },
  { key: "projects",  label: "Projects",  href: "projects.html" },
];
function renderNav(active) {
  const el = document.getElementById("mainnav");
  if (!el) return;
  el.innerHTML = NAV.map((n) => n.soon
    ? `<span class="navlink soon" title="Coming soon">${esc(n.label)}<span class="soon-pill">soon</span></span>`
    : `<a class="navlink${n.key === active ? " active" : ""}" href="${n.href}">${esc(n.label)}</a>`
  ).join("");
  // building icon in the brand mark
  const bm = document.querySelector(".brand-mark");
  if (bm && !bm.querySelector("svg")) bm.innerHTML = icon("building");
  // "Volunteer" corner button -> the keep-it-alive page (once per page)
  if (!document.getElementById("volunteerBtn")) {
    const a = document.createElement("a");
    a.id = "volunteerBtn";
    a.className = "volunteer-btn";
    a.href = "volunteer.html";
    a.innerHTML = `<span class="vb-heart">${icon("heart")}</span> Volunteer`;
    document.body.appendChild(a);
  }
}

/* ============================================================
   Identity — username + password account, remembered in localStorage.
   (`auth.pin` carries the password so every existing RPC call is unchanged.)
   ============================================================ */
let auth = null;                 // { name, pin(=password) }
let pendingAfterAuth = null;     // action to retry once signed in
let onAuthChange = () => {};     // page sets this (re-render on sign in/out)
let afterWrite = async () => {}; // page sets this (re-fetch after a write)
let authMode = "login";          // "login" | "signup"

// Build the log-in / sign-up modal (single source; the HTML gives the shell).
(function buildAuthModal() {
  const m = document.querySelector("#authOverlay .modal");
  if (!m) return;
  m.innerHTML = `
    <div class="auth-tabs">
      <button type="button" class="auth-tab active" data-mode="login">Log in</button>
      <button type="button" class="auth-tab" data-mode="signup">Create account</button>
    </div>
    <div class="sub" id="authSub">Welcome back — log in to your account.</div>
    <div class="auth-fields">
      <input id="authName" class="fld" type="text" placeholder="Username" autocomplete="username" />
      <input id="authPin" class="fld" type="password" placeholder="Password" autocomplete="current-password" />
    </div>
    <div class="auth-err" id="authErr"></div>
    <div class="modal-actions">
      <button class="btn ghost" id="authCancel" type="button">Cancel</button>
      <button class="btn primary" id="authSubmit" type="button">Log in</button>
    </div>
    <div class="auth-foot" id="authFoot">Your username is your name across The Office. Passwords are kept encrypted.</div>`;
})();

const authOverlay = document.getElementById("authOverlay");
const authName = document.getElementById("authName");
const authPin = document.getElementById("authPin");
const authErr = document.getElementById("authErr");
const authSub = document.getElementById("authSub");
const authSubmit = document.getElementById("authSubmit");
const authCancel = document.getElementById("authCancel");
const whoamiEl = document.getElementById("whoami");

function loadAuth() { try { auth = JSON.parse(localStorage.getItem("cb_auth") || "null"); } catch { auth = null; } }
function saveAuth(a) { auth = a; localStorage.setItem("cb_auth", JSON.stringify(a)); updateWhoami(); }
function clearAuth() { auth = null; localStorage.removeItem("cb_auth"); updateWhoami(); onAuthChange(); }

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "login";
  const signup = authMode === "signup";
  document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === authMode));
  if (authSubmit) authSubmit.textContent = signup ? "Create account" : "Log in";
  if (authSub) authSub.textContent = signup ? "Pick a username and a password (8+ characters)." : "Welcome back — log in to your account.";
  if (authPin) { authPin.placeholder = signup ? "Password (8+ characters)" : "Password"; authPin.setAttribute("autocomplete", signup ? "new-password" : "current-password"); }
  if (authErr) authErr.textContent = "";
}

function openAuth(mode) {
  if (!authOverlay) return;
  setAuthMode(mode || (auth?.name ? "login" : authMode));
  authName.value = auth?.name || "";
  authPin.value = "";
  authOverlay.classList.add("open");
  setTimeout(() => (auth?.name ? authPin : authName).focus(), 30);
}
function closeAuth() { if (authOverlay) authOverlay.classList.remove("open"); }

async function submitAuth() {
  const name = authName.value.trim(), pass = authPin.value;
  if (!name) { authErr.textContent = "Enter a username"; return; }
  if (!pass) { authErr.textContent = "Enter your password"; return; }
  if (authMode === "signup" && pass.length < 8) { authErr.textContent = "Password must be at least 8 characters"; return; }
  authSubmit.disabled = true;
  try {
    const fn = authMode === "signup" ? "sign_up" : "auth_user";
    const { error } = await sb.rpc(fn, { p_name: name, p_pin: pass });
    if (error) throw error;
    saveAuth({ name, pin: pass });
    closeAuth();
    await afterWrite();
    onAuthChange();
    if (pendingAfterAuth) { const a = pendingAfterAuth; pendingAfterAuth = null; a(); }
  } catch (e) {
    authErr.textContent = e.message || String(e);
  } finally {
    authSubmit.disabled = false;
  }
}

async function changePassword() {
  if (!auth) return;
  const cur = prompt("Your current password:");
  if (cur == null) return;
  const nw = prompt("New password (at least 8 characters):");
  if (nw == null) return;
  if (nw.length < 8) return toast("Password must be at least 8 characters");
  try {
    const { error } = await sb.rpc("change_password", { p_name: auth.name, p_pin: cur, p_new: nw });
    if (error) throw error;
    saveAuth({ name: auth.name, pin: nw });
    toast("Password changed");
  } catch (e) { toast(e.message || String(e)); }
}

// Ensure we're signed in before an action; if not, open the modal and
// remember what to do next.
function requireAuth(retry) {
  if (auth) return true;
  pendingAfterAuth = retry || null;
  openAuth();
  return false;
}

// Every write goes through here: attaches name+pin, handles errors,
// re-fetches via the page's afterWrite hook. Returns true on success.
async function callRpc(fn, params, okMsg) {
  if (!requireAuth()) return false;
  try {
    const { error } = await sb.rpc(fn, { p_name: auth.name, p_pin: auth.pin, ...params });
    if (error) throw error;
    if (okMsg) toast(okMsg);
    await afterWrite();
    return true;
  } catch (e) {
    const msg = e.message || String(e);
    toast(msg);
    if (/wrong username or password/i.test(msg)) { clearAuth(); openAuth("login"); }
    return false;
  }
}

function updateWhoami() {
  if (!whoamiEl) return;
  if (auth) {
    whoamiEl.innerHTML = `<span class="whoami-name">You <b>${esc(auth.name)}</b></span><button id="pwBtn" class="linkbtn">password</button><button id="signOutBtn" class="linkbtn">sign out</button>`;
    document.getElementById("pwBtn").addEventListener("click", changePassword);
    document.getElementById("signOutBtn").addEventListener("click", clearAuth);
  } else {
    whoamiEl.innerHTML = `<button id="signInBtn" class="linkbtn strong">Log in</button>`;
    document.getElementById("signInBtn").addEventListener("click", () => openAuth("login"));
  }
}

// ---- wire the auth modal (present on every page) ----
document.querySelectorAll(".auth-tab").forEach((t) => t.addEventListener("click", () => setAuthMode(t.dataset.mode)));
if (authSubmit) authSubmit.addEventListener("click", submitAuth);
if (authCancel) authCancel.addEventListener("click", () => { pendingAfterAuth = null; closeAuth(); });
if (authPin) authPin.addEventListener("keydown", (e) => { if (e.key === "Enter") submitAuth(); });
if (authName) authName.addEventListener("keydown", (e) => { if (e.key === "Enter") authPin.focus(); });
if (authOverlay) authOverlay.addEventListener("click", (e) => { if (e.target === authOverlay) { pendingAfterAuth = null; closeAuth(); } });

// ---- boot identity ----
loadAuth();
updateWhoami();
(async () => {
  if (auth) {
    // validate the remembered login (PIN may have been changed elsewhere)
    const { error } = await sb.rpc("auth_user", { p_name: auth.name, p_pin: auth.pin });
    if (error) { clearAuth(); }
  }
})();
