// Who gets the emails the site sends to the business (not customers).
// Edited on App & alerts → "Who gets emails" (settings.mjs actions
// "set-recipients"); kept in the "meta" store under "emailRecipients" as
// { morning: [...], weekly: [...], copies: [...] }. A list that was never
// saved uses the default, which is what the site did before:
//   morning - the 7 AM reminders email (lib-digest.mjs): REMINDER_EMAILS (or
//             the owner) plus Shon
//   weekly  - the Monday summary (lib-weekly.mjs) and the one-time "Google
//             reviews are live" email (check-reviews-live.mjs): the same
//             without Shon
//   copies  - a hidden copy (BCC) of invoices, payment reminders and
//             payment receipts sent to customers: the owner

import { getStore } from "@netlify/blobs";

export const OWNER_EMAIL = "readytoteok@gmail.com";
const SHON = "shonanderson856@gmail.com";
export const KINDS = ["morning", "weekly", "copies"];
const MAX = 10;

const clean = (e) => String(e || "").trim().toLowerCase();
export const validEmail = (e) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(e) && e.length <= 120;
const uniq = (list) => [...new Set(list.map(clean).filter(Boolean))];

function defaults() {
  const env = uniq((process.env.REMINDER_EMAILS || OWNER_EMAIL).split(","));
  const noShon = env.filter((e) => e !== SHON);
  return { morning: uniq([...env, SHON]), weekly: noShon.length ? noShon : [OWNER_EMAIL], copies: [OWNER_EMAIL] };
}

export async function getAllRecipients() {
  let saved = {};
  try { saved = (await getStore({ name: "meta", consistency: "strong" }).get("emailRecipients", { type: "json" })) || {}; } catch {}
  const d = defaults();
  return Object.fromEntries(KINDS.map((k) => [k, Array.isArray(saved[k]) && saved[k].length ? uniq(saved[k]) : d[k]]));
}

export async function getRecipients(kind) {
  return (await getAllRecipients())[kind] || [OWNER_EMAIL];
}

// Returns { ok, recipients } or { ok: false, error }
export async function setRecipients(kind, list) {
  if (!KINDS.includes(kind)) return { ok: false, error: "Unknown email list" };
  const emails = uniq(Array.isArray(list) ? list : []);
  const bad = emails.find((e) => !validEmail(e));
  if (bad) return { ok: false, error: `"${bad}" doesn't look like an email address.` };
  if (!emails.length) return { ok: false, error: "Keep at least one address on each list." };
  if (emails.length > MAX) return { ok: false, error: `Up to ${MAX} addresses per list.` };
  const store = getStore({ name: "meta", consistency: "strong" });
  let saved = {};
  try { saved = (await store.get("emailRecipients", { type: "json" })) || {}; } catch {}
  saved[kind] = emails;
  await store.setJSON("emailRecipients", saved);
  return { ok: true, recipients: await getAllRecipients() };
}
