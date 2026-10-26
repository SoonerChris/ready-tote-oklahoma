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
export function totesFor(record) {
  if (typeof record.toteCount === "number" && record.toteCount > 0) {
    return record.toteCount;
  }
  return totesInPackage(record.package);
}

// Oklahoma date and minutes after midnight, right now
function okNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
// "2:30 PM", "14:30" or "9 AM" -> minutes after midnight; null if no time
function clockMinutes(t) {
  const m = String(t || "").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3]) { const pm = m[3].toUpperCase() === "PM"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return h < 24 && min < 60 ? h * 60 + min : null;
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
  const invEvents = await listAll(getStore({ name: "inventory", consistency: "strong" }));
  const net = (list) => list.reduce((t, e) => t + (ADD_TYPES.includes(e.type) ? e.quantity : -e.quantity), 0);
  const totalOwned = net(invEvents.filter((e) => !isDolly(e)));
  // Dollies are only counted once at least one dolly stock change is logged;
  // until then there's no owned number to subtract from.
  const dollyEvents = invEvents.filter(isDolly);
  const dolliesTracked = dollyEvents.length > 0;
  const dolliesOwned = dolliesTracked ? net(dollyEvents) : null;

  const rentals = await listAll(getStore({ name: "rentals", consistency: "strong" }));
  const requests = await listAll(getStore({ name: "requests", consistency: "strong" }));

  // Normalize both stores into the same {start, end, totes} shape so the
  // per-day loop below doesn't need to know which store anything came from.
  // Last day each rental holds its totes (same rule as rentalEndDate in
  // admin-shared.js): a late pickup (delivered, not picked up) holds them
  // through today; marked picked up frees them from the day it came back;
  // an unmarked pickup today frees them once its pickup time has passed.
  const now = okNow();
  const today0 = now.date;
  const dayBefore = (d) => shiftDate(d, -1);
  const endOf = (r) => {
    // Extension (see admin-shared.js): the original ends the day before the
    // extension starts; the extension counts as delivered from its first day
    if (r.extendedBy && r.extendedOn && !r.pickedUpAt) return dayBefore(r.extendedOn);
    if ((r.deliveredAt || (r.extendsKey && r.dropoffDate <= today0)) && !r.pickedUpAt) {
      const t = clockMinutes(r.pickupTime);
      const late = r.pickupDate < today0 || (r.pickupDate === today0 && t !== null && now.minutes >= t);
      return late && r.pickupDate < today0 ? today0 : r.pickupDate;
    }
    if (r.pickedUpAt) {
      const back = new Date(r.pickedUpAt).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      return back <= r.pickupDate ? dayBefore(back) : r.pickupDate;
    }
    if (r.pickupDate === today0) {
      const t = clockMinutes(r.pickupTime);
      if (t !== null && now.minutes >= t) return dayBefore(today0);
    }
    return r.pickupDate;
  };
  const rentalWindows = rentals
    .filter((r) => !r.cancelled && r.dropoffDate && r.pickupDate)
    .map((r) => ({ start: r.dropoffDate, end: endOf(r), totes: totesFor(r), dollies: dolliesFor(r) }));

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
