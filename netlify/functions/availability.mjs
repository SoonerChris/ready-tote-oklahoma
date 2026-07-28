// GET or POST /.netlify/functions/availability
//
// Public endpoint — no admin secret required. Powers the customer-facing
// booking page's availability calendar.
//
// Returns ONLY aggregate numbers (date -> totes available). No customer
// names, emails, phones, addresses, or prices are ever included in the
// response, unlike get-rentals.mjs which is admin-only.
//
// Availability math mirrors the logic already used in admin.html and
// admin-inventory.html:
//   totalOwned = sum of inventory events (purchased/returned-to-service add,
//                damaged/lost/retired subtract)
//   deployed(date) = sum of totes-in-package for every rental whose
//                     [dropoffDate, pickupDate] window includes that date
//   available(date) = totalOwned - deployed(date)

import { getStore } from "@netlify/blobs";

const ADD_TYPES = ["purchased", "returned-to-service"];
const DAYS_AHEAD = 120; // ~4 months of lookahead, plenty for a 2-week rental window

function totesInPackage(pkg) {
  const m = String(pkg || "").match(/(\d+)\s*totes?/i);
  return m ? parseInt(m[1], 10) : 0;
}

function todayInOklahoma() {
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

export default async (request) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const invEvents = await listAll(getStore("inventory"));
    const totalOwned = invEvents.reduce(
      (t, e) => t + (ADD_TYPES.includes(e.type) ? e.quantity : -e.quantity),
      0
    );

    const rentals = await listAll(getStore("rentals"));

    const today = todayInOklahoma();
    const days = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = shiftDate(today, i);
      const deployed = rentals.reduce((t, r) => {
        if (r.dropoffDate && r.pickupDate && r.dropoffDate <= date && r.pickupDate >= date) {
          return t + totesInPackage(r.package);
        }
        return t;
      }, 0);
      days.push({ date, available: totalOwned - deployed });
    }

    return new Response(JSON.stringify({ totalOwned, today, days }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // short cache since this is read fairly often by the public page
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    console.error("availability failed:", e.message);
    return new Response(JSON.stringify({ error: "Unable to compute availability" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
