const offices = Store.getOffices();
const prices = Store.getPrices();
const officeIds = Object.keys(offices);

// selections[officeId][roomId] = tierId | null
let selections = {};
function resetSelections() {
  selections = {};
  officeIds.forEach((officeId) => {
    selections[officeId] = {};
    offices[officeId].rooms.forEach((r) => (selections[officeId][r.id] = null));
  });
}
resetSelections();

const floorPlanWrapEl = document.getElementById("floorPlanWrap");
const selectedPanelEl = document.getElementById("selectedPanel");
const summaryTextEl = document.getElementById("summaryText");
const totalPriceEl = document.getElementById("totalPrice");
const confirmBtn = document.getElementById("confirmBtn");
const modalOverlay = document.getElementById("modalOverlay");
const modalOfficeName = document.getElementById("modalOfficeName");
const modalLines = document.getElementById("modalLines");
const modalTotal = document.getElementById("modalTotal");
const successBanner = document.getElementById("successBanner");

function priceFor(officeId, roomId, tierId) {
  return prices[officeId]?.[roomId]?.[tierId] ?? 0;
}

function roomName(officeId, roomId) {
  return offices[officeId].rooms.find((r) => r.id === roomId)?.name ?? roomId;
}

function tierLabel(tierId) {
  return TIERS.find((t) => t.id === tierId)?.label ?? "";
}

function toggleRoom(officeId, roomId) {
  selections[officeId][roomId] = selections[officeId][roomId] ? null : "standard";
  renderFloorPlan();
  renderSelectedPanel();
  renderSummary();
}

function setTier(officeId, roomId, tierId) {
  selections[officeId][roomId] = tierId;
  renderFloorPlan();
  renderSelectedPanel();
  renderSummary();
}

/* ============================================================
   Isometric "dollhouse" renderer.

   The FLOOR_PLAN geometry in config.js is ground truth (traced from
   the real reference plan) — this code only changes how it's DRAWN:
   a 2:1 isometric projection where every room is an extruded slab
   (visible top face + south/east side faces), the real walls stand
   on top of the slab with their door gaps kept open, and selecting
   a room smoothly lifts its slab out of the model.
   ============================================================ */

const ISO_BASE = 16;   // slab thickness (z of every room's floor top)
const ISO_LIFT = 22;   // how far a selected room's slab rises
const WALL_H  = 54;    // wall height above the slab
const WALL_T  = 12;    // wall thickness

// Rendering-only relationships: some rooms sit ON another room's slab
// (they overlap it in plan), so their side faces must start at the
// parent slab's top — and ride along when the parent slab is lifted.
// pad > 0 draws the zone as a slightly raised platform (the wall-less
// zones in Malek's office, marked only by door frames in the reference).
const PLATE_RENDER = {
  // Moha's bathroom is carved into the NE corner of the Desks area, but
  // north of y=532 there is no Desks slab behind its east face (that
  // stretch borders the hall directly) — split the face: the north part
  // drops to ground, the south part stops at the Desks slab top.
  "moha:bathroom": { parent: "desks", pad: 0, southBottom: "parent", eastSplit: 532 },
  // Dishwashing Area is a small corner room walled off INSIDE the
  // Kitchen (beside the hall door), so it sits on the Kitchen's slab and
  // rides its lift; its south + east edges both stop at the Kitchen's
  // boundary, where the Kitchen's own skirt takes over below.
  "malek:dishwashing": { parent: "kitchen", pad: 0, southBottom: "parent", eastBottom: "parent" },
  // Malek's Bathroom is carved out of the (much bigger) Desks footprint —
  // its south edge borders Desks; its east edge is the building's real
  // exterior, so it's left as ground.
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
// Every DOM element needs its OWN entry, or the second piece of a
// multi-piece room silently steals the first piece's polygon references
// during the lift tween and corrupts its geometry every frame.
FLOOR_PLAN.shapes.forEach((s, i) => { s.__i = i; });

// Rectilinear union of axis-aligned rects -> ordered boundary polygon
// (world x/y units). Used so a multi-piece room (e.g. the L-shaped Chill
// Area, drawn as 2 touching rects) gets ONE floor polygon instead of 2
// separate ones — two same-color adjacent SVG polygons still show a
// faint seam along their shared edge (independent per-polygon
// antialiasing), even with identical fill and stroke. One polygon has no
// seam to show.
function unionOutline(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  const filled = new Set();
  for (const r of rects) {
    const x0 = xs.indexOf(r.x), x1 = xs.indexOf(r.x + r.w);
    const y0 = ys.indexOf(r.y), y1 = ys.indexOf(r.y + r.h);
    for (let i = x0; i < x1; i++) for (let j = y0; j < y1; j++) filled.add(`${i},${j}`);
  }
  // Every boundary edge of every filled grid cell either cancels out
  // against the identical (reversed) edge of a neighboring filled cell,
  // or survives — the surviving edges are exactly the outer boundary.
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

// Precompute each multi-piece room's combined floor outline once (static
// geometry, independent of lift/selection state).
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
function liftTarget(officeId, roomId) {
  // deco shapes (the shared hall) belong to no office and never lift
  return selections[officeId]?.[roomId] ? ISO_LIFT : 0;
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
    // Multi-piece room: only the FIRST piece (lowest __i) draws the shared
    // floor polygon, traced from the union outline — the other piece(s)
    // draw no top face at all, so there's no second polygon to seam
    // against. Both still get their own south/east walls and both still
    // sit in their own clickable <g>, but only one owns the floor.
    const isFirst = s.__i === Math.min(...FLOOR_PLAN.shapes.filter((o) => shapeKey(o) === key).map((o) => o.__i));
    if (isFirst) polys.top = unionPts.map(([x, y]) => isoPt(x, y, top));
  } else {
    polys.top = [isoPt(s.x, s.y, top), isoPt(x2, s.y, top), isoPt(x2, y2, top), isoPt(s.x, y2, top)];
  }
  // Pieces of a multi-piece room only get side faces along the room's
  // OUTER boundary. Without this, the wide half of the L-shaped Chill
  // Area painted its full south skirt straight across the stem piece's
  // floor — a dark band through the middle of the room. Cut away any
  // stretch of a face where a sibling piece continues past that edge.
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

// Split walls into solid pieces around their door gaps, as 3D boxes.
// A long wall (e.g. a full-height exterior wall) spans a wide RANGE of
// depths along its own length. Giving it one single depth key for sorting
// means that key can only be "right" for one point along the wall — at
// every other point it either wrongly hides things in front of it or
// wrongly gets hidden by things behind it. The building's tall exterior
// wall was doing exactly that: its one east-facing polygon runs its whole
// length, so it silently painted over a short interior wall it only
// crosses briefly. Fix: chunk any wall span longer than CHUNK into shorter
// pieces before turning it into a box, so each piece's depth key stays
// locally accurate. Adjacent chunks still render pixel-flush, so visually
// it's still one continuous wall.
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
        // Overlap each chunk 2 units into the next one: perfectly flush
        // chunks still show a hairline seam at every boundary (each
        // polygon antialiases independently), which made long walls read
        // as a row of separate bricks. Overlapping same-color coplanar
        // faces can't seam.
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

// Split long room names onto two lines so they fit narrow rooms.
function labelLines(name, s) {
  const spanUnits = s.w + s.h; // projected horizontal extent of the top face
  if (name.length * 34 > spanUnits * 0.9 && name.includes(" ")) {
    const words = name.split(" ");
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  return [name];
}

let isoScene = null; // { shapeEls: Map key -> {group, polys:{}, labelG, nameEl, tagEl}, }
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
  const mx = 46, mTop = 26, mBottom = 52; // room for the soft ground shadow
  return { x: minX - mx, y: minY - mTop, w: maxX - minX + mx * 2, h: maxY - minY + mTop + mBottom };
}

function buildScene() {
  // Seed lift state.
  for (const s of FLOOR_PLAN.shapes) {
    liftCur[shapeKey(s)] = liftTarget(s.officeId, s.id);
  }

  // Depth-sort by each box's CENTER point (not its far corner) — using the
  // far corner made long/tall boxes (like the full-height exterior walls)
  // sort as if they were "further forward" than they really are, purely
  // because their bounding box is big, which let a tall exterior wall
  // paint over a short interior wall it merely shares a corner with. The
  // center point is a fair depth proxy regardless of a box's size. Plates
  // and walls stay in two separate layers (all plates, then all walls) —
  // a plate's south/east face is a tall skirt running from roofline to
  // ground along that whole edge, so mixing it into the same pass as a
  // thin wall on that edge risks the plate's key outranking the wall that
  // should always read as standing in front of it.
  const farKey = (b) => (b.x + b.w / 2) + (b.y + b.h / 2);
  const walls = wallBoxes().sort((a, b) => farKey(a) - farKey(b));

  // A shape with a PLATE_RENDER "parent" (e.g. Dishwashing Area sitting
  // inside Desks' footprint) must always paint — and hit-test clicks —
  // after its parent, no matter what the raw depth key says. Desks is a
  // big room, so its CENTER can sort "later" than a small room resting on
  // top of it purely because of size, which would wrongly bury (and steal
  // clicks from) the room that's actually in front. Bump each child's
  // effective key past its parent's to guarantee correct order.
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

  // Soft ground shadow: every room footprint (inflated) at z=0, blurred.
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
      // lx/ly let a room pin its label off-center (e.g. Kitchen's label
      // clears the Dishwashing corner room carved out of its SE corner)
      const cx = s.lx ?? s.x + s.w / 2, cy = s.ly ?? s.y + s.h / 2;
      const [px, py] = isoPt(cx, cy, 0);
      const lines = labelLines(roomName(s.officeId, s.id), s);
      const nameTspans = lines
        .map((ln, i) => `<tspan x="${px.toFixed(1)}" dy="${i === 0 ? (lines.length > 1 ? "-0.62em" : "0") : "1.12em"}">${ln}</tspan>`)
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
      ${officeIds.map((id) => `<div class="legend-item"><span class="swatch office-${id}"></span>${offices[id].label}</div>`).join("")}
    </div>`;

  // Keyed per SHAPE INSTANCE (s.__i), not per room — a multi-piece room
  // like Chill Area has two separate <g class="plate"> elements in the DOM
  // and each needs its own polygon references, or the tween loop below
  // will happily overwrite one piece's geometry with the other's.
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
    if (!s.deco) group.addEventListener("click", () => toggleRoom(s.officeId, s.id));
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
  // Sync selection classes + label text, then tween slab heights.
  for (const s of FLOOR_PLAN.shapes) {
    const entry = isoScene.shapeEls.get(s.__i);
    const tier = selections[s.officeId]?.[s.id];
    entry.group.classList.toggle("selected", !!tier);
    if (entry.labelG) {
      entry.labelG.classList.toggle("selected", !!tier);
      if (entry.tagEl) {
        entry.tagEl.textContent = tier
          ? `$${priceFor(s.officeId, s.id, tier)} · ${tierLabel(tier)}`
          : "";
      }
    }
  }
  startLiftTween();
}

function getActiveSelections() {
  const active = [];
  officeIds.forEach((officeId) => {
    Object.entries(selections[officeId]).forEach(([roomId, tier]) => {
      if (!tier) return;
      active.push({
        officeId,
        officeName: offices[officeId].label,
        roomId,
        roomName: roomName(officeId, roomId),
        tier,
        price: priceFor(officeId, roomId, tier),
      });
    });
  });
  return active;
}

function renderSelectedPanel() {
  const active = getActiveSelections();
  if (!active.length) {
    selectedPanelEl.innerHTML = `<div class="selected-empty">Tap rooms in the floor plan above to add them here.</div>`;
    return;
  }

  selectedPanelEl.innerHTML = active
    .map(
      (a) => `
    <div class="room-card selected">
      <div class="room-head" data-remove-office="${a.officeId}" data-remove="${a.roomId}">
        <div class="room-name">${a.roomName}${a.officeName !== a.roomName ? `<span class="room-office-tag">${a.officeName}</span>` : ""}</div>
        <div class="checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>
      </div>
      <div class="tier-row">
        ${TIERS.map(
          (tier) => `
          <div class="tier-btn ${a.tier === tier.id ? "active" : ""}" data-tier="${tier.id}" data-office="${a.officeId}" data-room="${a.roomId}">
            ${tier.label}<span class="price">$${priceFor(a.officeId, a.roomId, tier.id)}</span>
          </div>`
        ).join("")}
      </div>
    </div>`
    )
    .join("");

  selectedPanelEl.querySelectorAll("[data-remove]").forEach((el) => {
    el.addEventListener("click", () => toggleRoom(el.dataset.removeOffice, el.dataset.remove));
  });
  selectedPanelEl.querySelectorAll("[data-tier]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      setTier(el.dataset.office, el.dataset.room, el.dataset.tier);
    });
  });
}

function renderSummary() {
  const active = getActiveSelections();
  const total = active.reduce((sum, a) => sum + a.price, 0);
  totalPriceEl.textContent = total;
  summaryTextEl.textContent = active.length
    ? `${active.length} area${active.length > 1 ? "s" : ""} selected`
    : "Select rooms to clean";
  confirmBtn.disabled = active.length === 0;
}

confirmBtn.addEventListener("click", () => {
  const active = getActiveSelections();
  if (!active.length) return;
  const involvedOffices = [...new Set(active.map((a) => a.officeName))];
  modalOfficeName.textContent = involvedOffices.join(" + ");
  modalLines.innerHTML = active
    .map(
      (a) => `
      <div class="modal-line">
        <div>
          <div class="room">${a.roomName}${a.officeName !== a.roomName ? `<span class="tier"> · ${a.officeName}</span>` : ""}</div>
          <div class="tier">${tierLabel(a.tier)} clean</div>
        </div>
        <div class="price">$${a.price}</div>
      </div>`
    )
    .join("");
  const total = active.reduce((sum, a) => sum + a.price, 0);
  modalTotal.textContent = `$${total}`;
  modalOverlay.classList.add("open");
});

document.getElementById("cancelBtn").addEventListener("click", () => {
  modalOverlay.classList.remove("open");
});

document.getElementById("submitBtn").addEventListener("click", () => {
  const active = getActiveSelections();
  const total = active.reduce((sum, a) => sum + a.price, 0);
  const involvedOffices = [...new Set(active.map((a) => a.officeName))];
  Store.addOrder({
    id: crypto.randomUUID(),
    officeName: involvedOffices.join(" + "),
    items: active,
    total,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  modalOverlay.classList.remove("open");
  resetSelections();
  renderFloorPlan();
  renderSelectedPanel();
  renderSummary();
  successBanner.classList.add("open");
  setTimeout(() => successBanner.classList.remove("open"), 4000);
});

renderFloorPlan();
renderSelectedPanel();
renderSummary();
