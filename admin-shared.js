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

// ---- Auth guard ----
// Runs immediately (this script is a blocking, non-deferred <script src>
// in <head>, so this executes before <body> is even parsed) rather than
// waiting for DOMContentLoaded — an unauthenticated visitor should never
// see a flash of a protected page's content before being redirected.
//
// admin-login.html is exempt (it's what everyone gets sent to). Every
// other admin-*.html page requires a saved username + password.
(function authGuard() {
  const page = location.pathname.split('/').pop();
  if (page === 'admin-login.html') return;
  const username = localStorage.getItem('rto-admin-username');
  const password = localStorage.getItem('rto-admin-password');
  if (!username || !password) {
    location.replace('admin-login.html?redirect=' + encodeURIComponent(page || 'admin.html'));
  }
})();

// ---- Log out ----
// Every protected page already has a <nav class="admin-nav">. Rather than
// adding a logout link's markup to all 10 HTML files, this appends one
// here once the nav exists, same technique used for the section-toggle
// buttons injected elsewhere in this project.
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.admin-nav');
  if (!nav) return;
  const logout = document.createElement('a');
  logout.href = '#';
  logout.className = 'logout-link';
  logout.textContent = 'Log out';
  logout.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('rto-admin-username');
    localStorage.removeItem('rto-admin-password');
    location.href = 'admin-login.html';
  });
  nav.appendChild(logout);
});
