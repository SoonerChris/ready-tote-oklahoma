// POST /.netlify/functions/delete-rental
// Deletes a rental record by its key. Admin only (signed-in session, see lib-auth.mjs).

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";
import { unlinkExtension } from "./lib-invoice.mjs";

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

  try {
    const store = getStore({ name: "rentals", consistency: "strong" });
    // Deleting an extension hands the pickup back to the original rental
    const existing = await store.get(body.key, { type: "json" });
    if (existing && existing.extendsKey) await unlinkExtension(store, existing.extendsKey, body.key);
    await store.delete(body.key);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("delete-rental failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
