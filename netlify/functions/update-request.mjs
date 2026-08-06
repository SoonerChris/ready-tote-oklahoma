// POST /.netlify/functions/update-request
// Moves a booking request through its pipeline and/or patches its details.
// Protected by INVOICE_SECRET.
//
// Body: { secret, key, action, ...fields }
// action one of: "review" | "send-confirmation" | "confirm" | "decline" | "reopen" | "invoice"
// Any editable field present in the body is merged onto the stored record
// regardless of action, so the same call that advances status can also fix
// a typo'd address or add review notes.

import { getStore } from "@netlify/blobs";

const EDITABLE_FIELDS = [
  "name", "email", "phone", "package",
  "deliveryDate", "pickupDate", "deliveryWindow", "pickupWindow", "deliveryAddress",
  "reviewNotes", "declineReason", "invoiceRentalKey",
];

const VALID_ACTIONS = new Set(["review", "send-confirmation", "confirm", "decline", "reopen", "invoice"]);

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
  if (body.action && !VALID_ACTIONS.has(body.action)) {
    return new Response("Invalid action", { status: 400 });
  }

  try {
    const store = getStore("requests");
    const existing = await store.get(body.key, { type: "json" });
    if (!existing) return new Response("Request not found", { status: 404 });

    const now = new Date().toISOString();
    const updated = { ...existing };

    for (const f of EDITABLE_FIELDS) {
      if (body[f] !== undefined) updated[f] = body[f];
    }

    switch (body.action) {
      case "review":
        updated.status = "reviewed";
        updated.reviewedAt = now;
        break;
      case "send-confirmation":
        updated.status = "awaiting_confirmation";
        updated.confirmationSentAt = now;
        break;
      case "confirm":
        updated.status = "confirmed";
        updated.confirmedAt = now;
        break;
      case "decline":
        updated.status = "declined";
        updated.declinedAt = now;
        break;
      case "reopen":
        updated.status = "new";
        break;
      case "invoice":
        updated.status = "invoiced";
        updated.invoicedAt = now;
        break;
      // no action = field-only patch (e.g. fixing a typo without changing status)
    }

    await store.setJSON(body.key, updated);
    return new Response(JSON.stringify({ ok: true, request: { key: body.key, ...updated } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("update-request failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
