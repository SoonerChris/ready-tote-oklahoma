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

import { computeAvailability } from "./lib-stock.mjs";

export default async (request) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    return new Response(JSON.stringify(await computeAvailability()), {
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
