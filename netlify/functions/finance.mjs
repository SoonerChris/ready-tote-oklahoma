// POST /.netlify/functions/finance
// Expense + mileage tracking. Actions: list, addExpense, addMileage, delete, setRate.
// Protected by INVOICE_SECRET.

import { getStore } from "@netlify/blobs";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!process.env.INVOICE_SECRET || body.secret !== process.env.INVOICE_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const store = getStore("finance");
  const meta = getStore("meta");

  try {
    switch (body.action) {
      case "list": {
        const { blobs } = await store.list();
        const expenses = [], mileage = [];
        for (const b of blobs) {
          const r = await store.get(b.key, { type: "json" });
          if (!r) continue;
          if (b.key.startsWith("exp_")) expenses.push({ key: b.key, ...r });
          else if (b.key.startsWith("mile_")) mileage.push({ key: b.key, ...r });
        }
        const mileageRate = (await meta.get("mileageRate", { type: "json" })) ?? null;
        return json({ expenses, mileage, mileageRate });
      }

      case "addExpense": {
        for (const f of ["date", "category", "amount"]) {
          if (!body[f]) return new Response("Missing field: " + f, { status: 400 });
        }
        const key = `exp_${body.date}_${Date.now()}`;
        await store.setJSON(key, {
          date: body.date,
          category: body.category,
          description: body.description || "",
          amount: Number(body.amount) || 0,
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
