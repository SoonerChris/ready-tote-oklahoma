// POST /.netlify/functions/hide-contact
// Contacts page: hide a person from the list without deleting any history.
// Kept in the "meta" store under "hiddenContacts" as { "<personKey>": hiddenAt }
// (personKey is the page's grouping key: phone, else email, else name).
// A hidden person comes back on their own if they rent or ask again after
// being hidden (the page compares dates).
// Admin only (signed-in session, see lib-auth.mjs).
//
// Body: { action: "list" | "hide" | "unhide", key? } -> { hiddenContacts }

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!isAdmin(request, body)) return new Response("Unauthorized", { status: 401 });
  if (!["list", "hide", "unhide"].includes(body.action)) return new Response("Unknown action", { status: 400 });
  const key = typeof body.key === "string" ? body.key.slice(0, 200) : "";
  if (body.action !== "list" && !/^[pen]./.test(key)) return new Response("Missing key", { status: 400 });

  try {
    const meta = getStore({ name: "meta", consistency: "strong" });
    let hidden = {};
    try { hidden = (await meta.get("hiddenContacts", { type: "json" })) || {}; } catch {}
    if (body.action === "hide") hidden[key] = new Date().toISOString();
    if (body.action === "unhide") delete hidden[key];
    if (body.action !== "list") await meta.setJSON("hiddenContacts", hidden);
    return json({ ok: true, hiddenContacts: hidden });
  } catch (e) {
    console.error("hide-contact failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
