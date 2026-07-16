// POST /.netlify/functions/stripe-webhook
// Receives Stripe webhook events. On checkout.session.completed (a paid
// payment link), sends the customer a branded confirmation email via Resend.
//
// Env vars required:
//   STRIPE_WEBHOOK_SECRET - signing secret (whsec_...) from the Stripe webhook endpoint
//   RESEND_API_KEY        - Resend API key
//   RESEND_FROM           - verified sender

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

  const fullName = session.customer_details?.name || "there";
  const firstName = escapeHtml(fullName.split(" ")[0]);
  const amount = formatAmount(session.amount_total, session.currency);

  const from = process.env.RESEND_FROM || FROM_FALLBACK;

  const html = `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0; padding:0; background-color:#F5F1E7;">
  <div style="display:none; max-height:0; overflow:hidden;">
    Payment received — your tote rental is confirmed!
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F1E7; padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

        <tr>
          <td align="center" style="background-color:#1E1B18; border-radius:16px 16px 0 0; padding:28px 24px;">
            <img src="${LOGO_URL}" alt="Ready Tote Oklahoma" width="110" style="display:block; width:110px; height:auto;">
          </td>
        </tr>
        <tr><td style="background-color:#C99A32; height:5px; font-size:0; line-height:0;">&nbsp;</td></tr>

        <tr>
          <td style="background-color:#FFFFFF; padding:36px 32px; font-family: Arial, Helvetica, sans-serif; color:#1E1B18;">

            <h1 style="margin:0 0 6px; font-size:24px; line-height:1.2;">
              You're all set, ${firstName}! &#127881;
            </h1>
            <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#6B6259;">
              We've received your payment${amount ? ` of <strong style="color:#1E1B18;">${amount}</strong>` : ""} and your reservation is <strong style="color:#1E8E52;">confirmed</strong>.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background-color:#F5F1E7; border-radius:12px; border:1px solid #E5DFD2;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 12px; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#C99A32; font-weight:bold;">
                    What Happens Next
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" style="font-family: Arial, Helvetica, sans-serif;">
                    <tr>
                      <td valign="top" style="padding:4px 10px 4px 0; font-size:14px; color:#C99A32; font-weight:bold;">1.</td>
                      <td style="padding:4px 0; font-size:14px; line-height:1.6; color:#1E1B18;">We deliver clean totes to your door on your scheduled drop-off date</td>
                    </tr>
                    <tr>
                      <td valign="top" style="padding:4px 10px 4px 0; font-size:14px; color:#C99A32; font-weight:bold;">2.</td>
                      <td style="padding:4px 0; font-size:14px; line-height:1.6; color:#1E1B18;">You pack and move at your own pace</td>
                    </tr>
                    <tr>
                      <td valign="top" style="padding:4px 10px 4px 0; font-size:14px; color:#C99A32; font-weight:bold;">3.</td>
                      <td style="padding:4px 0; font-size:14px; line-height:1.6; color:#1E1B18;">We pick up the empty totes on your scheduled pickup date</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:26px 0 0; font-size:14px; line-height:1.6; color:#6B6259;">
              Need to adjust your dates or have questions? Just reply to this email or call
              <a href="tel:${PHONE_TEL}" style="color:#1E1B18; font-weight:bold; text-decoration:none;">${PHONE_DISPLAY}</a>.
            </p>
          </td>
        </tr>

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
      to: [email],
      bcc: [OWNER_EMAIL],
      reply_to: OWNER_EMAIL,
      subject: "Payment received — your tote rental is confirmed!",
      html,
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
