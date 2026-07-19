/* ============================================================
   Cleaning board — one service of The Office.

   Shared foundation (identity, sign-in, callRpc, toasts, formatting
   helpers, the top nav) lives in core.js and loads before this file.

   A BID is one posting: bidder + amount + a set of rooms + optional
   deadline. It moves through a lifecycle:
       open  ->  claimed  ->  cleaned  ->  paid
   - a cleaner claims an open bid (or underbids to win it),
   - the claimer marks it cleaned,
   - the bidder marks it paid (closes the loop).
   Bidders can edit/cancel their own open bids; claimers can un-claim.

   Data lives in Supabase; the board subscribes to realtime changes so
   every device updates the moment anything happens.
   ============================================================ */

const offices = OFFICES;
const officeIds = Object.keys(offices);

// ---- live data ----
let bids = [];                    // full lifecycle rows
let helpers = [];                 // helper invites/acceptances across all jobs
const selectedKeys = new Set();   // "officeId:roomId" being composed into a bid
const selectedTasks = new Set();  // task ids checked for the bid being composed
let bidAmount = "";               // composer fields kept across re-renders
let bidDue = "";
let bidNote = "";

// ---- DOM ----
const floorPlanWrapEl = document.getElementById("floorPlanWrap");
const composerEl = document.getElementById("composer");
const dashboardEl = document.getElementById("dashboard");
const presetsEl = document.getElementById("presets");
const openBidsEl = document.getElementById("openBids");
const progressBidsEl = document.getElementById("progressBids");
const historyListEl = document.getElementById("historyList");
const statTotalEl = document.getElementById("statTotal");
const statAreasEl = document.getElementById("statAreas");
const selHintEl = document.getElementById("selHint");

// ---- cleaning-specific helpers (shared formatting lives in core.js) ----
function duePill(iso) {
  if (!iso) return "";
  const overdue = new Date(iso) - Date.now() < 0;
  return `<span class="due-pill ${overdue ? "overdue" : ""}">${overdue ? "Overdue " + relShort(iso) : "Due in " + relShort(iso)}</span>`;
}
// ISO <-> <input type=datetime-local> value (local time)
function toLocalInput(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localToISO(v) { return v ? new Date(v).toISOString() : null; }

function roomName(officeId, roomId) { return offices[officeId]?.rooms.find((r) => r.id === roomId)?.name ?? roomId; }
function keyOf(officeId, roomId) { return `${officeId}:${roomId}`; }
function selectedAreas() {
  return [...selectedKeys].map((k) => { const i = k.indexOf(":"); return { officeId: k.slice(0, i), roomId: k.slice(i + 1) }; });
}
function roomsLabel(rooms) { return (rooms || []).map((x) => roomName(x.office, x.room)).join(", "); }
function taskById(id) { return TASKS.find((t) => t.id === id); }
function tasksTagsHtml(tasks) {
  return (tasks || []).map((id) => { const t = taskById(id); return `<span class="task-tag">${t ? t.icon + " " + esc(t.label) : esc(id)}</span>`; }).join("");
}
function openBidsCoveringRoom(officeId, roomId) {
  return bids.filter((b) => b.status === "open" && (b.rooms || []).some((x) => x.office === officeId && x.room === roomId));
}
function roomOffered(officeId, roomId) {
  return openBidsCoveringRoom(officeId, roomId).reduce((s, b) => s + Number(b.amount), 0);
}
// ---- helpers / payment split ----
function helpersFor(bidId) { return helpers.filter((h) => h.bid_id === bidId); }
function acceptedHelpers(bidId) { return helpersFor(bidId).filter((h) => h.status === "accepted"); }
function myInvite(bidId) { return auth ? helpersFor(bidId).find((h) => h.helper_name === auth.name) : null; }
// The pot (b.amount) splits equally between the claimer and every accepted helper.
function splitInfo(b) {
  const accepted = acceptedHelpers(b.id).map((h) => h.helper_name);
  const team = [b.claimed_by, ...accepted].filter(Boolean);
  const n = Math.max(1, team.length);
  return { team, accepted, count: n, share: Number(b.amount) / n };
}
// Is this open job undercut below its posted price?
function isUndercut(b) { return Number(b.amount) < Number(b.posted_amount); }

function setNumber(el, to) {
  const from = Number(el.dataset.val || 0);
  to = Number(to) || 0;
  el.dataset.val = to;
  const intTarget = Number.isInteger(to);
  const start = performance.now(), dur = 550;
  function frame(t) {
    const k = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    const cur = from + (to - from) * eased;
    el.textContent = `${intTarget ? Math.round(cur) : cur.toFixed(2)} ${CURRENCY}`;
    if (k < 1) requestAnimationFrame(frame); else el.textContent = fmtMoney(to);
  }
  requestAnimationFrame(frame);
}

/* ============================================================
   Isometric renderer (geometry from config.js is ground truth)
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
    if (edges.has(rev)) edges.delete(rev); else edges.set(`${x1},${y1},${x2},${y2}`, true);
  };
  for (const key of filled) {
    const [i, j] = key.split(",").map(Number);
    const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
    toggle(x0, y0, x1, y0); toggle(x1, y0, x1, y1); toggle(x1, y1, x0, y1); toggle(x0, y1, x0, y0);
  }
  const next = new Map();
  for (const key of edges.keys()) { const [x1, y1, x2, y2] = key.split(",").map(Number); next.set(`${x1},${y1}`, [x2, y2]); }
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
  for (const s of FLOOR_PLAN.shapes) { const key = shapeKey(s); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(s); }
  for (const [key, pieces] of groups) if (pieces.length > 1) ROOM_TOP_OUTLINE.set(key, unionOutline(pieces));
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
    } else spans.push([lo - WALL_T / 2, hi + WALL_T / 2]);
    for (const [a, b] of spans) {
      const len = b - a;
      const n = Math.max(1, Math.ceil(len / WALL_CHUNK));
      const step = len / n;
      for (let k = 0; k < n; k++) {
        const segA = a + step * k, segB = Math.min(b, a + step * (k + 1) + 2);
        boxes.push(horizontal
          ? { x: segA, y: w.y1 - WALL_T / 2, w: segB - segA, h: WALL_T }
          : { x: w.x1 - WALL_T / 2, y: segA, w: WALL_T, h: segB - segA });
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
  const add = (p) => { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; };
  const zMax = ISO_BASE + 6 + ISO_LIFT * 2;
  for (const s of FLOOR_PLAN.shapes) for (const z of [0, zMax]) {
    add(isoPt(s.x, s.y, z)); add(isoPt(s.x + s.w, s.y, z)); add(isoPt(s.x + s.w, s.y + s.h, z)); add(isoPt(s.x, s.y + s.h, z));
  }
  for (const b of walls) for (const z of [ISO_BASE, ISO_BASE + WALL_H]) {
    add(isoPt(b.x, b.y, z)); add(isoPt(b.x + b.w, b.y, z)); add(isoPt(b.x + b.w, b.y + b.h, z)); add(isoPt(b.x, b.y + b.h, z));
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
  const shadowHtml = FLOOR_PLAN.shapes.map((s) => {
    const g = 14;
    const p = [isoPt(s.x - g, s.y - g, 0), isoPt(s.x + s.w + g, s.y - g, 0), isoPt(s.x + s.w + g, s.y + s.h + g, 0), isoPt(s.x - g, s.y + s.h + g, 0)];
    return `<polygon points="${ptsAttr(p)}"></polygon>`;
  }).join("");
  const platesHtml = shapes.map((s) => {
    const { polys } = plateGeom(s);
    const faces = Object.entries(polys).map(([face, p]) => `<polygon class="f-${face.replace(/\d+$/, "")}" data-face="${face}" points="${ptsAttr(p)}"></polygon>`).join("");
    const pad = (PLATE_RENDER[shapeKey(s)]?.pad ?? 0) > 0 ? " pad" : "";
    const deco = s.deco ? " deco" : "";
    return `<g class="plate office-${s.officeId}${pad}${deco}" data-office="${s.officeId}" data-room="${s.id}" data-idx="${s.__i}">${faces}</g>`;
  }).join("");
  const wallsHtml = walls.map((b) => {
    const p = wallPolys(b);
    return `<g class="wallbox"><polygon class="w-south" points="${ptsAttr(p.south)}"></polygon><polygon class="w-east" points="${ptsAttr(p.east)}"></polygon><polygon class="w-top" points="${ptsAttr(p.top)}"></polygon></g>`;
  }).join("");
  const labelsHtml = FLOOR_PLAN.shapes.filter((s) => s.label !== false).map((s) => {
    const cx = s.lx ?? s.x + s.w / 2, cy = s.ly ?? s.y + s.h / 2;
    const [px, py] = isoPt(cx, cy, 0);
    const lines = labelLines(roomName(s.officeId, s.id), s);
    const nameTspans = lines.map((ln, i) => `<tspan x="${px.toFixed(1)}" dy="${i === 0 ? (lines.length > 1 ? "-0.62em" : "0") : "1.12em"}">${esc(ln)}</tspan>`).join("");
    return `<g class="room-label-g" data-office="${s.officeId}" data-room="${s.id}"><text class="room-label" x="${px.toFixed(1)}" y="${py.toFixed(1)}">${nameTspans}</text><text class="room-price-tag" x="${px.toFixed(1)}" y="${py.toFixed(1)}" dy="${lines.length > 1 ? "1.85em" : "1.45em"}"></text></g>`;
  }).join("");
  floorPlanWrapEl.innerHTML = `
    <div class="floorplan-frame" style="aspect-ratio:${vb.w.toFixed(0)}/${vb.h.toFixed(0)}">
      <svg class="floorplan-svg" viewBox="${vb.x.toFixed(0)} ${vb.y.toFixed(0)} ${vb.w.toFixed(0)} ${vb.h.toFixed(0)}" preserveAspectRatio="xMidYMid meet">
        <defs><filter id="groundBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="15"></feGaussianBlur></filter></defs>
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
  floorPlanWrapEl.querySelectorAll(".legend-item").forEach((el) => el.addEventListener("click", () => toggleOffice(el.dataset.office)));
}
function applyShapeGeometry(s) {
  const entry = isoScene.shapeEls.get(s.__i);
  const { polys, top } = plateGeom(s);
  for (const [face, p] of Object.entries(polys)) if (entry.polyEls[face]) entry.polyEls[face].setAttribute("points", ptsAttr(p));
  if (entry.labelG) entry.labelG.setAttribute("transform", `translate(0,${(-top).toFixed(1)})`);
}
function startLiftTween() {
  if (tweenRAF) return;
  const step = () => {
    let live = false;
    for (const s of FLOOR_PLAN.shapes) {
      const key = shapeKey(s), target = liftTarget(s.officeId, s.id), cur = liftCur[key];
      if (Math.abs(target - cur) > 0.35) { liftCur[key] = cur + (target - cur) * 0.2; live = true; } else liftCur[key] = target;
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
  floorPlanWrapEl.querySelectorAll(".legend-item").forEach((el) => {
    const oid = el.dataset.office, rooms = offices[oid].rooms.map((r) => r.id);
    el.classList.toggle("active", rooms.length > 0 && rooms.every((rid) => selectedKeys.has(keyOf(oid, rid))));
  });
  startLiftTween();
}

/* ============================================================
   Selection + composer
   ============================================================ */
function toggleArea(officeId, roomId) {
  const k = keyOf(officeId, roomId);
  if (selectedKeys.has(k)) selectedKeys.delete(k); else selectedKeys.add(k);
  renderFloorPlan();
  renderComposer();
}
function toggleOffice(officeId) {
  const rooms = offices[officeId].rooms.map((r) => r.id);
  const all = rooms.every((rid) => selectedKeys.has(keyOf(officeId, rid)));
  rooms.forEach((rid) => { const k = keyOf(officeId, rid); if (all) selectedKeys.delete(k); else selectedKeys.add(k); });
  renderFloorPlan();
  renderComposer();
}
function composerBeingTyped() {
  const a = document.activeElement;
  return a && composerEl.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}
function renderComposer() {
  const areas = selectedAreas();
  if (selHintEl) selHintEl.textContent = areas.length ? `${areas.length} selected` : "Tap areas to select";

  if (!auth) {
    composerEl.innerHTML = `<div class="composer-empty"><div class="ce-title">Place a bid</div><div class="ce-sub">Sign in with your name and a PIN to bid. We'll remember you here.</div><button class="btn primary" id="composerSignIn">Sign in</button></div>`;
    document.getElementById("composerSignIn").addEventListener("click", () => openAuth());
    return;
  }
  if (!areas.length) {
    composerEl.innerHTML = `<div class="composer-empty"><div class="ce-title">Place a bid</div><div class="ce-sub">Tap rooms on the plan (or a whole office in the legend), then name one price for all of them.</div></div>`;
    return;
  }
  const chips = areas.map((a) => `<button class="area-chip" data-key="${a.officeId}:${a.roomId}" title="Remove"><span class="ac-name">${esc(roomName(a.officeId, a.roomId))}</span><span class="ac-x">×</span></button>`).join("");
  const taskBtns = TASKS.map((t) => `<button type="button" class="task-chip ${selectedTasks.has(t.id) ? "on" : ""}" data-task="${t.id}"><span>${t.icon}</span>${esc(t.label)}</button>`).join("");
  composerEl.innerHTML = `
    <div class="card-head"><span>Your bid</span><span class="hint">as ${esc(auth.name)}</span></div>
    <div class="card-body">
      <div class="area-chips">${chips}</div>
      <div class="composer-sub">What to do</div>
      <div class="task-chips">${taskBtns}</div>
      <textarea id="noteInput" class="fld note" rows="2" placeholder="Note for the cleaner (optional) — e.g. the floor is really greasy this time">${esc(bidNote)}</textarea>
      <div class="bid-form">
        <input id="amtInput" class="fld amt-wide" type="number" inputmode="decimal" min="1" step="1" placeholder="Amount (JD)" value="${esc(bidAmount)}" />
        <button id="addBidBtn" class="btn primary">Place bid</button>
      </div>
      <label class="due-row">Deadline (optional)<input id="dueInput" type="datetime-local" class="fld dt" value="${esc(bidDue)}" /></label>
      <div class="composer-note" id="composerNote"></div>
    </div>`;
  composerEl.querySelectorAll(".area-chip").forEach((el) => el.addEventListener("click", () => {
    selectedKeys.delete(el.dataset.key); renderFloorPlan(); renderComposer();
  }));
  composerEl.querySelectorAll(".task-chip").forEach((el) => el.addEventListener("click", () => {
    const id = el.dataset.task;
    if (selectedTasks.has(id)) selectedTasks.delete(id); else selectedTasks.add(id);
    el.classList.toggle("on", selectedTasks.has(id));
  }));
  const amtInput = document.getElementById("amtInput");
  const dueInput = document.getElementById("dueInput");
  const noteInput = document.getElementById("noteInput");
  const noteEl = document.getElementById("composerNote");
  const previewNote = () => {
    const amt = Number(amtInput.value);
    noteEl.innerHTML = amt > 0
      ? `<b>${esc(auth.name)}</b> bids <b>${fmtMoney(amt)}</b> for ${areas.length > 1 ? `all ${areas.length} rooms` : "this room"}.`
      : `One bid covering all ${areas.length} selected room${areas.length > 1 ? "s" : ""}.`;
  };
  previewNote();
  amtInput.addEventListener("input", () => { bidAmount = amtInput.value; previewNote(); });
  dueInput.addEventListener("input", () => { bidDue = dueInput.value; });
  noteInput.addEventListener("input", () => { bidNote = noteInput.value; });
  amtInput.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("addBidBtn").click(); });
  document.getElementById("addBidBtn").addEventListener("click", () => onPlaceBid(areas, amtInput.value, dueInput.value, noteInput.value));
}

/* ---- presets panel (one-tap bulk bids) ---- */
function renderPresets() {
  presetsEl.innerHTML = `
    <div class="card-head"><span>Quick bids</span></div>
    <div class="preset-list">
      ${PRESETS.map((p) => `<button class="preset-btn" data-preset="${p.id}"><span class="preset-ico">${p.icon}</span><span class="preset-label">${esc(p.label)}</span></button>`).join("")}
    </div>
    <div class="preset-foot">Sets up the rooms and tasks — then just name your amount.</div>`;
  presetsEl.querySelectorAll("[data-preset]").forEach((el) =>
    el.addEventListener("click", () => applyPreset(PRESETS.find((p) => p.id === el.dataset.preset))));
}
function applyPreset(p) {
  if (!p) return;
  const keys = p.rooms
    ? p.rooms.map((r) => keyOf(r.office, r.room))
    : p.scope === "all"
      ? officeIds.flatMap((o) => offices[o].rooms.map((r) => keyOf(o, r.id)))
      : (offices[p.scope]?.rooms.map((r) => keyOf(p.scope, r.id)) || []);
  selectedKeys.clear();
  keys.forEach((k) => selectedKeys.add(k));
  selectedTasks.clear();
  (p.tasks || []).forEach((t) => selectedTasks.add(t));
  renderFloorPlan();
  renderComposer();
  if (!auth) toast("Sign in to place this bid");
  const amt = document.getElementById("amtInput");
  if (amt) amt.focus();
  composerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function onPlaceBid(areas, amountRaw, dueRaw, noteRaw) {
  const amount = Number(amountRaw);
  if (!requireAuth(() => onPlaceBid(areas, amountRaw, dueRaw, noteRaw))) return;
  if (!amount || amount <= 0) return toast("Enter an amount greater than 0");
  if (!areas.length) return;
  const rooms = areas.map((a) => ({ office: a.officeId, room: a.roomId }));
  const note = (noteRaw ?? bidNote).trim();
  const ok = await callRpc("place_bid",
    { p_amount: amount, p_rooms: rooms, p_due_at: localToISO(dueRaw), p_tasks: [...selectedTasks], p_note: note || null },
    `Bid placed: ${fmtMoney(amount)} for ${areas.length} room${areas.length > 1 ? "s" : ""}`);
  if (ok) {
    selectedKeys.clear();
    selectedTasks.clear();
    bidAmount = ""; bidDue = ""; bidNote = "";
    renderFloorPlan();
    renderComposer();
  }
}

/* ============================================================
   Bid actions
   ============================================================ */
function onEditBid(bid) {
  if (!requireAuth()) return;
  const val = prompt(`New amount for ${roomsLabel(bid.rooms)} (JD):`, money(bid.amount));
  if (val == null) return;
  const amount = Number(val);
  if (!amount || amount <= 0) return toast("Enter an amount greater than 0");
  callRpc("edit_bid", { p_bid_id: bid.id, p_amount: amount, p_due_at: bid.due_at, p_tasks: bid.tasks || [], p_note: bid.note ?? null }, "Bid updated");
}
// Undercut / first offer on an open job. The offer must be below the
// current price (b.amount).
function onOffer(bid) {
  if (!requireAuth(() => onOffer(bid))) return;
  const val = prompt(`Offer to clean ${roomsLabel(bid.rooms)} for less than ${fmtMoney(bid.amount)}.\nYour price (JD):`, "");
  if (val == null) return;
  const amount = Number(val);
  if (!amount || amount <= 0) return toast("Enter an amount greater than 0");
  if (amount >= Number(bid.amount)) return toast(`Offer must be under ${fmtMoney(bid.amount)}`);
  callRpc("place_offer", { p_bid_id: bid.id, p_amount: amount }, `Offer placed: ${fmtMoney(amount)} — you're the lowest`);
}
function onInvite(bid) {
  if (!requireAuth()) return;
  const name = prompt(`Invite someone to help clean ${roomsLabel(bid.rooms)} and split the pay.\nTheir name (exactly as they sign in):`, "");
  if (name == null) return;
  if (!name.trim()) return toast("Enter a name");
  callRpc("invite_helper", { p_bid_id: bid.id, p_helper: name.trim() }, `Invited ${name.trim()} — waiting for them to accept`);
}
function onSchedule(bid, localVal) {
  callRpc("schedule_bid", { p_bid_id: bid.id, p_scheduled_for: localToISO(localVal) }, "Time set");
}
function wireBidActions() {
  document.querySelectorAll("[data-act]").forEach((el) => {
    const bid = bids.find((b) => b.id === el.dataset.bid);
    if (!bid) return;
    const act = el.dataset.act;
    if (act === "schedule") { el.addEventListener("change", () => onSchedule(bid, el.value)); return; }
    el.addEventListener("click", () => {
      if (act === "claim") callRpc("claim_bid", { p_bid_id: bid.id }, "You've got it — go clean!");
      else if (act === "offer" || act === "undercut") onOffer(bid);
      else if (act === "retract") callRpc("retract_offer", { p_bid_id: bid.id }, "Offer retracted");
      else if (act === "cancel") { if (confirm(`Cancel your bid on ${roomsLabel(bid.rooms)}?`)) callRpc("cancel_bid", { p_bid_id: bid.id }, "Bid canceled"); }
      else if (act === "edit") onEditBid(bid);
      else if (act === "unclaim") callRpc("unclaim_bid", { p_bid_id: bid.id }, "Un-claimed");
      else if (act === "cleaned") callRpc("mark_cleaned", { p_bid_id: bid.id }, "Marked cleaned — waiting on payment");
      else if (act === "paid") callRpc("mark_paid", { p_bid_id: bid.id }, "Marked paid — done!");
      else if (act === "invite") onInvite(bid);
      else if (act === "accept") callRpc("respond_invite", { p_bid_id: bid.id, p_accept: true }, "You're on the team");
      else if (act === "decline") callRpc("respond_invite", { p_bid_id: bid.id, p_accept: false }, "Invite declined");
      else if (act === "removehelper") callRpc("remove_helper", { p_bid_id: bid.id, p_helper: el.dataset.helper }, "Helper removed");
    });
  });
}

/* ============================================================
   Bid cards  (avatarHtml lives in core.js)
   ============================================================ */

function openCard(b) {
  const mine = auth && b.bidder_name === auth.name;
  const holder = b.claimed_by;                       // lowest-offer leader, if any
  const iAmHolder = auth && holder === auth.name;
  const undercut = isUndercut(b);
  const amtHtml = undercut
    ? `<div class="bid-amt"><span class="amt-was">${fmtMoney(b.posted_amount)}</span>${fmtMoney(b.amount)}</div>`
    : `<div class="bid-amt">${fmtMoney(b.amount)}</div>`;

  let leadLine = "";
  if (holder) {
    leadLine = `<div class="lead-line">${avatarHtml(holder).replace("bid-avatar", "lead-avatar")}<span>Lowest offer: <b>${esc(holder)}</b> at ${fmtMoney(b.amount)}${iAmHolder ? " — that's you" : ""}</span></div>`;
  }

  // Action buttons depend on who you are and whether the job has an offer.
  let actions;
  if (mine) {
    // The poster manages their own posting.
    actions = holder
      ? `<span class="hint-inline">${esc(holder)} leads at ${fmtMoney(b.amount)}</span><button class="btn danger small" data-act="cancel" data-bid="${b.id}">Cancel</button>`
      : `<button class="btn ghost small" data-act="edit" data-bid="${b.id}">Edit</button><button class="btn danger small" data-act="cancel" data-bid="${b.id}">Cancel</button>`;
  } else if (iAmHolder) {
    // You hold the lowest offer: lock it in, or back out.
    actions = `<button class="btn claim small" data-act="claim" data-bid="${b.id}">Start cleaning (${fmtMoney(b.amount)})</button><button class="btn ghost small" data-act="retract" data-bid="${b.id}">Retract offer</button>`;
  } else if (holder) {
    // Someone else leads: your only way in is to undercut them.
    actions = `<button class="btn claim small" data-act="undercut" data-bid="${b.id}">Undercut (under ${fmtMoney(b.amount)})</button>`;
  } else {
    // No offers yet: take it at the posted price, or offer less.
    actions = `<button class="btn claim small" data-act="claim" data-bid="${b.id}">Claim &amp; clean</button><button class="btn ghost small" data-act="offer" data-bid="${b.id}">Offer less</button>`;
  }

  return `<div class="bid-card${holder ? " has-holder" : ""}">
    <div class="bid-top">
      <div class="bid-who">${avatarHtml(b.bidder_name)}<div class="bid-name">${esc(b.bidder_name)}</div></div>
      ${amtHtml}
    </div>
    <div class="bid-rooms">${esc(roomsLabel(b.rooms))}</div>
    ${b.tasks && b.tasks.length ? `<div class="task-tags">${tasksTagsHtml(b.tasks)}</div>` : ""}
    ${b.note ? `<div class="bid-note">“${esc(b.note)}”</div>` : ""}
    ${leadLine}
    ${b.due_at ? `<div class="bid-meta">${duePill(b.due_at)}</div>` : ""}
    <div class="bid-actions">${actions}</div>
  </div>`;
}
// The team + per-person share on a claimed/cleaned job.
function teamHtml(b, editable) {
  const { accepted, share } = splitInfo(b);
  const invited = helpersFor(b.id).filter((h) => h.status === "invited").map((h) => h.helper_name);
  const chip = (name, role, extra) =>
    `<span class="team-chip ${role}">${esc(name)}<span class="team-role">${role === "claimer" ? "claimer" : role === "pending" ? "invited" : "helper"}</span>${extra || ""}</span>`;
  const rm = (name) => editable ? `<button class="team-x" data-act="removehelper" data-bid="${b.id}" data-helper="${esc(name)}" title="Remove">×</button>` : "";
  const chips = [
    chip(b.claimed_by, "claimer", `<span class="team-share">${fmtMoney(share)}</span>`),
    ...accepted.map((n) => chip(n, "accepted", `<span class="team-share">${fmtMoney(share)}</span>` + rm(n))),
    ...invited.map((n) => chip(n, "pending", rm(n))),
  ].join("");
  const splitNote = accepted.length
    ? `<div class="split-note">Split ${fmtMoney(b.amount)} ${splitInfo(b).count} ways · <b>${fmtMoney(share)} each</b></div>`
    : "";
  return `<div class="team-wrap"><div class="team-chips">${chips}</div>${splitNote}</div>`;
}
function progressCard(b) {
  const cleaned = b.status === "cleaned";
  const iAmClaimer = auth && b.claimed_by === auth.name;
  const iAmBidder = auth && b.bidder_name === auth.name;
  const invite = myInvite(b.id);
  const iAmInvited = invite && invite.status === "invited";
  const iAmHelper = invite && invite.status === "accepted";
  const undercut = isUndercut(b);
  const amtHtml = undercut
    ? `<div class="bid-amt"><span class="amt-was">${fmtMoney(b.posted_amount)}</span>${fmtMoney(b.amount)}</div>`
    : `<div class="bid-amt">${fmtMoney(b.amount)}</div>`;
  const schedInput = iAmClaimer && !cleaned
    ? `<label class="sched-row">When you'll do it<input type="datetime-local" class="fld dt" data-act="schedule" data-bid="${b.id}" value="${b.scheduled_for ? toLocalInput(b.scheduled_for) : ""}" /></label>`
    : (b.scheduled_for ? `<div class="bid-subline">Planned for ${esc(fmtDate(b.scheduled_for))}</div>` : "");
  return `<div class="bid-card">
    <div class="bid-top">
      <div class="bid-who">${avatarHtml(b.claimed_by || b.bidder_name)}<div><div class="bid-name">${esc(roomsLabel(b.rooms))}</div><div class="bid-subline">bid by ${esc(b.bidder_name)} · claimed by ${esc(b.claimed_by)}</div></div></div>
      ${amtHtml}
    </div>
    <div class="bid-meta">
      <span class="status-badge ${cleaned ? "cleaned" : "claimed"}">${cleaned ? "Cleaned · awaiting payment" : "In progress"}</span>
      ${b.due_at ? duePill(b.due_at) : ""}
    </div>
    ${b.tasks && b.tasks.length ? `<div class="task-tags">${tasksTagsHtml(b.tasks)}</div>` : ""}
    ${b.note ? `<div class="bid-note">“${esc(b.note)}”</div>` : ""}
    ${(b.claimed_by && (splitInfo(b).accepted.length || helpersFor(b.id).length)) ? teamHtml(b, iAmClaimer && !cleaned) : ""}
    ${schedInput}
    ${iAmInvited ? `<div class="invite-banner">You're invited to help — you'd get <b>${fmtMoney(Number(b.amount) / (splitInfo(b).count + 1))}</b>.</div>` : ""}
    <div class="bid-actions">
      ${iAmClaimer && !cleaned ? `<button class="btn ghost small" data-act="invite" data-bid="${b.id}">Invite helper</button>` : ""}
      ${iAmClaimer && !cleaned ? `<button class="btn claim small" data-act="cleaned" data-bid="${b.id}">Mark cleaned</button><button class="btn ghost small" data-act="unclaim" data-bid="${b.id}">Un-claim</button>` : ""}
      ${iAmInvited ? `<button class="btn primary small" data-act="accept" data-bid="${b.id}">Accept</button><button class="btn ghost small" data-act="decline" data-bid="${b.id}">Decline</button>` : ""}
      ${iAmHelper && !cleaned ? `<button class="btn ghost small" data-act="removehelper" data-bid="${b.id}" data-helper="${esc(auth.name)}">Leave</button>` : ""}
      ${cleaned && iAmBidder ? `<button class="btn primary small" data-act="paid" data-bid="${b.id}">Mark paid</button>` : ""}
    </div>
  </div>`;
}
function historyCard(b) {
  const acc = acceptedHelpers(b.id).map((h) => h.helper_name);
  const teamLine = acc.length
    ? ` +${acc.length} · ${fmtMoney(Number(b.amount) / (acc.length + 1))} each`
    : "";
  return `<div class="history-card">
    <div class="history-top"><div class="history-area">${esc(roomsLabel(b.rooms))}</div><div class="history-amt">${fmtMoney(b.amount)}</div></div>
    <div class="history-sub">bid by <b>${esc(b.bidder_name)}</b> · cleaned by <b>${esc(b.claimed_by)}${esc(teamLine)}</b> · paid</div>
    <div class="history-contribs">${esc(fmtDate(b.paid_at || b.created_at))}</div>
  </div>`;
}

function renderBidSections() {
  const open = bids.filter((b) => b.status === "open");
  const prog = bids.filter((b) => b.status === "claimed" || b.status === "cleaned");
  const paid = bids.filter((b) => b.status === "paid");
  const dueVal = (b) => (b.due_at ? new Date(b.due_at).getTime() : Infinity);
  open.sort((a, b) => dueVal(a) - dueVal(b) || new Date(b.created_at) - new Date(a.created_at));
  prog.sort((a, b) => new Date(a.scheduled_for || a.created_at) - new Date(b.scheduled_for || b.created_at));
  paid.sort((a, b) => new Date(b.paid_at || b.created_at) - new Date(a.paid_at || a.created_at));

  openBidsEl.innerHTML = open.length ? open.map(openCard).join("") : emptyBlock("No open bids. Select some rooms above and place one.");
  progressBidsEl.innerHTML = prog.length ? prog.map(progressCard).join("") : emptyBlock("Nothing being cleaned right now.");
  historyListEl.innerHTML = paid.length ? paid.map(historyCard).join("") : emptyBlock("No paid jobs yet.");
  wireBidActions();
}

/* ============================================================
   Bidders leaderboard (active open pledges)
   ============================================================ */
function renderDashboard() {
  const map = new Map();
  for (const b of bids) {
    if (b.status !== "open") continue;
    const cur = map.get(b.bidder_name) || { amount: 0, rooms: new Set() };
    cur.amount += Number(b.amount);
    (b.rooms || []).forEach((x) => cur.rooms.add(keyOf(x.office, x.room)));
    map.set(b.bidder_name, cur);
  }
  const rows = [...map.entries()].map(([name, v]) => ({ name, amount: v.amount, rooms: v.rooms.size })).sort((a, b) => b.amount - a.amount);
  const max = rows.length ? rows[0].amount : 0;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const list = rows.length
    ? rows.map((r, i) => `<div class="lb-row"><div class="lb-rank">${i + 1}</div>${avatarHtml(r.name).replace("bid-avatar", "lb-avatar")}<div class="lb-main"><div class="lb-name">${esc(r.name)}</div><div class="lb-bar"><span style="width:${max ? Math.max(6, (r.amount / max) * 100) : 0}%"></span></div></div><div class="lb-meta"><div class="lb-amt">${fmtMoney(r.amount)}</div><div class="lb-areas">${r.rooms} room${r.rooms > 1 ? "s" : ""}</div></div></div>`).join("")
    : `<div class="lb-empty">No open bids yet. Be the first to back some rooms.</div>`;
  dashboardEl.innerHTML = `<div class="card-head"><span>Bidders</span><span class="hint">${rows.length}</span></div><div class="lb-total"><span>Open pledges</span><b>${fmtMoney(total)}</b></div><div class="lb-list">${list}</div>`;
}

/* ============================================================
   Stats + data loading + realtime
   ============================================================ */
function updateStats() {
  const open = bids.filter((b) => b.status === "open");
  const total = open.reduce((s, b) => s + Number(b.amount), 0);
  const roomCount = new Set(open.flatMap((b) => (b.rooms || []).map((x) => keyOf(x.office, x.room)))).size;
  if (statTotalEl) setNumber(statTotalEl, total);
  if (statAreasEl) statAreasEl.textContent = roomCount;
}
function render() {
  renderFloorPlan();
  renderPresets();
  if (!composerBeingTyped()) renderComposer();
  renderBidSections();
  renderDashboard();
  updateStats();
}
async function reload() {
  try {
    const [bidsRes, helpersRes] = await Promise.all([
      sb.from("bids").select("*").order("created_at", { ascending: false }).limit(300),
      sb.from("helpers").select("*").limit(1000),
    ]);
    if (bidsRes.error) throw bidsRes.error;
    if (helpersRes.error) throw helpersRes.error;
    bids = bidsRes.data || [];
    helpers = helpersRes.data || [];
  } catch (e) {
    toast("Connection issue: " + (e.message || e));
  }
  render();
}
function subscribeRealtime() {
  sb.channel("board")
    .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "helpers" }, reload)
    .subscribe();
}
// Keep due/overdue countdowns fresh without wiping a focused input.
setInterval(() => {
  const a = document.activeElement;
  const inSection = a && (openBidsEl.contains(a) || progressBidsEl.contains(a)) && a.tagName === "INPUT";
  if (!inSection) renderBidSections();
}, 45000);

// ---- boot ----
// Identity is already loaded/validated by core.js. Wire the shared hooks
// so sign-in and every write re-fetch this board, then render + subscribe.
renderNav("cleaning");
onAuthChange = render;
afterWrite = reload;
render();
(async () => {
  await reload();
  subscribeRealtime();
})();
