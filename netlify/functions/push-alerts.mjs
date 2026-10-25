// Scheduled function: runs every 15 minutes. Sends two kinds of phone
// notifications to the admin Home Screen app (see lib-push.mjs):
//
//   soon  - a delivery or pickup starts within the hour. Uses the rental's
//           drop-off/pickup time; rentals with no time set, and stops
//           already marked delivered or picked up, are skipped.
//   stock - totes (or dollies) run low in the next 30 days. Checked once a
//           day from 7 AM, and only sent when the picture has changed since
//           the last alert, so the same shortage doesn't buzz every morning.
//
//   reminders (nudges) - at 9 AM, if any reminder texts are still unsent;
//           at 6 PM, if any review asks are still unsent. Once a day each,
//           and only when there's something left (best times to text).
//
// What's already been sent is kept in the "meta" store under "pushAlerts".
//
// It also backs up the 7 AM reminders email (daily-reminders.mjs): Netlify's
// scheduler sometimes skips a run, so from 7:20 AM on, if today's email
// hasn't gone out yet, it's sent from here (runDigestOnce keeps it to one).

import { getStore } from "@netlify/blobs";
import { notify } from "./lib-push.mjs";
import { friendlyTime, dropoffAddressOf, pickupAddressOf, computeReminders } from "./lib-reminders.mjs";
import { computeAvailability } from "./lib-stock.mjs";
import { runDigestOnce } from "./lib-digest.mjs";

const LEAD_MINUTES = 75;     // alert when a stop is this close or closer
const LOW_TOTES = 20;        // matches "Under 20" on the Inventory page
const STOCK_DAYS = 30;
const STOCK_FROM_HOUR = 7;
const DIGEST_CATCHUP = [7 * 60 + 20, 20 * 60];   // 7:20 AM to 8 PM
// Nudges: [from, until] in minutes since midnight. A run missed at 9:00
// still nudges at 9:15; after "until" the day's nudge is skipped.
const NUDGES = {
  texts:   { window: [9 * 60, 12 * 60], kinds: ["delivery", "pickupTomorrow", "pickup", "addressCheck", "followup", "emailReminder"] },
  reviews: { window: [18 * 60, 20 * 60], kinds: ["review"] },
};

// Oklahoma date and minutes since midnight, right now.
export function nowInOklahoma(at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// "2:30 PM", "14:30" or "9 AM" -> minutes since midnight; null if no time.
export function timeToMinutes(t) {
  const m = String(t || "").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3]) {
    const pm = m[3].toUpperCase() === "PM";
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return h < 24 && min < 60 ? h * 60 + min : null;
}

const totes = (n) => (n ? `${n} ${n === 1 ? "tote" : "totes"}` : "");
const dollies = (n) => (n ? `${n} ${n === 1 ? "dolly" : "dollies"}` : "");

// Stops starting within the next LEAD_MINUTES that haven't been alerted yet.
export function dueSoon(rentals, now, sent = {}) {
  const out = [];
  for (const r of rentals) {
    if (r.cancelled) continue;
    for (const [kind, date, time, addr, marked] of [
      ["Delivery", r.dropoffDate, r.dropoffTime, dropoffAddressOf(r), r.deliveredAt || r.pickedUpAt],
      ["Pickup", r.pickupDate, r.pickupTime, pickupAddressOf(r), r.pickedUpAt],
    ]) {
      // Already marked done on the Dashboard: nothing to remind about
      if (date !== now.date || marked) continue;
      const at = timeToMinutes(time);
      if (at === null) continue;
      const until = at - now.minutes;
      const id = `${kind.toLowerCase()}:${r.key}:${date}`;
      if (until < 0 || until > LEAD_MINUTES || sent[id]) continue;
      const what = kind === "Delivery" ? [totes(r.toteCount), dollies(r.dollyCount)].filter(Boolean).join(", ") : "";
      out.push({
        id,
        message: {
          title: `${kind} at ${friendlyTime(time)}: ${r.name || "customer"}`,
          body: [what, addr || "No address yet"].filter(Boolean).join(" · "),
          url: "/admin.html",
          tag: id,
        },
      });
    }
  }
  return out;
}

// The nudge for one NUDGES entry from computeReminders output, or null when
// nothing of that kind is left to send.
export function nudgeFor(which, rem, date) {
  const n = NUDGES[which].kinds.reduce((t, k) => t + (rem[k] || []).length, 0);
  if (!n) return null;
  const many = n === 1 ? "" : "s";
  return which === "texts"
    ? { title: `${n} text${many} still to send`, body: "Good time to send reminders now. Tap to open Reminders.", url: "/admin-reminders.html", tag: `nudge-texts-${date}` }
    : { title: `${n} review ask${many} to send`, body: "Evening is the best time for review texts. Tap to open Reminders.", url: "/admin-reminders.html", tag: `nudge-reviews-${date}` };
}

// The low-stock message for the next STOCK_DAYS, or null if stock is fine.
export function stockAlert(avail) {
  const days = avail.days.slice(0, STOCK_DAYS);
  const low = days.filter((d) => d.available < LOW_TOTES);
  const dollyShort = avail.dolliesTracked ? days.filter((d) => d.dolliesAvailable < 0) : [];
  if (!low.length && !dollyShort.length) return null;

  const fmt = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const parts = [];
  if (low.length) {
    const worst = low.reduce((a, b) => (b.available < a.available ? b : a));
    parts.push(worst.available < 0
      ? `Overbooked by ${-worst.available} totes on ${fmt(worst.date)}.`
      : `Only ${worst.available} totes free on ${fmt(worst.date)}.`);
    if (low.length > 1) parts.push(`${low.length} days under ${LOW_TOTES} in the next ${STOCK_DAYS}.`);
  }
  if (dollyShort.length) {
    const worst = dollyShort.reduce((a, b) => (b.dolliesAvailable < a.dolliesAvailable ? b : a));
    parts.push(`Short ${-worst.dolliesAvailable} ${-worst.dolliesAvailable === 1 ? "dolly" : "dollies"} on ${fmt(worst.date)}.`);
  }
  const overbooked = low.some((d) => d.available < 0) || dollyShort.length > 0;
  return {
    // Same days at the same levels = same alert; don't send it twice.
    signature: JSON.stringify([low.map((d) => [d.date, d.available]), dollyShort.map((d) => [d.date, d.dolliesAvailable])]),
    message: {
      title: overbooked ? "Overbooked" : "Totes running low",
      body: parts.join(" "),
      url: "/admin-inventory.html",
      tag: "stock",
    },
  };
}

export default async () => {
  const meta = getStore("meta");
  let state = {};
  try { state = (await meta.get("pushAlerts", { type: "json" })) || {}; } catch {}
  const now = nowInOklahoma();
  // Only today's "soon" flags matter; older ones are dropped.
  const soonSent = Object.fromEntries(Object.entries(state.soonSent || {}).filter(([id]) => id.endsWith(":" + now.date)));
  let changed = Object.keys(soonSent).length !== Object.keys(state.soonSent || {}).length;

  let rentals = null;
  try {
    const store = getStore("rentals");
    const { blobs } = await store.list();
    rentals = [];
    for (const b of blobs) {
      const r = await store.get(b.key, { type: "json" }).catch(() => null);
      if (r) rentals.push({ key: b.key, ...r });
    }
    for (const stop of dueSoon(rentals, now, soonSent)) {
      await notify("soon", stop.message);
      soonSent[stop.id] = new Date().toISOString();
      changed = true;
    }
  } catch (e) {
    console.error("push-alerts soon check failed:", e.message);
  }

  // 9 AM texts nudge / 6 PM review nudge, once a day each
  const nudgesDue = rentals ? Object.entries(NUDGES).filter(([which, n]) =>
    now.minutes >= n.window[0] && now.minutes < n.window[1] && (state.nudged || {})[which] !== now.date) : [];
  if (nudgesDue.length) {
    try {
      let sentFlags = {}, paidFlags = {};
      try { sentFlags = (await meta.get("sentFlags", { type: "json" })) || {}; } catch {}
      try { paidFlags = (await meta.get("paidFlags", { type: "json" })) || {}; } catch {}
      const rem = computeReminders(rentals, process.env.GOOGLE_REVIEW_LINK || "", sentFlags, paidFlags);
      for (const [which] of nudgesDue) {
        const msg = nudgeFor(which, rem, now.date);
        if (msg) await notify("reminders", msg);
        state.nudged = { ...(state.nudged || {}), [which]: now.date };
        changed = true;
      }
    } catch (e) {
      console.error("push-alerts nudge failed:", e.message);
    }
  }

  if (now.minutes >= STOCK_FROM_HOUR * 60 && state.stockCheckedOn !== now.date) {
    try {
      const alert = stockAlert(await computeAvailability(STOCK_DAYS));
      if (alert && alert.signature !== state.stockSignature) await notify("stock", alert.message);
      state.stockSignature = alert ? alert.signature : null;
      state.stockCheckedOn = now.date;
      changed = true;
    } catch (e) {
      console.error("push-alerts stock check failed:", e.message);
    }
  }

  if (now.minutes >= DIGEST_CATCHUP[0] && now.minutes < DIGEST_CATCHUP[1]) {
    try { await runDigestOnce("catch-up"); }
    catch (e) { console.error("push-alerts digest catch-up failed:", e.message); }
  }

  if (changed) await meta.setJSON("pushAlerts", { ...state, soonSent });
  return new Response("ok");
};

export const config = {
  schedule: "*/15 * * * *",
};
