// Scheduled function: runs daily at 12:00 UTC (7:00 AM Central during DST,
// 6:00 AM in winter). Emails the owner a summary of today's reminder texts
// with tap-to-send links (lib-digest.mjs). If Netlify skips this run,
// push-alerts.mjs sends it within 15 minutes after 7:20 AM instead.

import { runDigestOnce } from "./lib-digest.mjs";

export default async () => {
  const r = await runDigestOnce("schedule");
  return new Response(r.skipped ? "Already sent today" : `Digest: ${r.total} reminders`, { status: 200 });
};

export const config = {
  schedule: "0 12 * * *",
};
