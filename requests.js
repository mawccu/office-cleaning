/* ============================================================
   Requests & favors — one service of The Office.

   A favor is a small ask (a tea, an errand, grab-me-something) with an
   optional reward/tip. Post -> someone claims -> they mark it done ->
   if there's a reward, the poster marks it paid.

   Shared foundation (identity, callRpc, toasts, formatting, nav) comes
   from core.js, loaded first.
   ============================================================ */

const FAV_CATS = [
  { id: "tea",    icon: "cup", label: "Tea / coffee" },
  { id: "errand", icon: "bag", label: "Errand" },
  { id: "other",  icon: "dots", label: "Something else" },
];
function catMeta(id) { return FAV_CATS.find((c) => c.id === id) || FAV_CATS[2]; }

// ---- live data + composer state (kept across re-renders) ----
let favors = [];
let favTitle = "";
let favNote = "";
let favReward = "";
let favCat = "tea";

// ---- DOM ----
const composerEl = document.getElementById("composer");
const openFavorsEl = document.getElementById("openFavors");
const progressFavorsEl = document.getElementById("progressFavors");
const doneFavorsEl = document.getElementById("doneFavors");
const statOpenEl = document.getElementById("statOpen");
const statRewardEl = document.getElementById("statReward");

// ---- small view helpers ----
function rewardPill(f) {
  return Number(f.reward) > 0
    ? `<span class="reward-pill">${fmtMoney(f.reward)}</span>`
    : `<span class="favor-pill">Free favor</span>`;
}
function catChip(id) { const c = catMeta(id); return `<span class="cat-chip">${icon(c.icon)} ${esc(c.label)}</span>`; }

/* ============================================================
   Composer — post a request
   ============================================================ */
function composerBeingTyped() {
  const a = document.activeElement;
  return a && composerEl.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}
function renderComposer() {
  if (!auth) {
    composerEl.innerHTML = `<div class="composer-empty"><div class="ce-title">Ask for something</div><div class="ce-sub">Sign in with your name and a PIN to post a request. We'll remember you here.</div><button class="btn primary" id="composerSignIn">Sign in</button></div>`;
    document.getElementById("composerSignIn").addEventListener("click", () => openAuth());
    return;
  }
  const cats = FAV_CATS.map((c) => `<button type="button" class="cat-btn ${favCat === c.id ? "on" : ""}" data-cat="${c.id}">${icon(c.icon)}${esc(c.label)}</button>`).join("");
  composerEl.innerHTML = `
    <div class="card-head"><span>Post a request</span><span class="hint">as ${esc(auth.name)}</span></div>
    <div class="card-body">
      <div class="cat-row">${cats}</div>
      <input id="favTitle" class="fld" type="text" maxlength="120" placeholder="What do you need? e.g. a cup of green tea, no sugar" value="${esc(favTitle)}" />
      <textarea id="favNote" class="fld note" rows="2" placeholder="Any detail (optional) — where you're sitting, brand, etc.">${esc(favNote)}</textarea>
      <div class="bid-form">
        <input id="favReward" class="fld amt-wide" type="number" inputmode="decimal" min="0" step="1" placeholder="Reward / tip (optional, JD)" value="${esc(favReward)}" />
        <button id="postFavorBtn" class="btn primary">Post request</button>
      </div>
      <div class="composer-note" id="composerNote"></div>
    </div>`;
  composerEl.querySelectorAll(".cat-btn").forEach((el) => el.addEventListener("click", () => {
    favCat = el.dataset.cat;
    composerEl.querySelectorAll(".cat-btn").forEach((b) => b.classList.toggle("on", b.dataset.cat === favCat));
  }));
  const titleEl = document.getElementById("favTitle");
  const noteEl = document.getElementById("favNote");
  const rewardEl = document.getElementById("favReward");
  const preview = document.getElementById("composerNote");
  const previewNote = () => {
    const r = Number(rewardEl.value);
    preview.innerHTML = r > 0
      ? `A <b>${fmtMoney(r)}</b> reward for whoever helps.`
      : `A free favor — someone lends a hand.`;
  };
  previewNote();
  titleEl.addEventListener("input", () => { favTitle = titleEl.value; });
  noteEl.addEventListener("input", () => { favNote = noteEl.value; });
  rewardEl.addEventListener("input", () => { favReward = rewardEl.value; previewNote(); });
  titleEl.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("postFavorBtn").click(); });
  document.getElementById("postFavorBtn").addEventListener("click", onPostFavor);
}
async function onPostFavor() {
  if (!requireAuth(onPostFavor)) return;
  const title = (document.getElementById("favTitle")?.value ?? favTitle).trim();
  if (!title) return toast("Say what you need");
  const reward = Number(document.getElementById("favReward")?.value || 0) || 0;
  const note = (document.getElementById("favNote")?.value ?? favNote).trim();
  const ok = await callRpc("post_favor",
    { p_title: title, p_note: note || null, p_category: favCat, p_reward: reward },
    reward > 0 ? `Posted — ${fmtMoney(reward)} for a hand` : "Request posted");
  if (ok) { favTitle = ""; favNote = ""; favReward = ""; renderComposer(); }
}

/* ============================================================
   Cards
   ============================================================ */
function openFavorCard(f) {
  const mine = auth && f.poster_name === auth.name;
  return `<div class="bid-card">
    <div class="bid-top">
      <div class="bid-who">${avatarHtml(f.poster_name)}<div class="bid-name">${esc(f.poster_name)}</div></div>
      ${rewardPill(f)}
    </div>
    <div class="favor-title">${esc(f.title)}</div>
    <div class="favor-meta">${catChip(f.category)}<span class="favor-ago">${esc(relShort(f.created_at))} ago</span></div>
    ${f.note ? `<div class="bid-note">“${esc(f.note)}”</div>` : ""}
    <div class="bid-actions">
      ${mine
        ? `<button class="btn ghost small" data-act="edit" data-id="${f.id}">Edit</button><button class="btn danger small" data-act="cancel" data-id="${f.id}">Cancel</button>`
        : `<button class="btn claim small" data-act="claim" data-id="${f.id}">I'll do it</button>`}
    </div>
  </div>`;
}
function progressFavorCard(f) {
  const iAmClaimer = auth && f.claimed_by === auth.name;
  return `<div class="bid-card">
    <div class="bid-top">
      <div class="bid-who">${avatarHtml(f.claimed_by)}<div><div class="bid-name">${esc(f.title)}</div><div class="bid-subline">asked by ${esc(f.poster_name)} · on it: ${esc(f.claimed_by)}</div></div></div>
      ${rewardPill(f)}
    </div>
    <div class="favor-meta"><span class="status-badge claimed">On it</span>${catChip(f.category)}</div>
    ${f.note ? `<div class="bid-note">“${esc(f.note)}”</div>` : ""}
    <div class="bid-actions">
      ${iAmClaimer ? `<button class="btn claim small" data-act="done" data-id="${f.id}">Mark done</button><button class="btn ghost small" data-act="unclaim" data-id="${f.id}">Un-claim</button>` : ""}
    </div>
  </div>`;
}
function doneFavorCard(f) {
  const iAmPoster = auth && f.poster_name === auth.name;
  const owed = f.status === "done" && Number(f.reward) > 0;
  return `<div class="history-card">
    <div class="history-top"><div class="history-area">${esc(f.title)}</div><div class="history-amt">${Number(f.reward) > 0 ? fmtMoney(f.reward) : "—"}</div></div>
    <div class="history-sub">${esc(f.claimed_by || "?")} did <b>${esc(f.poster_name)}</b>'s ${esc(catMeta(f.category).label.toLowerCase())} · ${f.status === "paid" ? "paid" : owed ? "awaiting payment" : "done"}</div>
    <div class="history-contribs">${esc(fmtDate(f.paid_at || f.done_at || f.created_at))}</div>
    ${owed && iAmPoster ? `<div class="bid-actions" style="margin-top:10px"><button class="btn primary small" data-act="paid" data-id="${f.id}">Mark paid</button></div>` : ""}
  </div>`;
}

function wireFavorActions() {
  document.querySelectorAll("[data-act][data-id]").forEach((el) => {
    const f = favors.find((x) => x.id === el.dataset.id);
    if (!f) return;
    el.addEventListener("click", () => {
      const act = el.dataset.act;
      if (act === "claim") callRpc("claim_favor", { p_id: f.id }, "You're on it — thanks!");
      else if (act === "done") callRpc("mark_favor_done", { p_id: f.id }, Number(f.reward) > 0 ? "Marked done — waiting on the tip" : "Marked done — nice one");
      else if (act === "unclaim") callRpc("unclaim_favor", { p_id: f.id }, "Un-claimed");
      else if (act === "cancel") { if (confirm(`Cancel your request "${f.title}"?`)) callRpc("cancel_favor", { p_id: f.id }, "Request canceled"); }
      else if (act === "paid") callRpc("mark_favor_paid", { p_id: f.id }, "Marked paid — done!");
      else if (act === "edit") onEditFavor(f);
    });
  });
}
function onEditFavor(f) {
  if (!requireAuth()) return;
  const title = prompt("What do you need?", f.title);
  if (title == null) return;
  const rewardRaw = prompt("Reward / tip in JD (0 for a free favor):", money(f.reward));
  if (rewardRaw == null) return;
  const reward = Number(rewardRaw);
  if (isNaN(reward) || reward < 0) return toast("Reward can't be negative");
  callRpc("edit_favor", { p_id: f.id, p_title: title, p_note: f.note ?? null, p_category: f.category, p_reward: reward }, "Request updated");
}

/* ============================================================
   Render + data
   ============================================================ */
function renderSections() {
  const open = favors.filter((f) => f.status === "open");
  const prog = favors.filter((f) => f.status === "claimed");
  const done = favors.filter((f) => f.status === "done" || f.status === "paid");
  open.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  prog.sort((a, b) => new Date(a.claimed_at || a.created_at) - new Date(b.claimed_at || b.created_at));
  done.sort((a, b) => new Date(b.done_at || b.created_at) - new Date(a.done_at || a.created_at));

  openFavorsEl.innerHTML = open.length ? open.map(openFavorCard).join("") : emptyBlock("No open requests. Ask for something above.");
  progressFavorsEl.innerHTML = prog.length ? prog.map(progressFavorCard).join("") : emptyBlock("Nothing being handled right now.");
  doneFavorsEl.innerHTML = done.length ? done.map(doneFavorCard).join("") : emptyBlock("No finished favors yet.");
  wireFavorActions();
}
function updateStats() {
  const open = favors.filter((f) => f.status === "open");
  const reward = open.reduce((s, f) => s + Number(f.reward || 0), 0);
  if (statOpenEl) statOpenEl.textContent = open.length;
  if (statRewardEl) statRewardEl.textContent = fmtMoney(reward);
}
function render() {
  if (!composerBeingTyped()) renderComposer();
  renderSections();
  updateStats();
}
async function reload() {
  try {
    const { data, error } = await sb.from("favors").select("*").order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    favors = data || [];
  } catch (e) {
    toast("Connection issue: " + (e.message || e));
  }
  render();
}
function subscribeRealtime() {
  sb.channel("favors-board").on("postgres_changes", { event: "*", schema: "public", table: "favors" }, reload).subscribe();
}

// Keep "x ago" fresh without wiping a focused field.
setInterval(() => { if (!composerBeingTyped()) renderSections(); }, 60000);

// ---- boot ----
renderNav("requests");
onAuthChange = render;
afterWrite = reload;
render();
(async () => { await reload(); subscribeRealtime(); })();
