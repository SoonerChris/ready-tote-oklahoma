// POST /.netlify/functions/booking-source
// Public: the one-tap "How did you hear about us?" answer on the booking
// form's thank-you screen (index.html). It used to be a field on the form;
// asking after the request is sent keeps the form short.
//
// Saves the answer on the request just sent: same email and phone, sent in
// the last 2 hours (tapping another answer changes it). The request itself is stored by
// submission-created.mjs a moment after the form posts, so "not found yet"
// is a 404 and the page tries again.
//
// Body: { email, phone, howHeard } -> { ok: true } | 404 | 400

import { getStore } from "@netlify/blobs";

// Same choices the form used to offer (shown on Requests as "Heard via")
export const SOURCES = ["Facebook or Instagram", "Google search", "Friend or family", "Realtor", "Moving company", "Apartment community", "Other"];
const WINDOW_MS = 2 * 60 * 60 * 1000;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const digits = (p) => String(p || "").replace(/\D/g, "").slice(-10);

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const phone = digits(body.phone);
  const howHeard = SOURCES.find((s) => s === body.howHeard);
  if (!email || phone.length < 10 || !howHeard) return json({ error: "Missing email, phone or answer" }, 400);

  try {
    const store = getStore({ name: "requests", consistency: "strong" });
    const { blobs } = await store.list();
    const since = Date.now() - WINDOW_MS;
    let match = null;
    for (const b of blobs) {
      const r = await store.get(b.key, { type: "json" }).catch(() => null);
      if (!r || String(r.email || "").trim().toLowerCase() !== email || digits(r.phone) !== phone) continue;
      const at = Date.parse(r.submittedAt || "");
      if (!(at >= since)) continue;
      if (!match || at > Date.parse(match.r.submittedAt)) match = { key: b.key, r };
    }
    if (!match) return json({ error: "Not found yet" }, 404);
    await store.setJSON(match.key, { ...match.r, howHeard });
    return json({ ok: true });
  } catch (e) {
    console.error("booking-source failed:", e.message);
    return json({ error: "Storage error" }, 502);
  }
};
