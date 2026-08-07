// POST /.netlify/functions/get-rentals
// Returns the rental log plus today's computed reminders.
// Protected by INVOICE_SECRET (same secret as the invoice admin page).

import { getStore } from "@netlify/blobs";
import { computeReminders, reviewMessageFor, deliveryMessageFor, pickupMessageFor, followupMessageFor, paymentReminderMessageFor } from "./lib-reminders.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!process.env.INVOICE_SECRET || body.secret !== process.env.INVOICE_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const store = getStore("rentals");
  const { blobs } = await store.list();
  const fetched = await Promise.all(
    blobs.map(async (b) => {
      const r = await store.get(b.key, { type: "json" });
      return r ? { key: b.key, ...r } : null;
    })
  );
  const rentals = fetched.filter(Boolean);

  const metaStore = getStore("meta");
  let sentFlags = {};
  try { sentFlags = (await metaStore.get("sentFlags", { type: "json" })) || {}; } catch {}
  let paidFlags = {};
  try { paidFlags = (await metaStore.get("paidFlags", { type: "json" })) || {}; } catch {}

  const reviewLink = process.env.GOOGLE_REVIEW_LINK || "";
  const reminders = computeReminders(rentals, reviewLink, sentFlags, paidFlags);

  // Flag which rentals already have a delivery/pickup proof photo, using a
  // single list() call rather than checking each rental individually.
  const photosStore = getStore("photos");
  let photoKeys = new Set();
  try {
    const { blobs } = await photosStore.list();
    photoKeys = new Set(blobs.map((b) => b.key));
  } catch {}
  for (const r of rentals) {
    r.hasDeliveryPhoto = photoKeys.has(`${r.key}:delivery`);
    r.hasPickupPhoto = photoKeys.has(`${r.key}:pickup`);
  }

  // On-demand text links for every rental (All Rentals list)
  for (const r of rentals) {
    const rv = reviewMessageFor(r, reviewLink);
    const dv = deliveryMessageFor(r);
    const pv = pickupMessageFor(r);
    const fv = followupMessageFor(r);
    const pr = paymentReminderMessageFor(r);
    r.reviewSms = rv.sms;
    r.deliverySms = dv.sms;
    r.pickupSms = pv.sms;
    r.followupSms = fv.sms;
    r.paymentReminderSms = pr.sms;
  }

  return new Response(JSON.stringify({ rentals, reminders, sentFlags, paidFlags }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
