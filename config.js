// Shared data model + localStorage helpers for the office cleaning app.
// Client page (index.html) and Admin page (admin.html) both read/write this.

const TIERS = [
  { id: "quick", label: "Quick", desc: "Surface tidy, trash, wipe down" },
  { id: "standard", label: "Standard", desc: "Quick + floors, dusting" },
  { id: "deep", label: "Deep", desc: "Standard + full scrub, sanitize" },
];

// Room layout is drawn on an SVG canvas (x/y/w/h per shape, in viewBox units).
// Coordinates were traced pixel-for-pixel from the reference floor plan image
// (CHILL_AREA.png), so both offices' shapes match it exactly. A room can be
// made of more than one rect (e.g. the L-shaped Chill Area) — shapes sharing
// the same room id are treated as one clickable room; set label:false on the
// secondary piece so the name/price only prints once.
const DEFAULT_OFFICES = {
  moha: {
    label: "Moha's Office",
    rooms: [
      { id: "chill", name: "Chill Area" },
      { id: "bathroom", name: "Bathroom" },
      { id: "desks", name: "Desks" },
    ],
    layout: {
      viewBox: "410 30 710 1020",
      shapes: [
        { id: "chill", x: 430, y: 50, w: 524, h: 239 },
        { id: "chill", x: 656, y: 289, w: 298, h: 243, label: false },
        { id: "desks", x: 656, y: 532, w: 438, h: 495 },
        { id: "bathroom", x: 954, y: 475, w: 140, h: 286 },
      ],
    },
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
    layout: {
      viewBox: "960 100 680 950",
      shapes: [
        { id: "kitchen", x: 976, y: 118, w: 299, h: 342 },
        { id: "storage", x: 1287, y: 118, w: 334, h: 342 },
        { id: "desks", x: 1115, y: 678, w: 506, h: 349 },
        { id: "dishwashing", x: 1249, y: 463, w: 149, h: 215 },
        { id: "bathroom", x: 1490, y: 463, w: 131, h: 215 },
      ],
    },
  },
};

// Default price per room per tier ($)
const DEFAULT_PRICES = {
  moha: {
    chill: { quick: 4, standard: 7, deep: 12 },
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
