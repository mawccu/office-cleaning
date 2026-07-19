/* ============================================================
   The Office — hub landing.

   A grid of service tiles + a live activity strip. Live services link
   out to their own page; the rest show a "soon" pill. Shared identity,
   sign-in, and formatting come from core.js.
   ============================================================ */

const SERVICES = [
  { key: "cleaning", href: "cleaning.html", icon: "🧹", title: "Cleaning",
    blurb: "Post rooms, bid, underbid to win, then split the pay with helpers.", live: true },
  { key: "requests", href: "requests.html", icon: "🫖", title: "Requests & favors",
    blurb: "A cup of tea, a quick errand, grab-me-something — with an optional tip.", live: true },
  { key: "resources", icon: "📦", title: "Resources",
    blurb: "Out of coffee? Need a cable? Request supplies and gear here." },
  { key: "projects", icon: "🚀", title: "Projects",
    blurb: "Post a project, define the roles you need, and see who's in." },
];

const servicesEl = document.getElementById("services");
const activityStripEl = document.getElementById("activityStrip");

let hubBids = [];
let hubFavors = [];

function renderServices() {
  servicesEl.innerHTML = SERVICES.map((s) => {
    const inner = `
      <div class="svc-ico">${s.icon}</div>
      <div class="svc-body">
        <div class="svc-title">${esc(s.title)}${s.live ? "" : `<span class="soon-pill">soon</span>`}</div>
        <div class="svc-blurb">${esc(s.blurb)}</div>
        <div class="svc-live" id="live-${s.key}">${s.live ? "…" : ""}</div>
      </div>
      <div class="svc-go">${s.live ? "Open →" : ""}</div>`;
    return s.live
      ? `<a class="svc-card live" href="${s.href}">${inner}</a>`
      : `<div class="svc-card soon">${inner}</div>`;
  }).join("");
}

function renderActivity() {
  const open = hubBids.filter((b) => b.status === "open");
  const prog = hubBids.filter((b) => b.status === "claimed" || b.status === "cleaned");
  const pot = open.reduce((s, b) => s + Number(b.amount || 0), 0);
  const favOpen = hubFavors.filter((f) => f.status === "open");
  const favProg = hubFavors.filter((f) => f.status === "claimed");

  const liveClean = document.getElementById("live-cleaning");
  if (liveClean) liveClean.textContent = (open.length || prog.length)
    ? `${open.length} open · ${prog.length} in progress`
    : "Nothing on the board yet";

  const liveReq = document.getElementById("live-requests");
  if (liveReq) liveReq.textContent = (favOpen.length || favProg.length)
    ? `${favOpen.length} open · ${favProg.length} being handled`
    : "No requests right now";

  if (activityStripEl) {
    const bits = [];
    if (open.length) bits.push(`<b>${open.length}</b> room${open.length === 1 ? "" : "s"} up for grabs`);
    if (pot > 0) bits.push(`<b>${fmtMoney(pot)}</b> pledged`);
    if (favOpen.length) bits.push(`<b>${favOpen.length}</b> favor${favOpen.length === 1 ? "" : "s"} to give`);
    activityStripEl.innerHTML = bits.length
      ? `<span class="pulse"></span> ${bits.join(" · ")}`
      : `<span class="pulse"></span> All quiet — nothing needs doing right now`;
  }
}

async function loadActivity() {
  try {
    const [b, f] = await Promise.all([
      sb.from("bids").select("status,amount").limit(300),
      sb.from("favors").select("status,reward").limit(300),
    ]);
    if (!b.error) hubBids = b.data || [];
    if (!f.error) hubFavors = f.data || [];
  } catch (e) {
    // activity is best-effort; a hiccup shouldn't break the hub
  }
  renderActivity();
}

// ---- boot ----
renderNav("hub");
afterWrite = loadActivity;      // re-fetch counts after a sign-in
onAuthChange = () => {};         // tiles don't depend on who's signed in
renderServices();
loadActivity();
sb.channel("hub")
  .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, loadActivity)
  .on("postgres_changes", { event: "*", schema: "public", table: "favors" }, loadActivity)
  .subscribe();
