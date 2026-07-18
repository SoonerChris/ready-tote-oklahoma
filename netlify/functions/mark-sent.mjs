// POST /.netlify/functions/mark-sent
// Records that a reminder text was sent, so it stops appearing in the
// dashboard and morning emails. Protected by INVOICE_SECRET.

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
  if (!body.flagId) return new Response("Missing flagId", { status: 400 });

  try {
    const store = getStore("meta");
    let flags = {};
    try {
      flags = (await store.get("sentFlags", { type: "json" })) || {};
    } catch {
      // Key doesn't exist yet, start fresh
    }
    flags[body.flagId] = new Date().toISOString();
    await store.setJSON("sentFlags", flags);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("mark-sent failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
