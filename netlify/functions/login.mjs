// POST /.netlify/functions/login
// Checks the admin username and password and, if they match, starts a
// 30-day session: a signed HttpOnly cookie the other admin functions accept
// (see lib-auth.mjs). The browser never stores the password.
//
//   INVOICE_SECRET - the admin password
//   ADMIN_USERNAME - the username; if unset, any username is accepted with
//                    the right password, so a missing setting can't lock you out
//
// Too many wrong tries from one address (10 in 15 minutes) are turned away
// for the rest of that window, so the password can't be guessed by brute force.

import { getStore } from "@netlify/blobs";
import { passwordMatches, usernameMatches, createSession, sessionCookie } from "./lib-auth.mjs";

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

const json = (obj, status, headers = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
});

export default async (request, context) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  // One counter per client address; the rate limit is best-effort, so a
  // storage hiccup never blocks a correct sign-in.
  const ip = (context && context.ip) || request.headers.get("x-nf-client-connection-ip") || "unknown";
  const store = getStore("login-attempts");
  const key = "ip_" + ip.replace(/[^a-zA-Z0-9.:_-]/g, "_");
  let record = null;
  try { record = await store.get(key, { type: "json" }); } catch {}
  const now = Date.now();
  if (record && now - record.first > WINDOW_MS) record = null;
  if (record && record.count >= MAX_FAILURES) {
    const wait = Math.ceil((record.first + WINDOW_MS - now) / 60000);
    return json({ ok: false, error: "too_many_attempts", retryMinutes: wait }, 429, { "Retry-After": String(wait * 60) });
  }

  const ok = passwordMatches(body.password) && usernameMatches(body.username);
  if (!ok) {
    try { await store.setJSON(key, { first: record ? record.first : now, count: (record ? record.count : 0) + 1 }); } catch {}
    return json({ ok: false }, 401);
  }

  try { if (record) await store.delete(key); } catch {}
  const { token, expires } = createSession(body.username);
  return json({ ok: true, expires }, 200, { "Set-Cookie": sessionCookie(token) });
};
