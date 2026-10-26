// POST /.netlify/functions/settings
// Switches for how the app behaves, kept in the "meta" store under
// "settings". Admin only.
//
// Body: { action: "get" } -> { settings }
//       { action: "set", autoInvoice: true|false } -> { settings }
//
//   autoInvoice - email the invoice as soon as a customer confirms a
//                 standard booking (lib-invoice.mjs). On unless turned off.
//   autoMileage - log a delivery or pickup's round-trip miles on Finance
//                 when it's marked done (lib-mileage.mjs). On unless off.

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export const DEFAULTS = { autoInvoice: true, autoMileage: true };

export async function getSettings() {
  let saved = {};
  try { saved = (await getStore({ name: "meta", consistency: "strong" }).get("settings", { type: "json" })) || {}; } catch {}
  return { ...DEFAULTS, ...saved };
}

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!isAdmin(request, body)) return json({ error: "Unauthorized" }, 401);

  const settings = await getSettings();
  if (body.action === "get") return json({ settings });
  if (body.action !== "set") return json({ error: "Unknown action" }, 400);
  for (const k of Object.keys(DEFAULTS)) if (typeof body[k] === "boolean") settings[k] = body[k];
  await getStore({ name: "meta", consistency: "strong" }).setJSON("settings", settings);
  return json({ settings });
};
