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
  // "Volunteer" corner button -> the keep-it-alive page (once per page)
  if (!document.getElementById("volunteerBtn")) {
    const a = document.createElement("a");
    a.id = "volunteerBtn";
    a.className = "volunteer-btn";
    a.href = "volunteer.html";
    a.innerHTML = `<span class="vb-heart">♥</span> Volunteer`;
    document.body.appendChild(a);
  }
}

/* ============================================================
   Identity — name + PIN, remembered in localStorage.
   ============================================================ */
let auth = null;                 // { name, pin }
let pendingAfterAuth = null;     // action to retry once signed in
let onAuthChange = () => {};     // page sets this (re-render on sign in/out)
let afterWrite = async () => {}; // page sets this (re-fetch after a write)

const authOverlay = document.getElementById("authOverlay");
const authName = document.getElementById("authName");
const authPin = document.getElementById("authPin");
const authErr = document.getElementById("authErr");
const authSubmit = document.getElementById("authSubmit");
const authCancel = document.getElementById("authCancel");
const whoamiEl = document.getElementById("whoami");

function loadAuth() { try { auth = JSON.parse(localStorage.getItem("cb_auth") || "null"); } catch { auth = null; } }
function saveAuth(a) { auth = a; localStorage.setItem("cb_auth", JSON.stringify(a)); updateWhoami(); }
function clearAuth() { auth = null; localStorage.removeItem("cb_auth"); updateWhoami(); onAuthChange(); }

function openAuth() {
  if (!authOverlay) return;
  authErr.textContent = "";
  authName.value = auth?.name || "";
  authPin.value = "";
  authOverlay.classList.add("open");
  setTimeout(() => (auth?.name ? authPin : authName).focus(), 30);
}
function closeAuth() { if (authOverlay) authOverlay.classList.remove("open"); }

async function submitAuth() {
  const name = authName.value.trim(), pin = authPin.value.trim();
  if (!name) { authErr.textContent = "Enter your name"; return; }
  if (pin.length < 4) { authErr.textContent = "PIN must be at least 4 digits"; return; }
  authSubmit.disabled = true;
  try {
    const { error } = await sb.rpc("auth_user", { p_name: name, p_pin: pin });
    if (error) throw error;
    saveAuth({ name, pin });
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
    if (/name or pin|taken with a different pin/i.test(msg)) { clearAuth(); openAuth(); }
    return false;
  }
}

function updateWhoami() {
  if (!whoamiEl) return;
  if (auth) {
    whoamiEl.innerHTML = `<span class="whoami-name">You <b>${esc(auth.name)}</b></span><button id="signOutBtn" class="linkbtn">sign out</button>`;
    document.getElementById("signOutBtn").addEventListener("click", clearAuth);
  } else {
    whoamiEl.innerHTML = `<button id="signInBtn" class="linkbtn strong">Sign in</button>`;
    document.getElementById("signInBtn").addEventListener("click", openAuth);
  }
}

// ---- wire the auth modal (present on every page) ----
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
