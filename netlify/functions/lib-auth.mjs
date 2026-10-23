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

import { createHash, createHmac, timingSafeEqual, randomBytes, scryptSync } from "node:crypto";
import { getStore } from "@netlify/blobs";

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

// Returns { token, expires } for a new session. extra carries the role for
// an inventory-only login: { role: "inventory", v } (see staff accounts below).
export function createSession(username, extra = {}) {
  const key = signingKey();
  if (!key) throw new Error("INVOICE_SECRET is not set");
  const expires = Date.now() + MAX_AGE * 1000;
  const payload = b64url(JSON.stringify({ u: String(username || "").slice(0, 80), exp: expires, ...extra }));
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

// True for a signed-in admin session, or for a request that carries the
// password (scripts, and tabs opened before sessions existed). An
// inventory-only login is not an admin.
export function isAdmin(request, body) {
  const s = readSession(request);
  if (s) return s.role !== "inventory";
  return !!body && typeof body.secret === "string" && passwordMatches(body.secret);
}

// ---- Inventory-only logins (e.g. Shon) ----
// Made on the App & alerts page (staff-accounts.mjs) and kept in the "meta"
// store under "staffAccounts": { username: { salt, hash, v, createdAt } }.
// Passwords are stored as scrypt hashes, never as text. Changing a password
// or removing the login bumps/deletes it, which ends that person's sessions.
const STAFF_KEY = "staffAccounts";
export async function getStaffAccounts() {
  try { return (await getStore("meta").get(STAFF_KEY, { type: "json" })) || {}; } catch { return {}; }
}
export async function saveStaffAccounts(accounts) {
  await getStore("meta").setJSON(STAFF_KEY, accounts);
}
export const normUser = (u) => String(u || "").trim().toLowerCase().slice(0, 40);
export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(String(password), salt, 32).toString("hex") };
}
// The account if the username and password match one, else null
export async function checkStaffLogin(username, password) {
  const acct = (await getStaffAccounts())[normUser(username)];
  if (!acct) return null;
  return safeEqual(hashPassword(password, acct.salt).hash, acct.hash) ? acct : null;
}

// "admin", "inventory" or null. For functions the Inventory page uses: an
// admin can do anything; an inventory login only while its account still
// exists with the same password version.
export async function accessLevel(request, body) {
  if (isAdmin(request, body)) return "admin";
  const s = readSession(request);
  if (!s || s.role !== "inventory") return null;
  const acct = (await getStaffAccounts())[normUser(s.u)];
  return acct && acct.v === s.v ? "inventory" : null;
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/.netlify/functions; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/.netlify/functions; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
