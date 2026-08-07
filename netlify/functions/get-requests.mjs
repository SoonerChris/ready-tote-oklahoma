// POST /.netlify/functions/get-requests
// Returns every booking request in the pipeline (new -> reviewed ->
// awaiting_confirmation -> confirmed -> invoiced, or declined).
// Protected by INVOICE_SECRET (same secret as the other admin tools).

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

  try {
    const store = getStore("requests");
    const { blobs } = await store.list();
    const fetched = await Promise.all(
      blobs.map(async (b) => {
        const r = await store.get(b.key, { type: "json" });
        return r ? { key: b.key, ...r } : null;
      })
    );
    const requests = fetched.filter(Boolean);
    return new Response(JSON.stringify({ requests }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-requests failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
