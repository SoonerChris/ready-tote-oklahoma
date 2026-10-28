// POST /.netlify/functions/pickup-address
// Public: the customer's pickup-address page (address.html), opened from
// the link in the address-check text (readytoteokc.com/a/CODE, code from
// lib-links.mjs). The code is the only key: no login, and the page only
// shows their first name, pickup day and the pickup address on file.
//
// Body: { t, action }
//   look    -> { first, pickupDate, pickupTime, address, state, confirmedAt }
//   confirm -> the address on file is right: pickupAddressConfirmedAt is set,
//              so the address-check reminder stops (lib-reminders.mjs)
//   change  -> { street, city, state, zip }: saves the new pickup address
//              (fields and one line), keeps the old one in
//              pickupAddressChangedFrom, and alerts the admin app
// state: "open" | "closed" (picked up, cancelled, customer return, extended
// into a new rental, or the pickup day has passed)

import { getStore } from "@netlify/blobs";
import { notify } from "./lib-push.mjs";
import { keyForAddressCode } from "./lib-links.mjs";
import { pickupAddressOf, formatAddress, todayInOklahoma, friendlyTime } from "./lib-reminders.mjs";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const clean = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);

export default async (request, context) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const t = String(body.t || "");
  if (!/^[A-Za-z0-9_-]{18}$/.test(t)) return json({ error: "This link isn't valid." }, 404);

  try {
    const store = getStore({ name: "rentals", consistency: "strong" });
    const { blobs } = await store.list();
    const key = keyForAddressCode(t, blobs.map((b) => b.key));
    const r = key && (await store.get(key, { type: "json" }));
    if (!r) return json({ error: "This link isn't valid." }, 404);

    const closed = r.cancelled || r.pickedUpAt || r.serviceType === "self" || r.extendedBy || !r.pickupDate || r.pickupDate < todayInOklahoma();
    const view = (x) => ({
      first: String(x.name || "").split(" ")[0],
      pickupDate: x.pickupDate || "",
      pickupTime: x.pickupTime ? friendlyTime(x.pickupTime) : "",
      address: pickupAddressOf(x),
      state: closed ? "closed" : "open",
      confirmedAt: x.pickupAddressConfirmedAt || "",
    });

    if (body.action === "look") return json(view(r));
    if (closed) return json(view(r));
    const now = new Date().toISOString();

    if (body.action === "confirm") {
      const saved = { ...r, pickupAddressConfirmedAt: now };
      await store.setJSON(key, saved);
      return json(view(saved));
    }

    if (body.action === "change") {
      const a = body.address || {};
      const street = clean(a.street, 120), city = clean(a.city, 60), state = clean(a.state, 20).toUpperCase(), zip = clean(a.zip, 10);
      if (street.length < 3 || !/\d/.test(street)) return json({ error: "Please add the street address, with the house number." }, 400);
      if (city.length < 2) return json({ error: "Please add the city." }, 400);
      if (!/^[A-Z]{2}$/.test(state)) return json({ error: "Please use the 2-letter state, like OK." }, 400);
      if (!/^\d{5}(-\d{4})?$/.test(zip)) return json({ error: "Please add the 5-digit zip code." }, 400);
      const before = pickupAddressOf(r);
      const line = formatAddress(street, city, state, zip);
      const saved = { ...r, pickupAddressStreet: street, pickupAddressCity: city, pickupAddressState: state, pickupAddressZip: zip,
        pickupAddress: line, pickupAddressConfirmedAt: now, ...(before && before !== line ? { pickupAddressChangedFrom: before } : {}) };
      await store.setJSON(key, saved);
      if (before !== line) {
        const day = new Date(r.pickupDate + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
        const alert = notify("requests", { title: "Pickup address changed", body: `${r.name || "A customer"} (pickup ${day}): ${line}${before ? `, was ${before}` : ""}.`, url: "/admin-rentals.html", tag: "pickup-address-" + key })
          .catch((e) => console.error("Address alert failed:", e.message));
        if (context && typeof context.waitUntil === "function") context.waitUntil(alert); else await alert;
      }
      return json(view(saved));
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("pickup-address failed:", e.message);
    return json({ error: "Something went wrong. Please reply to our text instead." }, 502);
  }
};
