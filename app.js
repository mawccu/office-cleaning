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

const ISO_BASE = 26;   // slab thickness (z of every room's floor top)
const ISO_LIFT = 22;   // how far a selected room's slab rises
const WALL_H  = 60;    // wall height above the slab
const WALL_T  = 12;    // wall thickness

// Rendering-only relationships: some rooms sit ON another room's slab
// (they overlap it in plan), so their side faces must start at the
// parent slab's top — and ride along when the parent slab is lifted.
// pad > 0 draws the zone as a slightly raised platform (the wall-less
// zones in Malek's office, marked only by door frames in the reference).
const PLATE_RENDER = {
  "malek:dishwashing": { parent: "desks", pad: 6, southBottom: "parent", eastBottom: "parent" },
  "malek:bathroom":    { parent: "desks", pad: 6, southBottom: "parent", eastBottom: "parent" },
  // Moha's bathroom is carved into the Desks area but its east edge is
  // also part of the building exterior north of y=532 — split that face.
  "moha:bathroom":     { parent: "desks", pad: 0, southBottom: "parent", eastSplit: 532 },
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

// Current + target lift per shape (world units), tweened.
const liftCur = {};
function liftTarget(officeId, roomId) {
  return selections[officeId][roomId] ? ISO_LIFT : 0;
}

function plateGeom(s) {
  const key = shapeKey(s);
  const cfg = PLATE_RENDER[key];
  const Lself = liftCur[key] ?? 0;
  const Lparent = cfg?.parent ? (liftCur[`${s.officeId}:${cfg.parent}`] ?? 0) : 0;
  const parentTop = ISO_BASE + Lparent;
  const top = ISO_BASE + (cfg?.pad ?? 0) + Lself + Lparent;
  const x2 = s.x + s.w, y2 = s.y + s.h;

  const polys = {
    top: [isoPt(s.x, s.y, top), isoPt(x2, s.y, top), isoPt(x2, y2, top), isoPt(s.x, y2, top)],
  };
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
      boxes.push(
        horizontal
          ? { x: a, y: w.y1 - WALL_T / 2, w: b - a, h: WALL_T }
          : { x: w.x1 - WALL_T / 2, y: a, w: WALL_T, h: b - a }
      );
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

  const walls = wallBoxes().sort((a, b) => a.x + a.y - (b.x + b.y));
  const shapes = [...FLOOR_PLAN.shapes].sort((a, b) => a.x + a.y - (b.x + b.y));
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
        .map(([face, p]) => `<polygon class="f-${face === "east2" ? "east" : face}" data-face="${face}" points="${ptsAttr(p)}"></polygon>`)
        .join("");
      const pad = (PLATE_RENDER[shapeKey(s)]?.pad ?? 0) > 0 ? " pad" : "";
      return `<g class="plate office-${s.officeId}${pad}" data-office="${s.officeId}" data-room="${s.id}">${faces}</g>`;
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
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
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

  isoScene = { shapeEls: new Map() };
  const svg = floorPlanWrapEl.querySelector("svg");
  for (const s of FLOOR_PLAN.shapes) {
    const key = shapeKey(s);
    const group = svg.querySelector(`.plate[data-office="${s.officeId}"][data-room="${s.id}"]`);
    const polyEls = {};
    group.querySelectorAll("polygon").forEach((el) => (polyEls[el.dataset.face] = el));
    const labelG = svg.querySelector(`.room-label-g[data-office="${s.officeId}"][data-room="${s.id}"]`);
    isoScene.shapeEls.set(key, {
      shape: s,
      group,
      polyEls,
      labelG,
      tagEl: labelG ? labelG.querySelector(".room-price-tag") : null,
    });
    group.addEventListener("click", () => toggleRoom(s.officeId, s.id));
  }
}

function applyShapeGeometry(s) {
  const key = shapeKey(s);
  const entry = isoScene.shapeEls.get(key);
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
    const entry = isoScene.shapeEls.get(shapeKey(s));
    const tier = selections[s.officeId][s.id];
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
        <div class="room-name">${a.roomName}<span class="room-office-tag">${a.officeName}</span></div>
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
          <div class="room">${a.roomName}<span class="tier"> · ${a.officeName}</span></div>
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
