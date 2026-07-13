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

// Renders ONE combined map (FLOOR_PLAN) — both offices in the same
// coordinate space, exactly as laid out in the reference image, drawn as
// one continuous building: room fills first, then real walls (with door
// gaps cut out) on top, then a highlight outline for anything selected,
// then labels on top of everything. Sharp corners throughout — no rounded
// boxes floating apart from each other.
function wallSegmentPaths(wall) {
  const horizontal = wall.y1 === wall.y2;
  if (!wall.doorGap) {
    return [`M${wall.x1},${wall.y1} L${wall.x2},${wall.y2}`];
  }
  const [gapStart, gapEnd] = wall.doorGap;
  if (horizontal) {
    const y = wall.y1;
    const lo = Math.min(wall.x1, wall.x2);
    const hi = Math.max(wall.x1, wall.x2);
    return [`M${lo},${y} L${gapStart},${y}`, `M${gapEnd},${y} L${hi},${y}`];
  }
  const x = wall.x1;
  const lo = Math.min(wall.y1, wall.y2);
  const hi = Math.max(wall.y1, wall.y2);
  return [`M${x},${lo} L${x},${gapStart}`, `M${x},${gapEnd} L${x},${hi}`];
}

function renderFloorPlan() {
  const fillsHtml = FLOOR_PLAN.shapes
    .map((s) => {
      const selected = !!selections[s.officeId][s.id];
      return `<rect class="room-fill office-${s.officeId} ${selected ? "selected" : ""}" data-office="${s.officeId}" data-room="${s.id}" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"></rect>`;
    })
    .join("");

  const wallsHtml = (FLOOR_PLAN.walls || [])
    .flatMap(wallSegmentPaths)
    .map((d) => `<path class="wall-line" d="${d}"></path>`)
    .join("");

  const outlinesHtml = FLOOR_PLAN.shapes
    .filter((s) => selections[s.officeId][s.id])
    .map((s) => `<rect class="room-selected-outline" x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"></rect>`)
    .join("");

  const labelsHtml = FLOOR_PLAN.shapes
    .filter((s) => s.label !== false)
    .map((s) => {
      const selected = !!selections[s.officeId][s.id];
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      const priceTag = selected
        ? `$${priceFor(s.officeId, s.id, selections[s.officeId][s.id])} · ${tierLabel(selections[s.officeId][s.id])}`
        : "tap to select";
      return `
        <text class="room-label ${selected ? "selected" : ""}" x="${cx}" y="${cy - 6}" text-anchor="middle">${roomName(s.officeId, s.id)}</text>
        <text class="room-price-tag ${selected ? "selected" : ""}" x="${cx}" y="${cy + 14}" text-anchor="middle">${priceTag}</text>`;
    })
    .join("");

  const [, , vbw, vbh] = FLOOR_PLAN.viewBox.split(" ").map(Number);
  floorPlanWrapEl.innerHTML = `
    <div class="floorplan-frame" style="aspect-ratio:${vbw}/${vbh}">
      <svg class="floorplan-svg" viewBox="${FLOOR_PLAN.viewBox}" preserveAspectRatio="xMidYMid meet">
        <g class="room-fills">${fillsHtml}</g>
        <g class="walls">${wallsHtml}</g>
        <g class="selected-outlines">${outlinesHtml}</g>
        <g class="room-labels">${labelsHtml}</g>
      </svg>
    </div>
    <div class="floorplan-legend">
      ${officeIds.map((id) => `<div class="legend-item"><span class="swatch office-${id}"></span>${offices[id].label}</div>`).join("")}
    </div>`;

  floorPlanWrapEl.querySelectorAll(".room-fill").forEach((el) => {
    el.addEventListener("click", () => toggleRoom(el.dataset.office, el.dataset.room));
  });
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
