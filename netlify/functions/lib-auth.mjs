// Shared admin sign-in check for every protected function.
//
// Signing in (login.mjs) issues a session cookie instead of the browser
// keeping the password. The cookie is:
//   - HttpOnly: page scripts can't read it, so a stray script can't steal it
//   - Secure, SameSite=Strict: only sent over HTTPS, and never by another site
//   - scoped to /.netlify/functions, the only place that needs it
//   - signed (HMAC-SHA256) and stamped with an expiry, so it can't be forged
//     or extended
//
// The signing key is derived from INVOICE_SECRET (the admin password), so no
// new Netlify setting is needed, and changing the password signs out every
// device. Set SESSION_SECRET to use a separate key instead.
//
// Functions still accept the password itself as body.secret, so a script or
// a tab that was open before this change keeps working; the admin pages no
// longer store or send it.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "rto_session";
export const SESSION_DAYS = 30;
const MAX_AGE = SESSION_DAYS * 24 * 60 * 60; // seconds

function signingKey() {
  const base = process.env.SESSION_SECRET || process.env.INVOICE_SECRET;
  if (!base) return null;
  return createHash("sha256").update("rto-session-v1:" + base).digest();
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Compares in constant time, whatever the lengths, so response timing doesn't
// hint at how much of a guess was right.
export function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a ?? "")).digest();
  const hb = createHash("sha256").update(String(b ?? "")).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordMatches(password) {
  return !!process.env.INVOICE_SECRET && safeEqual(password, process.env.INVOICE_SECRET);
}

// If ADMIN_USERNAME isn't set, any username is accepted with the right
// password (unchanged from before), so a missing setting can't lock Chris out.
export function usernameMatches(username) {
  return !process.env.ADMIN_USERNAME || safeEqual(String(username || "").trim(), process.env.ADMIN_USERNAME);
}

// Returns { token, expires } for a new session.
export function createSession(username) {
  const key = signingKey();
  if (!key) throw new Error("INVOICE_SECRET is not set");
  const expires = Date.now() + MAX_AGE * 1000;
  const payload = b64url(JSON.stringify({ u: String(username || "").slice(0, 80), exp: expires }));
  const sig = b64url(createHmac("sha256", key).update(payload).digest());
  return { token: `${payload}.${sig}`, expires };
}

function cookieValue(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// The session in the request's cookie, or null if missing, forged or expired.
export function readSession(request) {
  const key = signingKey();
  const token = cookieValue(request, SESSION_COOKIE);
  if (!key || !token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = b64url(createHmac("sha256", key).update(payload).digest());
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// True for a signed-in session, or for a request that carries the password
// (scripts, and tabs opened before sessions existed).
export function isAdmin(request, body) {
  if (readSession(request)) return true;
  return !!body && typeof body.secret === "string" && passwordMatches(body.secret);
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/.netlify/functions; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/.netlify/functions; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
