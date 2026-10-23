// POST /.netlify/functions/confirm-booking
// Public: the customer's one-tap "Confirm my booking" link (confirm.html).
//
// The confirm text from the Requests page carries a random token saved on
// the request (confirmToken). The token is the only key: no login, and the
// page only ever shows the customer's first name, package and dates.
//
// Body: { t, action }
//   look    -> { first, package, deliveryDate, pickupDate, state }
//   confirm -> moves the request to "confirmed" and notifies the admin app
// state: "open" (can confirm) | "done" (already confirmed or invoiced) | "closed" (declined)
//
// Confirming takes a button press, not just opening the link, because
// Messages and other apps open links on their own to build previews.

import { getStore } from "@netlify/blobs";
import { notify } from "./lib-push.mjs";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const OPEN = ["new", "reviewed", "awaiting_confirmation"];
const DONE = ["confirmed", "invoiced"];

const fmt = (iso) => (iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const t = String(body.t || "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return json({ error: "This link isn't valid." }, 404);

  try {
    const store = getStore("requests");
    const { blobs } = await store.list();
    let key = null, req = null;
    for (const b of blobs) {
      const r = await store.get(b.key, { type: "json" }).catch(() => null);
      if (r && r.confirmToken === t) { key = b.key; req = r; break; }
    }
    if (!req) return json({ error: "This link isn't valid." }, 404);

    const state = (r) => (OPEN.includes(r.status) ? "open" : DONE.includes(r.status) ? "done" : "closed");
    const view = (r) => ({
      first: String(r.name || "").split(" ")[0],
      package: r.package || "",
      deliveryDate: r.deliveryDate || "",
      pickupDate: r.pickupDate || "",
      state: state(r),
    });

    if (body.action === "look") return json(view(req));
    if (body.action !== "confirm") return json({ error: "Unknown action" }, 400);
    if (state(req) !== "open") return json(view(req));

    const updated = { ...req, status: "confirmed", confirmedAt: new Date().toISOString(), confirmedBy: "customer" };
    await store.setJSON(key, updated);
    await notify("confirmed", {
      title: "Booking confirmed",
      body: `${req.name || "A customer"} confirmed ${fmt(req.deliveryDate)} to ${fmt(req.pickupDate)}. Ready to invoice.`,
      url: "/admin-requests.html",
      tag: "confirmed-" + key,
    });
    return json(view(updated));
  } catch (e) {
    console.error("confirm-booking failed:", e.message);
    return json({ error: "Something went wrong. Please reply YES to our text instead." }, 502);
  }
};
