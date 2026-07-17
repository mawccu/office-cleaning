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
    // Kitchen at top-left, Storage at top-right. Below them: two small
    // rooms are both built like bathrooms in the real blueprint — the one
    // directly under Kitchen got repurposed as the Dishwashing Area, the
    // one under Storage stayed the Bathroom. Desks is everything else:
    // the real blueprint labels that whole lower area "Sala" (hall/lounge)
    // — one open room wrapping around both small rooms, not a separate
    // hallway plus a separate desks room.
    rooms: [
      { id: "kitchen", name: "Kitchen" },
      { id: "storage", name: "Storage" },
      { id: "dishwashing", name: "Dishwashing Area" },
      { id: "bathroom", name: "Bathroom" },
      { id: "desks", name: "Desks" },
    ],
  },
};

// Single combined floor plan — one map, traced 1:1 from the reference
// image (CHILL_AREA.png), in reference-image pixel coordinates. Both
// offices sit in the SAME coordinate space. Each shape carries its
// officeId + room id. A room can be made of more than one rect (e.g. the
// L-shaped Chill Area) — set label:false on the secondary piece so the
// name/price only prints once. deco:true marks pure architecture that is
// NOT a cleanable room (the shared entrance hall — the blue strip in the
// reference): it's drawn, but has no label, takes no clicks, never lifts.
const FLOOR_PLAN = {
  shapes: [
    { officeId: "moha", id: "chill", x: 430, y: 50, w: 524, h: 239 },
    { officeId: "moha", id: "chill", x: 656, y: 289, w: 298, h: 243, label: false },
    { officeId: "moha", id: "desks", x: 656, y: 532, w: 438, h: 495 },
    // Carved into the NE corner of Desks; its east edge borders the hall.
    { officeId: "moha", id: "bathroom", x: 954, y: 475, w: 140, h: 286 },

    // Shared entrance hall between the two offices (blue in the
    // reference) — from the Kitchen's south wall down to the street door.
    { officeId: "hall", id: "hall", x: 1094, y: 460, w: 168, h: 567, deco: true, label: false },

    // Kitchen is the WIDER of the two top rooms (divider at x=1337).
    { officeId: "malek", id: "kitchen", x: 976, y: 118, w: 355, h: 342 },
    { officeId: "malek", id: "storage", x: 1343, y: 118, w: 278, h: 342 },
    // Desks = everything right of the hall, drawn first so Dishwashing
    // and Bathroom sit on top of it as their own small enclosed rooms
    // (both noticeably smaller than the desk space wrapping around them).
    { officeId: "malek", id: "desks", x: 1262, y: 460, w: 359, h: 567 },
    // Tucked between the hall and Desks, straddling the Kitchen/Storage
    // divider line above it — door facing east into Desks.
    { officeId: "malek", id: "dishwashing", x: 1262, y: 460, w: 128, h: 190 },
    // On the far east wall, under Storage — door facing west into Desks.
    { officeId: "malek", id: "bathroom", x: 1495, y: 460, w: 126, h: 212 },
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
    // South wall, with the office's own front door
    { x1: 1094, y1: 1027, x2: 656, y2: 1027, doorGap: [958, 1000] },
    { x1: 656, y1: 1027, x2: 656, y2: 289 },
    { x1: 656, y1: 289, x2: 430, y2: 289 },
    { x1: 430, y1: 289, x2: 430, y2: 50 },
    // Chill Area -> Desks doorway (wide, centered on the stem)
    { x1: 656, y1: 532, x2: 954, y2: 532, doorGap: [735, 895] },
    // Bathroom (door LOW on the west wall — below the stem — into Desks)
    { x1: 954, y1: 475, x2: 954, y2: 761, doorGap: [645, 715] },
    { x1: 954, y1: 761, x2: 1094, y2: 761 },

    // --- Malek's Office ---
    { x1: 976, y1: 118, x2: 1621, y2: 118 },
    { x1: 1621, y1: 118, x2: 1621, y2: 1027 },
    // South wall; the gap under the hall is the shared street entrance
    { x1: 1621, y1: 1027, x2: 1094, y2: 1027, doorGap: [1130, 1215] },
    // West wall stops at the kitchen — below y=460 it's Moha's side + hall
    { x1: 976, y1: 118, x2: 976, y2: 460 },
    // Kitchen / Storage divider (solid; kitchen is the wider room)
    { x1: 1337, y1: 118, x2: 1337, y2: 460 },
    // Kitchen south wall (door into the hall) running on over Dishwashing
    { x1: 976, y1: 460, x2: 1390, y2: 460, doorGap: [1130, 1215] },
    // Storage south wall (door into the Desks strip below it)
    { x1: 1390, y1: 460, x2: 1621, y2: 460, doorGap: [1425, 1490] },
    // Hall east wall: solid beside Dishwashing, then a doorway into Desks
    // near its south end
    { x1: 1262, y1: 460, x2: 1262, y2: 650 },
    { x1: 1262, y1: 650, x2: 1262, y2: 1027, doorGap: [945, 1015] },
    // Dishwashing Area (door on the east wall into Desks)
    { x1: 1390, y1: 460, x2: 1390, y2: 650, doorGap: [560, 630] },
    { x1: 1262, y1: 650, x2: 1390, y2: 650 },
    // Bathroom (door on the west wall into Desks)
    { x1: 1495, y1: 460, x2: 1495, y2: 672, doorGap: [560, 640] },
    { x1: 1495, y1: 672, x2: 1621, y2: 672 },
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
