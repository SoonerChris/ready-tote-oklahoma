// POST /.netlify/functions/save-outreach
// Adds a new outreach entry, or updates an existing one if `key` is provided.
// A partner can have a promo code (and an optional percent off) that
// customers enter on the booking form, and a short contact history log.
// Admin only (signed-in session, see lib-auth.mjs).

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";

const CATEGORIES = ["apartment", "realtor", "remodeler", "mover", "other"];

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!isAdmin(request, body)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const required = ["category", "name"];
  for (const f of required) {
    if (!body[f]) return new Response(`Missing field: ${f}`, { status: 400 });
  }
  if (!CATEGORIES.includes(body.category)) {
    return new Response("category must be one of: " + CATEGORIES.join(", "), { status: 400 });
  }
  const promoCode = body.promoCode === undefined ? undefined : String(body.promoCode).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  const promoPct = body.promoPct === undefined || body.promoPct === "" ? (body.promoPct === "" ? null : undefined) : Number(body.promoPct);
  if (promoPct != null && (!Number.isFinite(promoPct) || promoPct < 0 || promoPct > 50)) {
    return new Response("Discount must be a percent from 0 to 50", { status: 400 });
  }

  try {
    const store = getStore("outreach");
    const key = body.key || `${body.category}_${Date.now()}`;
    const existing = body.key ? await store.get(key, { type: "json" }) : null;

    await store.setJSON(key, {
      category: body.category,
      name: body.name,
      contactName: body.contactName ?? existing?.contactName ?? "",
      email: body.email ?? existing?.email ?? "",
      phone: body.phone ?? existing?.phone ?? "",
      dateContacted: body.dateContacted ?? existing?.dateContacted ?? "",
      status: body.status || existing?.status || "Not Contacted",
      lastFollowUp: body.lastFollowUp ?? existing?.lastFollowUp ?? "",
      // When to reach out next (YYYY-MM-DD); "" clears it
      nextFollowUp: body.nextFollowUp ?? existing?.nextFollowUp ?? "",
      notes: body.notes ?? existing?.notes ?? "",
      promoCode: promoCode ?? existing?.promoCode ?? "",
      promoPct: promoPct !== undefined ? promoPct : existing?.promoPct ?? null,
      // Newest first: [{ date, note }]
      log: Array.isArray(body.log)
        ? body.log.slice(0, 100).map((l) => ({ date: String(l.date || "").slice(0, 10), note: String(l.note || "").slice(0, 300) })).filter((l) => l.note)
        : existing?.log ?? [],
      updatedAt: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true, key }), { status: 200 });
  } catch (e) {
    console.error("save-outreach failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
