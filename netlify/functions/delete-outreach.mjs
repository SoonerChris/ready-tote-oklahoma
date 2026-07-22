// POST /.netlify/functions/delete-outreach
// Deletes one outreach entry by key.
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
  if (!body.key) return new Response("Missing field: key", { status: 400 });

  try {
    const store = getStore("outreach");
    await store.delete(body.key);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("delete-outreach failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
