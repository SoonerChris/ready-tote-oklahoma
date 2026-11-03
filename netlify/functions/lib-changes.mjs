// Change log: who changed a customer's details (name, phone, email,
// addresses, dates, times, package, counts) and when, plus what customers
// do themselves (confirm a booking, confirm or change their pickup
// address, add a military ID photo).
//
// One entry per save, in its own "changes" store so history never grows a
// request or rental record: key "<recordKey>/<time>", value
//   { at, recordKey, kind: "request"|"rental", name, by, source,
//     changes: [{ label, from, to }], event? }
// by: "customer", or the signed-in username for edits made in the app.
// Shown by get-changes.mjs (History on Requests and All Rentals, Recent
// changes on Contacts). Logging never blocks or fails the save itself.

import { getStore } from "@netlify/blobs";
import { readSession } from "./lib-auth.mjs";
import { formatAddress, dropoffAddressOf, pickupAddressOf } from "./lib-reminders.mjs";

const store = () => getStore({ name: "changes", consistency: "strong" });

// The fields worth tracking, as people read them
const requestAddress = (r) => formatAddress(r.deliveryAddressStreet, r.deliveryAddressCity, r.deliveryAddressState, r.deliveryAddressZip) || r.deliveryAddress || "";
const VIEWS = {
  request: (r) => ({
    "Name": r.name, "Phone": r.phone, "Email": r.email,
    "Delivery address": r.serviceType === "self" ? "Self pickup" : requestAddress(r),
    "Delivery date": r.deliveryDate, "Delivery time": r.deliveryWindow,
    "Pickup date": r.pickupDate, "Pickup time": r.pickupWindow,
    "Package": r.package,
  }),
  rental: (r) => ({
    "Name": r.name, "Phone": r.phone, "Email": r.email,
    "Drop-off address": r.serviceType === "self" ? "Self pickup" : dropoffAddressOf(r),
    "Pickup address": r.serviceType === "self" ? "Self return" : pickupAddressOf(r),
    "Drop-off date": r.dropoffDate, "Drop-off time": r.dropoffTime,
    "Pickup date": r.pickupDate, "Pickup time": r.pickupTime,
    "Package": r.package, "Totes": r.toteCount, "Dollies": r.dollyCount, "Price": r.price,
  }),
};
const show = (v) => (v === undefined || v === null ? "" : String(v).trim());

export function diffRecord(kind, before, after) {
  const a = VIEWS[kind](before || {}), b = VIEWS[kind](after || {});
  return Object.keys(b).filter((k) => show(a[k]) !== show(b[k])).map((label) => ({ label, from: show(a[label]), to: show(b[label]) }));
}

// Who made a change through the app: the signed-in username
export function whoFrom(request) {
  const s = request && readSession(request);
  return (s && s.u) || "admin";
}

// Logs { changes } and/or an { event }; nothing to log -> no entry
export async function logChange({ recordKey, kind, record, by, source, changes = [], event = "" }) {
  if (!recordKey || (!changes.length && !event)) return;
  try {
    const at = new Date().toISOString();
    await store().setJSON(`${recordKey}/${at}_${Math.random().toString(36).slice(2, 6)}`, {
      at, recordKey, kind, name: (record && record.name) || "", by: by || "admin", source: source || "", changes, ...(event ? { event } : {}),
    });
  } catch (e) {
    console.error("Change log failed (the save itself went through):", e.message);
  }
}

// Diff and log in one go, for edit screens
export async function logEdit({ recordKey, kind, before, after, by, source }) {
  const changes = diffRecord(kind, before, after);
  if (changes.length) await logChange({ recordKey, kind, record: after, by, source, changes });
  return changes;
}

// Entries for some records (newest first), or the latest across everything
export async function listChanges({ keys = null, limit = 100 } = {}) {
  const s = store();
  const prefixes = keys && keys.length ? keys.map((k) => k + "/") : [""];
  const blobKeys = new Set();
  for (const prefix of prefixes) {
    const { blobs } = await s.list(prefix ? { prefix } : {});
    for (const b of blobs) if (!prefix || b.key.startsWith(prefix)) blobKeys.add(b.key);
  }
  // Keys end in an ISO time, so the newest sort last
  const pick = [...blobKeys].sort((x, y) => x.split("/").pop().localeCompare(y.split("/").pop())).reverse().slice(0, limit);
  return (await Promise.all(pick.map((k) => s.get(k, { type: "json" }).catch(() => null)))).filter(Boolean);
}
