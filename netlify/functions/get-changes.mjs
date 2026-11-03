// POST /.netlify/functions/get-changes
// The change log (lib-changes.mjs) for the admin app.
// Admin only (signed-in session, see lib-auth.mjs).
//
// Body: { key }          -> { changes } for one request or rental, newest
//                           first. A rental also gets the history of the
//                           request it was invoiced from (invoiceRentalKey).
//       { recent: true }  -> { changes } latest 50 across everything

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";
import { listChanges } from "./lib-changes.mjs";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!isAdmin(request, body)) return json({ error: "Unauthorized" }, 401);
  try {
    if (body.recent === true) return json({ changes: await listChanges({ limit: 50 }) });
    const key = typeof body.key === "string" ? body.key.slice(0, 200) : "";
    if (!key) return json({ error: "Missing key" }, 400);
    const keys = [key];
    // The request a rental came from, so its earlier history comes along
    const reqs = getStore({ name: "requests", consistency: "strong" });
    const { blobs } = await reqs.list();
    for (const b of blobs) {
      const q = await reqs.get(b.key, { type: "json" }).catch(() => null);
      if (q && q.invoiceRentalKey === key) keys.push(b.key);
    }
    return json({ changes: await listChanges({ keys, limit: 200 }) });
  } catch (e) {
    console.error("get-changes failed:", e.message);
    return json({ error: "Storage error" }, 502);
  }
};
