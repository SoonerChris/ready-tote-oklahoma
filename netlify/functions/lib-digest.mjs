// The morning reminders email: a summary of today's reminder texts with
// tap-to-send links, sent to the owner (and Shon). Moved here from
// daily-reminders.mjs so push-alerts.mjs can send it too when Netlify's
// scheduler misses the 7 AM run.

import { getStore } from "@netlify/blobs";
import { computeReminders, rentalToICSAttachments, todayInOklahoma } from "./lib-reminders.mjs";
import { emailLayout, heading, sectionLabel, pill, button, escapeHtml, emailColors as C, SITE_URL } from "./lib-email.mjs";
import { notify } from "./lib-push.mjs";

const OWNER_EMAIL = "readytoteok@gmail.com";
// Always get the digest, on top of REMINDER_EMAILS (or the owner if unset).
const ALWAYS_CC = ["shonanderson856@gmail.com"];
const REMINDER_RECIPIENTS = [...new Set(
  [...(process.env.REMINDER_EMAILS || OWNER_EMAIL).split(","), ...ALWAYS_CC]
    .map(e => e.trim().toLowerCase()).filter(Boolean)
)];
const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";

// Builds and emails today's digest. notifyPhone: also buzz the admin app
// (only on the first try of the day, so a retry doesn't buzz twice).
// Returns { total, ok } - ok is false when Resend refused the email.
export async function sendDigest({ notifyPhone = true } = {}) {
  const store = getStore("rentals");
  const { blobs } = await store.list();
  const rentals = [];
  for (const b of blobs) {
    const r = await store.get(b.key, { type: "json" });
    if (r) rentals.push({ key: b.key, ...r });
  }

  const metaStore = getStore("meta");
  let sentFlags = {};
  try { sentFlags = (await metaStore.get("sentFlags", { type: "json" })) || {}; } catch {}
  let paidFlags = {};
  try { paidFlags = (await metaStore.get("paidFlags", { type: "json" })) || {}; } catch {}

  const rem = computeReminders(rentals, process.env.GOOGLE_REVIEW_LINK || "", sentFlags, paidFlags);
  const total = rem.delivery.length + rem.pickupTomorrow.length + rem.pickup.length + rem.review.length + rem.followup.length + rem.emailReminder.length + rem.addressCheck.length;

  if (total === 0) {
    console.log("No reminders due today.");
    return { total, ok: true };
  }

  // The same news on the phone, with the biggest groups named
  const parts = [["delivery", rem.delivery], ["pickup", [...rem.pickupTomorrow, ...rem.pickup]], ["address check", rem.addressCheck],
    ["payment nudge", [...rem.followup, ...rem.emailReminder]], ["review ask", rem.review]]
    .filter(([, l]) => l.length).map(([w, l]) => `${l.length} ${w}${l.length === 1 ? "" : "s"}`);
  if (notifyPhone) await notify("reminders", {
    title: `${total} reminder${total === 1 ? "" : "s"} today`,
    body: parts.join(", "),
    url: "/admin-reminders.html",
    tag: "reminders-" + new Date().toISOString().slice(0, 10),
  });

  // One bordered list per kind of reminder; each item shows who, where,
  // and the exact text that will go out from the dashboard.
  const card = (rows) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line}; border-radius:12px;">${rows}
      </table>`;
  const itemRow = (i, top, sub, extra = "") => `
        <tr><td style="padding:14px 16px; ${i ? `border-top:1px solid ${C.line};` : ""} font-size:14px; line-height:1.5; color:${C.ink};">
          <strong>${top}</strong><br>
          <span style="font-size:13px; color:${C.steel};">${sub}</span>${extra}
        </td></tr>`;
  const dueBadge = (r) => r.overdue ? `&nbsp;${pill("Overdue", "red")}` : "";

  const section = (title, items) => {
    if (!items.length) return "";
    const rows = items.map((r, i) => itemRow(i,
      `${escapeHtml(r.name)}${r.phone ? ` &middot; ${escapeHtml(r.phone)}` : ""}${dueBadge(r)}`,
      [r.package, r.address].filter(Boolean).map(escapeHtml).join(" &middot; "),
      r.message ? `<div style="margin-top:10px; background-color:${C.frame}; border-radius:8px; padding:10px 12px; font-size:13px; color:${C.ink};">${escapeHtml(r.message)}</div>` : ""
    )).join("");
    return `${sectionLabel(`${title} (${items.length})`, { top: 26 })}${card(rows)}`;
  };

  // Email reminders aren't tap-to-send links like texts; they're sent by
  // the dashboard itself, so this section just flags who's due.
  const emailSection = (items) => {
    if (!items.length) return "";
    const rows = items.map((r, i) => itemRow(i,
      `${escapeHtml(r.name)}${dueBadge(r)}`,
      [r.email, r.package, r.price && (String(r.price).startsWith("$") ? r.price : "$" + r.price)].filter(Boolean).map(escapeHtml).join(" &middot; ")
    )).join("");
    return `${sectionLabel(`Payment reminder emails (${items.length}), send from the dashboard`, { top: 26 })}${card(rows)}`;
  };

  const dashboardUrl = `${SITE_URL}/admin-reminders.html`;
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" });

  const html = emailLayout({
    footer: false,
    preheader: `${total} reminder${total > 1 ? "s" : ""} to handle today.`,
    body: `
            ${heading(`${total} reminder${total > 1 ? "s" : ""} to handle today`, {
              badge: pill(today, "gold"),
              lead: "Open the reminders page to send each one. Sending from there marks it done.",
            })}
            ${button(dashboardUrl, "Open reminders")}
            ${section("Confirm pickup address", rem.addressCheck)}
            ${section("Delivery tomorrow", rem.delivery)}
            ${section("Pickup tomorrow", rem.pickupTomorrow)}
            ${section("Pickup in 2 days", rem.pickup)}
            ${section("Review requests", rem.review)}
            ${section("Invoice follow-ups", rem.followup)}
            ${emailSection(rem.emailReminder)}`,
  });

  // Collect ICS calendar attachments for delivery + pickup reminders
  const attachments = [];
  const seen = new Set();
  for (const r of [...rem.delivery, ...rem.pickupTomorrow, ...rem.pickup]) {
    const id = (r.key || r.phone + r.dropoffDate);
    if (seen.has(id)) continue;
    seen.add(id);
    attachments.push(...rentalToICSAttachments(r));
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || FROM_FALLBACK,
      to: REMINDER_RECIPIENTS,
      subject: `${total} reminder${total > 1 ? "s" : ""} to handle today | Ready Tote Oklahoma`,
      html,
      attachments: attachments.length ? attachments : undefined,
    }),
  });

  if (!resp.ok) {
    console.error("Resend error:", resp.status, await resp.text());
    return { total, ok: false };
  }
  console.log(`Digest sent: ${total} reminders.`);
  return { total, ok: true };
}

// Once a day, whoever gets there first: the 7 AM scheduled run
// (daily-reminders.mjs) or the 15-minute catch-up in push-alerts.mjs, for
// mornings Netlify's scheduler skips a run. What happened is kept in the
// "meta" store under "digestRun": { on: date, ok, tries }. A failed send is
// retried up to MAX_TRIES times.
const MAX_TRIES = 3;
export async function runDigestOnce(source) {
  const meta = getStore("meta");
  const today = todayInOklahoma();
  let last = null;
  try { last = await meta.get("digestRun", { type: "json" }); } catch {}
  if (last && last.on === today && (last.ok || last.tries >= MAX_TRIES)) return { skipped: true };
  const tries = last && last.on === today ? last.tries + 1 : 1;
  // Claim the day before sending, so two runs can't both send
  await meta.setJSON("digestRun", { on: today, ok: false, tries, source, at: new Date().toISOString() });
  let result = { total: 0, ok: false };
  try { result = await sendDigest({ notifyPhone: tries === 1 }); }
  catch (e) { console.error("Digest failed:", e.message); }
  await meta.setJSON("digestRun", { on: today, ok: result.ok, tries, source, total: result.total, at: new Date().toISOString() });
  if (source !== "schedule") console.log(`Digest caught up by ${source}: ${result.total} reminders, ok=${result.ok}.`);
  return result;
}
