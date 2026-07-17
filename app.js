/* ============================================================
   Cleaning Bids board.

   The "areas" are the rooms in the floor plan (config.js). Anyone can add
   money to an area's POT (a bid: amount + their name). Bids on the same
   area stack — $3 + $2 = a $5 pot. Anyone can then CLAIM an area: that
   records a claim in the history for the pot total and clears the area's
   bids so it reopens for new ones.

   All data lives in Supabase (supabase.js). The board subscribes to
   realtime changes, so every open device updates the moment someone
   bids or claims.
   ============================================================ */

const offices = OFFICES;
const officeIds = Object.keys(offices);

// ---- live data from Supabase ----
let bids = [];       // { id, office_id, room_id, bidder_name, amount, created_at }
let claims = [];     // { id, office_id, room_id, claimed_by, total_amount, contributors, created_at }
let selectedArea = null; // { officeId, roomId } | null

// ---- who am I (just a name, stored locally) ----
function userName() { return (localStorage.getItem("bidder_name") || "").trim(); }
function setUserName(n) { localStorage.setItem("bidder_name", (n || "").trim()); }

// ---- DOM ----
const floorPlanWrapEl = document.getElementById("floorPlanWrap");
const detailPanelEl = document.getElementById("detailPanel");
const historyListEl = document.getElementById("historyList");
const toastEl = document.getElementById("toast");
const userNameLabel = document.getElementById("userNameLabel");
const changeNameBtn = document.getElementById("changeNameBtn");

// ---- helpers ----
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function money(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function roomName(officeId, roomId) {
  return offices[officeId]?.rooms.find((r) => r.id === roomId)?.name ?? roomId;
}
function officeLabel(officeId) {
  return offices[officeId]?.label ?? officeId;
}
function areaBids(officeId, roomId) {
  return bids.filter((b) => b.office_id === officeId && b.room_id === roomId);
}
function potFor(officeId, roomId) {
  return areaBids(officeId, roomId).reduce((s, b) => s + Number(b.amount), 0);
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

/* ============================================================
   Isometric "dollhouse" renderer.

   The FLOOR_PLAN geometry in config.js is ground truth (traced from the
   real reference plan) — this code only changes how it's DRAWN: a 2:1
   isometric projection where every room is an extruded slab (visible top
   face + south/east side faces), the real walls stand on top of the slab
   with their door gaps kept open, and selecting an area smoothly lifts
   its slab out of the model.
   ============================================================ */

const ISO_BASE = 16;   // slab thickness (z of every room's floor top)
const ISO_LIFT = 22;   // how far a selected room's slab rises
const WALL_H  = 54;    // wall height above the slab
const WALL_T  = 12;    // wall thickness

// Rendering-only relationships: some rooms sit ON another room's slab
// (they overlap it in plan), so their side faces must start at the
// parent slab's top — and ride along when the parent slab is lifted.
const PLATE_RENDER = {
  "moha:bathroom": { parent: "desks", pad: 0, southBottom: "parent", eastSplit: 532 },
  "malek:dishwashing": { parent: "kitchen", pad: 0, southBottom: "parent", eastBottom: "parent" },
  "malek:bathroom": { parent: "desks", pad: 0, southBottom: "parent" },
};

function isoPt(x, y, z = 0) {
  return [x - y, (x + y) / 2 - z];
}
function ptsAttr(points) {
  return points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
}
function shapeKey(s) {
  return `${s.officeId}:${s.id}`;
}

// Stable per-shape identity (distinct from shapeKey, which is per-ROOM and
// intentionally shared by multi-piece rooms like the L-shaped Chill Area).
FLOOR_PLAN.shapes.forEach((s, i) => { s.__i = i; });

// Rectilinear union of axis-aligned rects -> ordered boundary polygon,
// so a multi-piece room gets ONE seamless floor polygon instead of two.
function unionOutline(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  const filled = new Set();
  for (const r of rects) {
    const x0 = xs.indexOf(r.x), x1 = xs.indexOf(r.x + r.w);
    const y0 = ys.indexOf(r.y), y1 = ys.indexOf(r.y + r.h);
    for (let i = x0; i < x1; i++) for (let j = y0; j < y1; j++) filled.add(`${i},${j}`);
  }
  const edges = new Map();
  const toggle = (x1, y1, x2, y2) => {
    const rev = `${x2},${y2},${x1},${y1}`;
    if (edges.has(rev)) edges.delete(rev);
    else edges.set(`${x1},${y1},${x2},${y2}`, true);
  };
  for (const key of filled) {
    const [i, j] = key.split(",").map(Number);
    const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
    toggle(x0, y0, x1, y0);
    toggle(x1, y0, x1, y1);
    toggle(x1, y1, x0, y1);
    toggle(x0, y1, x0, y0);
  }
  const next = new Map();
  for (const key of edges.keys()) {
    const [x1, y1, x2, y2] = key.split(",").map(Number);
    next.set(`${x1},${y1}`, [x2, y2]);
  }
  const [firstKey] = next.keys();
  const loop = [];
  let cur = firstKey;
  do {
    const [x, y] = cur.split(",").map(Number);
    loop.push([x, y]);
    const [nx, ny] = next.get(cur);
    cur = `${nx},${ny}`;
  } while (cur !== firstKey && loop.length < rects.length * 5);
  return loop;
}

const ROOM_TOP_OUTLINE = new Map();
{
  const groups = new Map();
  for (const s of FLOOR_PLAN.shapes) {
    const key = shapeKey(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const [key, pieces] of groups) {
    if (pieces.length > 1) ROOM_TOP_OUTLINE.set(key, unionOutline(pieces));
  }
}

// Current + target lift per shape (world units), tweened.
const liftCur = {};
function isSelected(officeId, roomId) {
  return !!selectedArea && selectedArea.officeId === officeId && selectedArea.roomId === roomId;
}
function liftTarget(officeId, roomId) {
  return isSelected(officeId, roomId) ? ISO_LIFT : 0;
}

function plateGeom(s) {
  const key = shapeKey(s);
  const cfg = PLATE_RENDER[key];
  const Lself = liftCur[key] ?? 0;
  const Lparent = cfg?.parent ? (liftCur[`${s.officeId}:${cfg.parent}`] ?? 0) : 0;
  const parentTop = ISO_BASE + Lparent;
  const top = ISO_BASE + (cfg?.pad ?? 0) + Lself + Lparent;
  const x2 = s.x + s.w, y2 = s.y + s.h;

  const polys = {};
  const unionPts = ROOM_TOP_OUTLINE.get(key);
  if (unionPts) {
    const isFirst = s.__i === Math.min(...FLOOR_PLAN.shapes.filter((o) => shapeKey(o) === key).map((o) => o.__i));
    if (isFirst) polys.top = unionPts.map(([x, y]) => isoPt(x, y, top));
  } else {
    polys.top = [isoPt(s.x, s.y, top), isoPt(x2, s.y, top), isoPt(x2, y2, top), isoPt(s.x, y2, top)];
  }
  const siblings = FLOOR_PLAN.shapes.filter((o) => o !== s && shapeKey(o) === key);
  if (siblings.length) {
    const cut = (lo, hi, cuts) => {
      let spans = [[lo, hi]];
      for (const [a, b] of cuts) {
        spans = spans.flatMap(([p, q]) => {
          const c = Math.max(p, a), d = Math.min(q, b);
          if (c >= d) return [[p, q]];
          const keep = [];
          if (p < c) keep.push([p, c]);
          if (d < q) keep.push([d, q]);
          return keep;
        });
      }
      return spans;
    };
    const southCuts = siblings.filter((o) => o.y === y2).map((o) => [o.x, o.x + o.w]);
    cut(s.x, x2, southCuts).forEach(([a, b], i) => {
      polys["south" + (i || "")] = [isoPt(a, y2, top), isoPt(b, y2, top), isoPt(b, y2, 0), isoPt(a, y2, 0)];
    });
    const eastCuts = siblings.filter((o) => o.x === x2).map((o) => [o.y, o.y + o.h]);
    cut(s.y, y2, eastCuts).forEach(([a, b], i) => {
      polys["east" + (i || "")] = [isoPt(x2, a, top), isoPt(x2, b, top), isoPt(x2, b, 0), isoPt(x2, a, 0)];
    });
    return { polys, top };
  }

  const southBottom = cfg?.southBottom === "parent" ? parentTop : 0;
  polys.south = [isoPt(s.x, y2, top), isoPt(x2, y2, top), isoPt(x2, y2, southBottom), isoPt(s.x, y2, southBottom)];

  if (cfg?.eastSplit != null) {
    const m = cfg.eastSplit;
    polys.east = [isoPt(x2, s.y, top), isoPt(x2, m, top), isoPt(x2, m, 0), isoPt(x2, s.y, 0)];
    polys.east2 = [isoPt(x2, m, top), isoPt(x2, y2, top), isoPt(x2, y2, parentTop), isoPt(x2, m, parentTop)];
  } else {
    const eastBottom = cfg?.eastBottom === "parent" ? parentTop : 0;
    polys.east = [isoPt(x2, s.y, top), isoPt(x2, y2, top), isoPt(x2, y2, eastBottom), isoPt(x2, s.y, eastBottom)];
  }
  return { polys, top };
}

const WALL_CHUNK = 70;
function wallBoxes() {
  const boxes = [];
  for (const w of FLOOR_PLAN.walls || []) {
    const horizontal = w.y1 === w.y2;
    const lo = horizontal ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2);
    const hi = horizontal ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
    const spans = [];
    if (w.doorGap) {
      const [gs, ge] = w.doorGap;
      if (gs - lo > 1) spans.push([lo - WALL_T / 2, gs]);
      if (hi - ge > 1) spans.push([ge, hi + WALL_T / 2]);
    } else {
      spans.push([lo - WALL_T / 2, hi + WALL_T / 2]);
    }
    for (const [a, b] of spans) {
      const len = b - a;
      const n = Math.max(1, Math.ceil(len / WALL_CHUNK));
      const step = len / n;
      for (let k = 0; k < n; k++) {
        const segA = a + step * k, segB = Math.min(b, a + step * (k + 1) + 2);
        boxes.push(
          horizontal
            ? { x: segA, y: w.y1 - WALL_T / 2, w: segB - segA, h: WALL_T }
            : { x: w.x1 - WALL_T / 2, y: segA, w: WALL_T, h: segB - segA }
        );
      }
    }
  }
  return boxes;
}

function wallPolys(b) {
  const z0 = ISO_BASE, z1 = ISO_BASE + WALL_H;
  const x2 = b.x + b.w, y2 = b.y + b.h;
  return {
    top: [isoPt(b.x, b.y, z1), isoPt(x2, b.y, z1), isoPt(x2, y2, z1), isoPt(b.x, y2, z1)],
    south: [isoPt(b.x, y2, z1), isoPt(x2, y2, z1), isoPt(x2, y2, z0), isoPt(b.x, y2, z0)],
    east: [isoPt(x2, b.y, z1), isoPt(x2, y2, z1), isoPt(x2, y2, z0), isoPt(x2, b.y, z0)],
  };
}

function labelLines(name, s) {
  const spanUnits = s.w + s.h;
  if (name.length * 34 > spanUnits * 0.9 && name.includes(" ")) {
    const words = name.split(" ");
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  return [name];
}

let isoScene = null;
let tweenRAF = null;

function computeViewBox(walls) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  const add = (p) => {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  };
  const zMax = ISO_BASE + 6 + ISO_LIFT * 2;
  for (const s of FLOOR_PLAN.shapes) {
    for (const z of [0, zMax]) {
      add(isoPt(s.x, s.y, z));
      add(isoPt(s.x + s.w, s.y, z));
      add(isoPt(s.x + s.w, s.y + s.h, z));
      add(isoPt(s.x, s.y + s.h, z));
    }
  }
  for (const b of walls) {
    for (const z of [ISO_BASE, ISO_BASE + WALL_H]) {
      add(isoPt(b.x, b.y, z));
      add(isoPt(b.x + b.w, b.y, z));
      add(isoPt(b.x + b.w, b.y + b.h, z));
      add(isoPt(b.x, b.y + b.h, z));
    }
  }
  const mx = 46, mTop = 26, mBottom = 52;
  return { x: minX - mx, y: minY - mTop, w: maxX - minX + mx * 2, h: maxY - minY + mTop + mBottom };
}

function buildScene() {
  for (const s of FLOOR_PLAN.shapes) {
    liftCur[shapeKey(s)] = liftTarget(s.officeId, s.id);
  }

  const farKey = (b) => (b.x + b.w / 2) + (b.y + b.h / 2);
  const walls = wallBoxes().sort((a, b) => farKey(a) - farKey(b));

  const rawKey = new Map(FLOOR_PLAN.shapes.map((s) => [s, farKey(s)]));
  for (const s of FLOOR_PLAN.shapes) {
    const parentId = PLATE_RENDER[shapeKey(s)]?.parent;
    if (!parentId) continue;
    const parent = FLOOR_PLAN.shapes.find((p) => p.officeId === s.officeId && p.id === parentId);
    if (parent && rawKey.get(parent) >= rawKey.get(s)) {
      rawKey.set(s, rawKey.get(parent) + 1);
    }
  }
  const shapes = [...FLOOR_PLAN.shapes].sort((a, b) => rawKey.get(a) - rawKey.get(b));
  const vb = computeViewBox(walls);

  const shadowHtml = FLOOR_PLAN.shapes
    .map((s) => {
      const g = 14;
      const p = [
        isoPt(s.x - g, s.y - g, 0), isoPt(s.x + s.w + g, s.y - g, 0),
        isoPt(s.x + s.w + g, s.y + s.h + g, 0), isoPt(s.x - g, s.y + s.h + g, 0),
      ];
      return `<polygon points="${ptsAttr(p)}"></polygon>`;
    })
    .join("");

  const platesHtml = shapes
    .map((s) => {
      const { polys } = plateGeom(s);
      const faces = Object.entries(polys)
        .map(([face, p]) => `<polygon class="f-${face.replace(/\d+$/, "")}" data-face="${face}" points="${ptsAttr(p)}"></polygon>`)
        .join("");
      const pad = (PLATE_RENDER[shapeKey(s)]?.pad ?? 0) > 0 ? " pad" : "";
      const deco = s.deco ? " deco" : "";
      return `<g class="plate office-${s.officeId}${pad}${deco}" data-office="${s.officeId}" data-room="${s.id}" data-idx="${s.__i}">${faces}</g>`;
    })
    .join("");

  const wallsHtml = walls
    .map((b) => {
      const p = wallPolys(b);
      return `<g class="wallbox">
        <polygon class="w-south" points="${ptsAttr(p.south)}"></polygon>
        <polygon class="w-east" points="${ptsAttr(p.east)}"></polygon>
        <polygon class="w-top" points="${ptsAttr(p.top)}"></polygon>
      </g>`;
    })
    .join("");

  const labelsHtml = FLOOR_PLAN.shapes
    .filter((s) => s.label !== false)
    .map((s) => {
      const cx = s.lx ?? s.x + s.w / 2, cy = s.ly ?? s.y + s.h / 2;
      const [px, py] = isoPt(cx, cy, 0);
      const lines = labelLines(roomName(s.officeId, s.id), s);
      const nameTspans = lines
        .map((ln, i) => `<tspan x="${px.toFixed(1)}" dy="${i === 0 ? (lines.length > 1 ? "-0.62em" : "0") : "1.12em"}">${esc(ln)}</tspan>`)
        .join("");
      return `<g class="room-label-g" data-office="${s.officeId}" data-room="${s.id}">
        <text class="room-label" x="${px.toFixed(1)}" y="${py.toFixed(1)}">${nameTspans}</text>
        <text class="room-price-tag" x="${px.toFixed(1)}" y="${py.toFixed(1)}" dy="${lines.length > 1 ? "1.85em" : "1.45em"}"></text>
      </g>`;
    })
    .join("");

  floorPlanWrapEl.innerHTML = `
    <div class="floorplan-frame" style="aspect-ratio:${vb.w.toFixed(0)}/${vb.h.toFixed(0)}">
      <svg class="floorplan-svg" viewBox="${vb.x.toFixed(0)} ${vb.y.toFixed(0)} ${vb.w.toFixed(0)} ${vb.h.toFixed(0)}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="groundBlur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="15"></feGaussianBlur>
          </filter>
        </defs>
        <g class="ground-shadow" filter="url(#groundBlur)">${shadowHtml}</g>
        <g class="plates">${platesHtml}</g>
        <g class="wallsets">${wallsHtml}</g>
        <g class="labels">${labelsHtml}</g>
      </svg>
    </div>
    <div class="floorplan-legend">
      ${officeIds.map((id) => `<div class="legend-item"><span class="swatch office-${id}"></span>${esc(offices[id].label)}</div>`).join("")}
    </div>`;

  isoScene = { shapeEls: new Map() };
  const svg = floorPlanWrapEl.querySelector("svg");
  svg.querySelectorAll(".plate").forEach((group) => {
    const i = Number(group.dataset.idx);
    const s = FLOOR_PLAN.shapes[i];
    const polyEls = {};
    group.querySelectorAll("polygon").forEach((el) => (polyEls[el.dataset.face] = el));
    const labelG = svg.querySelector(`.room-label-g[data-office="${s.officeId}"][data-room="${s.id}"]`);
    isoScene.shapeEls.set(i, {
      shape: s,
      group,
      polyEls,
      labelG,
      tagEl: labelG ? labelG.querySelector(".room-price-tag") : null,
    });
    if (!s.deco) group.addEventListener("click", () => selectArea(s.officeId, s.id));
  });
}

function applyShapeGeometry(s) {
  const entry = isoScene.shapeEls.get(s.__i);
  const { polys, top } = plateGeom(s);
  for (const [face, p] of Object.entries(polys)) {
    if (entry.polyEls[face]) entry.polyEls[face].setAttribute("points", ptsAttr(p));
  }
  if (entry.labelG) entry.labelG.setAttribute("transform", `translate(0,${(-top).toFixed(1)})`);
}

function startLiftTween() {
  if (tweenRAF) return;
  const step = () => {
    let live = false;
    for (const s of FLOOR_PLAN.shapes) {
      const key = shapeKey(s);
      const target = liftTarget(s.officeId, s.id);
      const cur = liftCur[key];
      if (Math.abs(target - cur) > 0.35) {
        liftCur[key] = cur + (target - cur) * 0.2;
        live = true;
      } else {
        liftCur[key] = target;
      }
    }
    for (const s of FLOOR_PLAN.shapes) applyShapeGeometry(s);
    tweenRAF = live ? requestAnimationFrame(step) : null;
  };
  tweenRAF = requestAnimationFrame(step);
}

function renderFloorPlan() {
  if (!isoScene) buildScene();
  for (const s of FLOOR_PLAN.shapes) {
    const entry = isoScene.shapeEls.get(s.__i);
    const sel = isSelected(s.officeId, s.id);
    const pot = potFor(s.officeId, s.id);
    entry.group.classList.toggle("selected", sel);
    entry.group.classList.toggle("has-pot", pot > 0 && !sel);
    if (entry.labelG) {
      entry.labelG.classList.toggle("selected", sel);
      entry.labelG.classList.toggle("has-pot", pot > 0 && !sel);
      if (entry.tagEl) entry.tagEl.textContent = pot > 0 ? `$${money(pot)}` : "";
    }
  }
  startLiftTween();
}

/* ============================================================
   Bidding + claim UI
   ============================================================ */

function selectArea(officeId, roomId) {
  selectedArea = isSelected(officeId, roomId) ? null : { officeId, roomId };
  renderFloorPlan();
  renderDetail();
}

function renderDetail() {
  if (!selectedArea) {
    detailPanelEl.innerHTML = `<div class="detail-empty">Tap an area on the plan to add money to its pot, or to claim it.</div>`;
    return;
  }
  const { officeId, roomId } = selectedArea;
  const name = roomName(officeId, roomId);
  const office = officeLabel(officeId);
  const pot = potFor(officeId, roomId);
  const contributors = areaBids(officeId, roomId);
  const nm = userName();

  const chips = contributors.length
    ? contributors
        .map((b) => `<span class="chip"><b>${esc(b.bidder_name)}</b> $${money(b.amount)}</span>`)
        .join("")
    : `<span class="detail-none">No bids yet — be the first to add to the pot.</span>`;

  detailPanelEl.innerHTML = `
    <div class="detail-card">
      <div class="detail-head">
        <div class="detail-title">${esc(name)}${office !== name ? `<span class="room-office-tag">${esc(office)}</span>` : ""}</div>
        <div class="detail-pot"><span>Pot</span>$${money(pot)}</div>
      </div>
      <div class="chips">${chips}</div>

      <div class="bid-form">
        <input id="nameInput" class="fld" type="text" placeholder="Your name" value="${esc(nm)}" autocomplete="name" />
        <input id="amtInput" class="fld amt" type="number" inputmode="decimal" min="1" step="1" placeholder="$" />
        <button id="addBidBtn" class="btn">Add to pot</button>
      </div>

      <button id="claimBtn" class="btn claim" ${pot > 0 ? "" : "disabled"}>
        ${pot > 0 ? `Claim &amp; clean · collect $${money(pot)}` : "Nothing to claim yet"}
      </button>
    </div>`;

  const nameInput = document.getElementById("nameInput");
  const amtInput = document.getElementById("amtInput");
  nameInput.addEventListener("change", () => { setUserName(nameInput.value); updateWhoami(); });
  amtInput.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("addBidBtn").click(); });
  document.getElementById("addBidBtn").addEventListener("click", () =>
    onAddBid(officeId, roomId, nameInput.value.trim(), amtInput.value));
  document.getElementById("claimBtn").addEventListener("click", () =>
    onClaim(officeId, roomId, nameInput.value.trim()));
}

async function onAddBid(officeId, roomId, name, amountRaw) {
  const amount = Number(amountRaw);
  if (!name) return toast("Enter your name first");
  if (!amount || amount <= 0) return toast("Enter an amount greater than 0");
  setUserName(name);
  updateWhoami();
  try {
    const { error } = await sb.from("bids").insert({
      office_id: officeId, room_id: roomId, bidder_name: name, amount,
    });
    if (error) throw error;
    toast(`Added $${money(amount)} to ${roomName(officeId, roomId)}`);
    await reload();
  } catch (e) {
    toast("Could not add bid: " + (e.message || e));
  }
}

async function onClaim(officeId, roomId, name) {
  const pot = potFor(officeId, roomId);
  if (pot <= 0) return;
  if (!name) return toast("Enter your name first");
  if (!confirm(`Claim ${roomName(officeId, roomId)} and collect $${money(pot)}? You'll go and clean it.`)) return;
  setUserName(name);
  updateWhoami();
  try {
    const { error } = await sb.rpc("claim_area", {
      p_office_id: officeId, p_room_id: roomId, p_claimed_by: name,
    });
    if (error) throw error;
    toast(`You claimed ${roomName(officeId, roomId)} · $${money(pot)}`);
    selectedArea = null;
    await reload();
  } catch (e) {
    toast("Could not claim: " + (e.message || e));
  }
}

function renderHistory() {
  if (!claims.length) {
    historyListEl.innerHTML = `<div class="detail-empty">No areas claimed yet.</div>`;
    return;
  }
  historyListEl.innerHTML = claims
    .map((c) => {
      const contribs = (c.contributors || [])
        .map((x) => `${esc(x.name)} $${money(x.amount)}`)
        .join(", ");
      return `<div class="history-card">
        <div class="history-top">
          <div class="history-area">${esc(roomName(c.office_id, c.room_id))}<span class="room-office-tag">${esc(officeLabel(c.office_id))}</span></div>
          <div class="history-amt">$${money(c.total_amount)}</div>
        </div>
        <div class="history-sub">Claimed by <b>${esc(c.claimed_by)}</b> · ${esc(fmtDate(c.created_at))}</div>
        ${contribs ? `<div class="history-contribs">from ${contribs}</div>` : ""}
      </div>`;
    })
    .join("");
}

/* ============================================================
   Data loading + realtime
   ============================================================ */

async function reload() {
  try {
    const [bidsRes, claimsRes] = await Promise.all([
      sb.from("bids").select("*").order("created_at", { ascending: true }),
      sb.from("claims").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    if (bidsRes.error) throw bidsRes.error;
    if (claimsRes.error) throw claimsRes.error;
    bids = bidsRes.data || [];
    claims = claimsRes.data || [];
  } catch (e) {
    toast("Connection issue: " + (e.message || e));
  }
  renderFloorPlan();
  renderDetail();
  renderHistory();
}

function subscribeRealtime() {
  sb.channel("board")
    .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "claims" }, reload)
    .subscribe();
}

function updateWhoami() {
  userNameLabel.textContent = userName() || "—";
}

changeNameBtn.addEventListener("click", () => {
  const n = prompt("Your name (shown on your bids and claims):", userName());
  if (n != null) {
    setUserName(n);
    updateWhoami();
    renderDetail();
  }
});

// ---- boot ----
updateWhoami();
renderFloorPlan();
renderDetail();
renderHistory();
reload();
subscribeRealtime();
