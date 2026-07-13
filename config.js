// Shared data model + localStorage helpers for the office cleaning app.
// Client page (index.html) and Admin page (admin.html) both read/write this.

const TIERS = [
  { id: "quick", label: "Quick", desc: "Surface tidy, trash, wipe down" },
  { id: "standard", label: "Standard", desc: "Quick + floors, dusting" },
  { id: "deep", label: "Deep", desc: "Standard + full scrub, sanitize" },
];

const DEFAULT_OFFICES = {
  moha: {
    label: "Moha's Office",
    rooms: [
      { id: "chill", name: "Chill Area" },
      { id: "hall", name: "Hall" },
      { id: "bathroom", name: "Bathroom" },
      { id: "desks", name: "Desks" },
    ],
  },
  malek: {
    label: "Malek's Office",
    rooms: [
      { id: "kitchen", name: "Kitchen" },
      { id: "storage", name: "Storage" },
      { id: "dishwashing", name: "Dishwashing Area" },
      { id: "bathroom", name: "Bathroom" },
      { id: "desks", name: "Desks" },
    ],
  },
};

// Single combined floor plan — one map, exactly as drawn in the reference
// image (CHILL_AREA.png). Both offices sit in the SAME coordinate space
// (traced pixel-for-pixel from that image), so they're drawn as one
// continuous building rather than two separate boxes. Each shape carries
// its officeId + room id. A room can be made of more than one rect (e.g.
// the L-shaped Chill Area) — set label:false on the secondary piece so the
// name/price only prints once.
const FLOOR_PLAN = {
  viewBox: "405 15 1235 1035",
  shapes: [
    { officeId: "moha", id: "chill", x: 430, y: 50, w: 524, h: 239 },
    // The narrow connector between Chill Area and Desks is its own room
    // (unlabeled in the reference, but structurally a separate hall/corridor).
    { officeId: "moha", id: "hall", x: 656, y: 289, w: 298, h: 243 },
    { officeId: "moha", id: "desks", x: 656, y: 532, w: 438, h: 495 },
    { officeId: "moha", id: "bathroom", x: 954, y: 475, w: 140, h: 286 },
    { officeId: "malek", id: "kitchen", x: 976, y: 118, w: 299, h: 342 },
    { officeId: "malek", id: "storage", x: 1287, y: 118, w: 334, h: 342 },
    // Desks is one continuous room (matches the reference: no wall around
    // Dishwashing/Bathroom, just door-frame markers), so it's drawn first as
    // the full lower area and the two smaller zones sit on top of it.
    { officeId: "malek", id: "desks", x: 1115, y: 462, w: 506, h: 565 },
    // Flush against Kitchen/Storage's bottom wall (y460) — no gap, so it
    // reads as attached to the kitchen row instead of floating in Desks.
    { officeId: "malek", id: "dishwashing", x: 1249, y: 460, w: 140, h: 205 },
    { officeId: "malek", id: "bathroom", x: 1490, y: 460, w: 110, h: 205 },
  ],
};

// Default price per room per tier ($)
const DEFAULT_PRICES = {
  moha: {
    chill: { quick: 4, standard: 7, deep: 12 },
    hall: { quick: 3, standard: 5, deep: 8 },
    bathroom: { quick: 4, standard: 7, deep: 12 },
    desks: { quick: 4, standard: 8, deep: 13 },
  },
  malek: {
    kitchen: { quick: 4, standard: 8, deep: 13 },
    storage: { quick: 3, standard: 5, deep: 9 },
    dishwashing: { quick: 3, standard: 6, deep: 10 },
    bathroom: { quick: 4, standard: 7, deep: 12 },
    desks: { quick: 5, standard: 9, deep: 15 },
  },
};

const STORAGE_KEYS = {
  offices: "cleaning_offices",
  prices: "cleaning_prices",
  orders: "cleaning_orders",
};

const Store = {
  getOffices() {
    const raw = localStorage.getItem(STORAGE_KEYS.offices);
    return raw ? JSON.parse(raw) : structuredClone(DEFAULT_OFFICES);
  },
  getPrices() {
    const raw = localStorage.getItem(STORAGE_KEYS.prices);
    return raw ? JSON.parse(raw) : structuredClone(DEFAULT_PRICES);
  },
  savePrices(prices) {
    localStorage.setItem(STORAGE_KEYS.prices, JSON.stringify(prices));
  },
  getOrders() {
    const raw = localStorage.getItem(STORAGE_KEYS.orders);
    return raw ? JSON.parse(raw) : [];
  },
  addOrder(order) {
    const orders = Store.getOrders();
    orders.unshift(order);
    localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify(orders));
    return orders;
  },
  updateOrderStatus(orderId, status) {
    const orders = Store.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (order) order.status = status;
    localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify(orders));
    return orders;
  },
};
