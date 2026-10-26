// POST /.netlify/functions/confirm-booking
// Public: the customer's one-tap "Confirm my booking" link (confirm.html).
//
// The confirm text from the Requests page carries a random token saved on
// the request (confirmToken). The token is the only key: no login, and the
// page only ever shows the customer's first name, package, dates and, once
// invoiced, the price and Stripe pay link.
//
// Body: { t, action }
//   look    -> { first, package, deliveryDate, pickupDate, state, pay? }
//   confirm -> moves the request to "confirmed" and notifies the admin app.
//              A standard booking (lib-invoice.mjs autoInvoicePlan) is then
//              invoiced right away: invoice email out, rental logged, request
//              "invoiced", and the page shows a Pay now button. Anything
//              else waits on Requests as "Ready to invoice", with the reason.
// state: "open" (can confirm) | "done" (already confirmed or invoiced) | "closed" (declined)
// pay:   { url, price, paid } once it's been invoiced automatically
//
// Confirming takes a button press, not just opening the link, because
// Messages and other apps open links on their own to build previews.

import { getStore } from "@netlify/blobs";
import { notify } from "./lib-push.mjs";
import { sendInvoice, autoInvoicePlan, loadPackages } from "./lib-invoice.mjs";
import { computeAvailability } from "./lib-stock.mjs";
import { getSettings } from "./settings.mjs";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const OPEN = ["new", "reviewed", "awaiting_confirmation"];
const DONE = ["confirmed", "invoiced"];

const fmt = (iso) => (iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "");

async function listRentals() {
  const store = getStore({ name: "rentals", consistency: "strong" });
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }).catch(() => null)))).filter(Boolean);
}

// Invoices a just-confirmed request if it's a standard booking.
// Returns { invoiced: true, request } or { invoiced: false, reasons }.
async function tryAutoInvoice(store, key) {
  const settings = await getSettings();
  if (!settings.autoInvoice) return { invoiced: false, reasons: ["automatic invoices are off"] };
  // Re-read and claim it, so a double tap can't send two invoices
  const req = await store.get(key, { type: "json" });
  if (!req || req.status !== "confirmed" || req.invoiceRentalKey || req.autoInvoiceStartedAt) return { invoiced: false, reasons: ["already being invoiced"] };
  const [packages, availability, rentals] = await Promise.all([loadPackages(), computeAvailability(), listRentals()]);
  const plan = autoInvoicePlan(req, packages, { availability, rentals });
  if (!plan.ok) {
    await store.setJSON(key, { ...req, autoInvoiceSkipped: plan.reasons });
    return { invoiced: false, reasons: plan.reasons };
  }
  await store.setJSON(key, { ...req, autoInvoiceStartedAt: new Date().toISOString() });
  const sent = await sendInvoice(plan.invoice);
  if (!sent.ok) {
    console.error("Automatic invoice failed:", sent.error);
    const { autoInvoiceStartedAt, ...back } = req;
    await store.setJSON(key, { ...back, autoInvoiceSkipped: ["the invoice email didn't send"] });
    return { invoiced: false, reasons: ["the invoice email didn't send"] };
  }
  const now = new Date().toISOString();
  const done = { ...req, status: "invoiced", invoicedAt: now, autoInvoicedAt: now, invoiceRentalKey: sent.key || "",
    payUrl: plan.invoice.stripeUrl, payPrice: plan.invoice.price };
  await store.setJSON(key, done);
  return { invoiced: true, request: done };
}

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const t = String(body.t || "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return json({ error: "This link isn't valid." }, 404);

  try {
    const store = getStore({ name: "requests", consistency: "strong" });
    const { blobs } = await store.list();
    let key = null, req = null;
    for (const b of blobs) {
      const r = await store.get(b.key, { type: "json" }).catch(() => null);
      if (r && r.confirmToken === t) { key = b.key; req = r; break; }
    }
    if (!req) return json({ error: "This link isn't valid." }, 404);

    const state = (r) => (OPEN.includes(r.status) ? "open" : DONE.includes(r.status) ? "done" : "closed");
    const view = async (r) => {
      const out = {
        first: String(r.name || "").split(" ")[0],
        package: r.package || "",
        deliveryDate: r.deliveryDate || "",
        pickupDate: r.pickupDate || "",
        state: state(r),
      };
      if (r.status === "invoiced" && r.payUrl) {
        let paid = false;
        try { paid = !!((await getStore({ name: "meta", consistency: "strong" }).get("paidFlags", { type: "json" })) || {})[r.invoiceRentalKey]; } catch {}
        out.pay = { url: r.payUrl, price: r.payPrice || "", paid };
      }
      return out;
    };

    if (body.action === "look") return json(await view(req));
    if (body.action !== "confirm") return json({ error: "Unknown action" }, 400);
    if (state(req) !== "open") return json(await view(req));

    const confirmed = { ...req, status: "confirmed", confirmedAt: new Date().toISOString(), confirmedBy: "customer" };
    await store.setJSON(key, confirmed);

    let auto = { invoiced: false, reasons: [] };
    try { auto = await tryAutoInvoice(store, key); }
    catch (e) {
      console.error("Automatic invoice check failed:", e.message);
      auto = { invoiced: false, reasons: ["the automatic check didn't finish"] };
    }

    const dates = `${fmt(req.deliveryDate)} to ${fmt(req.pickupDate)}`;
    await notify("confirmed", auto.invoiced
      ? { title: "Booking confirmed and invoiced", body: `${req.name || "A customer"} confirmed ${dates}. Invoice for ${auto.request.payPrice} emailed with a pay link.`, url: "/admin-rentals.html", tag: "confirmed-" + key }
      : { title: "Booking confirmed", body: `${req.name || "A customer"} confirmed ${dates}. Ready to invoice${auto.reasons.length ? ` (check: ${auto.reasons.join(", ")})` : ""}.`, url: "/admin-requests.html", tag: "confirmed-" + key });
    return json(await view(auto.invoiced ? auto.request : confirmed));
  } catch (e) {
    console.error("confirm-booking failed:", e.message);
    return json({ error: "Something went wrong. Please reply YES to our text instead." }, 502);
  }
};
