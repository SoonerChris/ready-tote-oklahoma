// POST /.netlify/functions/send-payment-reminder
// Sends a follow-up payment reminder email for an invoice that's still
// unpaid, reusing the Stripe payment link saved when the invoice was sent
// (lib-payment-reminder.mjs, shared with the automatic morning send).
// Admin only (signed-in session, see lib-auth.mjs). Body: { secret, key } where key is the
// rental's blob store key.
//
// Env vars required:
//   RESEND_API_KEY - Resend API key
//   RESEND_FROM    - verified sender

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";
import { emailPaymentReminder } from "./lib-payment-reminder.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!isAdmin(request, body)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!body.key) return new Response("Missing key", { status: 400 });

  const store = getStore({ name: "rentals", consistency: "strong" });
  const rental = await store.get(body.key, { type: "json" });
  if (!rental) return new Response("Rental not found", { status: 404 });

  const res = await emailPaymentReminder(body.key, rental);
  if (!res.ok) {
    return res.status === 502
      ? new Response(JSON.stringify({ ok: false, error: res.error }), { status: 502 })
      : new Response(res.error, { status: res.status });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
