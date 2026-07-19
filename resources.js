/* ============================================================
   Resources — one service of The Office.

   "We're out of coffee", "need an HDMI cable". Post what the office
   needs (with an optional bounty), someone grabs it, marks it got,
   and the poster settles up if there was a reward. Built on core.js.
   ============================================================ */

let resources = [];
let rItem = "", rQty = "", rNote = "", rReward = "", rUrgent = false;

const composerEl = document.getElementById("composer");
const openResEl = document.getElementById("openRes");
const progressResEl = document.getElementById("progressRes");
const doneResEl = document.getElementById("doneRes");
const statOpenEl = document.getElementById("statOpen");
const statUrgentEl = document.getElementById("statUrgent");

function rewardPill(r) {
  return Number(r.reward) > 0
    ? `<span class="reward-pill">${fmtMoney(r.reward)}</span>`
    : `<span class="favor-pill">No bounty</span>`;
}
function urgentBadge(r) { return r.urgency === "urgent" ? `<span class="urgent-badge">Urgent</span>` : ""; }

function composerBeingTyped() {
  const a = document.activeElement;
  return a && composerEl.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}
function renderComposer() {
  if (!auth) {
    composerEl.innerHTML = `<div class="composer-empty"><div class="ce-title">Request something</div><div class="ce-sub">Sign in with your name and a PIN to ask the office for supplies or gear.</div><button class="btn primary" id="composerSignIn">Sign in</button></div>`;
    document.getElementById("composerSignIn").addEventListener("click", () => openAuth());
    return;
  }
  composerEl.innerHTML = `
    <div class="card-head"><span>Request a resource</span><span class="hint">as ${esc(auth.name)}</span></div>
    <div class="card-body">
      <input id="rItem" class="fld" type="text" maxlength="120" placeholder="What does the office need? e.g. coffee beans, an HDMI cable" value="${esc(rItem)}" />
      <div class="bid-form">
        <input id="rQty" class="fld" type="text" maxlength="40" placeholder="How much / many (optional)" value="${esc(rQty)}" />
        <button type="button" id="rUrgentBtn" class="cat-btn ${rUrgent ? "on" : ""}" style="white-space:nowrap">⚡ Urgent</button>
      </div>
      <textarea id="rNote" class="fld note" rows="2" placeholder="Any detail (optional) — brand, where to get it, etc.">${esc(rNote)}</textarea>
      <div class="bid-form">
        <input id="rReward" class="fld amt-wide" type="number" inputmode="decimal" min="0" step="1" placeholder="Bounty for whoever gets it (optional, JD)" value="${esc(rReward)}" />
        <button id="postResBtn" class="btn primary">Post request</button>
      </div>
      <div class="composer-note" id="composerNote"></div>
    </div>`;
  const itemEl = document.getElementById("rItem");
  const qtyEl = document.getElementById("rQty");
  const noteEl = document.getElementById("rNote");
  const rewardEl = document.getElementById("rReward");
  const urgentBtn = document.getElementById("rUrgentBtn");
  const preview = document.getElementById("composerNote");
  const previewNote = () => {
    const v = Number(rewardEl.value);
    preview.innerHTML = v > 0 ? `A <b>${fmtMoney(v)}</b> bounty for whoever brings it.` : `No bounty — someone grabs it for the office.`;
  };
  previewNote();
  itemEl.addEventListener("input", () => { rItem = itemEl.value; });
  qtyEl.addEventListener("input", () => { rQty = qtyEl.value; });
  noteEl.addEventListener("input", () => { rNote = noteEl.value; });
  rewardEl.addEventListener("input", () => { rReward = rewardEl.value; previewNote(); });
  urgentBtn.addEventListener("click", () => { rUrgent = !rUrgent; urgentBtn.classList.toggle("on", rUrgent); });
  itemEl.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("postResBtn").click(); });
  document.getElementById("postResBtn").addEventListener("click", onPostResource);
}
async function onPostResource() {
  if (!requireAuth(onPostResource)) return;
  const item = (document.getElementById("rItem")?.value ?? rItem).trim();
  if (!item) return toast("Say what the office needs");
  const reward = Number(document.getElementById("rReward")?.value || 0) || 0;
  const qty = (document.getElementById("rQty")?.value ?? rQty).trim();
  const note = (document.getElementById("rNote")?.value ?? rNote).trim();
  const ok = await callRpc("post_resource",
    { p_item: item, p_qty: qty || null, p_note: note || null, p_urgency: rUrgent ? "urgent" : "normal", p_reward: reward },
    "Request posted");
  if (ok) { rItem = ""; rQty = ""; rNote = ""; rReward = ""; rUrgent = false; renderComposer(); }
}

function openResCard(r) {
  const mine = auth && r.poster_name === auth.name;
  return `<div class="bid-card${r.urgency === "urgent" ? " urgent" : ""}">
    <div class="bid-top">
      <div class="bid-who">${avatarHtml(r.poster_name)}<div class="bid-name">${esc(r.poster_name)}</div></div>
      ${rewardPill(r)}
    </div>
    <div class="favor-title">${esc(r.item)}${r.qty ? ` <span class="res-qty">×${esc(r.qty)}</span>` : ""}</div>
    <div class="favor-meta">${urgentBadge(r)}<span class="favor-ago">${esc(relShort(r.created_at))} ago</span></div>
    ${r.note ? `<div class="bid-note">“${esc(r.note)}”</div>` : ""}
    <div class="bid-actions">
      ${mine
        ? `<button class="btn ghost small" data-act="edit" data-id="${r.id}">Edit</button><button class="btn danger small" data-act="cancel" data-id="${r.id}">Cancel</button>`
        : `<button class="btn claim small" data-act="claim" data-id="${r.id}">I'll get it</button>`}
    </div>
  </div>`;
}
function progressResCard(r) {
  const iAmClaimer = auth && r.claimed_by === auth.name;
  return `<div class="bid-card">
    <div class="bid-top">
      <div class="bid-who">${avatarHtml(r.claimed_by)}<div><div class="bid-name">${esc(r.item)}${r.qty ? ` ×${esc(r.qty)}` : ""}</div><div class="bid-subline">asked by ${esc(r.poster_name)} · getting it: ${esc(r.claimed_by)}</div></div></div>
      ${rewardPill(r)}
    </div>
    <div class="favor-meta"><span class="status-badge claimed">On it</span>${urgentBadge(r)}</div>
    ${r.note ? `<div class="bid-note">“${esc(r.note)}”</div>` : ""}
    <div class="bid-actions">
      ${iAmClaimer ? `<button class="btn claim small" data-act="got" data-id="${r.id}">Mark got</button><button class="btn ghost small" data-act="unclaim" data-id="${r.id}">Un-claim</button>` : ""}
    </div>
  </div>`;
}
function doneResCard(r) {
  const iAmPoster = auth && r.poster_name === auth.name;
  const owed = r.status === "done" && Number(r.reward) > 0;
  return `<div class="history-card">
    <div class="history-top"><div class="history-area">${esc(r.item)}${r.qty ? ` ×${esc(r.qty)}` : ""}</div><div class="history-amt">${Number(r.reward) > 0 ? fmtMoney(r.reward) : "—"}</div></div>
    <div class="history-sub">${esc(r.claimed_by || "?")} got it for <b>${esc(r.poster_name)}</b> · ${r.status === "paid" ? "paid" : owed ? "awaiting payment" : "done"}</div>
    <div class="history-contribs">${esc(fmtDate(r.paid_at || r.done_at || r.created_at))}</div>
    ${owed && iAmPoster ? `<div class="bid-actions" style="margin-top:10px"><button class="btn primary small" data-act="paid" data-id="${r.id}">Mark paid</button></div>` : ""}
  </div>`;
}

function wireResActions() {
  document.querySelectorAll("[data-act][data-id]").forEach((el) => {
    const r = resources.find((x) => x.id === el.dataset.id);
    if (!r) return;
    el.addEventListener("click", () => {
      const act = el.dataset.act;
      if (act === "claim") callRpc("claim_resource", { p_id: r.id }, "You're getting it — thanks!");
      else if (act === "got") callRpc("mark_resource_got", { p_id: r.id }, Number(r.reward) > 0 ? "Marked got — waiting on the bounty" : "Marked got — nice one");
      else if (act === "unclaim") callRpc("unclaim_resource", { p_id: r.id }, "Un-claimed");
      else if (act === "cancel") { if (confirm(`Cancel your request "${r.item}"?`)) callRpc("cancel_resource", { p_id: r.id }, "Request canceled"); }
      else if (act === "paid") callRpc("mark_resource_paid", { p_id: r.id }, "Marked paid — done!");
      else if (act === "edit") onEditRes(r);
    });
  });
}
function onEditRes(r) {
  if (!requireAuth()) return;
  const item = prompt("What does the office need?", r.item);
  if (item == null) return;
  const rewardRaw = prompt("Bounty in JD (0 for none):", money(r.reward));
  if (rewardRaw == null) return;
  const reward = Number(rewardRaw);
  if (isNaN(reward) || reward < 0) return toast("Bounty can't be negative");
  callRpc("edit_resource", { p_id: r.id, p_item: item, p_qty: r.qty ?? null, p_note: r.note ?? null, p_urgency: r.urgency, p_reward: reward }, "Request updated");
}

function renderSections() {
  const rank = (r) => (r.urgency === "urgent" ? 0 : 1);
  const open = resources.filter((r) => r.status === "open");
  const prog = resources.filter((r) => r.status === "claimed");
  const done = resources.filter((r) => r.status === "done" || r.status === "paid");
  open.sort((a, b) => rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at));
  prog.sort((a, b) => new Date(a.claimed_at || a.created_at) - new Date(b.claimed_at || b.created_at));
  done.sort((a, b) => new Date(b.done_at || b.created_at) - new Date(a.done_at || a.created_at));

  openResEl.innerHTML = open.length ? open.map(openResCard).join("") : emptyBlock("Nothing needed right now. Ask above.");
  progressResEl.innerHTML = prog.length ? prog.map(progressResCard).join("") : emptyBlock("Nothing being picked up right now.");
  doneResEl.innerHTML = done.length ? done.map(doneResCard).join("") : emptyBlock("No sorted requests yet.");
  wireResActions();
}
function updateStats() {
  const open = resources.filter((r) => r.status === "open");
  if (statOpenEl) statOpenEl.textContent = open.length;
  if (statUrgentEl) statUrgentEl.textContent = open.filter((r) => r.urgency === "urgent").length;
}
function render() {
  if (!composerBeingTyped()) renderComposer();
  renderSections();
  updateStats();
}
async function reload() {
  try {
    const { data, error } = await sb.from("resources").select("*").order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    resources = data || [];
  } catch (e) {
    toast("Connection issue: " + (e.message || e));
  }
  render();
}
function subscribeRealtime() {
  sb.channel("resources-board").on("postgres_changes", { event: "*", schema: "public", table: "resources" }, reload).subscribe();
}
setInterval(() => { if (!composerBeingTyped()) renderSections(); }, 60000);

// ---- boot ----
renderNav("resources");
onAuthChange = render;
afterWrite = reload;
render();
(async () => { await reload(); subscribeRealtime(); })();
