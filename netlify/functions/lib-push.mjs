// Push notifications to the admin Home Screen app (iPhone and others).
//
// Phones that turned notifications on (App & alerts page) are saved in the
// "push" blob store, one per device, with which kinds they want:
//   requests  - a new booking request came in   (submission-created.mjs)
//   payments  - a customer paid through Stripe   (stripe-webhook.mjs)
//   reminders - the morning reminders are ready  (daily-reminders.mjs)
//
// The VAPID keys that sign pushes are made on first use and kept in the
// "meta" store, so there's nothing to set up in Netlify. A device that has
// uninstalled the app or turned notifications off is removed automatically.

import webpush from "web-push";
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

const CONTACT = "mailto:readytoteok@gmail.com";
export const KINDS = ["requests", "payments", "reminders"];

export const deviceKey = (endpoint) => "dev_" + createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 32);

export async function vapidKeys() {
  const meta = getStore("meta");
  let keys = null;
  try { keys = await meta.get("pushKeys", { type: "json" }); } catch {}
  if (keys && keys.publicKey && keys.privateKey) return keys;
  keys = webpush.generateVAPIDKeys();
  await meta.setJSON("pushKeys", keys);
  return keys;
}

// Send one notification to one saved device. Returns "sent", "gone" or "failed".
export async function sendTo(device, message) {
  const keys = await vapidKeys();
  webpush.setVapidDetails(CONTACT, keys.publicKey, keys.privateKey);
  try {
    await webpush.sendNotification(device.subscription, JSON.stringify(message), { TTL: 60 * 60 * 24, urgency: "high" });
    return "sent";
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) return "gone";
    console.error("push send failed:", e.statusCode || "", e.body || e.message);
    return "failed";
  }
}

// Tell every device that wants this kind. Never throws: a notification
// problem must not break a booking, a payment or the morning email.
export async function notify(kind, message) {
  try {
    const store = getStore("push");
    const { blobs } = await store.list();
    let sent = 0;
    for (const b of blobs) {
      const device = await store.get(b.key, { type: "json" }).catch(() => null);
      if (!device || !device.subscription || device.prefs?.[kind] === false) continue;
      const result = await sendTo(device, message);
      if (result === "sent") sent++;
      if (result === "gone") await store.delete(b.key).catch(() => {});
    }
    return { sent };
  } catch (e) {
    console.error("notify failed:", kind, e.message);
    return { sent: 0 };
  }
}
