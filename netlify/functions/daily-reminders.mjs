// Scheduled function: emails the owner a summary of today's reminder texts
// with tap-to-send links, or a short "nothing due" note (lib-digest.mjs),
// at 7:00 AM Oklahoma time all year. Netlify schedules are in UTC, so it
// runs at 12:00 and 13:00 UTC and sends on whichever one is 7 AM in
// Oklahoma (12:00 in summer, 13:00 in winter); runDigestOnce keeps it to
// one a day. If Netlify skips the run, push-alerts.mjs sends it within
// 15 minutes after 7:20 AM instead.

import { runDigestOnce } from "./lib-digest.mjs";

const SEND_HOUR = 7;

export default async () => {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (hour < SEND_HOUR) return new Response(`Too early (${hour}:00 in Oklahoma)`, { status: 200 });
  const r = await runDigestOnce("schedule");
  return new Response(r.skipped ? "Already sent today" : `Digest: ${r.total} reminders`, { status: 200 });
};

export const config = {
  schedule: "0 12,13 * * *",
};
