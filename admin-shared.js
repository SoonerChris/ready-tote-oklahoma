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
