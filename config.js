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
    // Two rooms + a bathroom. The L-shaped area at the top (the wide part
    // plus the connector stem going down to Desks) is ALL Chill Area — one
    // room, not split into a separate hall.
    rooms: [
      { id: "chill", name: "Chill Area" },
      { id: "bathroom", name: "Bathroom" },
      { id: "desks", name: "Desks" },
    ],
  },
  malek: {
    label: "Malek's Office",
    // Kitchen at top-left, Storage at top-right. Below them: Dishwashing
    // Area sits directly under the Kitchen (built as a small bathroom-style
    // room, repurposed), a Hallway corridor runs between Dishwashing and
    // the Bathroom (which sits under Storage on the far wall), and Desks
    // spans the full width at the bottom, fed by the hallway.
    rooms: [
      { id: "kitchen", name: "Kitchen" },
      { id: "storage", name: "Storage" },
      { id: "dishwashing", name: "Dishwashing Area" },
      { id: "hallway", name: "Hallway" },
      { id: "bathroom", name: "Bathroom" },
      { id: "desks", name: "Desks" },
    ],
  },
};

// Single combined floor plan — one map, exactly as drawn in the reference
// image (CHILL_AREA.png), corrected per the owner's own walkthrough of the
// real building. Both offices sit in the SAME coordinate space. Each shape
// carries its officeId + room id. A room can be made of more than one rect
// (e.g. the L-shaped Chill Area) — set label:false on the secondary piece
// so the name/price only prints once.
const FLOOR_PLAN = {
  viewBox: "405 15 1235 1035",
  shapes: [
    { officeId: "moha", id: "chill", x: 430, y: 50, w: 524, h: 239 },
    { officeId: "moha", id: "chill", x: 656, y: 289, w: 298, h: 243, label: false },
    { officeId: "moha", id: "desks", x: 656, y: 532, w: 438, h: 495 },
    { officeId: "moha", id: "bathroom", x: 954, y: 475, w: 140, h: 286 },

    { officeId: "malek", id: "kitchen", x: 976, y: 118, w: 299, h: 342 },
    { officeId: "malek", id: "storage", x: 1287, y: 118, w: 334, h: 342 },
    // Directly under the Kitchen — a real enclosed room (built like a small
    // bathroom, repurposed as the dishwashing area), door facing east into
    // the hallway.
    { officeId: "malek", id: "dishwashing", x: 976, y: 460, w: 220, h: 180 },
    // The corridor between Dishwashing and Bathroom, open to Kitchen above
    // and Desks below.
    { officeId: "malek", id: "hallway", x: 1196, y: 460, w: 225, h: 180 },
    // Under Storage, on the far right wall — door facing west into the hallway.
    { officeId: "malek", id: "bathroom", x: 1421, y: 460, w: 200, h: 180 },
    // Full-width, bottom of the office — wide open to the hallway above it.
    { officeId: "malek", id: "desks", x: 976, y: 640, w: 645, h: 387 },
  ],
  // Real architectural walls, drawn as one continuous line layer on top of
  // the room fills so the whole thing reads as one building instead of a
  // pile of separate boxes. Each wall is a straight segment; doorGap cuts an
  // opening out of it (an [start, end] range along the segment's long axis).
  // A room with no wall on a given side is open to whatever's next to it.
  walls: [
    // --- Moha's Office exterior ---
    { x1: 430, y1: 50, x2: 954, y2: 50 },
    { x1: 954, y1: 50, x2: 954, y2: 475 },
    { x1: 954, y1: 475, x2: 1094, y2: 475 },
    { x1: 1094, y1: 475, x2: 1094, y2: 1027 },
    { x1: 1094, y1: 1027, x2: 656, y2: 1027 },
    { x1: 656, y1: 1027, x2: 656, y2: 289 },
    { x1: 656, y1: 289, x2: 430, y2: 289 },
    { x1: 430, y1: 289, x2: 430, y2: 50 },
    // Chill Area -> Desks doorway
    { x1: 656, y1: 532, x2: 954, y2: 532, doorGap: [705, 795] },
    // Bathroom walls (door on the hall-facing side)
    { x1: 954, y1: 475, x2: 954, y2: 761, doorGap: [495, 565] },
    { x1: 954, y1: 761, x2: 1094, y2: 761 },

    // --- Malek's Office exterior (simple rectangle — Dishwashing/Desks now
    // line up flush with Kitchen's left wall, no notch) ---
    { x1: 976, y1: 118, x2: 1621, y2: 118 },
    { x1: 1621, y1: 118, x2: 1621, y2: 1027 },
    { x1: 1621, y1: 1027, x2: 976, y2: 1027 },
    { x1: 976, y1: 1027, x2: 976, y2: 118 },
    // Kitchen / Storage divider
    { x1: 1281, y1: 118, x2: 1281, y2: 460 },
    // Dishwashing Area: solid on top (under Kitchen) and bottom (above
    // Desks), door on the east wall into the Hallway.
    { x1: 976, y1: 460, x2: 1196, y2: 460 },
    { x1: 1196, y1: 460, x2: 1196, y2: 640, doorGap: [500, 600] },
    { x1: 976, y1: 640, x2: 1196, y2: 640 },
    // Bathroom: solid on top (under Storage) and bottom (above Desks),
    // door on the west wall into the Hallway.
    { x1: 1287, y1: 460, x2: 1621, y2: 460 },
    { x1: 1421, y1: 460, x2: 1421, y2: 640, doorGap: [500, 600] },
    { x1: 1421, y1: 640, x2: 1621, y2: 640 },
    // Hallway has no walls of its own beyond those doors — open to Kitchen
    // above (the gap left at x1196-1275 in the wall above) and open to
    // Desks below.
  ],
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
    hallway: { quick: 3, standard: 5, deep: 8 },
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
