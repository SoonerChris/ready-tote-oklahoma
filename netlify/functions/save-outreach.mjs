// POST /.netlify/functions/save-outreach
// Adds a new outreach entry, or updates an existing one if `key` is provided.
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

  const required = ["category", "name"];
  for (const f of required) {
    if (!body[f]) return new Response(`Missing field: ${f}`, { status: 400 });
  }
  if (!["apartment", "realtor", "remodeler", "mover"].includes(body.category)) {
    return new Response("category must be 'apartment', 'realtor', 'remodeler', or 'mover'", { status: 400 });
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
      updatedAt: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true, key }), { status: 200 });
  } catch (e) {
    console.error("save-outreach failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
