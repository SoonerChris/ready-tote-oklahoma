// Ready Tote Oklahoma — tote availability check for a date range, shared by
// admin-requests.html and admin-invoice.html.
//
// Reads the same public availability function the booking page uses
// (netlify/functions/availability.mjs): totes owned minus every invoiced
// rental and every awaiting-confirmation/confirmed request, per day, for the
// next 120 days. A request that is itself awaiting confirmation or confirmed
// is already counted in those numbers, so its own totes are added back
// ("holdBack") before comparing, or it would compete against itself.
//
// Load AFTER admin-shared.js (uses esc()).

let AVAIL = null;        // { totalOwned, today, days: [{ date, available }] }
let AVAIL_FAILED = false;

async function loadAvailability() {
  try {
    const resp = await fetch('/.netlify/functions/availability');
    if (!resp.ok) throw new Error(resp.status);
    const data = await resp.json();
    // Anything unexpected counts as "couldn't check"; this must never break the page
    if (!data || !Array.isArray(data.days)) throw new Error('bad shape');
    AVAIL = data;
    AVAIL_FAILED = false;
  } catch {
    AVAIL = null;
    AVAIL_FAILED = true;
  }
  return AVAIL;
}

// "2–3 Bedrooms — 40 Totes + 2 Dollies — $169" -> 40; 0 when it doesn't say
function totesInPackageText(pkg) {
  const m = String(pkg || '').match(/(\d+)\s*totes?/i);
  return m ? parseInt(m[1], 10) : 0;
}

// The tightest day in [start, end] that's still ahead of us.
// Returns null when there's nothing to check (no dates, or all in the past).
function checkAvailability(start, end, need, holdBack) {
  if (!AVAIL || !start || !end || end < start) return null;
  let low = null;
  for (const d of AVAIL.days) {
    if (d.date < start || d.date > end) continue;
    let free = d.available;
    if (holdBack && d.date >= holdBack.start && d.date <= holdBack.end) free += holdBack.totes;
    if (!low || free < low.free) low = { free, date: d.date };
  }
  if (!low) return null;
  return { ...low, need: need || 0, ok: !need || low.free >= need };
}

function availabilityHtml(res) {
  if (AVAIL_FAILED) return '<span class="avail info">Couldn’t check availability. Check Inventory before confirming.</span>';
  if (!res) return '<span class="avail info">—</span>';
  const day = new Date(res.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!res.need) return `<span class="avail info">${res.free} totes free at the lowest point (${day}). Set a tote count to check it.</span>`;
  if (res.ok) return `<span class="avail ok">Enough totes. ${res.free} free at the lowest point (${day}), this needs ${res.need}.</span>`;
  if (res.free < 0) return `<span class="avail short">Not enough totes. ${day} is already overbooked by ${-res.free}, and this needs ${res.need}.</span>`;
  return `<span class="avail short">Not enough totes. Only ${res.free} free on ${day}, this needs ${res.need}.</span>`;
}

// Styles live here so pages that load this file don't need a new
// admin-shared.css version (it's served with an immutable cache header).
(function injectAvailabilityStyles() {
  const css = `
    .avail{display:inline-block; padding:3px 8px; border-radius:4px; font-size:13px; font-weight:600; line-height:1.4;}
    .avail.ok{background:var(--green-bg); color:#14492F;}
    .avail.short{background:var(--red-bg); color:#831C1E;}
    .avail.info{background:var(--track); color:#4A433B; font-weight:500;}`;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();
