// Netlify event-triggered function.
// The name "submission-created" is special: Netlify runs it automatically
// every time a verified form submission comes in.
//
// Env vars required:
//   RESEND_API_KEY - Resend API key
//   RESEND_FROM    - verified sender, e.g. "Ready Tote Oklahoma <booking@readytoteokc.com>"

import { getStore } from "@netlify/blobs";
import { emailLayout, heading, pill, detailsCard, steps, callout, contactLine, htmlToText, PHONE_DISPLAY } from "./lib-email.mjs";
import { notify } from "./lib-push.mjs";
import { checkDistance } from "./lib-distance.mjs";

const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";
const OWNER_EMAIL = "readytoteok@gmail.com";

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
  const isMilitary = data.is_military === "true";
  // "I'll pick up and return the totes myself" on the booking form
  const selfPickup = data.self_pickup === "true";
  const militaryIdKey = data.military_id_key || "";
  // Optional partner promo code; checked by hand before invoicing
  const promoCode = String(data.promo_code || "").trim().slice(0, 40);
  // Optional "How did you hear about us?" answer (marketing attribution only)
  const howHeard = String(data.how_heard || "").trim().slice(0, 60);

  // The booking form now collects one "Delivery Address" text box
  // (delivery_address). Submissions from before that change sent
  // street/city/state/zip separately, so accept either shape. The raw
  // text is also kept under the legacy deliveryAddress field, which the
  // admin pages already fall back to (see deliveryAddressOf in admin-shared.js).
  const rawAddress = String(data.delivery_address || "").trim();
  const addr = rawAddress
    ? splitAddress(rawAddress)
    : {
        street: data.delivery_address_street || "",
        city: data.delivery_address_city || "",
        state: data.delivery_address_state || "",
        zip: data.delivery_address_zip || "",
      };

  const from = process.env.RESEND_FROM || FROM_FALLBACK;
  const addressLine = rawAddress || [addr.street, addr.city, [addr.state, addr.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  // "No preference" isn't worth showing back to them
  const windowOf = (w) => (w && !/no preference/i.test(w) ? escapeHtml(w) : "");

  // How far the delivery is (free area or a mileage charge, lib-distance.mjs).
  // Never blocks the request: no answer just means it isn't flagged.
  const distance = !selfPickup && addressLine ? await checkDistance(addressLine) : null;

  // Persist the request itself so it shows up in the Booking Requests admin
  // page, instead of only existing as a Netlify notification email. Never
  // let a storage hiccup block the customer auto-reply below.
  try {
    const store = getStore({ name: "requests", consistency: "strong" });
    const emailPart = String(customerEmail).replace(/[^a-zA-Z0-9@.]/g, "");
    const dateKey = data.delivery_date || "no-date";
    const key = `${dateKey}_${emailPart}_${Date.now()}`;
    await store.setJSON(key, {
      name: data.name || "",
      email: customerEmail,
      phone: data.phone || "",
      package: data.package || "",
      deliveryDate: data.delivery_date || "",
      pickupDate: data.pickup_date || "",
      deliveryWindow: data.delivery_window || "",
      pickupWindow: data.pickup_window || "",
      deliveryAddress: rawAddress,
      deliveryAddressStreet: addr.street,
      deliveryAddressCity: addr.city,
      deliveryAddressState: addr.state,
      deliveryAddressZip: addr.zip,
      isMilitary,
      serviceType: selfPickup ? "self" : "delivery",
      militaryIdKey,
      promoCode,
      howHeard,
      ...(distance ? { distance } : {}),
      status: "new",
      submittedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Booking request log failed (auto-reply still sent):", e.message);
  }

  // Buzz the admin app (never blocks the customer's auto-reply)
  await notify("requests", {
    title: "New booking request",
    body: [data.name || "Someone", data.package || "", selfPickup ? "self pickup" : "", data.delivery_date ? "delivery " + (formatDate(data.delivery_date) || data.delivery_date) : "",
      distance && distance.zone === "outside" ? `${distance.miles} mi, outside the free area` : ""].filter(Boolean).join(" · "),
    url: "/admin-requests.html",
    tag: "request-" + Date.now(),
  });

  // Only shown when the "military discount" checkbox was checked. If they
  // already uploaded a photo on the booking form (militaryIdKey set), just
  // confirm we have it. If they checked the box but skipped the upload,
  // ask for it here so it isn't a follow-up email later.
  const militaryBlock = !isMilitary ? "" : militaryIdKey
    ? callout("<strong>Military discount:</strong> We got your ID photo. Thank you for your service! We'll verify it and apply the discount to your invoice.", "plain")
    : callout("<strong>Military discount:</strong> Looks like you qualify. Thank you for your service! To apply it, add a photo of your military ID (active duty, veteran, or immediate family) on the confirm page we text you, or reply to this email with it. We'll take care of the rest.", "gold");

  const html = emailLayout({
    preheader: "We got your booking request and will confirm your dates shortly. No payment is due yet.",
    body: `
            ${heading(`Request received, ${firstName}`, {
              badge: pill("Request received", "green"),
              lead: `Thanks for choosing Ready Tote Oklahoma. We'll text you from <strong style="color:#1E1B18;">${PHONE_DISPLAY}</strong> to confirm your dates. <strong style="color:#1E1B18;">No payment is due yet.</strong>`,
            })}
            ${detailsCard({
              label: "Your request",
              rows: [["Package", pkg],
                ["Delivery", deliveryDate + (windowOf(data.delivery_window) ? `<br><span style="font-weight:400; color:#6B6259;">${windowOf(data.delivery_window)}</span>` : "")],
                ["Pickup", pickupDate + (windowOf(data.pickup_window) ? `<br><span style="font-weight:400; color:#6B6259;">${windowOf(data.pickup_window)}</span>` : "")],
                selfPickup ? ["Service", "You pick up and return the totes"] : addressLine ? ["Address", escapeHtml(addressLine)] : null,
                promoCode ? ["Promo code", `${escapeHtml(promoCode)} (we'll apply it on your invoice)`] : null],
            })}
            <p style="margin:10px 0 0; font-size:13px; color:#6B6259;">Something look wrong? Just reply and we'll fix it.</p>
${militaryBlock}
            ${steps([
              "We check availability and text you to confirm",
              "Tap the link in that text (or reply YES)",
              "Your invoice arrives by email",
              selfPickup ? "You pick up clean totes on your date" : "Clean totes arrive at your door, with free delivery",
            ])}
            ${contactLine("Questions in the meantime?")}`,
  });

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
      subject: `We got your request, ${data.name ? String(data.name).split(" ")[0] : "thanks"}! | Ready Tote Oklahoma`,
      html,
      text: htmlToText(html),
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

// Best-effort split of a one-line address into street/city/state/zip so
// the admin edit panel and invoice prefill get separate fields.
//   "123 Main St, Moore, OK 73160"  -> 123 Main St | Moore | OK | 73160
//   "123 Main St Apt 4, Norman"     -> 123 Main St Apt 4 | Norman | OK | ""
//   "123 Main St Moore OK 73160"    -> 123 Main St Moore | "" | OK | 73160
// Without commas, city can't be told apart from the street, so it stays in
// street (still displays correctly). State defaults to OK (service area).
// The customer's original text is always saved alongside as deliveryAddress.
function splitAddress(raw) {
  let rest = String(raw || "").replace(/\s+/g, " ").trim();
  const out = { street: "", city: "", state: "OK", zip: "" };
  if (!rest) return out;

  const zipM = rest.match(/[,\s]*\b(\d{5})(?:-\d{4})?\s*$/);
  if (zipM) { out.zip = zipM[1]; rest = rest.slice(0, zipM.index).trim(); }

  // Only strip an explicit Oklahoma marker; other 2-letter endings like
  // "St", "Ct", "Dr" are street suffixes, not states.
  const stM = rest.match(/(?:^|[,\s])(ok|okla\.?|oklahoma)\s*,?\s*$/i);
  if (stM) rest = rest.slice(0, stM.index).trim();
  rest = rest.replace(/,\s*$/, "").trim();

  const lastComma = rest.lastIndexOf(",");
  if (lastComma > 0) {
    out.street = rest.slice(0, lastComma).trim();
    out.city = rest.slice(lastComma + 1).trim();
  } else {
    out.street = rest;
  }
  return out;
}
