// POST /.netlify/functions/push-subscribe
// Turns notifications on or off for one device (the admin Home Screen app).
// Admin only (signed-in session, see lib-auth.mjs).
//
// Body: { action, ... }
//   key                                  -> { publicKey } for subscribing
//   subscribe   { subscription, prefs }  -> saves this device
//   prefs       { endpoint, prefs }      -> which kinds this device wants
//   status      { endpoint }             -> { on, prefs } for this device
//   unsubscribe { endpoint }             -> forgets this device
//   test        { endpoint }             -> sends a test notification
//   badge                                -> { count } for the app icon badge

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";
import { vapidKeys, deviceKey, sendTo, KINDS, badgeCount } from "./lib-push.mjs";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const cleanPrefs = (p) => Object.fromEntries(KINDS.map((k) => [k, !(p && p[k] === false)]));

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!isAdmin(request, body)) return json({ error: "Unauthorized" }, 401);

  const store = getStore({ name: "push", consistency: "strong" });
  const endpoint = body.endpoint || body.subscription?.endpoint;
  try {
    switch (body.action) {
      case "badge":
        return json({ count: await badgeCount() });
      case "key":
        return json({ publicKey: (await vapidKeys()).publicKey });
      case "subscribe": {
        const sub = body.subscription;
        if (!sub || !/^https:\/\//.test(sub.endpoint || "") || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: "Bad subscription" }, 400);
        await store.setJSON(deviceKey(sub.endpoint), {
          subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          prefs: cleanPrefs(body.prefs),
          device: String(body.device || "").slice(0, 80),
          savedAt: new Date().toISOString(),
        });
        return json({ ok: true });
      }
      case "prefs": {
        const d = await store.get(deviceKey(endpoint), { type: "json" });
        if (!d) return json({ error: "This device isn't set up for notifications" }, 404);
        await store.setJSON(deviceKey(endpoint), { ...d, prefs: cleanPrefs(body.prefs) });
        return json({ ok: true });
      }
      case "status": {
        const d = endpoint ? await store.get(deviceKey(endpoint), { type: "json" }) : null;
        return json({ on: !!d, prefs: d ? d.prefs : cleanPrefs() });
      }
      case "unsubscribe":
        if (endpoint) await store.delete(deviceKey(endpoint));
        return json({ ok: true });
      case "test": {
        const d = await store.get(deviceKey(endpoint), { type: "json" });
        if (!d) return json({ error: "This device isn't set up for notifications" }, 404);
        const r = await sendTo(d, { title: "Ready Tote", body: "Notifications are working. You'll hear about new requests, payments and morning reminders here.", url: "/admin.html", tag: "test" });
        if (r === "gone") await store.delete(deviceKey(endpoint));
        return r === "sent" ? json({ ok: true }) : json({ error: r === "gone" ? "This phone stopped accepting notifications. Turn them on again." : "Couldn't send the test." }, 502);
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("push-subscribe failed:", body.action, e.message);
    return json({ error: "Storage error" }, 502);
  }
};
