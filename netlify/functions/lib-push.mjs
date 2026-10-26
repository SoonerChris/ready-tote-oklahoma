// Push notifications to the admin Home Screen app (iPhone and others).
//
// Phones that turned notifications on (App & alerts page) are saved in the
// "push" blob store, one per device, with which kinds they want:
//   requests  - a new booking request came in   (submission-created.mjs)
//   payments  - a customer paid through Stripe   (stripe-webhook.mjs)
//   reminders - the morning reminders are ready  (daily-reminders.mjs)
//   confirmed - a customer tapped the confirm link (confirm-booking.mjs)
//   soon      - a delivery or pickup within the hour (push-alerts.mjs)
//   stock     - totes running low or overbooked    (push-alerts.mjs)
//
// The VAPID keys that sign pushes are made on first use and kept in the
// "meta" store, so there's nothing to set up in Netlify. A device that has
// uninstalled the app or turned notifications off is removed automatically.

import webpush from "web-push";
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

const CONTACT = "mailto:readytoteok@gmail.com";
export const KINDS = ["requests", "payments", "reminders", "confirmed", "soon", "stock"];

export const deviceKey = (endpoint) => "dev_" + createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 32);

export async function vapidKeys() {
  const meta = getStore({ name: "meta", consistency: "strong" });
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

// ---- App icon badge ----
// The number on the Home Screen icon: booking requests waiting on you (new,
// reviewed, confirmed) plus late pickups (marked delivered, pickup time
// passed, not marked picked up). Sent with every notification and read by
// the app when it opens (push-subscribe "badge").
const WAITING = ["new", "reviewed", "confirmed"];
function okNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function clockMinutes(t) {
  const m = String(t || "").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3]) { const pm = m[3].toUpperCase() === "PM"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return h < 24 && min < 60 ? h * 60 + min : null;
}
async function readAll(name) {
  const store = getStore({ name, consistency: "strong" });
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }).catch(() => null)))).filter(Boolean);
}
export async function badgeCount() {
  try {
    const [requests, rentals] = await Promise.all([readAll("requests"), readAll("rentals")]);
    const now = okNow();
    const late = rentals.filter((r) => !r.cancelled && r.deliveredAt && !r.pickedUpAt && r.pickupDate &&
      (r.pickupDate < now.date || (r.pickupDate === now.date && clockMinutes(r.pickupTime) !== null && now.minutes >= clockMinutes(r.pickupTime))));
    return requests.filter((r) => WAITING.includes(r.status)).length + late.length;
  } catch (e) {
    console.error("badgeCount failed:", e.message);
    return null;
  }
}

// Tell every device that wants this kind. Never throws: a notification
// problem must not break a booking, a payment or the morning email.
export async function notify(kind, message) {
  try {
    const badge = await badgeCount();
    if (badge !== null) message = { ...message, badge };
    const store = getStore({ name: "push", consistency: "strong" });
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
