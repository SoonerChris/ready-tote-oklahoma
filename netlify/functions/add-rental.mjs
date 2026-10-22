// POST /.netlify/functions/add-rental
// Logs a rental record directly (no email sent). Used by the "Log only, no
// email" mode of admin-invoice.html, for bookings paid another way or for
// backfilling past rentals.
// Admin only (signed-in session, see lib-auth.mjs).

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";

// toteCount/dollyCount drive Inventory math directly, so they're validated
// as real whole numbers here rather than parsed out of the package text.
function parseCount(value, fieldName) {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldName} must be a whole number (0 or more)`);
  }
  return n;
}

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!isAdmin(request, body)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const required = ["name", "phone", "package", "price", "dropoffDate", "pickupDate"];
  for (const f of required) {
    if (!body[f]) return new Response(`Missing field: ${f}`, { status: 400 });
  }

  let toteCount, dollyCount;
  try {
    toteCount = parseCount(body.toteCount, "toteCount");
    dollyCount = parseCount(body.dollyCount, "dollyCount");
  } catch (e) {
    return new Response(e.message, { status: 400 });
  }

  try {
    const store = getStore("rentals");
    const emailPart = (body.email || "no-email").replace(/[^a-zA-Z0-9@.]/g, "");
    const key = `${body.dropoffDate}_${emailPart}_${Date.now()}`;
    await store.setJSON(key, {
      name: body.name,
      email: body.email || "",
      phone: body.phone,
      package: body.package,
      toteCount,
      dollyCount,
      price: body.price,
      duration: body.duration || "2 Weeks",
      dropoffDate: body.dropoffDate,
      dropoffTime: body.dropoffTime || "10:00 AM",
      pickupDate: body.pickupDate,
      pickupTime: body.pickupTime || "10:00 AM",
      dropoffAddressStreet: body.dropoffAddressStreet || "",
      dropoffAddressCity: body.dropoffAddressCity || "",
      dropoffAddressState: body.dropoffAddressState || "",
      dropoffAddressZip: body.dropoffAddressZip || "",
      pickupAddressStreet: body.pickupAddressStreet || "",
      pickupAddressCity: body.pickupAddressCity || "",
      pickupAddressState: body.pickupAddressState || "",
      pickupAddressZip: body.pickupAddressZip || "",
      serviceType: body.serviceType || "delivery",
      notes: body.notes || "",
      isMilitary: !!body.isMilitary,
      isRush: !!body.isRush,
      ...(body.militaryIdKey ? { militaryIdKey: body.militaryIdKey } : {}),
      invoicedAt: new Date().toISOString(),
      backfilled: true,
    });
    return new Response(JSON.stringify({ ok: true, key }), { status: 200 });
  } catch (e) {
    console.error("add-rental failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
