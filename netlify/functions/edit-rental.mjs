// POST /.netlify/functions/edit-rental
// Updates one or more fields on an existing rental record in place. Unlike
// delete + add-rental, this preserves the record's key, so any paidFlags,
// sentFlags, or tosAccepted state tied to that key stays intact.
// Protected by INVOICE_SECRET.

import { getStore } from "@netlify/blobs";

const EDITABLE_FIELDS = [
  "name", "email", "phone", "package", "price", "duration",
  "dropoffDate", "dropoffTime", "pickupDate", "pickupTime",
  "dropoffAddress", "pickupAddress", "serviceType", "notes",
];
// Notes can be intentionally cleared (saved as blank); every other field
// is skipped if blank so a stray empty submit can't wipe real data.
const CLEARABLE_FIELDS = ["notes"];

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!process.env.INVOICE_SECRET || body.secret !== process.env.INVOICE_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!body.key) return new Response("Missing key", { status: 400 });

  try {
    const store = getStore("rentals");
    const existing = await store.get(body.key, { type: "json" });
    if (!existing) return new Response("Rental not found", { status: 404 });

    const updated = { ...existing };
    let changed = false;
    for (const f of EDITABLE_FIELDS) {
      if (body[f] === undefined || body[f] === null) continue;
      const isBlank = String(body[f]).trim() === "";
      if (isBlank && !CLEARABLE_FIELDS.includes(f)) continue;
      updated[f] = isBlank ? "" : body[f];
      changed = true;
    }
    if (!changed) return new Response("No editable fields provided", { status: 400 });

    await store.setJSON(body.key, updated);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("edit-rental failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
