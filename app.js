const offices = Store.getOffices();
const prices = Store.getPrices();

let currentOfficeId = Object.keys(offices)[0];
// selections[roomId] = tierId | null
let selections = {};

function resetSelections() {
  selections = {};
  offices[currentOfficeId].rooms.forEach((r) => (selections[r.id] = null));
}
resetSelections();

const officeTabsEl = document.getElementById("officeTabs");
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

function renderOfficeTabs() {
  officeTabsEl.innerHTML = "";
  const ids = Object.keys(offices);
  officeTabsEl.style.display = ids.length > 1 ? "flex" : "none";
  ids.forEach((id) => {
    const office = offices[id];
    const tab = document.createElement("div");
    tab.className = "office-tab" + (id === currentOfficeId ? " active" : "");
    tab.innerHTML = `<div class="name">${office.label}</div><div class="count">${office.rooms.length} areas</div>`;
    tab.addEventListener("click", () => {
      currentOfficeId = id;
      resetSelections();
      renderOfficeTabs();
      renderFloorPlan();
      renderSelectedPanel();
      renderSummary();
    });
    officeTabsEl.appendChild(tab);
  });
}

function priceFor(roomId, tierId) {
  return prices[currentOfficeId]?.[roomId]?.[tierId] ?? 0;
}

function roomName(roomId) {
  return offices[currentOfficeId].rooms.find((r) => r.id === roomId)?.name ?? roomId;
}

function tierLabel(tierId) {
  return TIERS.find((t) => t.id === tierId)?.label ?? "";
}

function toggleRoom(roomId) {
  selections[roomId] = selections[roomId] ? null : "standard";
  renderFloorPlan();
  renderSelectedPanel();
  renderSummary();
}

function setTier(roomId, tierId) {
  selections[roomId] = tierId;
  renderFloorPlan();
  renderSelectedPanel();
  renderSummary();
}

function renderFloorPlan() {
  const office = offices[currentOfficeId];
  const layout = office.layout;

  if (!layout) {
    // Fallback for an office with no drawn layout: simple list of tap targets.
    floorPlanWrapEl.innerHTML = `<div class="room-grid">${office.rooms
      .map((room) => {
        const selected = !!selections[room.id];
        return `<div class="room-shape-fallback ${selected ? "selected" : ""}" data-room="${room.id}">${room.name}</div>`;
      })
      .join("")}</div>`;
    floorPlanWrapEl.querySelectorAll("[data-room]").forEach((el) => {
      el.addEventListener("click", () => toggleRoom(el.dataset.room));
    });
    return;
  }

  const shapesHtml = layout.shapes
    .map((s) => {
      const selected = !!selections[s.id];
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      const priceTag = selected ? `$${priceFor(s.id, selections[s.id])} · ${tierLabel(selections[s.id])}` : "tap to select";
      return `
        <g class="room-shape ${selected ? "selected" : ""}" data-room="${s.id}">
          <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="8"></rect>
          <text class="room-label" x="${cx}" y="${cy - 6}" text-anchor="middle">${roomName(s.id)}</text>
          <text class="room-price-tag" x="${cx}" y="${cy + 14}" text-anchor="middle">${priceTag}</text>
        </g>`;
    })
    .join("");

  floorPlanWrapEl.innerHTML = `
    <svg class="floorplan-svg" viewBox="${layout.viewBox}" preserveAspectRatio="xMidYMid meet">
      ${shapesHtml}
    </svg>`;

  floorPlanWrapEl.querySelectorAll(".room-shape").forEach((el) => {
    el.addEventListener("click", () => toggleRoom(el.dataset.room));
  });
}

function getActiveSelections() {
  return Object.entries(selections)
    .filter(([, tier]) => tier)
    .map(([roomId, tier]) => ({ roomId, roomName: roomName(roomId), tier, price: priceFor(roomId, tier) }));
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
      <div class="room-head" data-remove="${a.roomId}">
        <div class="room-name">${a.roomName}</div>
        <div class="checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>
      </div>
      <div class="tier-row">
        ${TIERS.map(
          (tier) => `
          <div class="tier-btn ${a.tier === tier.id ? "active" : ""}" data-tier="${tier.id}" data-room="${a.roomId}">
            ${tier.label}<span class="price">$${priceFor(a.roomId, tier.id)}</span>
          </div>`
        ).join("")}
      </div>
    </div>`
    )
    .join("");

  selectedPanelEl.querySelectorAll("[data-remove]").forEach((el) => {
    el.addEventListener("click", () => toggleRoom(el.dataset.remove));
  });
  selectedPanelEl.querySelectorAll("[data-tier]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      setTier(el.dataset.room, el.dataset.tier);
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
  modalOfficeName.textContent = offices[currentOfficeId].label;
  modalLines.innerHTML = active
    .map(
      (a) => `
      <div class="modal-line">
        <div>
          <div class="room">${a.roomName}</div>
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
  Store.addOrder({
    id: crypto.randomUUID(),
    officeId: currentOfficeId,
    officeName: offices[currentOfficeId].label,
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

renderOfficeTabs();
renderFloorPlan();
renderSelectedPanel();
renderSummary();
