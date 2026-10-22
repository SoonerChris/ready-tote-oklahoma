// POST /.netlify/functions/send-payment-reminder
// Sends a follow-up payment reminder email for an invoice that's still
// unpaid, reusing the Stripe payment link saved when the invoice was sent.
// Admin only (signed-in session, see lib-auth.mjs). Body: { secret, key } where key is the
// rental's blob store key.
//
// Env vars required:
//   RESEND_API_KEY - Resend API key
//   RESEND_FROM    - verified sender

import { getStore } from "@netlify/blobs";
import { friendlyTime } from "./lib-reminders.mjs";
import { isAdmin } from "./lib-auth.mjs";
import { emailLayout, heading, pill, detailsCard, button, contactLine, cleanLineItems, lineItemRows } from "./lib-email.mjs";

const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";
const OWNER_EMAIL = "readytoteok@gmail.com";

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

  const store = getStore("rentals");
  const rental = await store.get(body.key, { type: "json" });
  if (!rental) return new Response("Rental not found", { status: 404 });
  if (!rental.email) return new Response("This rental has no email on file", { status: 400 });
  if (!rental.stripeUrl) {
    return new Response("No payment link saved for this rental — resend the invoice instead", { status: 400 });
  }
  const stripeUrl = String(rental.stripeUrl);
  if (!/^https:\/\/([a-z0-9-]+\.)?stripe\.com\//.test(stripeUrl)) {
    return new Response("Saved payment link is invalid", { status: 400 });
  }

  const name = escapeHtml(rental.name || "there");
  const firstName = name.split(" ")[0];
  const pkg = escapeHtml(rental.package || "");
  const rawPrice = String(rental.price || "").trim();
  const price = escapeHtml(rawPrice ? (rawPrice.startsWith("$") ? rawPrice : "$" + rawPrice) : "");
  const dropoffKnown = !!(rental.dropoffDate && rental.dropoffTime);
  const dropoff = dropoffKnown ? `${formatDate(rental.dropoffDate)} at ${escapeHtml(friendlyTime(rental.dropoffTime))}` : "";

  const from = process.env.RESEND_FROM || FROM_FALLBACK;


  const html = emailLayout({
    preheader: "Friendly reminder: your Ready Tote Oklahoma invoice is still open.",
    body: `
            ${heading(`Just a reminder, ${firstName}`, {
              badge: pill("Invoice still open", "gold"),
              lead: `We haven't received payment for your tote rental yet. Complete your reservation below to lock in your dates${dropoffKnown ? ` for ${dropoff}` : ""}.`,
            })}
            ${detailsCard({
              label: "Payment reminder",
              rows: [
                ["Package", pkg],
                dropoffKnown ? ["Drop-off", dropoff] : null,
                ...lineItemRows(cleanLineItems(rental.lineItems)),
              ],
              total: price ? ["Total due", price] : null,
            })}
            ${button(stripeUrl, "Complete reservation", { note: "Secure payment by Stripe" })}
            ${contactLine("Already paid, or need to change anything?")}`,
  });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [rental.email],
      bcc: [OWNER_EMAIL],
      reply_to: OWNER_EMAIL,
      subject: `Reminder: your invoice is still open | ${rental.package || "Ready Tote Oklahoma"}`,
      html,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Resend API error:", resp.status, errText);
    return new Response(JSON.stringify({ ok: false, error: errText }), { status: 502 });
  }

  // Record that the reminder was sent, in the same flags store the SMS
  // reminders use (flagId prefix keeps it distinct: "emailReminder:<key>")
  try {
    const metaStore = getStore("meta");
    let flags = {};
    try { flags = (await metaStore.get("sentFlags", { type: "json" })) || {}; } catch {}
    flags["emailReminder:" + body.key] = new Date().toISOString();
    await metaStore.setJSON("sentFlags", flags);
  } catch (e) {
    console.error("send-payment-reminder: failed to record sent flag (email still sent):", e.message);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(isoDate) {
  const d = new Date(isoDate + "T12:00:00");
  if (isNaN(d)) return escapeHtml(isoDate);
  return d.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}
