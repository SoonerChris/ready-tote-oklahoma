// Free totes and dollies per day, shared by the public availability
// calendar (availability.mjs) and the low-stock alert (push-alerts.mjs).
// See availability.mjs for how the math works.

import { getStore } from "@netlify/blobs";

const ADD_TYPES = ["purchased", "returned-to-service"];
// Stock events without an item predate dolly tracking and are totes
const isDolly = (e) => e.item === "dolly";
const HOLD_REQUEST_STATUSES = ["awaiting_confirmation", "confirmed"];
export const DAYS_AHEAD = 120; // ~4 months of lookahead, plenty for a 2-week rental window

function dolliesInPackage(pkg) {
  const s = String(pkg || "");
  const m = s.match(/(\d+)\s*doll(?:y|ies)/i);
  if (m) return parseInt(m[1], 10);
  return /doll(?:y|ies)/i.test(s) ? 1 : 0;
}
function dolliesFor(record) {
  if (typeof record.dollyCount === "number") return record.dollyCount;
  return dolliesInPackage(record.package);
}

function totesInPackage(pkg) {
  const m = String(pkg || "").match(/(\d+)\s*totes?/i);
  return m ? parseInt(m[1], 10) : 0;
}

// Prefer the validated toteCount field (rentals only); fall back to
// parsing the package label for legacy records or requests, which don't
// have a toteCount field at all.
function totesFor(record) {
  if (typeof record.toteCount === "number" && record.toteCount > 0) {
    return record.toteCount;
  }
  return totesInPackage(record.package);
}

export function todayInOklahoma() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD
}

function shiftDate(isoDate, days) {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function listAll(store) {
  const { blobs } = await store.list();
  const fetched = await Promise.all(
    blobs.map(async (b) => {
      const r = await store.get(b.key, { type: "json" });
      return r ? { key: b.key, ...r } : null;
    })
  );
  return fetched.filter(Boolean);
}

export async function computeAvailability(daysAhead = DAYS_AHEAD) {
  const invEvents = await listAll(getStore("inventory"));
  const net = (list) => list.reduce((t, e) => t + (ADD_TYPES.includes(e.type) ? e.quantity : -e.quantity), 0);
  const totalOwned = net(invEvents.filter((e) => !isDolly(e)));
  // Dollies are only counted once at least one dolly stock change is logged;
  // until then there's no owned number to subtract from.
  const dollyEvents = invEvents.filter(isDolly);
  const dolliesTracked = dollyEvents.length > 0;
  const dolliesOwned = dolliesTracked ? net(dollyEvents) : null;

  const rentals = await listAll(getStore("rentals"));
  const requests = await listAll(getStore("requests"));

  // Normalize both stores into the same {start, end, totes} shape so the
  // per-day loop below doesn't need to know which store anything came from.
  const rentalWindows = rentals
    .filter((r) => !r.cancelled && r.dropoffDate && r.pickupDate)
    .map((r) => ({ start: r.dropoffDate, end: r.pickupDate, totes: totesFor(r), dollies: dolliesFor(r) }));

  const heldRequestWindows = requests
    .filter((r) => HOLD_REQUEST_STATUSES.includes(r.status) && r.deliveryDate && r.pickupDate)
    .map((r) => ({ start: r.deliveryDate, end: r.pickupDate, totes: totesFor(r), dollies: dolliesFor(r) }));

  const deployedWindows = [...rentalWindows, ...heldRequestWindows];

  const today = todayInOklahoma();
  const days = [];
  for (let i = 0; i < daysAhead; i++) {
    const date = shiftDate(today, i);
    const out = deployedWindows.filter((w) => w.start <= date && w.end >= date);
    const deployed = out.reduce((t, w) => t + w.totes, 0);
    const day = { date, available: totalOwned - deployed };
    if (dolliesTracked) day.dolliesAvailable = dolliesOwned - out.reduce((t, w) => t + w.dollies, 0);
    days.push(day);
  }

  return { totalOwned, dolliesTracked, dolliesOwned, today, days };
}
