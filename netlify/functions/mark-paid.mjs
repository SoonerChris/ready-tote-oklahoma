// POST /.netlify/functions/mark-paid
// Records or clears a rental's "paid" status. Used by admin-reminders.html
// to denote invoices that have been sent but not yet paid.
// Admin only (signed-in session, see lib-auth.mjs).

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";

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
    const store = getStore({ name: "meta", consistency: "strong" });
    let flags = {};
    try {
      flags = (await store.get("paidFlags", { type: "json" })) || {};
    } catch {
      // Key doesn't exist yet, start fresh
    }
    if (body.paid === false) {
      delete flags[body.key];
    } else {
      flags[body.key] = new Date().toISOString();
    }
    await store.setJSON("paidFlags", flags);
    // Marked by hand means paid outside Stripe (Stripe payments are marked
    // by stripe-webhook), so no Stripe fee is estimated for it on Finance
    try {
      const via = (await store.get("paidVia", { type: "json" })) || {};
      if (body.paid === false) delete via[body.key]; else via[body.key] = "manual";
      await store.setJSON("paidVia", via);
    } catch {}
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("mark-paid failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
