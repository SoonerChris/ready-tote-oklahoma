// POST /.netlify/functions/mark-sent
// Records that a reminder text was sent, so it stops appearing in the
// dashboard and morning emails. Pass { unsent: true } to clear a flag
// instead (puts the reminder back on the "due" list). Protected by
// INVOICE_SECRET.

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
  if (!body.flagId) return new Response("Missing flagId", { status: 400 });

  try {
    const store = getStore("meta");
    let flags = {};
    try {
      flags = (await store.get("sentFlags", { type: "json" })) || {};
    } catch {
      // Key doesn't exist yet, start fresh
    }
    // "Skip" clears a reminder without a text going out: it counts as done
    // (same sent flag), and is also noted in skippedFlags so it reads as
    // skipped rather than sent. Undo clears both.
    let skipped = null;
    if (body.skip === true || body.unsent === true) {
      try { skipped = (await store.get("skippedFlags", { type: "json" })) || {}; } catch { skipped = {}; }
    }
    if (body.unsent === true) {
      delete flags[body.flagId];
      if (skipped && skipped[body.flagId]) { delete skipped[body.flagId]; await store.setJSON("skippedFlags", skipped); }
    } else {
      flags[body.flagId] = new Date().toISOString();
      if (body.skip === true) { skipped[body.flagId] = flags[body.flagId]; await store.setJSON("skippedFlags", skipped); }
    }
    await store.setJSON("sentFlags", flags);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("mark-sent failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
