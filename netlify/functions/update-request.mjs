// POST /.netlify/functions/update-request
// Moves a booking request through its pipeline and/or patches its details.
// Admin only (signed-in session, see lib-auth.mjs).
//
// Body: { secret, key, action, ...fields }
// action one of: "review" | "send-confirmation" | "confirm" | "unconfirm" | "decline" | "reopen" | "invoice"
//   | "delete" | "restore"
// "delete" removes a declined request for good (test bookings, spam), so
// the person drops off Contacts unless they have other rentals or
// requests. It returns the record, and "restore" ({ key, record }) puts it
// back for Undo. Only declined requests can be deleted or restored.
// Any editable field present in the body is merged onto the stored record
// regardless of action, so the same call that advances status can also fix
// a typo'd address or add review notes.

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";
import { checkDistance } from "./lib-distance.mjs";

const EDITABLE_FIELDS = [
  "name", "email", "phone", "package",
  "deliveryDate", "pickupDate", "deliveryWindow", "pickupWindow",
  "deliveryAddress", "deliveryAddressStreet", "deliveryAddressCity",
  "deliveryAddressState", "deliveryAddressZip",
  "reviewNotes", "declineReason", "invoiceRentalKey", "isMilitary", "promoCode",
  "confirmToken",   // one-tap confirm link in the confirm text (confirm-booking.mjs)
];

const VALID_ACTIONS = new Set(["review", "send-confirmation", "confirm", "unconfirm", "decline", "reopen", "invoice", "delete", "restore"]);
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!isAdmin(request, body)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!body.key) return new Response("Missing key", { status: 400 });
  if (body.action && !VALID_ACTIONS.has(body.action)) {
    return new Response("Invalid action", { status: 400 });
  }

  try {
    // Strong reads everywhere (all functions): a default read can return a
    // copy from just before the last save for up to a minute, and saving that
    // copy back wipes the newer change. That lost confirm-link codes when
    // "Yes, sent" followed "Text to confirm" within seconds.
    const store = getStore({ name: "requests", consistency: "strong" });
    if (body.action === "restore") {
      const { key: _k, ...record } = body.record && typeof body.record === "object" ? body.record : {};
      if (record.status !== "declined") return new Response("Only a deleted declined request can be restored", { status: 400 });
      if (await store.get(body.key, { type: "json" })) return new Response("That request is already there", { status: 409 });
      await store.setJSON(body.key, record);
      return json({ ok: true, request: { key: body.key, ...record } });
    }
    const existing = await store.get(body.key, { type: "json" });
    if (!existing) return new Response("Request not found", { status: 404 });
    if (body.action === "delete") {
      if (existing.status !== "declined") return new Response("Decline the request first; only declined requests can be deleted", { status: 400 });
      await store.delete(body.key);
      return json({ ok: true, deleted: { key: body.key, ...existing } });
    }

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
        delete updated.confirmedBy;   // set to "customer" only by the confirm link
        break;
      case "unconfirm":
        // Undo of "confirm": back to waiting on the customer
        updated.status = "awaiting_confirmation";
        delete updated.confirmedAt;
        delete updated.confirmedBy;
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

    // A changed delivery address gets its distance checked again
    const ADDRESS_FIELDS = ["deliveryAddress", "deliveryAddressStreet", "deliveryAddressCity", "deliveryAddressState", "deliveryAddressZip"];
    if (ADDRESS_FIELDS.some((f) => body[f] !== undefined && body[f] !== existing[f]) && updated.serviceType !== "self") {
      const line = [updated.deliveryAddressStreet, updated.deliveryAddressCity, [updated.deliveryAddressState, updated.deliveryAddressZip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || updated.deliveryAddress;
      const distance = await checkDistance(line);
      if (distance) updated.distance = distance; else delete updated.distance;
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
