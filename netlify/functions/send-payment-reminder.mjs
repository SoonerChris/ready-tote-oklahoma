// POST /.netlify/functions/send-payment-reminder
// Sends a follow-up payment reminder email for an invoice that's still
// unpaid, reusing the Stripe payment link saved when the invoice was sent.
// Protected by INVOICE_SECRET. Body: { secret, key } where key is the
// rental's blob store key.
//
// Env vars required:
//   RESEND_API_KEY - Resend API key
//   RESEND_FROM    - verified sender

import { getStore } from "@netlify/blobs";

const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";
const OWNER_EMAIL = "readytoteok@gmail.com";
const SITE_URL = "https://readytoteokc.com";
const LOGO_URL = `${SITE_URL}/images/logo.png`;
const PHONE_DISPLAY = "580.399.3202";
const PHONE_TEL = "+15803993202";

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

  if (!process.env.INVOICE_SECRET || body.secret !== process.env.INVOICE_SECRET) {
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
  const dropoff = dropoffKnown ? `${formatDate(rental.dropoffDate)} at ${escapeHtml(rental.dropoffTime)}` : "";

  const from = process.env.RESEND_FROM || FROM_FALLBACK;

  const row = (label, value) => `
    <tr>
      <td style="padding:7px 0; font-size:14px; color:#6B6259; width:150px; vertical-align:top;">${label}</td>
      <td style="padding:7px 0; font-size:14px; color:#1E1B18; font-weight:bold;">${value}</td>
    </tr>`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0; padding:0; background-color:#F5F1E7;">
  <div style="display:none; max-height:0; overflow:hidden;">
    Friendly reminder — your Ready Tote Oklahoma invoice is still open.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F1E7; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

        <!-- Header -->
        <tr>
          <td align="center" style="background-color:#1E1B18; border-radius:16px 16px 0 0; padding:28px 24px;">
            <img src="${LOGO_URL}" alt="Ready Tote Oklahoma" width="110" style="display:block; width:110px; height:auto;">
          </td>
        </tr>
        <tr><td style="background-color:#C99A32; height:5px; font-size:0; line-height:0;">&nbsp;</td></tr>

        <!-- Body -->
        <tr>
          <td style="background-color:#FFFFFF; padding:36px 32px; font-family: Arial, Helvetica, sans-serif; color:#1E1B18;">

            <h1 style="margin:0 0 6px; font-size:24px; line-height:1.2;">
              Just a reminder, ${firstName}
            </h1>
            <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#6B6259;">
              We haven't received payment yet for your tote rental invoice. Complete your reservation below to lock in your dates${dropoffKnown ? ` for ${dropoff}` : ""}.
            </p>

            <!-- Invoice card -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background-color:#F5F1E7; border-radius:12px; border:1px solid #E5DFD2;">
              <tr>
                <td style="padding:22px 24px;">
                  <p style="margin:0 0 14px; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#C99A32; font-weight:bold;">
                    Payment Reminder
                  </p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, Helvetica, sans-serif;">
                    ${row("Package", pkg)}
                    ${dropoffKnown ? row("Drop-off", dropoff) : ""}
                  </table>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px; border-top:2px solid #C99A32;">
                    <tr>
                      <td style="padding:12px 0 0; font-size:15px; color:#1E1B18; font-weight:bold;">Total Due</td>
                      <td align="right" style="padding:12px 0 0; font-size:22px; color:#1E1B18; font-weight:bold; font-family: Arial, Helvetica, sans-serif;">${price}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA button -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
              <tr>
                <td align="center">
                  <a href="${stripeUrl}"
                     style="display:inline-block; background-color:#C99A32; color:#1E1B18; font-family: Arial, Helvetica, sans-serif; font-size:16px; font-weight:bold; text-decoration:none; padding:16px 42px; border-radius:10px;">
                    Complete Reservation &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 24px; font-size:12px; color:#9A938A; text-align:center;">
              Secure payment powered by Stripe
            </p>

            <p style="margin:0; font-size:14px; line-height:1.6; color:#6B6259;">
              Already paid, or need to change anything? Just reply to this email or call
              <a href="tel:${PHONE_TEL}" style="color:#1E1B18; font-weight:bold; text-decoration:none;">${PHONE_DISPLAY}</a>.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="background-color:#1E1B18; border-radius:0 0 16px 16px; padding:24px 32px; font-family: Arial, Helvetica, sans-serif;">
            <p style="margin:0 0 6px; font-size:13px; color:#FFFFFF; font-weight:bold;">
              We Drop Off. You Pack. We Pick Up.
            </p>
            <p style="margin:0; font-size:12px; color:#9A938A;">
              Ready Tote Oklahoma &bull; Serving the OKC Metro &amp; Ada Area<br>
              <a href="tel:${PHONE_TEL}" style="color:#C99A32; text-decoration:none;">${PHONE_DISPLAY}</a>
              &nbsp;&bull;&nbsp;
              <a href="${SITE_URL}" style="color:#C99A32; text-decoration:none;">readytoteokc.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
      subject: `Reminder: your invoice is still open — ${rental.package || "Ready Tote Oklahoma"}`,
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
