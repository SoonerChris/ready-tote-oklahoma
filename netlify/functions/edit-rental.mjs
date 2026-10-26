// POST /.netlify/functions/edit-rental
// Updates one or more fields on an existing rental record in place. Unlike
// delete + add-rental, this preserves the record's key, so any paidFlags,
// sentFlags, or tosAccepted state tied to that key stays intact.
// Admin only (signed-in session, see lib-auth.mjs).

import { getStore } from "@netlify/blobs";
import { accessLevel } from "./lib-auth.mjs";
import { linkExtension, unlinkExtension } from "./lib-invoice.mjs";

const EDITABLE_FIELDS = [
  "name", "email", "phone", "package", "price", "duration",
  "dropoffDate", "dropoffTime", "pickupDate", "pickupTime",
  "dropoffAddress", "pickupAddress",
  "dropoffAddressStreet", "dropoffAddressCity", "dropoffAddressState", "dropoffAddressZip",
  "pickupAddressStreet", "pickupAddressCity", "pickupAddressState", "pickupAddressZip",
  "serviceType", "notes", "stripeUrl",
  "isMilitary",
];
// Notes can be intentionally cleared (saved as blank); every other text
// field is skipped if blank so a stray empty submit can't wipe real data.
const CLEARABLE_FIELDS = ["notes"];
// Validated separately since these drive Inventory math and must stay
// real whole numbers, not arbitrary strings.
const NUMERIC_FIELDS = ["toteCount", "dollyCount"];

// Always store times as "2:30 PM", even if a client sends "14:30".
function normalizeTime(v) {
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return v;
  const h = parseInt(m[1], 10);
  return (h % 12 || 12) + ":" + m[2] + " " + (h >= 12 ? "PM" : "AM");
}

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const access = await accessLevel(request, body);
  if (!access) {
    return new Response("Unauthorized", { status: 401 });
  }
  // An inventory-only login can only mark totes clean (or undo it)
  if (access === "inventory") {
    const extra = Object.keys(body).filter((k) => !["key", "mark", "undo", "count", "secret"].includes(k));
    if (body.mark !== "cleaned" || extra.length) return new Response("Not allowed for this login", { status: 403 });
  }
  if (!body.key) return new Response("Missing key", { status: 400 });

  try {
    const store = getStore({ name: "rentals", consistency: "strong" });
    const existing = await store.get(body.key, { type: "json" });
    if (!existing) return new Response("Rental not found", { status: 404 });

    const updated = { ...existing };
    let changed = false;
    for (const f of EDITABLE_FIELDS) {
      if (body[f] === undefined || body[f] === null) continue;
      const isBlank = String(body[f]).trim() === "";
      if (isBlank && !CLEARABLE_FIELDS.includes(f)) continue;
      if (f === "stripeUrl" && !isBlank) {
        const url = String(body[f]).trim();
        if (!/^https:\/\/([a-z0-9-]+\.)?stripe\.com\//.test(url)) {
          return new Response("stripeUrl must be a stripe.com link", { status: 400 });
        }
        updated[f] = url;
        changed = true;
        continue;
      }
      updated[f] = isBlank ? "" : (f === "dropoffTime" || f === "pickupTime") ? normalizeTime(body[f]) : body[f];
      changed = true;
    }
    for (const f of NUMERIC_FIELDS) {
      if (body[f] === undefined || body[f] === null || String(body[f]).trim() === "") continue;
      const n = Number(body[f]);
      if (!Number.isInteger(n) || n < 0) {
        return new Response(`${f} must be a whole number (0 or more)`, { status: 400 });
      }
      updated[f] = n;
      changed = true;
    }
    // Cancel keeps the record (and its history) but takes it out of
    // reminders, inventory, availability, revenue and payment matching.
    // { cancel: true, cancelReason } cancels; { cancel: false } restores.
    // A cancelled extension hands the pickup back to the original rental;
    // restoring it takes it over again (extensions: lib-invoice.mjs).
    if (body.cancel === true) {
      updated.cancelled = true;
      updated.cancelledAt = new Date().toISOString();
      updated.cancelReason = String(body.cancelReason || "").trim().slice(0, 120);
      if (updated.extendsKey) await unlinkExtension(store, updated.extendsKey, body.key);
      changed = true;
    } else if (body.cancel === false) {
      delete updated.cancelled; delete updated.cancelledAt; delete updated.cancelReason;
      if (updated.extendsKey) await linkExtension(store, updated.extendsKey, body.key, updated.dropoffDate);
      changed = true;
    }
    // An extension's new start date moves the original's handover day too
    if (updated.extendsKey && !updated.cancelled && updated.dropoffDate !== existing.dropoffDate) {
      await linkExtension(store, updated.extendsKey, body.key, updated.dropoffDate);
    }
    // { unlinkExtension: true } on an extension: it's a separate rental after
    // all (its own delivery; the original gets its pickup back)
    if (body.unlinkExtension === true && updated.extendsKey) {
      await unlinkExtension(store, updated.extendsKey, body.key);
      delete updated.extendsKey;
      changed = true;
    }
    // Delivered / Picked up / Clean buttons: { mark: "delivered" | "pickedUp"
    // | "cleaned" }, or with undo: true to take it back. Picked up implies
    // delivered. "cleaned" is the totes washed after they came back (Inventory).
    // "cleaned" with count: N saves a partial wash (N totes done so far).
    if (body.mark === "cleaned" && body.undo !== true && body.count !== undefined) {
      const n = Number(body.count);
      if (!Number.isInteger(n) || n < 0 || n > 10000) return new Response("Bad count", { status: 400 });
      if (n) updated.cleanedTotes = n; else delete updated.cleanedTotes;
      delete updated.cleanedAt;
      changed = true;
    } else if (body.mark === "delivered" || body.mark === "pickedUp" || body.mark === "cleaned") {
      const field = { delivered: "deliveredAt", pickedUp: "pickedUpAt", cleaned: "cleanedAt" }[body.mark];
      if (body.undo === true) {
        delete updated[field];
        if (field === "deliveredAt") delete updated.pickedUpAt;
        if (field === "cleanedAt") delete updated.cleanedTotes;
      } else {
        const now = new Date().toISOString();
        updated[field] = now;
        if (field === "cleanedAt") delete updated.cleanedTotes;
        if (field === "pickedUpAt" && !updated.deliveredAt) updated.deliveredAt = now;
      }
      changed = true;
    }
    if (!changed) return new Response("No editable fields provided", { status: 400 });

    // A new price makes the saved breakdown (package, rush, discount) stale;
    // drop it so emails show just the new total rather than lines that
    // don't add up to it.
    if (updated.price !== existing.price && updated.lineItems) delete updated.lineItems;

    await store.setJSON(body.key, updated);
    return new Response(JSON.stringify({ ok: true, deliveredAt: updated.deliveredAt || null, pickedUpAt: updated.pickedUpAt || null, cleanedAt: updated.cleanedAt || null, cleanedTotes: updated.cleanedTotes || 0 }), { status: 200 });
  } catch (e) {
    console.error("edit-rental failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
