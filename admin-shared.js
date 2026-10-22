// Ready Tote Oklahoma — shared client-side helpers for admin pages.
//
// Loaded via <script src="admin-shared.js?v=..."></script> BEFORE each
// page's own inline <script> block, same pattern as admin-shared.css.
// These were previously copy-pasted into 5-7 separate admin-*.html files;
// consolidating here means a fix or change only has to happen once.
//
// Plain global functions on purpose — the admin pages are plain <script>
// tags with no build step or module system, matching the rest of the
// project's no-framework approach.

// HTML-escape a value for safe insertion into innerHTML.
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

// Escape a value for safe insertion into a double-quoted HTML attribute.
function escAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;');
}

// "2026-07-20" -> "07/20/26". Pass a fallback for pages that want
// something other than an empty string when the date is missing
// (e.g. admin-requests.html uses '—').
function fmtDate(iso, fallback = '') {
  if (!iso) return fallback;
  const parts = String(iso).slice(0, 10).split('-');
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return m + '/' + d + '/' + y.slice(2);
}

// Normalize a phone number to E.164 (+1XXXXXXXXXX) for sms: links.
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return digits ? '+' + digits : '';
}

// Build a tap-to-text sms: link. Same logic as normalizePhone/smsLink in
// netlify/functions/lib-reminders.mjs, kept in sync intentionally — pages
// that already load rentals through get-rentals reuse its pre-built sms
// fields instead, this is for pages (like Send Invoice) that don't.
function smsLink(phone, message) {
  return `sms:${normalizePhone(phone)}?&body=${encodeURIComponent(message)}`;
}

// ---- Address composition ----
// Booking requests and rentals store addresses as separate street/city/
// state/zip fields. This joins them into one display/lookup string, same
// logic as formatAddress in netlify/functions/lib-reminders.mjs, kept in
// sync intentionally. Returns "" if every part is blank.
function formatAddress(street, city, state, zip) {
  const line2 = [city, state].filter(Boolean).join(", ");
  return [street, [line2, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// Records saved before the street/city/state/zip split still have a
// single combined string under the old field name (deliveryAddress on
// requests; dropoffAddress/pickupAddress, or the oldest records' plain
// address, on rentals). These fall back to that legacy string so old
// records keep displaying correctly without a data migration.
function deliveryAddressOf(r) {
  return formatAddress(r.deliveryAddressStreet, r.deliveryAddressCity, r.deliveryAddressState, r.deliveryAddressZip)
    || r.deliveryAddress || "";
}
function dropoffAddressOf(r) {
  return formatAddress(r.dropoffAddressStreet, r.dropoffAddressCity, r.dropoffAddressState, r.dropoffAddressZip)
    || r.dropoffAddress || r.address || "";
}
function pickupAddressOf(r) {
  return formatAddress(r.pickupAddressStreet, r.pickupAddressCity, r.pickupAddressState, r.pickupAddressZip)
    || r.pickupAddress || r.address || "";
}

// ---- Tote and dolly counts ----
// Shared by the Dashboard and Inventory so both pages always show the same
// numbers. Rentals carry real toteCount/dollyCount fields (set by Send
// Invoice, Add Rental and quick edits); the package text is only read for
// older rentals saved before those fields existed, and for requests.
function totesInPackage(pkg) {
  const m = String(pkg || '').match(/(\d+)\s*totes?/i);
  return m ? parseInt(m[1], 10) : 0;
}
function dolliesInPackage(pkg) {
  const s = String(pkg || '');
  const m = s.match(/(\d+)\s*doll(?:y|ies)/i);
  if (m) return parseInt(m[1], 10);
  return /doll(?:y|ies)/i.test(s) ? 1 : 0;
}
function toteQty(r) {
  return typeof r.toteCount === 'number' ? r.toteCount : totesInPackage(r.package);
}
function dollyQty(r) {
  return typeof r.dollyCount === 'number' ? r.dollyCount : dolliesInPackage(r.package);
}

// Requests that hold totes but have no rental yet: awaiting the customer's
// confirmation, or confirmed, and not matched to an invoiced rental by
// email+date or name+date. Same holds as the public availability function.
// estTotes is 0 when the package text can't be read (e.g. "Custom package");
// callers list those rather than guess.
function findPendingConfirmed(requests, rentals) {
  const byEmail = new Set(rentals.map(r => `${(r.email || '').toLowerCase()}|${r.dropoffDate}`));
  const byName = new Set(rentals.map(r => `${(r.name || '').toLowerCase()}|${r.dropoffDate}`));
  return requests
    .filter(req => req.status === 'confirmed' || req.status === 'awaiting_confirmation')
    .filter(req => !byEmail.has(`${(req.email || '').toLowerCase()}|${req.deliveryDate}`)
      && !byName.has(`${(req.name || '').toLowerCase()}|${req.deliveryDate}`))
    .map(req => ({ ...req, estTotes: totesInPackage(req.package), estDollies: dolliesInPackage(req.package) }));
}

// ---- Auth guard ----
// Runs immediately (this script is a blocking, non-deferred <script src>
// in <head>, so this executes before <body> is even parsed) rather than
// waiting for DOMContentLoaded — an unauthenticated visitor should never
// see a flash of a protected page's content before being redirected.
//
// admin-login.html is exempt (it's what everyone gets sent to). Every
// other admin-*.html page needs a session that hasn't expired.
//
// The real session is an HttpOnly cookie the server checks (see
// netlify/functions/lib-auth.mjs); page scripts can't read it, by design.
// This browser only remembers *that* it's signed in and until when
// ("rto-admin-session"), so it can send you to sign in without a wasted
// round trip. The password itself is never stored.
const SESSION_KEY = 'rto-admin-session';

function adminSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s && typeof s.exp === 'number' && s.exp > Date.now() ? s : null;
  } catch { return null; }
}

// Pages put this in their hidden #secret field and check it's non-empty
// before loading. It's only a "signed in" marker; the server ignores it and
// checks the session cookie.
function adminSessionMarker() { return adminSession() ? 'session' : ''; }

function goToLogin() {
  const page = location.pathname.split('/').pop() || 'admin.html';
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  location.replace('admin-login.html?redirect=' + encodeURIComponent(page));
}

(function authGuard() {
  // Older versions of these pages saved the admin password in this browser.
  // Wipe it on every load so no device keeps a plain-text copy.
  try { localStorage.removeItem('rto-admin-password'); } catch {}
  const page = location.pathname.split('/').pop();
  if (page === 'admin-login.html') return;
  if (!adminSession()) goToLogin();
})();

// If the server says the session is over (expired, signed out elsewhere, or
// the password changed), go to sign in instead of showing "load failed".
(function signInOnExpiredSession() {
  if (location.pathname.split('/').pop() === 'admin-login.html') return;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const resp = await realFetch(input, init);
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (resp.status === 401 && url.includes('/.netlify/functions/') && !url.includes('/login')) goToLogin();
    return resp;
  };
})();

// ---- Log out ----
// Every protected page already has a <nav class="admin-nav">. Rather than
// adding a logout link's markup to all 10 HTML files, this appends one
// here once the nav exists, same technique used for the section-toggle
// buttons injected elsewhere in this project.
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.admin-nav');
  if (!nav) return;

  // Product mark at the top of the sidebar, plus the Menu button that
  // opens the folded nav on phones (hidden on wider screens by CSS).
  const brand = document.createElement('a');
  brand.className = 'admin-brand';
  brand.href = 'admin.html';
  brand.innerHTML = '<img src="images/logo.png" alt=""><span><b>Ready Tote</b><small>Admin</small></span>';
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'admin-menu-btn';
  menuBtn.textContent = 'Menu';
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.textContent = open ? 'Close' : 'Menu';
  });
  nav.prepend(brand, menuBtn);

  const logout = document.createElement('a');
  logout.href = '#';
  logout.className = 'logout-link';
  logout.textContent = 'Log out';
  logout.addEventListener('click', async (e) => {
    e.preventDefault();
    // Ends the session on the server (clears the cookie), then here
    try { await fetch('/.netlify/functions/logout', { method: 'POST' }); } catch {}
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem('rto-admin-username'); } catch {}
    location.href = 'admin-login.html';
  });
  nav.appendChild(logout);
});
