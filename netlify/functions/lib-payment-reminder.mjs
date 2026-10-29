// Payment reminder email for an unpaid invoice: the same Stripe pay link
// as the invoice, with the rental details. Used by the "Send reminder"
// button (send-payment-reminder.mjs) and, once a day, by the morning run
// (lib-digest.mjs), which emails the ones that just came due when the
// Automation switch is on (settings.mjs autoPaymentEmail).
//
// Env vars: RESEND_API_KEY, RESEND_FROM

import { getRecipients } from "./lib-recipients.mjs";
import { getStore } from "@netlify/blobs";
import { friendlyTime, dropoffAddressOf, pickupAddressOf, computeReminders, todayInOklahoma } from "./lib-reminders.mjs";
import { emailLayout, heading, pill, detailsCard, button, contactLine, cleanLineItems, lineItemRows, htmlToText } from "./lib-email.mjs";
import { getSettings } from "./settings.mjs";

const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";
const OWNER_EMAIL = "readytoteok@gmail.com";

// Why a reminder email can't go out for this rental, or null
export function reminderProblem(rental) {
  if (!rental.email) return "This rental has no email on file";
  if (!rental.stripeUrl) return "No payment link saved for this rental — resend the invoice instead";
  if (!/^https:\/\/([a-z0-9-]+\.)?stripe\.com\//.test(String(rental.stripeUrl))) return "Saved payment link is invalid";
  return null;
}

// Sends it and records the sent flag ("emailReminder:<key>", the same
// flags the texts use). Returns { ok } or { ok: false, status, error }.
export async function emailPaymentReminder(key, rental) {
  const problem = reminderProblem(rental);
  if (problem) return { ok: false, status: 400, error: problem };
  const stripeUrl = String(rental.stripeUrl);

  const name = escapeHtml(rental.name || "there");
  const firstName = name.split(" ")[0];
  const pkg = escapeHtml(rental.package || "");
  const rawPrice = String(rental.price || "").trim();
  const price = escapeHtml(rawPrice ? (rawPrice.startsWith("$") ? rawPrice : "$" + rawPrice) : "");
  const dropoffKnown = !!(rental.dropoffDate && rental.dropoffTime);
  const dropoff = dropoffKnown ? `${formatDate(rental.dropoffDate)} at ${escapeHtml(friendlyTime(rental.dropoffTime))}` : "";
  const pickup = rental.pickupDate ? formatDate(rental.pickupDate) + (rental.pickupTime ? ` at ${escapeHtml(friendlyTime(rental.pickupTime))}` : "") : "";
  const self = rental.serviceType === "self";
  const dAddr = dropoffAddressOf(rental), pAddr = pickupAddressOf(rental);
  const addrRows = self ? [] : dAddr && dAddr === pAddr ? [["Address", escapeHtml(dAddr)]]
    : [dAddr ? ["Drop-off address", escapeHtml(dAddr)] : null, pAddr ? ["Pickup address", escapeHtml(pAddr)] : null];

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
                dropoffKnown ? [self ? "Pick up totes" : "Drop-off", dropoff] : null,
                pickup ? [self ? "Return totes" : "Pickup", pickup] : null,
                ...addrRows,
                ...lineItemRows(cleanLineItems(rental.lineItems), rental.price),
              ],
              total: price ? ["Total due", price] : null,
            })}
            ${button(stripeUrl, "Complete reservation", { note: "Secure payment by Stripe" })}
            <p style="margin:0; font-size:14px; line-height:1.6; color:#6B6259; text-align:center;"><strong style="color:#1E1B18;">Plans changed?</strong> Just reply and we'll release your dates. No hard feelings.</p>
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
      bcc: await getRecipients("copies"),   // App & alerts → Who gets emails
      reply_to: OWNER_EMAIL,
      subject: "Quick reminder: your tote rental invoice | Ready Tote Oklahoma",
      html,
      text: htmlToText(html),
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Resend API error:", resp.status, errText);
    return { ok: false, status: 502, error: errText };
  }

  try {
    const metaStore = getStore({ name: "meta", consistency: "strong" });
    let flags = {};
    try { flags = (await metaStore.get("sentFlags", { type: "json" })) || {}; } catch {}
    flags["emailReminder:" + key] = new Date().toISOString();
    await metaStore.setJSON("sentFlags", flags);
  } catch (e) {
    console.error("Payment reminder: failed to record sent flag (email still sent):", e.message);
  }
  return { ok: true };
}

// Morning run: email every payment reminder that came due today (or
// yesterday, in case a run was missed). Older overdue ones stay on
// Reminders for you to decide. Returns [{ key, name }] of the ones sent.
export async function autoPaymentReminders(rentals, sentFlags, paidFlags) {
  if (!(await getSettings()).autoPaymentEmail) return [];
  const today = todayInOklahoma();
  const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  const due = computeReminders(rentals, "", sentFlags, paidFlags).emailReminder
    .filter((r) => r.key && r.dueDate >= yesterday && !reminderProblem(r));
  const sent = [];
  for (const r of due) {
    const res = await emailPaymentReminder(r.key, r);
    if (res.ok) sent.push({ key: r.key, name: r.name || "" });
  }
  return sent;
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
