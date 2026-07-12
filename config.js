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
      { id: "desks", name: "Desks" },
      { id: "chilling", name: "Chilling Room" },
      { id: "bathroom", name: "Bathroom" },
    ],
  },
  malek: {
    label: "Malek's Office",
    rooms: [
      { id: "kitchen", name: "Kitchen" },
      { id: "desks", name: "Desks" },
      { id: "storage", name: "Storage" },
      { id: "bathroom", name: "Bathroom" },
      { id: "hallway", name: "Hallway" },
    ],
  },
};

// Default price per room per tier ($)
const DEFAULT_PRICES = {
  moha: {
    desks: { quick: 3, standard: 6, deep: 10 },
    chilling: { quick: 3, standard: 5, deep: 9 },
    bathroom: { quick: 4, standard: 7, deep: 12 },
  },
  malek: {
    kitchen: { quick: 4, standard: 8, deep: 13 },
    desks: { quick: 3, standard: 6, deep: 10 },
    storage: { quick: 3, standard: 5, deep: 8 },
    bathroom: { quick: 4, standard: 7, deep: 12 },
    hallway: { quick: 2, standard: 4, deep: 6 },
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
