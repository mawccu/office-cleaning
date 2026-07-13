// Shared data model + localStorage helpers for the office cleaning app.
// Client page (index.html) and Admin page (admin.html) both read/write this.

const TIERS = [
  { id: "quick", label: "Quick", desc: "Surface tidy, trash, wipe down" },
  { id: "standard", label: "Standard", desc: "Quick + floors, dusting" },
  { id: "deep", label: "Deep", desc: "Standard + full scrub, sanitize" },
];

// Room layout is drawn on an SVG canvas (x/y/w/h per room, in viewBox units),
// traced from the real floor plan + the hand-drawn office sketch.
const DEFAULT_OFFICES = {
  main: {
    label: "The Office",
    rooms: [
      { id: "office1", name: "Office 1" },
      { id: "office2", name: "Office 2" },
      { id: "office3", name: "Office 3" },
      { id: "bath1", name: "Bathroom 1" },
      { id: "bath2", name: "Bathroom 2" },
      { id: "hall", name: "Hall" },
    ],
    // Traced from the actual hand-drawn office sketch: a stepped room (office1)
    // on the left with the stairwell/entry notch left blank beneath it, a
    // narrow central hall corridor, and two office suites (office2 + bath1,
    // office3 + bath2) flanking the hall.
    layout: {
      viewBox: "0 0 640 420",
      shapes: [
        { id: "office1", x: 20, y: 20, w: 220, h: 260 },
        { id: "office2", x: 260, y: 20, w: 130, h: 260 },
        { id: "bath1", x: 260, y: 290, w: 130, h: 110 },
        { id: "hall", x: 390, y: 20, w: 70, h: 380 },
        { id: "office3", x: 460, y: 20, w: 160, h: 260 },
        { id: "bath2", x: 460, y: 290, w: 160, h: 110 },
      ],
    },
  },
};

// Default price per room per tier ($)
const DEFAULT_PRICES = {
  main: {
    office1: { quick: 5, standard: 9, deep: 15 },
    office2: { quick: 4, standard: 7, deep: 12 },
    office3: { quick: 4, standard: 8, deep: 13 },
    bath1: { quick: 4, standard: 7, deep: 12 },
    bath2: { quick: 4, standard: 7, deep: 12 },
    hall: { quick: 6, standard: 10, deep: 16 },
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
