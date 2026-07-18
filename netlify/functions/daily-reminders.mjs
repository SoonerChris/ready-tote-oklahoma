// Scheduled function: runs daily at 12:00 UTC (7:00 AM Central during DST).
// Emails the owner a summary of today's reminder texts with tap-to-send links.

import { getStore } from "@netlify/blobs";
import { computeReminders } from "./lib-reminders.mjs";

const OWNER_EMAIL = "readytoteok@gmail.com";
const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";

export default async () => {
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

  const rem = computeReminders(rentals, process.env.GOOGLE_REVIEW_LINK || "", sentFlags);
  const total = rem.delivery.length + rem.pickup.length + rem.review.length;

  if (total === 0) {
    console.log("No reminders due today.");
    return new Response("No reminders today", { status: 200 });
  }

  const section = (title, items) => {
    if (!items.length) return "";
    const rows = items.map(r => `
      <tr>
        <td style="padding:10px 14px; border:1px solid #E5DFD2; font-family:Arial,sans-serif; font-size:14px;">
          <strong>${r.name}</strong> — ${r.phone}<br>
          <span style="color:#6B6259; font-size:12px;">${r.package} · ${r.address}</span><br>
          <a href="${r.sms}" style="display:inline-block; margin-top:8px; background:#C99A32; color:#1E1B18; font-weight:bold; text-decoration:none; padding:8px 16px; border-radius:8px; font-size:13px;">Tap to text ${r.name.split(" ")[0]}</a>
        </td>
      </tr>`).join("");
    return `
      <h2 style="font-family:Arial,sans-serif; font-size:16px; color:#1E1B18; margin:24px 0 8px;">${title} (${items.length})</h2>
      <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">${rows}</table>`;
  };

  const html = `
  <div style="max-width:600px; margin:0 auto; font-family:Arial,sans-serif; color:#1E1B18;">
    <h1 style="font-size:20px;">Today's reminders — ${total} text${total > 1 ? "s" : ""} to send</h1>
    <p style="color:#6B6259; font-size:14px;">Open this on your phone and tap each button. Messages are pre-filled — just hit send.</p>
    ${section("🚚 Delivery tomorrow", rem.delivery)}
    ${section("📦 Pickup in 2 days", rem.pickup)}
    ${section("⭐ Review requests", rem.review)}
    <p style="color:#9A938A; font-size:12px; margin-top:24px;">Full dashboard: readytoteokc.com/admin-reminders.html</p>
  </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || FROM_FALLBACK,
      to: [OWNER_EMAIL],
      subject: `${total} reminder text${total > 1 ? "s" : ""} to send today — Ready Tote`,
      html,
    }),
  });

  if (!resp.ok) console.error("Resend error:", resp.status, await resp.text());
  return new Response("Summary sent", { status: 200 });
};

export const config = {
  schedule: "0 12 * * *",
};
