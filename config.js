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
    // Kitchen (the wider room) at top-left, with the Dishwashing Area
    // walled off in its corner beside the hall door; Storage top-right.
    // Below them, Desks is the whole open area east of the shared hall,
    // with the Bathroom carved out against the east wall under Storage.
    rooms: [
      { id: "kitchen", name: "Kitchen" },
      { id: "storage", name: "Storage" },
      { id: "dishwashing", name: "Dishwashing Area" },
      { id: "bathroom", name: "Bathroom" },
      { id: "desks", name: "Desks" },
    ],
  },
  // The entrance hall between the two offices (blue strip in the
  // reference) — its own group since it belongs to neither office, but
  // it gets cleaned like any room.
  hall: {
    label: "Hall",
    rooms: [{ id: "hall", name: "Hall" }],
  },
  // Outdoor square off the south side of Malek's Desks, reached through
  // a door in the south wall. Also gets cleaned.
  outside: {
    label: "Outside",
    rooms: [{ id: "outside", name: "Outside" }],
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

    // Entrance hall between the two offices (blue in the reference) —
    // from the Kitchen's south wall down to the building's south wall.
    { officeId: "hall", id: "hall", x: 1094, y: 460, w: 168, h: 567 },

    // Outdoor square off the south side of Malek's Desks — no walls of
    // its own, just an open terrace slab outside the building.
    { officeId: "outside", id: "outside", x: 1292, y: 1027, w: 300, h: 300 },

    // Kitchen is the WIDER of the two top rooms (divider at x=1337);
    // its label is nudged NW so it clears the Dishwashing corner room.
    { officeId: "malek", id: "kitchen", x: 966, y: 118, w: 365, h: 342, lx: 1120, ly: 265 },
    { officeId: "malek", id: "storage", x: 1343, y: 118, w: 278, h: 342 },
    // Desks = everything right of the hall, drawn first so the Bathroom
    // sits on top of it as its own small enclosed room.
    { officeId: "malek", id: "desks", x: 1262, y: 460, w: 359, h: 567 },
    // Corner room walled off INSIDE the Kitchen, right beside the hall
    // door — its own west + north walls, door facing the kitchen.
    { officeId: "malek", id: "dishwashing", x: 1203, y: 330, w: 128, h: 130 },
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
    // South wall — solid (no exterior door drawn on the model)
    { x1: 1094, y1: 1027, x2: 656, y2: 1027 },
    { x1: 656, y1: 1027, x2: 656, y2: 289 },
    { x1: 656, y1: 289, x2: 430, y2: 289 },
    { x1: 430, y1: 289, x2: 430, y2: 50 },
    // Chill Area -> Desks doorway (wide, centered on the stem)
    { x1: 656, y1: 532, x2: 954, y2: 532, doorGap: [735, 895] },
    // Bathroom (door LOW on the west wall — below the stem — into Desks)
    { x1: 954, y1: 475, x2: 954, y2: 761, doorGap: [645, 715] },
    { x1: 954, y1: 761, x2: 1094, y2: 761 },

    // --- Malek's Office ---
    { x1: 966, y1: 118, x2: 1621, y2: 118 },
    { x1: 1621, y1: 118, x2: 1621, y2: 1027 },
    // South wall — one doorway from Desks out to the Outside square
    { x1: 1621, y1: 1027, x2: 1094, y2: 1027, doorGap: [1400, 1480] },
    // West wall stops at the kitchen — below y=460 it's Moha's side + hall.
    // At x=966 it sits flush against Moha's east wall (x=954, both 12
    // thick) so the pair reads as ONE thick shared wall, not two walls
    // with a dark slot between them.
    { x1: 966, y1: 118, x2: 966, y2: 460 },
    // Kitchen / Storage divider (solid; kitchen is the wider room)
    { x1: 1337, y1: 118, x2: 1337, y2: 460 },
    // Kitchen south wall — the hall doorway sits just west of the
    // Dishwashing corner room so its west wall lands on the door jamb
    { x1: 966, y1: 460, x2: 1337, y2: 460, doorGap: [1120, 1197] },
    // Storage south wall (door into the Desks strip below it)
    { x1: 1337, y1: 460, x2: 1621, y2: 460, doorGap: [1425, 1490] },
    // Hall east wall, with a doorway into Desks near its south end
    { x1: 1262, y1: 460, x2: 1262, y2: 1027, doorGap: [945, 1015] },
    // Dishwashing Area: corner room tucked inside the Kitchen beside the
    // hall door — west + north walls, door on the west facing the kitchen
    { x1: 1203, y1: 330, x2: 1203, y2: 460, doorGap: [370, 440] },
    { x1: 1203, y1: 330, x2: 1331, y2: 330 },
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
  hall: {
    hall: { quick: 3, standard: 5, deep: 9 },
  },
  outside: {
    outside: { quick: 4, standard: 7, deep: 12 },
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
    // Merge saved prices over defaults so areas added after the user
    // last saved (e.g. Hall, Outside) still get their default prices.
    return raw
      ? { ...structuredClone(DEFAULT_PRICES), ...JSON.parse(raw) }
      : structuredClone(DEFAULT_PRICES);
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
