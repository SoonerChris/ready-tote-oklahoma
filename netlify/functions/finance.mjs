// POST /.netlify/functions/finance
// Expense + mileage tracking. Actions: list, addExpense, editExpense,
// addMileage, editMileage, delete, restore, setRate, deleteRate,
// setStripeFees, setTaxPct.
//
// Mileage rates are kept by start date ({ from, rate }), since the IRS rate
// can change during a year; each trip uses the rate in effect on its date.
//
// Recurring expenses (monthly/yearly) are one record with a start date and an
// optional endDate; the pages turn them into one charge per month or year.
// Admin only (signed-in session, see lib-auth.mjs).

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";

const DEFAULT_STRIPE_FEES = { pct: 2.9, fixed: 0.3 };

// Rates by start date. A rate saved before dates were tracked (one number
// under "mileageRate") counts from the beginning.
async function getRates(meta) {
  const rates = await meta.get("mileageRates", { type: "json" }).catch(() => null);
  if (Array.isArray(rates)) return rates;
  const old = await meta.get("mileageRate", { type: "json" }).catch(() => null);
  return Number.isFinite(old) ? [{ from: "0000-01-01", rate: old }] : [];
}

// A trip can name the rental and leg it was for, so Finance knows which
// deliveries and pickups are already logged
function mileageRecord(b) {
  return {
    date: b.date,
    purpose: String(b.purpose).slice(0, 200),
    miles: Number(b.miles) || 0,
    ...(b.rentalKey ? { rentalKey: String(b.rentalKey).slice(0, 200), leg: b.leg === "pickup" ? "pickup" : "delivery" } : {}),
  };
}
const validDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!isAdmin(request, body)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const store = getStore("finance");
  const meta = getStore("meta");

  try {
    switch (body.action) {
      case "list": {
        const { blobs } = await store.list();
        const fetched = await Promise.all(
          blobs.map(async (b) => {
            const r = await store.get(b.key, { type: "json" });
            return r ? { key: b.key, ...r } : null;
          })
        );
        const expenses = [], mileage = [];
        for (let i = 0; i < blobs.length; i++) {
          const r = fetched[i];
          if (!r) continue;
          if (blobs[i].key.startsWith("exp_")) expenses.push(r);
          else if (blobs[i].key.startsWith("mile_")) mileage.push(r);
        }
        const mileageRates = await getRates(meta);
        const mileageRate = mileageRates.length ? mileageRates[mileageRates.length - 1].rate : null;
        const stripeFees = (await meta.get("stripeFees", { type: "json" })) ?? DEFAULT_STRIPE_FEES;
        const taxPct = (await meta.get("taxSetAsidePct", { type: "json" })) ?? 25;
        // Which expenses have a receipt photo (photos store, "<key>:receipt")
        try {
          const { blobs: photos } = await getStore("photos").list();
          const withReceipt = new Set(photos.map((b) => b.key).filter((k) => k.endsWith(":receipt")).map((k) => k.slice(0, -8)));
          for (const e of expenses) if (withReceipt.has(e.key)) e.hasReceipt = true;
        } catch {}
        return json({ expenses, mileage, mileageRate, mileageRates, stripeFees, taxPct });
      }

      case "addExpense": {
        for (const f of ["date", "category", "amount"]) {
          if (!body[f]) return new Response("Missing field: " + f, { status: 400 });
        }
        const recurring = ["monthly", "yearly"].includes(body.recurring) ? body.recurring : "one-time";
        const key = `exp_${body.date}_${Date.now()}`;
        await store.setJSON(key, {
          date: body.date,
          category: body.category,
          vendor: body.vendor || "",
          description: body.description || "",
          amount: Number(body.amount) || 0,
          paymentMethod: body.paymentMethod || "",
          recurring,
          ...(recurring !== "one-time" && validDate(body.endDate) ? { endDate: body.endDate } : {}),
        });
        return json({ ok: true, key });
      }

      case "editExpense": {
        if (!body.key) return new Response("Missing key", { status: 400 });
        for (const f of ["date", "category", "amount"]) {
          if (!body[f]) return new Response("Missing field: " + f, { status: 400 });
        }
        const existing = await store.get(body.key, { type: "json" });
        if (!existing) return new Response("Expense not found", { status: 404 });
        const recurring = ["monthly", "yearly"].includes(body.recurring) ? body.recurring : "one-time";
        await store.setJSON(body.key, {
          date: body.date,
          category: body.category,
          vendor: body.vendor || "",
          description: body.description || "",
          amount: Number(body.amount) || 0,
          paymentMethod: body.paymentMethod || "",
          recurring,
          ...(recurring !== "one-time" && validDate(body.endDate) ? { endDate: body.endDate } : {}),
        });
        return json({ ok: true });
      }

      case "addMileage": {
        for (const f of ["date", "purpose", "miles"]) {
          if (!body[f]) return new Response("Missing field: " + f, { status: 400 });
        }
        const key = `mile_${body.date}_${Date.now()}`;
        await store.setJSON(key, mileageRecord(body));
        return json({ ok: true, key });
      }
      case "editMileage": {
        if (!body.key || !String(body.key).startsWith("mile_")) return new Response("Missing key", { status: 400 });
        for (const f of ["date", "purpose", "miles"]) {
          if (!body[f]) return new Response("Missing field: " + f, { status: 400 });
        }
        const existing = await store.get(body.key, { type: "json" });
        if (!existing) return new Response("Trip not found", { status: 404 });
        await store.setJSON(body.key, { ...existing, ...mileageRecord(body) });
        return json({ ok: true });
      }
      case "restore": {
        // Undo of a delete: put the record back under its original key, so
        // anything tied to that key (a receipt photo) comes back with it
        const key = String(body.key || "");
        if (!/^(exp|mile)_/.test(key) || !body.record || typeof body.record !== "object") return new Response("Bad restore", { status: 400 });
        const { key: _k, hasReceipt, ...record } = body.record;
        await store.setJSON(key, record);
        return json({ ok: true });
      }

      case "delete": {
        if (!body.key) return new Response("Missing key", { status: 400 });
        await store.delete(body.key);
        return json({ ok: true });
      }

      case "setRate": {
        const rate = Number(body.rate);
        if (!Number.isFinite(rate) || rate <= 0 || rate > 5) {
          return new Response("Rate must be dollars per mile, e.g. 0.725", { status: 400 });
        }
        const from = validDate(body.from) ? body.from : "0000-01-01";
        const rates = (await getRates(meta)).filter((r) => r.from !== from);
        rates.push({ from, rate });
        rates.sort((a, b) => a.from.localeCompare(b.from));
        await meta.setJSON("mileageRates", rates);
        return json({ ok: true, rates });
      }
      case "deleteRate": {
        const rates = (await getRates(meta)).filter((r) => r.from !== body.from);
        await meta.setJSON("mileageRates", rates);
        return json({ ok: true, rates });
      }
      case "setTaxPct": {
        const pct = Number(body.pct);
        if (!Number.isFinite(pct) || pct < 0 || pct > 60) return new Response("Set-aside must be a percent from 0 to 60", { status: 400 });
        await meta.setJSON("taxSetAsidePct", pct);
        return json({ ok: true });
      }

      case "setStripeFees": {
        // Stripe's standard US card pricing is 2.9% + 30 cents; change it here if yours differs
        const pct = Number(body.pct), fixed = Number(body.fixed);
        if (!Number.isFinite(pct) || pct < 0 || pct > 10 || !Number.isFinite(fixed) || fixed < 0 || fixed > 5) {
          return new Response("Fees must look like 2.9 (percent) and 0.30 (dollars)", { status: 400 });
        }
        await meta.setJSON("stripeFees", { pct, fixed });
        return json({ ok: true });
      }
      default:
        return new Response("Unknown action", { status: 400 });
    }
  } catch (e) {
    console.error("finance action failed:", body.action, e.message);
    return new Response("Storage error", { status: 502 });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
