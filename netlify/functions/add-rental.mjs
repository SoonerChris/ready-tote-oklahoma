// POST /.netlify/functions/add-rental
// Logs a rental record directly (no email sent). For backfilling past/active
// bookings that were made before the rental log existed.
// Protected by INVOICE_SECRET.

import { getStore } from "@netlify/blobs";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!process.env.INVOICE_SECRET || body.secret !== process.env.INVOICE_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const required = ["name", "phone", "package", "price", "dropoffDate", "pickupDate"];
  for (const f of required) {
    if (!body[f]) return new Response(`Missing field: ${f}`, { status: 400 });
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
      price: body.price,
      duration: body.duration || "2 Weeks",
      dropoffDate: body.dropoffDate,
      dropoffTime: body.dropoffTime || "10:00 AM",
      pickupDate: body.pickupDate,
      pickupTime: body.pickupTime || "10:00 AM",
      dropoffAddress: body.dropoffAddress || "",
      pickupAddress: body.pickupAddress || "",
      serviceType: body.serviceType || "delivery",
      invoicedAt: new Date().toISOString(),
      backfilled: true,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("add-rental failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
