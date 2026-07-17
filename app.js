/* ============================================================
   Cleaning Bids board.

   A BID is one posting: one bidder, one amount, and a SET of rooms it
   covers ("Malek bids 10 JD to clean Kitchen + Storage + Bathroom"). No
   splitting, no per-room maths — the amount is for the whole bundle.
   CLAIMING takes a whole bid (all its rooms), logs it to history, and
   removes it. You can select individual rooms or a whole office at once.

   Data lives in Supabase (supabase.js); the board subscribes to realtime
   changes so every device updates the moment someone bids or claims.
   ============================================================ */

const offices = OFFICES;
const officeIds = Object.keys(offices);

// ---- live data from Supabase ----
let bids = [];    // { id, bidder_name, amount, rooms:[{office,room}], created_at }
let claims = [];  // { id, bidder_name, amount, rooms, claimed_by, created_at }
const selectedKeys = new Set(); // "officeId:roomId" currently selected for a new bid

// ---- who am I (just a name, stored locally) ----
function userName() { return (localStorage.getItem("bidder_name") || "").trim(); }
function setUserName(n) { localStorage.setItem("bidder_name", (n || "").trim()); }

// ---- DOM ----
const floorPlanWrapEl = document.getElementById("floorPlanWrap");
const composerEl = document.getElementById("composer");
const dashboardEl = document.getElementById("dashboard");
const openBidsEl = document.getElementById("openBids");
const historyListEl = document.getElementById("historyList");
const toastEl = document.getElementById("toast");
const userNameLabel = document.getElementById("userNameLabel");
const changeNameBtn = document.getElementById("changeNameBtn");
const statTotalEl = document.getElementById("statTotal");
const statAreasEl = document.getElementById("statAreas");
const selHintEl = document.getElementById("selHint");

// ---- helpers ----
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
const CURRENCY = "JD"; // Jordanian Dinar
function money(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
function fmtMoney(n) { return `${money(n)} ${CURRENCY}`; }
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function roomName(officeId, roomId) {
  return offices[officeId]?.rooms.find((r) => r.id === roomId)?.name ?? roomId;
}
function officeLabel(officeId) { return offices[officeId]?.label ?? officeId; }
function keyOf(officeId, roomId) { return `${officeId}:${roomId}`; }
function selectedAreas() {
  return [...selectedKeys].map((k) => {
    const i = k.indexOf(":");
    return { officeId: k.slice(0, i), roomId: k.slice(i + 1) };
  });
}
function bidsCoveringRoom(officeId, roomId) {
  return bids.filter((b) => (b.rooms || []).some((x) => x.office === officeId && x.room === roomId));
}
function roomOffered(officeId, roomId) {
  return bidsCoveringRoom(officeId, roomId).reduce((s, b) => s + Number(b.amount), 0);
}
function roomsLabel(rooms) {
  return (rooms || []).map((x) => roomName(x.office, x.room)).join(", ");
}
function initials(name) {
  const p = name.trim().split(/\s+/);
  const s = ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase();
  return s || name.slice(0, 2).toUpperCase() || "?";
}
function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

// Animated count-up for the header pot total.
function setNumber(el, to) {
  const from = Number(el.dataset.val || 0);
  to = Number(to) || 0;
  el.dataset.val = to;
  const intTarget = Number.isInteger(to);
  const start = performance.now();
  const dur = 550;
  function frame(t) {
    const k = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    const cur = from + (to - from) * eased;
    el.textContent = `${intTarget ? Math.round(cur) : cur.toFixed(2)} ${CURRENCY}`;
    if (k < 1) requestAnimationFrame(frame);
    else el.textContent = fmtMoney(to);
  }
  requestAnimationFrame(frame);
}

/* ============================================================
   Isometric "dollhouse" renderer (geometry from config.js is ground
   truth; this only controls how it's drawn). Selecting a room lifts its
   slab; rooms with a bid on them glow gold.
   ============================================================ */

const ISO_BASE = 16, ISO_LIFT = 22, WALL_H = 54, WALL_T = 12;

const PLATE_RENDER = {
  "moha:bathroom": { parent: "desks", pad: 0, southBottom: "parent", eastSplit: 532 },
  "malek:dishwashing": { parent: "kitchen", pad: 0, southBottom: "parent", eastBottom: "parent" },
  "malek:bathroom": { parent: "desks", pad: 0, southBottom: "parent" },
};

function isoPt(x, y, z = 0) { return [x - y, (x + y) / 2 - z]; }
function ptsAttr(points) { return points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "); }
function shapeKey(s) { return `${s.officeId}:${s.id}`; }

FLOOR_PLAN.shapes.forEach((s, i) => { s.__i = i; });

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
    toggle(x0, y0, x1, y0); toggle(x1, y0, x1, y1);
    toggle(x1, y1, x0, y1); toggle(x0, y1, x0, y0);
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

const liftCur = {};
function isSelected(officeId, roomId) { return selectedKeys.has(keyOf(officeId, roomId)); }
function liftTarget(officeId, roomId) { return isSelected(officeId, roomId) ? ISO_LIFT : 0; }

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

let isoScene = null, tweenRAF = null;

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
      add(isoPt(s.x, s.y, z)); add(isoPt(s.x + s.w, s.y, z));
      add(isoPt(s.x + s.w, s.y + s.h, z)); add(isoPt(s.x, s.y + s.h, z));
    }
  }
  for (const b of walls) {
    for (const z of [ISO_BASE, ISO_BASE + WALL_H]) {
      add(isoPt(b.x, b.y, z)); add(isoPt(b.x + b.w, b.y, z));
      add(isoPt(b.x + b.w, b.y + b.h, z)); add(isoPt(b.x, b.y + b.h, z));
    }
  }
  const mx = 46, mTop = 26, mBottom = 52;
  return { x: minX - mx, y: minY - mTop, w: maxX - minX + mx * 2, h: maxY - minY + mTop + mBottom };
}

function buildScene() {
  for (const s of FLOOR_PLAN.shapes) liftCur[shapeKey(s)] = liftTarget(s.officeId, s.id);

  const farKey = (b) => (b.x + b.w / 2) + (b.y + b.h / 2);
  const walls = wallBoxes().sort((a, b) => farKey(a) - farKey(b));

  const rawKey = new Map(FLOOR_PLAN.shapes.map((s) => [s, farKey(s)]));
  for (const s of FLOOR_PLAN.shapes) {
    const parentId = PLATE_RENDER[shapeKey(s)]?.parent;
    if (!parentId) continue;
    const parent = FLOOR_PLAN.shapes.find((p) => p.officeId === s.officeId && p.id === parentId);
    if (parent && rawKey.get(parent) >= rawKey.get(s)) rawKey.set(s, rawKey.get(parent) + 1);
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
      ${officeIds.map((id) => `<button class="legend-item" data-office="${id}" title="Select all of ${esc(offices[id].label)}"><span class="swatch office-${id}"></span>${esc(offices[id].label)}</button>`).join("")}
    </div>`;

  isoScene = { shapeEls: new Map() };
  const svg = floorPlanWrapEl.querySelector("svg");
  svg.querySelectorAll(".plate").forEach((group) => {
    const i = Number(group.dataset.idx);
    const s = FLOOR_PLAN.shapes[i];
    const polyEls = {};
    group.querySelectorAll("polygon").forEach((el) => (polyEls[el.dataset.face] = el));
    const labelG = svg.querySelector(`.room-label-g[data-office="${s.officeId}"][data-room="${s.id}"]`);
    isoScene.shapeEls.set(i, { shape: s, group, polyEls, labelG, tagEl: labelG ? labelG.querySelector(".room-price-tag") : null });
    if (!s.deco) group.addEventListener("click", () => toggleArea(s.officeId, s.id));
  });
  floorPlanWrapEl.querySelectorAll(".legend-item").forEach((el) => {
    el.addEventListener("click", () => toggleOffice(el.dataset.office));
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
      if (Math.abs(target - cur) > 0.35) { liftCur[key] = cur + (target - cur) * 0.2; live = true; }
      else liftCur[key] = target;
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
    const offered = roomOffered(s.officeId, s.id);
    entry.group.classList.toggle("selected", sel);
    entry.group.classList.toggle("has-pot", offered > 0 && !sel);
    if (entry.labelG) {
      entry.labelG.classList.toggle("selected", sel);
      entry.labelG.classList.toggle("has-pot", offered > 0 && !sel);
      if (entry.tagEl) entry.tagEl.textContent = offered > 0 ? fmtMoney(offered) : "";
    }
  }
  // office legend active state (all its rooms selected)
  floorPlanWrapEl.querySelectorAll(".legend-item").forEach((el) => {
    const oid = el.dataset.office;
    const rooms = offices[oid].rooms.map((r) => r.id);
    const all = rooms.length > 0 && rooms.every((rid) => selectedKeys.has(keyOf(oid, rid)));
    el.classList.toggle("active", all);
  });
  startLiftTween();
}

/* ============================================================
   Selection + composer (build one bundled bid)
   ============================================================ */

function toggleArea(officeId, roomId) {
  const k = keyOf(officeId, roomId);
  if (selectedKeys.has(k)) selectedKeys.delete(k);
  else selectedKeys.add(k);
  renderFloorPlan();
  renderComposer();
}

function toggleOffice(officeId) {
  const rooms = offices[officeId].rooms.map((r) => r.id);
  const all = rooms.every((rid) => selectedKeys.has(keyOf(officeId, rid)));
  rooms.forEach((rid) => {
    const k = keyOf(officeId, rid);
    if (all) selectedKeys.delete(k);
    else selectedKeys.add(k);
  });
  renderFloorPlan();
  renderComposer();
}

function composerBeingTyped() {
  const a = document.activeElement;
  return a && composerEl.contains(a) && a.tagName === "INPUT";
}

function renderComposer() {
  const areas = selectedAreas();
  if (selHintEl) selHintEl.textContent = areas.length ? `${areas.length} selected` : "Tap areas to select";

  if (!areas.length) {
    composerEl.innerHTML = `
      <div class="composer-empty">
        <div class="ce-title">Place a bid</div>
        <div class="ce-sub">Tap rooms on the plan (or a whole office in the legend), then name one amount to bid on all of them together.</div>
      </div>`;
    return;
  }

  const nm = userName();
  const chips = areas
    .map((a) => `<button class="area-chip" data-key="${a.officeId}:${a.roomId}" title="Remove">
        <span class="ac-name">${esc(roomName(a.officeId, a.roomId))}</span>
        <span class="ac-x">×</span>
      </button>`)
    .join("");

  composerEl.innerHTML = `
    <div class="card-head"><span>Your bid</span><span class="hint">${areas.length} area${areas.length > 1 ? "s" : ""}</span></div>
    <div class="card-body">
      <div class="area-chips">${chips}</div>
      <div class="bid-form">
        <input id="nameInput" class="fld" type="text" placeholder="Your name" value="${esc(nm)}" autocomplete="name" />
        <input id="amtInput" class="fld amt" type="number" inputmode="decimal" min="1" step="1" placeholder="Amount" />
        <button id="addBidBtn" class="btn primary">Place bid</button>
      </div>
      <div class="composer-note" id="composerNote">${areas.length > 1 ? `One bid covering all ${areas.length} selected areas.` : ""}</div>
    </div>`;

  composerEl.querySelectorAll(".area-chip").forEach((el) => {
    el.addEventListener("click", () => {
      selectedKeys.delete(el.dataset.key);
      renderFloorPlan();
      renderComposer();
    });
  });

  const nameInput = document.getElementById("nameInput");
  const amtInput = document.getElementById("amtInput");
  const noteEl = document.getElementById("composerNote");
  nameInput.addEventListener("change", () => { setUserName(nameInput.value); updateWhoami(); });
  amtInput.addEventListener("input", () => {
    const amt = Number(amtInput.value);
    const who = nameInput.value.trim() || "You";
    if (amt > 0) {
      noteEl.innerHTML = `<b>${esc(who)}</b> bids <b>${fmtMoney(amt)}</b> for ${areas.length > 1 ? `all ${areas.length} areas` : "this area"}.`;
    } else {
      noteEl.innerHTML = areas.length > 1 ? `One bid covering all ${areas.length} selected areas.` : "";
    }
  });
  amtInput.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("addBidBtn").click(); });
  document.getElementById("addBidBtn").addEventListener("click", () => onPlaceBid(areas, nameInput.value.trim(), amtInput.value));
}

async function onPlaceBid(areas, name, amountRaw) {
  const amount = Number(amountRaw);
  if (!name) return toast("Enter your name first");
  if (!amount || amount <= 0) return toast("Enter an amount greater than 0");
  if (!areas.length) return;
  setUserName(name);
  updateWhoami();
  try {
    const rooms = areas.map((a) => ({ office: a.officeId, room: a.roomId }));
    const { error } = await sb.from("bids").insert({ bidder_name: name, amount, rooms });
    if (error) throw error;
    toast(`Bid placed: ${fmtMoney(amount)} for ${areas.length} area${areas.length > 1 ? "s" : ""}`);
    selectedKeys.clear();
    await reload();
  } catch (e) {
    toast("Could not place bid: " + (e.message || e));
  }
}

/* ============================================================
   Open bids (claimable postings)
   ============================================================ */

function renderOpenBids() {
  if (!bids.length) {
    openBidsEl.innerHTML = `<div class="empty-block">No open bids yet. Select some rooms above and place one.</div>`;
    return;
  }
  const sorted = [...bids].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  openBidsEl.innerHTML = sorted
    .map((b) => `
      <div class="bid-card">
        <div class="bid-top">
          <div class="bid-who">
            <div class="bid-avatar" style="--h:${hashHue(b.bidder_name)}">${esc(initials(b.bidder_name))}</div>
            <div class="bid-name">${esc(b.bidder_name)}</div>
          </div>
          <div class="bid-amt">${fmtMoney(b.amount)}</div>
        </div>
        <div class="bid-rooms">${esc(roomsLabel(b.rooms))}</div>
        <button class="btn claim small" data-bid="${b.id}">Claim &amp; clean</button>
      </div>`)
    .join("");

  openBidsEl.querySelectorAll("[data-bid]").forEach((el) => {
    const bid = bids.find((b) => b.id === el.dataset.bid);
    if (bid) el.addEventListener("click", () => onClaimBid(bid));
  });
}

async function onClaimBid(bid) {
  let name = userName();
  if (!name) {
    const entered = prompt("Your name to claim this bid:", "");
    if (entered == null) return;
    name = entered.trim();
    setUserName(name);
    updateWhoami();
  }
  if (!name) return toast("Enter your name first");
  if (!confirm(`Claim ${bid.bidder_name}'s bid of ${fmtMoney(bid.amount)} and clean ${roomsLabel(bid.rooms)}?`)) return;
  try {
    const { error } = await sb.rpc("claim_bid", { p_bid_id: bid.id, p_claimed_by: name });
    if (error) throw error;
    toast(`You claimed ${roomsLabel(bid.rooms)} · ${fmtMoney(bid.amount)}`);
    await reload();
  } catch (e) {
    toast("Could not claim: " + (e.message || e));
    await reload();
  }
}

/* ============================================================
   Bidders leaderboard
   ============================================================ */

function renderDashboard() {
  const map = new Map(); // name -> { amount, rooms:Set }
  for (const b of bids) {
    const cur = map.get(b.bidder_name) || { amount: 0, rooms: new Set() };
    cur.amount += Number(b.amount);
    (b.rooms || []).forEach((x) => cur.rooms.add(keyOf(x.office, x.room)));
    map.set(b.bidder_name, cur);
  }
  const rows = [...map.entries()]
    .map(([name, v]) => ({ name, amount: v.amount, rooms: v.rooms.size }))
    .sort((a, b) => b.amount - a.amount);
  const max = rows.length ? rows[0].amount : 0;
  const totalPledged = rows.reduce((s, r) => s + r.amount, 0);

  const list = rows.length
    ? rows.map((r, i) => `
        <div class="lb-row">
          <div class="lb-rank">${i + 1}</div>
          <div class="lb-avatar" style="--h:${hashHue(r.name)}">${esc(initials(r.name))}</div>
          <div class="lb-main">
            <div class="lb-name">${esc(r.name)}</div>
            <div class="lb-bar"><span style="width:${max ? Math.max(6, (r.amount / max) * 100) : 0}%"></span></div>
          </div>
          <div class="lb-meta">
            <div class="lb-amt">${fmtMoney(r.amount)}</div>
            <div class="lb-areas">${r.rooms} room${r.rooms > 1 ? "s" : ""}</div>
          </div>
        </div>`).join("")
    : `<div class="lb-empty">No bids yet. Be the first to back some rooms.</div>`;

  dashboardEl.innerHTML = `
    <div class="card-head"><span>Bidders</span><span class="hint">${rows.length}</span></div>
    <div class="lb-total"><span>Total pledged</span><b>${fmtMoney(totalPledged)}</b></div>
    <div class="lb-list">${list}</div>`;
}

/* ============================================================
   Claim history
   ============================================================ */

function renderHistory() {
  if (!claims.length) {
    historyListEl.innerHTML = `<div class="empty-block">No bids claimed yet. Once someone takes a bid, it lands here.</div>`;
    return;
  }
  historyListEl.innerHTML = claims
    .map((c) => `<div class="history-card">
        <div class="history-top">
          <div class="history-area">${esc(roomsLabel(c.rooms))}</div>
          <div class="history-amt">${fmtMoney(c.amount)}</div>
        </div>
        <div class="history-sub">Bid by <b>${esc(c.bidder_name)}</b> · claimed by <b>${esc(c.claimed_by)}</b></div>
        <div class="history-contribs">${esc(fmtDate(c.created_at))}</div>
      </div>`)
    .join("");
}

/* ============================================================
   Stats + data loading + realtime
   ============================================================ */

function updateStats() {
  const total = bids.reduce((s, b) => s + Number(b.amount), 0);
  const areaCount = new Set(bids.flatMap((b) => (b.rooms || []).map((x) => keyOf(x.office, x.room)))).size;
  if (statTotalEl) setNumber(statTotalEl, total);
  if (statAreasEl) statAreasEl.textContent = areaCount;
}

function render() {
  renderFloorPlan();
  if (!composerBeingTyped()) renderComposer();
  renderOpenBids();
  renderDashboard();
  renderHistory();
  updateStats();
}

async function reload() {
  try {
    const [bidsRes, claimsRes] = await Promise.all([
      sb.from("bids").select("*").order("created_at", { ascending: true }),
      sb.from("claims").select("*").order("created_at", { ascending: false }).limit(60),
    ]);
    if (bidsRes.error) throw bidsRes.error;
    if (claimsRes.error) throw claimsRes.error;
    bids = bidsRes.data || [];
    claims = claimsRes.data || [];
  } catch (e) {
    toast("Connection issue: " + (e.message || e));
  }
  render();
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
  if (n != null) { setUserName(n); updateWhoami(); renderComposer(); }
});

// ---- boot ----
updateWhoami();
render();
reload();
subscribeRealtime();
