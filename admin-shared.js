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

// Phone for display: "15803993202" or "580.399.3202" -> "(580) 399-3202".
// Anything that isn't a US number is shown as typed.
function fmtPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(raw || '');
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

// Who customer texts are from (keep in sync with SIGNER in
// netlify/functions/lib-reminders.mjs).
const TEXT_SIGNER = 'Chris with Ready Tote Oklahoma';

// ---- Where a rental is right now ----
// By date, and on the drop-off or pickup day itself by the time on the
// rental: it's out once the drop-off time has passed, and back once the
// pickup time has passed. With no time set, the whole day counts (out from
// the start of the drop-off day, back the day after pickup), as before.
// Times are Oklahoma time. Returns 'upcoming', 'out', 'done', or '' for a
// cancelled rental or one missing its dates.
function okNow(at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
// "2:30 PM", "14:30" or "9 AM" -> minutes after midnight; null if no time
function clockMinutes(t) {
  const m = String(t || '').match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3]) { const pm = m[3].toUpperCase() === 'PM'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return h < 24 && min < 60 ? h * 60 + min : null;
}
// Tapping Delivered / Picked up overrides the clock: marked picked up is
// done; marked delivered stays out, even past the pickup time, until it's
// marked picked up (a late pickup).
function rentalPhase(r, now = okNow()) {
  if (!r || r.cancelled || !r.dropoffDate || !r.pickupDate) return '';
  if (r.pickedUpAt) return 'done';
  if (r.deliveredAt) return 'out';
  const passed = (date, time) => date < now.date || (date === now.date && clockMinutes(time) !== null && now.minutes >= clockMinutes(time));
  if (passed(r.pickupDate, r.pickupTime)) return 'done';
  if (r.dropoffDate > now.date || (r.dropoffDate === now.date && clockMinutes(r.dropoffTime) !== null && now.minutes < clockMinutes(r.dropoffTime))) return 'upcoming';
  return 'out';
}

// Marked delivered, not picked up, and the pickup time has passed
function isLatePickup(r, now = okNow()) {
  if (!r || r.cancelled || !r.deliveredAt || r.pickedUpAt || !r.pickupDate) return false;
  const t = clockMinutes(r.pickupTime);
  return r.pickupDate < now.date || (r.pickupDate === now.date && t !== null && now.minutes >= t);
}
// Last day a rental holds its totes: the pickup date, or today while a
// late pickup is still out (same rule as lib-stock.mjs on the server)
function rentalEndDate(r, today) {
  return isLatePickup(r) && r.pickupDate < today ? today : r.pickupDate;
}
// "Oct 23, 2:14 PM" for a deliveredAt / pickedUpAt stamp
function markText(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---- Rush fee ----
// One rule everywhere, matching the booking form and terms: a request that
// came in less than 24 hours before delivery pays a $25 expedite fee.
// Delivery time is the start of the customer's window (morning 8 AM,
// afternoon noon, evening 5 PM), or noon when they had no preference.
// Send Invoice uses the real drop-off time instead, once it's set.
const RUSH_FEE = 25;
function windowStart(w) {
  const m = String(w || '').toLowerCase().match(/morning|afternoon|evening/);
  return m ? { morning: '08:00', afternoon: '12:00', evening: '17:00' }[m[0]] : '12:00';
}
function isRushBooking(submittedAt, deliveryDate, time) {
  if (!submittedAt || !deliveryDate) return false;
  const t = /^\d{1,2}:\d{2}$/.test(time || '') ? time.padStart(5, '0') : '12:00';
  const delivery = new Date(`${deliveryDate}T${t}:00`), sent = new Date(submittedAt);
  if (isNaN(delivery) || isNaN(sent)) return false;
  return (delivery - sent) / 36e5 < 24;
}

// ---- Money: the rules Finance and the Dashboard both use ----
// Revenue can be counted when it's paid (cash basis, what most small
// businesses file taxes on) or by drop-off date. Recurring expenses count
// once per month or year from their start date until they're stopped.
// Stripe keeps a fee from every card payment; it's estimated as an expense.
const FIN_BASIS_KEY = 'rto-fin-basis';
function finBasis() { try { return localStorage.getItem(FIN_BASIS_KEY) === 'dropoff' ? 'dropoff' : 'paid'; } catch { return 'paid'; } }
function setFinBasis(b) { try { localStorage.setItem(FIN_BASIS_KEY, b); } catch {} }
const okDay = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); };
const round2 = n => Math.round(n * 100) / 100;
function priceAmount(p) { const m = String(p || '').replace(/[^0-9.]/g, ''); return m ? parseFloat(m) || 0 : 0; }

// Rentals logged with Add Rental were paid another way, on their drop-off date
const paidOutsideInvoice = r => !!r.backfilled || !r.invoicedAt;

// One entry per rental: { date, amount, rental }. On the "paid" basis an
// unpaid invoice isn't revenue yet.
function revenueEntries(rentals, paidFlags, basis) {
  const out = [];
  for (const r of rentals) {
    const amount = priceAmount(r.price);
    let date = '';
    if (basis === 'dropoff' || paidOutsideInvoice(r)) date = r.dropoffDate || '';
    else if (paidFlags[r.key]) date = okDay(paidFlags[r.key]);
    if (date) out.push({ date, amount, rental: r });
  }
  return out;
}

// Invoices sent and not paid yet
function owedRentals(rentals, paidFlags) {
  return rentals.filter(r => !paidOutsideInvoice(r) && !paidFlags[r.key]);
}

// Each expense as the charges it really makes, up to `until` (YYYY-MM-DD)
function expenseCharges(expenses, until) {
  const out = [];
  const pad = n => String(n).padStart(2, '0');
  for (const e of expenses) {
    if ((e.recurring !== 'monthly' && e.recurring !== 'yearly') || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) { out.push({ ...e, source: e }); continue; }
    const stop = e.endDate && e.endDate < until ? e.endDate : until;
    let [y, m] = e.date.split('-').map(Number);
    const d = +e.date.slice(8, 10);
    for (let i = 0; i < 1200; i++) {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const date = `${y}-${pad(m)}-${pad(Math.min(d, last))}`;
      if (date > stop) break;
      out.push({ ...e, date, repeat: i > 0, source: e });
      if (e.recurring === 'monthly') { m++; if (m > 12) { m = 1; y++; } } else y++;
    }
  }
  return out;
}

// Estimated Stripe fee on each Stripe card payment. Payments are recorded
// as Stripe (the webhook) or marked paid by hand (cash, Venmo); invoices
// paid before that was recorded are assumed to be Stripe.
function stripeFeeCharges(revenue, paidFlags, paidVia, fees) {
  const pct = Number(fees && fees.pct), fixed = Number(fees && fees.fixed);
  if (!Number.isFinite(pct) || !Number.isFinite(fixed)) return [];
  return revenue
    .filter(x => !paidOutsideInvoice(x.rental) && paidFlags[x.rental.key] && (paidVia[x.rental.key] || 'stripe') === 'stripe' && x.amount > 0)
    .map(x => ({ date: x.date, amount: round2(x.amount * pct / 100 + fixed), category: 'Stripe fees', vendor: 'Stripe',
      description: 'Estimated fee on ' + (x.rental.name || 'a payment'), estimated: true, rental: x.rental }));
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

  // Home Screen app setup and notifications, just above Log out.
  const appLink = document.createElement('a');
  appLink.href = 'admin-app.html';
  appLink.textContent = 'App & alerts';
  if (location.pathname.endsWith('admin-app.html')) appLink.setAttribute('aria-current', 'page');
  nav.appendChild(appLink);

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

// ---- App icon badge ----
// The number on the Home Screen icon (requests waiting on you plus late
// pickups, counted on the server). Refreshed whenever an admin page opens
// or comes back on screen, and after the Dashboard or Requests changes
// something. iPhones only show it when notifications are allowed.
function refreshBadge() {
  if (!('setAppBadge' in navigator) || !adminSession()) return Promise.resolve(null);
  return fetch('/.netlify/functions/push-subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'badge' }) })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || typeof d.count !== 'number') return null;
      return (d.count > 0 ? navigator.setAppBadge(d.count) : navigator.clearAppBadge()).then(() => d.count, () => d.count);
    })
    .catch(() => null);
}
window.addEventListener('load', refreshBadge);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshBadge(); });

// ---- Home Screen app ----
// The service worker (sw.js) shows push notifications and an offline page
// when the admin is opened from the iPhone Home Screen. Live data is never
// cached, so registering it changes nothing else about the pages.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // update(): pick up a changed sw.js on every open, not whenever the
    // phone gets round to it
    navigator.serviceWorker.register('/sw.js', { scope: '/admin' }).then(reg => reg.update()).catch(() => {});
  });
}
