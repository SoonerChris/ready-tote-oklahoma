// POST /.netlify/functions/get-rentals
// Returns the rental log plus today's computed reminders.
// Protected by INVOICE_SECRET (same secret as the invoice admin page).

import { getStore } from "@netlify/blobs";
import { computeReminders, reviewMessageFor } from "./lib-reminders.mjs";

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
  const rentals = [];
  for (const b of blobs) {
    const r = await store.get(b.key, { type: "json" });
    if (r) rentals.push({ key: b.key, ...r });
  }

  const metaStore = getStore("meta");
  let sentFlags = {};
  try { sentFlags = (await metaStore.get("sentFlags", { type: "json" })) || {}; } catch {}

  const reviewLink = process.env.GOOGLE_REVIEW_LINK || "";
  const reminders = computeReminders(rentals, reviewLink, sentFlags);

  // On-demand review text for every rental (for the All Rentals list)
  for (const r of rentals) {
    const rv = reviewMessageFor(r, reviewLink);
    r.reviewSms = rv.sms;
  }

  return new Response(JSON.stringify({ rentals, reminders, sentFlags }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
