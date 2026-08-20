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
//   deployed(date) = sum of totes for every invoiced rental AND every
//                     awaiting-confirmation/confirmed booking request whose
//                     date window includes that date
//   available(date) = totalOwned - deployed(date)
//
// Two stores feed "deployed":
//   - "rentals": created once send-invoice.mjs/add-rental.mjs runs. Has a
//     real, validated toteCount field (see send-invoice.mjs) — always prefer
//     that over parsing the package label, since custom/backfilled packages
//     don't always say "N Totes" in a regex-parseable way.
//   - "requests": the Booking Requests pipeline. A request only becomes a
//     "rentals" record once invoiced, so without this a Confirmed-but-not-
//     yet-invoiced booking wouldn't block the calendar at all — the exact
//     gap this endpoint exists to prevent. Only "awaiting_confirmation" and
//     "confirmed" count as a real hold on the dates; "new"/"reviewed" are
//     still just pending review, and "invoiced" already exists as a
//     "rentals" record so counting it here too would double it up.

import { getStore } from "@netlify/blobs";

const ADD_TYPES = ["purchased", "returned-to-service"];
const HOLD_REQUEST_STATUSES = ["awaiting_confirmation", "confirmed"];
const DAYS_AHEAD = 120; // ~4 months of lookahead, plenty for a 2-week rental window

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
    const requests = await listAll(getStore("requests"));

    // Normalize both stores into the same {start, end, totes} shape so the
    // per-day loop below doesn't need to know which store anything came from.
    const rentalWindows = rentals
      .filter((r) => r.dropoffDate && r.pickupDate)
      .map((r) => ({ start: r.dropoffDate, end: r.pickupDate, totes: totesFor(r) }));

    const heldRequestWindows = requests
      .filter((r) => HOLD_REQUEST_STATUSES.includes(r.status) && r.deliveryDate && r.pickupDate)
      .map((r) => ({ start: r.deliveryDate, end: r.pickupDate, totes: totesFor(r) }));

    const deployedWindows = [...rentalWindows, ...heldRequestWindows];

    const today = todayInOklahoma();
    const days = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const date = shiftDate(today, i);
      const deployed = deployedWindows.reduce((t, w) => {
        if (w.start <= date && w.end >= date) return t + w.totes;
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
