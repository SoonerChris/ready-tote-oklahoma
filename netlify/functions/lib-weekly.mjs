// The Monday summary email: last week (Monday to Sunday) in numbers, plus
// this week's stops and who still owes money. Sent by weekly-summary.mjs on
// Monday at 7 AM Oklahoma time (Automation switch: settings weeklySummary),
// or right away from App & alerts ("Email it now").
//
// buildWeeklySummary() only reads the data it's handed, so it can be
// tested; sendWeeklySummary() loads everything and emails it to the same
// people as the morning email.

import { getStore } from "@netlify/blobs";
import { emailLayout, heading, pill, sectionLabel, detailsCard, button, escapeHtml, emailColors as C, SITE_URL } from "./lib-email.mjs";
import { friendlyTime, dropoffAddressOf, pickupAddressOf, todayInOklahoma } from "./lib-reminders.mjs";
import { sendEmail } from "./lib-digest.mjs";

const shift = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const okDate = (iso) => { const d = new Date(iso || ""); return isNaN(d) ? "" : d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); };
const priceNum = (p) => { const m = String(p || "").replace(/[^0-9.]/g, ""); return m ? parseFloat(m) : 0; };
const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const SHORT_SOURCE = { "Facebook or Instagram": "Facebook/Instagram", "Google search": "Google", "Friend or family": "Friend",
  "Moving company": "Movers", "Apartment community": "Apartment" };

// Monday of the week that holds `today`, and the week before it
export function weekBounds(today) {
  const dow = new Date(today + "T12:00:00Z").getUTCDay();   // 0 = Sunday
  const thisMon = shift(today, -((dow + 6) % 7));
  return { lastMon: shift(thisMon, -7), lastSun: shift(thisMon, -1), thisMon, thisSun: shift(thisMon, 6) };
}

export function buildWeeklySummary({ rentals = [], requests = [], paidFlags = {}, sentFlags = {}, skippedFlags = {}, mileage = [] }, today) {
  const { lastMon, lastSun, thisMon, thisSun } = weekBounds(today);
  const inLast = (iso) => { const d = iso && iso.length > 10 ? okDate(iso) : iso; return !!d && d >= lastMon && d <= lastSun; };
  const live = rentals.filter((r) => !r.cancelled);

  // Money
  const collected = live.filter((r) => inLast(paidFlags[r.key]));
  const invoiced = live.filter((r) => !r.backfilled && inLast(r.invoicedAt));
  const owing = live.filter((r) => !r.backfilled && r.invoicedAt && !paidFlags[r.key])
    .sort((a, b) => (a.invoicedAt || "").localeCompare(b.invoicedAt || ""));
  const sum = (list) => list.reduce((t, r) => t + priceNum(r.price), 0);

  // Bookings
  const newReqs = requests.filter((q) => inLast(q.submittedAt));
  const declined = requests.filter((q) => q.status === "declined" && inLast(q.declinedAt));
  const heard = {};
  for (const q of newReqs) if (q.howHeard) heard[q.howHeard] = (heard[q.howHeard] || 0) + 1;
  const heardLine = Object.entries(heard).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${escapeHtml(SHORT_SOURCE[k] || k)} ${n}`).join(" &middot; ");

  // Work
  const delivered = live.filter((r) => inLast(r.deliveredAt));
  const pickedUp = live.filter((r) => inLast(r.pickedUpAt));
  const trips = mileage.filter((m) => inLast(m.date));
  const miles = Math.round(trips.reduce((t, m) => t + (Number(m.miles) || 0), 0) * 10) / 10;
  const reviews = Object.entries(sentFlags).filter(([id, at]) => id.startsWith("review:") && !skippedFlags[id] && inLast(at));

  // This week's stops (an extension has no delivery, an extended rental no pickup)
  const stops = [];
  for (const r of live) {
    const self = r.serviceType === "self";
    if (!r.extendsKey && !r.deliveredAt && r.dropoffDate >= thisMon && r.dropoffDate <= thisSun)
      stops.push({ date: r.dropoffDate, time: r.dropoffTime, what: self ? "Customer pickup" : "Deliver", r, addr: self ? "At our place" : dropoffAddressOf(r) });
    if (!r.extendedBy && !r.pickedUpAt && r.pickupDate >= thisMon && r.pickupDate <= thisSun)
      stops.push({ date: r.pickupDate, time: r.pickupTime, what: self ? "Customer return" : "Pick up", r, addr: self ? "At our place" : pickupAddressOf(r) });
  }
  const mins = (t) => { const m = String(t || "").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i); if (!m) return 9999; let h = +m[1]; if (m[3]) { const pm = /pm/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; } return h * 60 + +(m[2] || 0); };
  stops.sort((a, b) => a.date.localeCompare(b.date) || mins(a.time) - mins(b.time));

  const list = (rows) => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line}; border-radius:12px;">${rows.map((x, i) => `
              <tr><td style="padding:12px 16px; ${i ? `border-top:1px solid ${C.line};` : ""} font-size:14px; line-height:1.5; color:${C.ink};">${x}</td></tr>`).join("")}
            </table>`;
  const dayName = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  const stopRows = stops.map((x) => `<strong>${escapeHtml(dayName(x.date))}${x.time ? ` &middot; ${escapeHtml(friendlyTime(x.time))}` : ""}</strong> &middot; ${escapeHtml(x.what)}, ${escapeHtml(x.r.name || "customer")}<br>
                <span style="font-size:13px; color:${C.steel};">${[x.r.toteCount ? `${x.r.toteCount} totes` : "", x.addr].filter(Boolean).map(escapeHtml).join(" &middot; ")}</span>`);
  const owedRows = owing.slice(0, 8).map((r) => {
    const days = Math.max(0, Math.round((Date.parse(today + "T12:00:00Z") - Date.parse(okDate(r.invoicedAt) + "T12:00:00Z")) / 864e5));
    return `<strong>${escapeHtml(r.name || "Customer")}</strong> &middot; ${escapeHtml(money(priceNum(r.price)))}<br><span style="font-size:13px; color:${C.steel};">Invoiced ${escapeHtml(short(okDate(r.invoicedAt)))}, ${plural(days, "day")} ago</span>`;
  });

  const quiet = !collected.length && !invoiced.length && !newReqs.length && !delivered.length && !pickedUp.length;
  const range = `${short(lastMon)} to ${short(lastSun)}`;
  const html = emailLayout({
    footer: false,
    preheader: `Last week: ${money(sum(collected))} collected, ${plural(newReqs.length, "new request")}. This week: ${plural(stops.length, "stop")}.`,
    body: `
            ${heading("Your week at Ready Tote", {
              badge: pill(range, "gold"),
              lead: quiet ? "A quiet week. Here's what's coming up." : "Last week in numbers, and what's coming up this week.",
            })}
            ${detailsCard({ label: "Money", rows: [
              ["Collected", `${money(sum(collected))} <span style="font-weight:400; color:${C.steel};">(${plural(collected.length, "payment")})</span>`],
              ["Invoiced", `${money(sum(invoiced))} <span style="font-weight:400; color:${C.steel};">(${plural(invoiced.length, "invoice")})</span>`],
              ["Still owed", `${money(sum(owing))} <span style="font-weight:400; color:${C.steel};">(${plural(owing.length, "invoice")}, all time)</span>`],
            ] })}
            <div style="height:14px;"></div>
            ${detailsCard({ label: "Bookings", rows: [
              ["New requests", String(newReqs.length)],
              ["Booked", String(invoiced.length)],
              ["Declined", String(declined.length)],
              heardLine ? ["How they found us", heardLine] : null,
            ] })}
            <div style="height:14px;"></div>
            ${detailsCard({ label: "On the road", rows: [
              ["Deliveries", String(delivered.length)],
              ["Pickups", String(pickedUp.length)],
              ["Trip miles", trips.length ? `${miles.toLocaleString("en-US")} mi <span style="font-weight:400; color:${C.steel};">(${plural(trips.length, "trip")})</span>` : "None logged"],
              ["Review asks", String(reviews.length)],
            ] })}
            ${sectionLabel(`This week, ${short(thisMon)} to ${short(thisSun)}`, { top: 26 })}
            ${stops.length ? list(stopRows) : `<p style="margin:0; font-size:14px; color:${C.steel};">No deliveries or pickups scheduled.</p>`}
            ${owing.length ? `${sectionLabel(`Still owed (${owing.length})`, { top: 26 })}${list(owedRows)}${owing.length > 8 ? `<p style="margin:8px 0 0; font-size:13px; color:${C.steel};">And ${owing.length - 8} more on the Dashboard.</p>` : ""}` : ""}
            ${button(`${SITE_URL}/admin.html`, "Open the dashboard")}`,
  });
  return { subject: `Your week: ${money(sum(collected))} collected, ${plural(stops.length, "stop")} ahead | Ready Tote Oklahoma`, html,
    totals: { collected: sum(collected), invoiced: invoiced.length, owed: sum(owing), newRequests: newReqs.length, stops: stops.length, miles } };
}

async function all(name) {
  const store = getStore({ name, consistency: "strong" });
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map(async (b) => { const v = await store.get(b.key, { type: "json" }).catch(() => null); return v ? { key: b.key, ...v } : null; }))).filter(Boolean);
}

export async function sendWeeklySummary() {
  const meta = getStore({ name: "meta", consistency: "strong" });
  const flag = async (k) => { try { return (await meta.get(k, { type: "json" })) || {}; } catch { return {}; } };
  const [rentals, requests, finance, paidFlags, sentFlags, skippedFlags] = await Promise.all([
    all("rentals"), all("requests"), all("finance"), flag("paidFlags"), flag("sentFlags"), flag("skippedFlags")]);
  const mileage = finance.filter((x) => x.key.startsWith("mile_"));
  const s = buildWeeklySummary({ rentals, requests, paidFlags, sentFlags, skippedFlags, mileage }, todayInOklahoma());
  const ok = await sendEmail(s.subject, s.html);
  return { ok, totals: s.totals };
}
