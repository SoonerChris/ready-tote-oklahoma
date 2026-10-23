// POST /.netlify/functions/stripe-webhook
// Receives Stripe webhook events. On checkout.session.completed (a paid
// payment link): (1) auto-matches the payment to a rental record by email
// or customer name and marks it paid, (2) if the customer checked the terms
// of service box at checkout, records that acceptance on the same rental
// record, and (3) sends the customer a branded confirmation email via Resend.
//
// Env vars required:
//   STRIPE_WEBHOOK_SECRET - signing secret (whsec_...) from the Stripe webhook endpoint
//   RESEND_API_KEY        - Resend API key
//   RESEND_FROM           - verified sender

import { getStore } from "@netlify/blobs";
import { emailLayout, heading, pill, steps, contactLine, detailsCard, goodToKnow, htmlToText } from "./lib-email.mjs";
import { friendlyTime, dropoffAddressOf, pickupAddressOf, rentalToICSAttachments } from "./lib-reminders.mjs";
import { notify } from "./lib-push.mjs";

const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";
const OWNER_EMAIL = "readytoteok@gmail.com";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature") || "";

  // --- Verify Stripe signature (HMAC-SHA256, no SDK needed) ---
  const verified = await verifyStripeSignature(
    rawBody,
    sigHeader,
    process.env.STRIPE_WEBHOOK_SECRET || ""
  );
  if (!verified) {
    console.error("Stripe signature verification failed");
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Only act on completed, paid checkouts
  if (event.type !== "checkout.session.completed") {
    return new Response("Ignored event type", { status: 200 });
  }
  const session = event.data?.object || {};
  if (session.payment_status && session.payment_status !== "paid") {
    return new Response("Not paid yet, ignoring", { status: 200 });
  }

  const email = session.customer_details?.email;
  if (!email) {
    console.error("No customer email on session", session.id);
    return new Response("No customer email", { status: 200 });
  }

  const rawName = session.customer_details?.name || "";
  const fullName = rawName || "there";
  const firstName = escapeHtml(fullName.split(" ")[0]);
  const amount = formatAmount(session.amount_total, session.currency);

  // Was the terms-of-service checkbox checked at checkout? Only present when
  // consent_collection.terms_of_service = "required" is set on the Payment Link.
  const tosAccepted = session.consent?.terms_of_service === "accepted";

  // --- Auto-match this payment to a rental record and mark it paid ---
  let rental = null;   // the matched rental, so the receipt can show its dates
  try {
    rental = await autoMarkPaid(email, rawName, session.amount_total, tosAccepted);
  } catch (e) {
    console.error("stripe-webhook: auto mark-paid failed:", e.message);
  }

  await notify("payments", {
    title: "Payment received",
    body: `${amount || "A payment"} from ${rawName || email}`,
    url: "/admin-rentals.html?q=" + encodeURIComponent(rawName || email),
    tag: "paid-" + (session.id || Date.now()),
  });

  const from = process.env.RESEND_FROM || FROM_FALLBACK;

  const html = emailLayout({
    preheader: "Payment received. Your tote rental is confirmed.",
    body: `
            ${heading(`You're all set, ${firstName}`, {
              badge: pill("Confirmed", "green"),
              lead: `We received your payment${amount ? ` of <strong style="color:#1E1B18;">${amount}</strong>` : ""} and your reservation is confirmed.`,
            })}
            ${rental ? receiptCard(rental, amount) : steps([
              "We deliver clean totes to your door on your drop-off date",
              "You pack and move at your own pace",
              "We pick up the empty totes on your pickup date",
            ], { top: 0 })}
            ${goodToKnow([
              "Each tote holds up to 65 lbs. Pad anything fragile.",
              "No liquids, chemicals or food in the totes, please.",
              "Need them longer? Let us know <strong>before</strong> pickup day.",
              rental && rental.serviceType === "self" ? "Bring the totes back empty on your return date."
                : "At pickup, have the totes empty and ready to go.",
              rental && rental.serviceType === "self" ? null : "We'll text you when we're on the way.",
            ])}
            ${contactLine("Need to adjust your dates or have questions?")}`,
  });
  const attachments = rental && rental.dropoffDate && rental.pickupDate ? rentalToICSAttachments(rental, { forCustomer: true }) : undefined;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      bcc: [OWNER_EMAIL],
      reply_to: OWNER_EMAIL,
      subject: "Payment received: your tote rental is confirmed",
      html,
      text: htmlToText(html),
      attachments,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Resend API error:", resp.status, errText);
    // 200 so Stripe doesn't endlessly retry; failure is logged
    return new Response("Email failed, logged", { status: 200 });
  }

  return new Response("Confirmation sent", { status: 200 });
};

// --- Stripe signature verification using Web Crypto (no SDK) ---
// Header format: t=TIMESTAMP,v1=SIGNATURE[,v1=...]
// Signed payload: `${t}.${rawBody}` HMAC-SHA256 with the endpoint secret.
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!secret || !sigHeader) return false;

  const parts = Object.create(null);
  const v1s = [];
  for (const piece of sigHeader.split(",")) {
    const [k, v] = piece.split("=", 2);
    if (k === "t") parts.t = v;
    if (k === "v1") v1s.push(v);
  }
  if (!parts.t || v1s.length === 0) return false;

  // Reject events older than 5 minutes (replay protection)
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC", key, enc.encode(`${parts.t}.${rawBody}`)
  );
  const expected = [...new Uint8Array(sigBytes)]
    .map(b => b.toString(16).padStart(2, "0")).join("");

  return v1s.some(v1 => timingSafeEqual(v1, expected));
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function formatAmount(cents, currency) {
  if (typeof cents !== "number") return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// --- Auto-match a Stripe payment to a rental record, then mark it paid ---
// Matches on email first (most reliable), falling back to customer name if
// no email match is found. If a customer has more than one unpaid invoice,
// narrows by the paid amount, then falls back to the most recently invoiced.
async function autoMarkPaid(email, name, amountCents, tosAccepted) {
  const rentalsStore = getStore("rentals");
  const { blobs } = await rentalsStore.list();
  const fetched = await Promise.all(
    blobs.map(async (b) => {
      const r = await rentalsStore.get(b.key, { type: "json" });
      return r ? { key: b.key, ...r } : null;
    })
  );
  const rentals = fetched.filter(Boolean);

  const metaStore = getStore("meta");
  let paidFlags = {};
  try {
    paidFlags = (await metaStore.get("paidFlags", { type: "json" })) || {};
  } catch {
    // Key doesn't exist yet, start fresh
  }

  const match = findRentalMatch(rentals, paidFlags, email, name, amountCents);
  if (!match) {
    console.warn("stripe-webhook: no rental match for payment from", email, name || "(no name)");
    return null;
  }

  paidFlags[match.key] = new Date().toISOString();
  await metaStore.setJSON("paidFlags", paidFlags);
  // How it was paid, so Finance only estimates Stripe fees on Stripe payments
  try {
    const via = (await metaStore.get("paidVia", { type: "json" })) || {};
    via[match.key] = "stripe";
    await metaStore.setJSON("paidVia", via);
  } catch (e) { console.error("stripe-webhook: paidVia save failed:", e.message); }
  console.log("stripe-webhook: marked rental paid ->", match.key, match.name);

  // Record terms-of-service acceptance on the rental record itself, so it's
  // kept alongside the rest of that customer's booking details.
  if (tosAccepted) {
    const { key, ...rest } = match;
    try {
      await rentalsStore.setJSON(key, {
        ...rest,
        tosAccepted: true,
        tosAcceptedAt: new Date().toISOString(),
      });
      console.log("stripe-webhook: recorded ToS acceptance ->", key);
    } catch (e) {
      console.error("stripe-webhook: failed to save ToS acceptance:", e.message);
    }
  }
  return match;
}

// Receipt details for a matched rental: dates, times, address, amount.
function receiptCard(r, amount) {
  const self = r.serviceType === "self";
  const when = (d, t) => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) + (t ? ` at ${escapeHtml(friendlyTime(t))}` : "") : "";
  const dAddr = dropoffAddressOf(r), pAddr = pickupAddressOf(r);
  return detailsCard({
    label: "Your rental",
    rows: [
      ["Package", escapeHtml(r.package || "")],
      [self ? "Pick up totes" : "Drop-off", when(r.dropoffDate, r.dropoffTime)],
      [self ? "Return totes" : "Pickup", when(r.pickupDate, r.pickupTime)],
      ...(self ? [] : dAddr && dAddr === pAddr ? [["Address", escapeHtml(dAddr)]]
        : [dAddr ? ["Drop-off address", escapeHtml(dAddr)] : null, pAddr ? ["Pickup address", escapeHtml(pAddr)] : null]),
    ],
    total: amount ? ["Paid", amount] : null,
  }) + `
            <p style="margin:10px 0 0; font-size:13px; color:#6B6259;">${self ? "Pick-up and return" : "Drop-off and pickup"} are attached. Tap them to add to your calendar.</p>`;
}

function findRentalMatch(rentals, paidFlags, email, name, amountCents) {
  // Only rentals that were actually invoiced (not backfilled) and aren't
  // already marked paid are candidates — same rule admin-reminders.html uses.
  const candidates = rentals.filter((r) => r.invoicedAt && !r.backfilled && !r.cancelled && !paidFlags[r.key]);
  if (!candidates.length) return null;

  const normEmail = email ? normalize(email) : "";
  const normName = name ? normalize(name) : "";

  let pool = normEmail ? candidates.filter((r) => normalize(r.email || "") === normEmail) : [];
  if (!pool.length && normName) {
    pool = candidates.filter((r) => normalize(r.name || "") === normName);
  }
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];

  // Same person, multiple unpaid invoices — narrow by the amount actually paid
  if (Number.isFinite(amountCents)) {
    const byAmount = pool.filter((r) => centsFromPriceString(r.price) === amountCents);
    if (byAmount.length) pool = byAmount;
  }

  // Still ambiguous — assume the most recently invoiced one
  pool.sort((a, b) => (b.invoicedAt || "").localeCompare(a.invoicedAt || ""));
  return pool[0];
}

function normalize(str) {
  return String(str).trim().toLowerCase().replace(/\s+/g, " ");
}

function centsFromPriceString(price) {
  if (!price) return null;
  const num = parseFloat(String(price).replace(/[^0-9.]/g, ""));
  return Number.isFinite(num) ? Math.round(num * 100) : null;
}
