// POST /.netlify/functions/get-outreach
// Returns all B2B outreach entries (apartments + realtors).
// Protected by INVOICE_SECRET (same secret as the other admin pages).

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

  const store = getStore("outreach");
  const { blobs } = await store.list();
  const fetched = await Promise.all(
    blobs.map(async (b) => {
      const r = await store.get(b.key, { type: "json" });
      return r ? { key: b.key, ...r } : null;
    })
  );
  const entries = fetched.filter(Boolean);
  entries.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return new Response(JSON.stringify({ entries }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
