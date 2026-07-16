// Netlify event-triggered function.
// The name "submission-created" is special: Netlify runs it automatically
// every time a verified form submission comes in.
//
// Env vars required:
//   RESEND_API_KEY - Resend API key
//   RESEND_FROM    - verified sender, e.g. "Ready Tote Oklahoma <booking@readytoteokc.com>"

const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";
const OWNER_EMAIL = "readytoteok@gmail.com";
const SITE_URL = "https://readytoteokc.com";
const LOGO_URL = `${SITE_URL}/images/logo.png`;
const PHONE_DISPLAY = "580.399.3202";
const PHONE_TEL = "+15803993202";

export default async (request) => {
  const body = await request.json();
  const data = body?.payload?.data || {};

  const formName = body?.payload?.form_name;
  if (formName && formName !== "booking") {
    return new Response("Ignored non-booking form", { status: 200 });
  }

  const customerEmail = data.email;
  if (!customerEmail) {
    return new Response("No customer email in submission", { status: 200 });
  }

  const name = escapeHtml(data.name || "there");
  const firstName = name.split(" ")[0];
  const pkg = escapeHtml(data.package || "your selected package");
  const deliveryDate = formatDate(data.delivery_date) || "your requested date";
  const pickupDate = formatDate(data.pickup_date) || "your requested date";

  const from = process.env.RESEND_FROM || FROM_FALLBACK;

  const html = `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0; padding:0; background-color:#F5F1E7;">
  <div style="display:none; max-height:0; overflow:hidden;">
    We got your booking request — we'll confirm your dates shortly. No payment due yet.
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

        <!-- Gold divider -->
        <tr><td style="background-color:#C99A32; height:5px; font-size:0; line-height:0;">&nbsp;</td></tr>

        <!-- Body -->
        <tr>
          <td style="background-color:#FFFFFF; padding:36px 32px; font-family: Arial, Helvetica, sans-serif; color:#1E1B18;">

            <h1 style="margin:0 0 6px; font-size:24px; line-height:1.2;">
              Request received, ${firstName}! &#9989;
            </h1>
            <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:#6B6259;">
              Thanks for choosing Ready Tote Oklahoma. We'll reach out shortly to confirm
              your dates and send your invoice. <strong style="color:#1E1B18;">No payment is due yet.</strong>
            </p>

            <!-- Details card -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="background-color:#F5F1E7; border-radius:12px; border:1px solid #E5DFD2;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 14px; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#C99A32; font-weight:bold; font-family: Arial, Helvetica, sans-serif;">
                    Your Request
                  </p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, Helvetica, sans-serif;">
                    <tr>
                      <td style="padding:6px 0; font-size:14px; color:#6B6259; width:150px;">Package</td>
                      <td style="padding:6px 0; font-size:14px; color:#1E1B18; font-weight:bold;">${pkg}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0; font-size:14px; color:#6B6259;">Delivery</td>
                      <td style="padding:6px 0; font-size:14px; color:#1E1B18; font-weight:bold;">${deliveryDate}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0; font-size:14px; color:#6B6259;">Pickup</td>
                      <td style="padding:6px 0; font-size:14px; color:#1E1B18; font-weight:bold;">${pickupDate}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- What happens next -->
            <p style="margin:28px 0 10px; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#C99A32; font-weight:bold;">
              What Happens Next
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="font-family: Arial, Helvetica, sans-serif;">
              <tr>
                <td valign="top" style="padding:4px 10px 4px 0; font-size:14px; color:#C99A32; font-weight:bold;">1.</td>
                <td style="padding:4px 0; font-size:14px; line-height:1.6; color:#1E1B18;">We confirm your dates &amp; availability</td>
              </tr>
              <tr>
                <td valign="top" style="padding:4px 10px 4px 0; font-size:14px; color:#C99A32; font-weight:bold;">2.</td>
                <td style="padding:4px 0; font-size:14px; line-height:1.6; color:#1E1B18;">You receive an invoice by email</td>
              </tr>
              <tr>
                <td valign="top" style="padding:4px 10px 4px 0; font-size:14px; color:#C99A32; font-weight:bold;">3.</td>
                <td style="padding:4px 0; font-size:14px; line-height:1.6; color:#1E1B18;">Clean totes arrive at your door &mdash; free delivery</td>
              </tr>
            </table>

            <p style="margin:28px 0 0; font-size:14px; line-height:1.6; color:#6B6259;">
              Questions in the meantime? Just reply to this email or call
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
      to: [customerEmail],
      reply_to: OWNER_EMAIL,
      subject: "Booking request received — Ready Tote Oklahoma",
      html,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Resend API error:", resp.status, errText);
    return new Response("Auto-reply failed, logged", { status: 200 });
  }

  return new Response("Auto-reply sent", { status: 200 });
};

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// "2026-07-20" -> "Monday, July 20, 2026"
function formatDate(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate + "T12:00:00");
  if (isNaN(d)) return escapeHtml(isoDate);
  return d.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}
