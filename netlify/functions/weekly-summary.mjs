// Scheduled function: the Monday summary email (lib-weekly.mjs) at 7 AM
// Oklahoma time. Netlify schedules are in UTC and sometimes skip a run, so
// it's tried every hour from 12:15 to 16:15 UTC on Mondays and sends on the
// first try that's 7 AM or later in Oklahoma; "weeklyRun" in the meta store
// ({ on: date, ok }) keeps it to one a week. Off with the Automation switch
// (settings weeklySummary).

import { getStore } from "@netlify/blobs";
import { sendWeeklySummary } from "./lib-weekly.mjs";
import { todayInOklahoma } from "./lib-reminders.mjs";
import { getSettings } from "./settings.mjs";

const SEND_HOUR = 7;

export default async () => {
  const now = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  if (p.weekday !== "Mon") return new Response("Not Monday in Oklahoma", { status: 200 });
  if (Number(p.hour) < SEND_HOUR) return new Response(`Too early (${p.hour}:00 in Oklahoma)`, { status: 200 });
  if (!(await getSettings()).weeklySummary) return new Response("Switched off", { status: 200 });

  const meta = getStore({ name: "meta", consistency: "strong" });
  const today = todayInOklahoma();
  let last = null;
  try { last = await meta.get("weeklyRun", { type: "json" }); } catch {}
  if (last && last.on === today && (last.ok || last.tries >= 3)) return new Response("Already sent this week", { status: 200 });
  const tries = last && last.on === today ? last.tries + 1 : 1;
  await meta.setJSON("weeklyRun", { on: today, ok: false, tries, at: now.toISOString() });
  let r = { ok: false };
  try { r = await sendWeeklySummary(); } catch (e) { console.error("Weekly summary failed:", e.message); }
  await meta.setJSON("weeklyRun", { on: today, ok: r.ok, tries, at: new Date().toISOString() });
  return new Response(`Weekly summary ${r.ok ? "sent" : "failed"}`, { status: 200 });
};

export const config = {
  schedule: "15 12-16 * * 1",
};
