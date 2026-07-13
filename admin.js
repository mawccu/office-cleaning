const offices = Store.getOffices();
let prices = Store.getPrices();

const pricingBlocksEl = document.getElementById("pricingBlocks");
const ordersListEl = document.getElementById("ordersList");
const saveBanner = document.getElementById("saveBanner");

function renderPricing() {
  pricingBlocksEl.innerHTML = "";
  Object.entries(offices).forEach(([officeId, office]) => {
    const block = document.createElement("div");
    block.className = "admin-office-block";

    const rows = office.rooms
      .map(
        (room) => `
      <tr>
        <td>${room.name}</td>
        ${TIERS.map(
          (tier) => `
          <td>
            $<input type="number" min="0" step="1"
              data-office="${officeId}" data-room="${room.id}" data-tier="${tier.id}"
              value="${prices[officeId]?.[room.id]?.[tier.id] ?? 0}" />
          </td>`
        ).join("")}
      </tr>`
      )
      .join("");

    block.innerHTML = `
      <h3>${office.label}</h3>
      <div class="table-scroll">
      <table class="price-table">
        <thead>
          <tr>
            <th>Room</th>
            ${TIERS.map((t) => `<th>${t.label}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
    `;
    pricingBlocksEl.appendChild(block);
  });
}

function renderOrders() {
  const orders = Store.getOrders();
  if (!orders.length) {
    ordersListEl.innerHTML = `<div class="empty-state">No requests yet.</div>`;
    return;
  }
  ordersListEl.innerHTML = orders
    .map(
      (o) => `
    <div class="order-card">
      <div class="order-top">
        <div class="office-name">${o.officeName}</div>
        <div class="order-date">${new Date(o.createdAt).toLocaleString()}</div>
      </div>
      <div class="order-items">${o.items.map((i) => `${i.roomName} (${i.tier})`).join(", ")}</div>
      <div class="order-bottom">
        <div class="order-total">$${o.total}</div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="badge ${o.status}">${o.status}</span>
          ${
            o.status === "pending"
              ? `<button class="btn small" data-complete="${o.id}">Mark done</button>`
              : ""
          }
        </div>
      </div>
    </div>`
    )
    .join("");

  ordersListEl.querySelectorAll("[data-complete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      Store.updateOrderStatus(btn.dataset.complete, "done");
      renderOrders();
    });
  });
}

document.getElementById("saveBtn").addEventListener("click", () => {
  pricingBlocksEl.querySelectorAll("input").forEach((input) => {
    const { office, room, tier } = input.dataset;
    prices[office] = prices[office] || {};
    prices[office][room] = prices[office][room] || {};
    prices[office][room][tier] = Number(input.value) || 0;
  });
  Store.savePrices(prices);
  saveBanner.classList.add("open");
  setTimeout(() => saveBanner.classList.remove("open"), 3000);
});

document.getElementById("resetBtn").addEventListener("click", () => {
  prices = structuredClone(DEFAULT_PRICES);
  Store.savePrices(prices);
  renderPricing();
});

renderPricing();
renderOrders();
