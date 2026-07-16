// POST /.netlify/functions/send-invoice
// Sends a branded invoice email to a customer with a Stripe payment button.
// Protected by INVOICE_SECRET env var — requests must include the matching secret.
//
// Env vars required:
//   RESEND_API_KEY - Resend API key
//   RESEND_FROM    - verified sender
//   INVOICE_SECRET - a password you choose; the admin page asks for it

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

  // Auth check
  if (!process.env.INVOICE_SECRET || body.secret !== process.env.INVOICE_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const required = ["email", "name", "phone", "package", "duration", "price", "dropoffDate", "dropoffTime", "pickupDate", "pickupTime", "address", "stripeUrl"];
  for (const f of required) {
    if (!body[f]) return new Response(`Missing field: ${f}`, { status: 400 });
  }

  const name = escapeHtml(body.name);
  const firstName = name.split(" ")[0];
  const pkg = escapeHtml(body.package);
  const duration = escapeHtml(body.duration);
  const price = escapeHtml(body.price);
  const dropoff = `${formatDate(body.dropoffDate)} at ${escapeHtml(body.dropoffTime)}`;
  const pickup = `${formatDate(body.pickupDate)} at ${escapeHtml(body.pickupTime)}`;
  const address = escapeHtml(body.address);
  const stripeUrl = String(body.stripeUrl);
  if (!/^https:\/\/([a-z0-9-]+\.)?stripe\.com\//.test(stripeUrl)) {
    return new Response("stripeUrl must be a stripe.com link", { status: 400 });
  }

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
    Your invoice is ready — complete your reservation to lock in your dates.
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
              Your invoice is ready, ${firstName}
            </h1>
            <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#6B6259;">
              Here are your confirmed rental details. Complete your reservation below to lock in your dates.
            </p>

            <!-- Invoice card -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background-color:#F5F1E7; border-radius:12px; border:1px solid #E5DFD2;">
              <tr>
                <td style="padding:22px 24px;">
                  <p style="margin:0 0 14px; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#C99A32; font-weight:bold;">
                    Rental Invoice
                  </p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, Helvetica, sans-serif;">
                    ${row("Package", pkg)}
                    ${row("Duration", duration)}
                    ${row("Drop-off", dropoff)}
                    ${row("Pickup", pickup)}
                    ${row("Address", address)}
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
              Need to change anything? Just reply to this email or call
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
      to: [body.email],
      bcc: [OWNER_EMAIL],
      reply_to: OWNER_EMAIL,
      subject: `Your invoice — ${body.package} — Ready Tote Oklahoma`,
      html,
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
      dropoffDate: body.dropoffDate,
      dropoffTime: body.dropoffTime,
      pickupDate: body.pickupDate,
      pickupTime: body.pickupTime,
      address: body.address,
      invoicedAt: new Date().toISOString(),
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
