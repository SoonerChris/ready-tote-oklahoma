// POST /.netlify/functions/inventory
// Stock ledger for totes and dollies. Actions: list, add, delete.
// Each event has item "tote" or "dolly"; events saved before dollies were
// tracked have no item and are totes.
// Admin only (signed-in session, see lib-auth.mjs).

import { getStore } from "@netlify/blobs";
import { accessLevel, readSession } from "./lib-auth.mjs";

const ADD_TYPES = ["purchased", "returned-to-service"];
const REMOVE_TYPES = ["damaged", "lost", "retired"];

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  const access = await accessLevel(request, body);   // admin or inventory-only login
  if (!access) {
    return new Response("Unauthorized", { status: 401 });
  }
  // An inventory-only login's changes are stamped with its username, and it
  // can only delete those (to fix a mistake), never the rest of the history.
  const staffUser = access === "inventory" ? readSession(request).u : null;

  const store = getStore("inventory");

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
        const events = fetched.filter(Boolean);
        return json({ events });
      }

      case "add": {
        for (const f of ["date", "type", "quantity"]) {
          if (!body[f]) return new Response("Missing field: " + f, { status: 400 });
        }
        if (![...ADD_TYPES, ...REMOVE_TYPES].includes(body.type)) {
          return new Response("Unknown event type", { status: 400 });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) return new Response("Date must look like 2026-10-24", { status: 400 });
        const quantity = Number(body.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return new Response("Quantity must be a positive number", { status: 400 });
        }
        const key = `inv_${body.date}_${Date.now()}`;
        await store.setJSON(key, {
          date: body.date,
          item: body.item === "dolly" ? "dolly" : "tote",
          type: body.type,
          quantity,
          note: String(body.note || "").slice(0, 200),
          ...(staffUser ? { by: staffUser } : {}),
          // Lost or damaged by a customer: which rental it was
          ...(REMOVE_TYPES.includes(body.type) && body.rentalKey
            ? { rentalKey: String(body.rentalKey).slice(0, 200), rentalName: String(body.rentalName || "").slice(0, 80) } : {}),
        });
        return json({ ok: true, key });
      }

      case "delete": {
        if (!body.key) return new Response("Missing key", { status: 400 });
        if (staffUser) {
          const ev = await store.get(body.key, { type: "json" }).catch(() => null);
          if (!ev || ev.by !== staffUser) return new Response("You can only delete changes you logged", { status: 403 });
        }
        await store.delete(body.key);
        return json({ ok: true });
      }

      default:
        return new Response("Unknown action", { status: 400 });
    }
  } catch (e) {
    console.error("inventory action failed:", body.action, e.message);
    return new Response("Storage error", { status: 502 });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
