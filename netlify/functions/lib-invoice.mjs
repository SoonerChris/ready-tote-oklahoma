// Invoices: the branded invoice email with a Stripe payment button, plus the
// rental record that reminders, Inventory and Finance all read.
//
// sendInvoice(data) is shared by send-invoice.mjs (the Send Invoice page)
// and confirm-booking.mjs (automatic invoices when a customer confirms).
// autoInvoicePlan(request, ...) decides whether a confirmed booking request
// is simple enough to invoice without a person checking it first.

import { getStore } from "@netlify/blobs";
import { rentalToICSAttachments } from "./lib-reminders.mjs";
import { emailLayout, heading, pill, detailsCard, button, contactLine, cleanLineItems, lineItemRows, callout, htmlToText, SITE_URL } from "./lib-email.mjs";

const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";
const OWNER_EMAIL = "readytoteok@gmail.com";

const REQUIRED = ["email", "name", "phone", "package", "duration", "price", "dropoffDate", "dropoffTime", "pickupDate", "pickupTime", "dropoffAddress", "pickupAddress", "stripeUrl"];

// toteCount/dollyCount drive Inventory math directly, so they're validated
// as real whole numbers here rather than parsed out of the package text.
function parseCount(value, fieldName) {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldName} must be a whole number (0 or more)`);
  }
  return n;
}

// Sends the invoice email and logs the rental.
// Returns { ok: true, key } or { ok: false, status, error }.
export async function sendInvoice(body) {
  for (const f of REQUIRED) {
    if (!body[f]) return { ok: false, status: 400, error: `Missing field: ${f}` };
  }
  let toteCount, dollyCount;
  try {
    toteCount = parseCount(body.toteCount, "toteCount");
    dollyCount = parseCount(body.dollyCount, "dollyCount");
  } catch (e) {
    return { ok: false, status: 400, error: e.message };
  }

  const name = escapeHtml(body.name);
  const firstName = name.split(" ")[0];
  const pkg = escapeHtml(body.package);
  const duration = escapeHtml(body.duration);
  const rawPrice = String(body.price).trim();
  const price = escapeHtml(rawPrice.startsWith("$") ? rawPrice : "$" + rawPrice);
  // Package / rush / military lines, only when they add up to the price
  let lineItems = cleanLineItems(body.lineItems);
  const priceNum = parseFloat(rawPrice.replace(/[^0-9.]/g, ""));
  if (lineItems && !(Math.abs(lineItems.reduce((t, i) => t + i.amount, 0) - priceNum) < 0.01)) lineItems = null;
  const dropoff = `${formatDate(body.dropoffDate)} at ${escapeHtml(body.dropoffTime)}`;
  const pickup = `${formatDate(body.pickupDate)} at ${escapeHtml(body.pickupTime)}`;
  const dropoffAddress = escapeHtml(body.dropoffAddress);
  const pickupAddress = escapeHtml(body.pickupAddress);
  const sameAddress = body.dropoffAddress === body.pickupAddress;
  const selfService = body.serviceType === "self";
  const stripeUrl = String(body.stripeUrl);
  if (!/^https:\/\/([a-z0-9-]+\.)?stripe\.com\//.test(stripeUrl)) {
    return { ok: false, status: 400, error: "stripeUrl must be a stripe.com link" };
  }

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
                ...lineItemRows(lineItems),
              ],
              total: ["Total due", price],
            })}
            ${button(stripeUrl, "Complete reservation", { note: "Secure payment by Stripe" })}
            ${callout(`<strong>${selfService ? "Pick-up and return" : "Drop-off and pickup"} are attached.</strong> Tap them to add to your calendar.<br>Free to cancel or reschedule up to 48 hours before ${selfService ? "your pick-up" : "delivery"}.`, "plain")}
            ${contactLine("Need to change anything?")}`,
  });

  // Generate calendar event attachments
  const icsAttachments = rentalToICSAttachments(body, { forCustomer: true });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || FROM_FALLBACK,
      to: [body.email],
      bcc: [OWNER_EMAIL],
      reply_to: OWNER_EMAIL,
      subject: `Your Ready Tote invoice, ${String(body.name).split(" ")[0]} (${rawPrice.startsWith("$") ? rawPrice : "$" + rawPrice})`,
      html,
      text: htmlToText(html),
      attachments: icsAttachments,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Resend API error:", resp.status, errText);
    return { ok: false, status: 502, error: errText };
  }

  // Log the rental so reminders and review requests can find it. The key
  // goes back to the caller so it can mark the "invoice sent" text for it.
  let key = null;
  try {
    const store = getStore({ name: "rentals", consistency: "strong" });
    key = `${body.dropoffDate}_${body.email.replace(/[^a-zA-Z0-9@.]/g, "")}_${Date.now()}`;
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
      isRush: !!body.isRush,
      ...(body.promoCode ? { promoCode: String(body.promoCode).trim().slice(0, 40) } : {}),
      ...(lineItems ? { lineItems } : {}),
      militaryIdKey: body.militaryIdKey || "",
      ...(body.autoInvoiced ? { autoInvoiced: true } : {}),
    });
  } catch (e) {
    console.error("Rental log failed (invoice still sent):", e.message);
    key = null;
  }

  return { ok: true, key };
}

// ---- Automatic invoices ----
// A confirmed request is invoiced on its own only when nothing about it
// needs a person: a standard package, the standard two weeks, no rush fee,
// no military or promo discount, a full address, dates ahead, and stock.
// Anything else waits on Requests as "Ready to invoice", with the reason.

const STANDARD_DAYS = 14;
// Same starting times the Send Invoice page uses for the customer's window
const WINDOW_TIME = { morning: "09:00", afternoon: "13:00", evening: "17:00" };
const DEFAULT_TIME = "10:00";
const timeFor = (w) => { const m = String(w || "").toLowerCase().match(/morning|afternoon|evening/); return m ? WINDOW_TIME[m[0]] : null; };

const shift = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const okToday = (at = new Date()) => at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

// The package list the booking form and Send Invoice page use (packages.json)
export async function loadPackages() {
  const resp = await fetch(`${SITE_URL}/packages.json`, { headers: { "Cache-Control": "no-cache" } });
  if (!resp.ok) throw new Error("packages.json " + resp.status);
  return (await resp.json()).packages || [];
}

// Rush rule shared with the site: delivery less than 24 hours after the
// request came in (isRushBooking in admin-shared.js).
function isRush(submittedAt, deliveryDate, time) {
  if (!submittedAt || !deliveryDate) return false;
  const delivery = chicagoTime(deliveryDate, time || "12:00"), sent = new Date(submittedAt);
  if (isNaN(delivery) || isNaN(sent)) return false;
  return (delivery - sent) / 36e5 < 24;
}

// A date and clock time in Oklahoma as a real moment (CDT or CST as it falls)
function chicagoTime(date, time) {
  const asUtc = new Date(`${date}T${time}:00Z`);
  if (isNaN(asUtc)) return asUtc;
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" })
    .formatToParts(asUtc).find((p) => p.type === "timeZoneName")?.value || "GMT-6";
  const hours = Number((tz.match(/GMT([+-]\d+)/) || [, -6])[1]);
  return new Date(asUtc.getTime() - hours * 36e5);
}

// Returns { ok: true, invoice } with the sendInvoice() data, or
// { ok: false, reasons: [...] } in plain words for the admin alert.
// availability: computeAvailability() output (the request already holds its
// totes there); rentals: existing rentals, for the duplicate check.
export function autoInvoicePlan(req, packages, { availability = null, rentals = [], now = new Date() } = {}) {
  const reasons = [];
  const text = String(req.package || "");
  const pkg = packages.find((p) => p.name && text.toLowerCase().includes(p.name.toLowerCase()));
  if (!pkg) reasons.push("package isn't a standard one");
  else if (!pkg.stripeUrl) reasons.push("package has no Stripe link");
  else if (pkg.price && /\$\d/.test(text) && !text.includes(pkg.price)) reasons.push("price on the request doesn't match the package");
  if (req.promoCode) reasons.push(`promo code ${req.promoCode}`);
  if (req.isMilitary) reasons.push("military discount (check the ID)");
  if (!req.email) reasons.push("no email");
  if (!req.name || !req.phone) reasons.push("missing name or phone");
  if (!req.deliveryDate || !req.pickupDate) reasons.push("missing dates");
  else {
    if (req.deliveryDate < okToday(now)) reasons.push("delivery date has passed");
    if (shift(req.deliveryDate, STANDARD_DAYS) !== req.pickupDate) reasons.push("not the standard 2 weeks");
  }
  const self = req.serviceType === "self";
  const dropoffTime = timeFor(req.deliveryWindow) || DEFAULT_TIME;
  const pickupTime = timeFor(req.pickupWindow) || DEFAULT_TIME;
  if (req.deliveryDate && isRush(req.submittedAt, req.deliveryDate, dropoffTime)) reasons.push("rush fee applies");
  const street = req.deliveryAddressStreet, city = req.deliveryAddressCity, state = req.deliveryAddressState, zip = req.deliveryAddressZip;
  if (!self && !(street && city && state && zip)) reasons.push("address needs checking");
  if (availability && pkg && req.deliveryDate && req.pickupDate) {
    const days = (availability.days || []).filter((d) => d.date >= req.deliveryDate && d.date <= req.pickupDate);
    if (days.some((d) => d.available < 0)) reasons.push("not enough totes on those dates");
    if (availability.dolliesTracked && days.some((d) => d.dolliesAvailable < 0)) reasons.push("not enough dollies on those dates");
  }
  const email = String(req.email || "").toLowerCase();
  if (email && rentals.some((r) => !r.cancelled && String(r.email || "").toLowerCase() === email && r.dropoffDate === req.deliveryDate)) {
    reasons.push("this customer already has a rental starting that day");
  }
  if (reasons.length) return { ok: false, reasons };

  const notes = [req.reviewNotes,
    req.deliveryWindow && !/no preference/i.test(req.deliveryWindow) ? `Delivery pref: ${req.deliveryWindow}.` : "",
    req.pickupWindow && !/no preference/i.test(req.pickupWindow) ? `Pickup pref: ${req.pickupWindow}.` : ""].filter(Boolean).join(" ");
  const address = self ? "" : `${street}, ${city}, ${String(state).toUpperCase()} ${zip}`;
  return {
    ok: true,
    invoice: {
      name: req.name, email: req.email, phone: req.phone,
      package: pkg.name, duration: pkg.duration || "2 Weeks", price: pkg.price,
      toteCount: pkg.toteCount, dollyCount: pkg.dollyCount, stripeUrl: pkg.stripeUrl,
      dropoffDate: req.deliveryDate, dropoffTime, pickupDate: req.pickupDate, pickupTime,
      serviceType: self ? "self" : "delivery",
      dropoffAddress: self ? "Customer pickup" : address,
      pickupAddress: self ? "Customer return" : address,
      notes, isMilitary: false, isRush: false,
      militaryIdKey: req.militaryIdKey || "",
      autoInvoiced: true,
    },
  };
}

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
