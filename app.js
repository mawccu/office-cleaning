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
const roomGridEl = document.getElementById("roomGrid");
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
  Object.entries(offices).forEach(([id, office]) => {
    const tab = document.createElement("div");
    tab.className = "office-tab" + (id === currentOfficeId ? " active" : "");
    tab.innerHTML = `<div class="name">${office.label}</div><div class="count">${office.rooms.length} areas</div>`;
    tab.addEventListener("click", () => {
      currentOfficeId = id;
      resetSelections();
      renderOfficeTabs();
      renderRooms();
      renderSummary();
    });
    officeTabsEl.appendChild(tab);
  });
}

function priceFor(roomId, tierId) {
  return prices[currentOfficeId]?.[roomId]?.[tierId] ?? 0;
}

function renderRooms() {
  roomGridEl.innerHTML = "";
  offices[currentOfficeId].rooms.forEach((room) => {
    const selectedTier = selections[room.id];
    const card = document.createElement("div");
    card.className = "room-card" + (selectedTier ? " selected" : "");

    const head = document.createElement("div");
    head.className = "room-head";
    head.innerHTML = `
      <div class="room-name">${room.name}</div>
      <div class="checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></div>
    `;
    head.addEventListener("click", () => {
      selections[room.id] = selections[room.id] ? null : "standard";
      renderRooms();
      renderSummary();
    });
    card.appendChild(head);

    const tierRow = document.createElement("div");
    tierRow.className = "tier-row";
    TIERS.forEach((tier) => {
      const btn = document.createElement("div");
      btn.className = "tier-btn" + (selectedTier === tier.id ? " active" : "");
      btn.innerHTML = `${tier.label}<span class="price">$${priceFor(room.id, tier.id)}</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        selections[room.id] = tier.id;
        renderRooms();
        renderSummary();
      });
      tierRow.appendChild(btn);
    });
    card.appendChild(tierRow);

    roomGridEl.appendChild(card);
  });
}

function getActiveSelections() {
  return Object.entries(selections)
    .filter(([, tier]) => tier)
    .map(([roomId, tier]) => {
      const room = offices[currentOfficeId].rooms.find((r) => r.id === roomId);
      return { roomId, roomName: room.name, tier, price: priceFor(roomId, tier) };
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
          <div class="tier">${TIERS.find((t) => t.id === a.tier).label} clean</div>
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
  renderRooms();
  renderSummary();
  successBanner.classList.add("open");
  setTimeout(() => successBanner.classList.remove("open"), 4000);
});

renderOfficeTabs();
renderRooms();
renderSummary();
