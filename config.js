// Shared data model + localStorage helpers for the office cleaning app.
// Client page (index.html) and Admin page (admin.html) both read/write this.

const TIERS = [
  { id: "quick", label: "Quick", desc: "Surface tidy, trash, wipe down" },
  { id: "standard", label: "Standard", desc: "Quick + floors, dusting" },
  { id: "deep", label: "Deep", desc: "Standard + full scrub, sanitize" },
];

// Room layout is drawn on a 640x400 SVG canvas. x/y/w/h define each room's
// rectangle. The overall shape echoes the office's real stepped floor plan
// (office1 as the tall block on the left, the rest of the rooms set back
// to the right) based on the floor plan + whiteboard sketch.
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
    layout: {
      viewBox: "0 0 640 400",
      shapes: [
        { id: "office1", x: 20, y: 20, w: 210, h: 360 },
        { id: "office2", x: 230, y: 90, w: 170, h: 140 },
        { id: "office3", x: 400, y: 90, w: 220, h: 140 },
        { id: "bath1", x: 230, y: 230, w: 100, h: 150 },
        { id: "bath2", x: 330, y: 230, w: 100, h: 150 },
        { id: "hall", x: 430, y: 230, w: 190, h: 150 },
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
