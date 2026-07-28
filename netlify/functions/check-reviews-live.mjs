// Scheduled function: runs daily at 13:00 UTC (8:00 AM Central during DST).
// Checks whether the Google Places API has indexed the business yet
// (separate from Google Search's Knowledge Graph, which can go live weeks earlier).
// Sends ONE notification email the first time reviews are found, then goes quiet.
//
// Env vars used (all already set up for other functions):
//   RESEND_API_KEY, RESEND_FROM, REMINDER_EMAILS (or falls back to owner email)

import { getStore } from "@netlify/blobs";

const OWNER_EMAIL = "readytoteok@gmail.com";
const NOTIFY_RECIPIENTS = (process.env.REMINDER_EMAILS || OWNER_EMAIL)
  .split(",").map(e => e.trim()).filter(Boolean);
const FROM_FALLBACK = "Ready Tote Oklahoma <booking@readytoteokc.com>";
const SITE_URL = "https://readytoteokc.com";
const FLAG_KEY = "reviewsLiveNotified";

export default async () => {
  const metaStore = getStore("meta");

  // Don't re-notify if we've already flagged this as live before
  let alreadyNotified = false;
  try {
    const flag = await metaStore.get(FLAG_KEY, { type: "json" });
    alreadyNotified = !!(flag && flag.notified);
  } catch {}

  if (alreadyNotified) {
    console.log("Already notified that reviews are live. Skipping check.");
    return new Response("Already notified", { status: 200 });
  }

  let data;
  try {
    const resp = await fetch(`${SITE_URL}/.netlify/functions/google-reviews`);
    data = await resp.json();
  } catch (e) {
    console.error("Check failed:", e.message);
    return new Response("Check failed", { status: 200 });
  }

  const isLive = !data.error && ((data.reviews && data.reviews.length > 0) || data.totalReviews > 0);

  if (!isLive) {
    console.log("Not live yet:", data.error || "no reviews returned");
    return new Response("Not live yet", { status: 200 });
  }

  // It's live! Send the one-time notification.
  const checkedDate = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit", day: "2-digit", year: "2-digit",
  });

  const html = `
  <div style="max-width:600px; margin:0 auto; font-family:Arial,sans-serif; color:#1E1B18;">
    <h1 style="font-size:20px;">🎉 Google reviews are live!</h1>
    <p style="font-size:14px; color:#6B6259;">Checked ${checkedDate}. The Places API is now returning your reviews, so the live reviews feature on your site is unblocked.</p>
    <div style="background:#F5F1E7; border-radius:10px; padding:16px; margin:20px 0;">
      <p style="margin:0 0 8px; font-size:14px;"><strong>Rating:</strong> ${data.overallRating ?? "n/a"} (${data.totalReviews ?? 0} reviews)</p>
      <p style="margin:0; font-size:13px; color:#6B6259;">No code changes needed, this was already built and waiting.</p>
    </div>
    <p style="font-size:13px; color:#6B6259;">This is a one-time notification. Daily checks have now stopped.</p>
  </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || FROM_FALLBACK,
      to: NOTIFY_RECIPIENTS,
      subject: "🎉 Your Google reviews are now live on the site",
      html,
    }),
  });

  if (!resp.ok) {
    console.error("Resend error:", resp.status, await resp.text());
    // Don't set the flag if the email failed to send, so we retry tomorrow.
    return new Response("Live, but email failed", { status: 200 });
  }

  try {
    await metaStore.setJSON(FLAG_KEY, { notified: true, date: checkedDate });
  } catch (e) {
    console.error("Failed to set notified flag:", e.message);
  }

  return new Response("Live! Notification sent.", { status: 200 });
};

export const config = {
  schedule: "0 13 * * *",
};
