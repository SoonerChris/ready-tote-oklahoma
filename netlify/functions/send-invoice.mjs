// POST /.netlify/functions/send-invoice
// Sends a branded invoice email to a customer with a Stripe payment button.
// Admin only (signed-in session, see lib-auth.mjs).
//
// Env vars required:
//   RESEND_API_KEY - Resend API key
//   RESEND_FROM    - verified sender
//   INVOICE_SECRET - a password you choose; the admin page asks for it

import { getStore } from "@netlify/blobs";
import { rentalToICSAttachments } from "./lib-reminders.mjs";
import { isAdmin } from "./lib-auth.mjs";
import { emailLayout, heading, pill, detailsCard, button, contactLine } from "./lib-email.mjs";

const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";
const OWNER_EMAIL = "readytoteok@gmail.com";

// toteCount/dollyCount drive Inventory math directly, so they're validated
// as real whole numbers here rather than parsed out of the package text.
function parseCount(value, fieldName) {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldName} must be a whole number (0 or more)`);
  }
  return n;
}

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

  // Auth check
  if (!isAdmin(request, body)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const required = ["email", "name", "phone", "package", "duration", "price", "dropoffDate", "dropoffTime", "pickupDate", "pickupTime", "dropoffAddress", "pickupAddress", "stripeUrl"];
  for (const f of required) {
    if (!body[f]) return new Response(`Missing field: ${f}`, { status: 400 });
  }

  let toteCount, dollyCount;
  try {
    toteCount = parseCount(body.toteCount, "toteCount");
    dollyCount = parseCount(body.dollyCount, "dollyCount");
  } catch (e) {
    return new Response(e.message, { status: 400 });
  }

  const name = escapeHtml(body.name);
  const firstName = name.split(" ")[0];
  const pkg = escapeHtml(body.package);
  const duration = escapeHtml(body.duration);
  const rawPrice = String(body.price).trim();
  const price = escapeHtml(rawPrice.startsWith("$") ? rawPrice : "$" + rawPrice);
  const dropoff = `${formatDate(body.dropoffDate)} at ${escapeHtml(body.dropoffTime)}`;
  const pickup = `${formatDate(body.pickupDate)} at ${escapeHtml(body.pickupTime)}`;
  const dropoffAddress = escapeHtml(body.dropoffAddress);
  const pickupAddress = escapeHtml(body.pickupAddress);
  const sameAddress = body.dropoffAddress === body.pickupAddress;
  const selfService = body.serviceType === "self";
  const stripeUrl = String(body.stripeUrl);
  if (!/^https:\/\/([a-z0-9-]+\.)?stripe\.com\//.test(stripeUrl)) {
    return new Response("stripeUrl must be a stripe.com link", { status: 400 });
  }

  const from = process.env.RESEND_FROM || FROM_FALLBACK;


  const html = emailLayout({
    preheader: "Your invoice is ready. Complete your reservation to lock in your dates.",
    body: `
            ${heading(`Your invoice is ready, ${firstName}`, {
              badge: pill("Payment due", "gold"),
              lead: "Here are your rental details. Complete your reservation below to lock in your dates.",
            })}
            ${detailsCard({
              label: "Rental invoice",
              rows: [
                ["Package", pkg],
                ["Duration", duration],
                ...(selfService
                  ? [["Service", "You pick up and return the totes"], ["Pick up totes", dropoff], ["Return totes", pickup]]
                  : [["Drop-off", dropoff], ["Pickup", pickup],
                     ...(sameAddress ? [["Address", dropoffAddress]] : [["Drop-off address", dropoffAddress], ["Pickup address", pickupAddress]])]),
              ],
              total: ["Total due", price],
            })}
            ${button(stripeUrl, "Complete reservation", { note: "Secure payment by Stripe" })}
            ${contactLine("Need to change anything?")}`,
  });

  // Generate calendar event attachments
  const icsAttachments = rentalToICSAttachments(body);

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [body.email],
      bcc: [OWNER_EMAIL],
      reply_to: OWNER_EMAIL,
      subject: `Your invoice for ${body.package} | Ready Tote Oklahoma`,
      html,
      attachments: icsAttachments,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Resend API error:", resp.status, errText);
    return new Response(JSON.stringify({ ok: false, error: errText }), { status: 502 });
  }

  // Log the rental so reminders and review requests can find it
  try {
    const store = getStore("rentals");
    const key = `${body.dropoffDate}_${body.email.replace(/[^a-zA-Z0-9@.]/g, "")}_${Date.now()}`;
    await store.setJSON(key, {
      name: body.name,
      email: body.email,
      phone: body.phone,
      package: body.package,
      toteCount,
      dollyCount,
      price: body.price,
      duration: body.duration,
      dropoffDate: body.dropoffDate,
      dropoffTime: body.dropoffTime,
      pickupDate: body.pickupDate,
      pickupTime: body.pickupTime,
      dropoffAddress: body.dropoffAddress,
      pickupAddress: body.pickupAddress,
      serviceType: body.serviceType || "delivery",
      notes: body.notes || "",
      invoicedAt: new Date().toISOString(),
      stripeUrl,
      isMilitary: !!body.isMilitary,
      militaryIdKey: body.militaryIdKey || "",
    });
  } catch (e) {
    console.error("Rental log failed (invoice still sent):", e.message);
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
