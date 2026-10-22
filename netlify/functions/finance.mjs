// POST /.netlify/functions/finance
// Expense + mileage tracking. Actions: list, addExpense, editExpense, addMileage,
// delete, setRate, setStripeFees.
//
// Recurring expenses (monthly/yearly) are one record with a start date and an
// optional endDate; the pages turn them into one charge per month or year.
// Admin only (signed-in session, see lib-auth.mjs).

import { getStore } from "@netlify/blobs";
import { isAdmin } from "./lib-auth.mjs";

const DEFAULT_STRIPE_FEES = { pct: 2.9, fixed: 0.3 };
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
        const mileageRate = (await meta.get("mileageRate", { type: "json" })) ?? null;
        const stripeFees = (await meta.get("stripeFees", { type: "json" })) ?? DEFAULT_STRIPE_FEES;
        return json({ expenses, mileage, mileageRate, stripeFees });
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
        return json({ ok: true });
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
        await store.setJSON(key, {
          date: body.date,
          purpose: body.purpose,
          miles: Number(body.miles) || 0,
        });
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
          return new Response("Rate must be dollars per mile, e.g. 0.70", { status: 400 });
        }
        await meta.setJSON("mileageRate", rate);
        return json({ ok: true, rate });
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
