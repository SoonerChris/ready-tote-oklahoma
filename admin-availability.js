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

// "2–3 Bedrooms — 40 Totes + 2 Dollies — $169" -> 2; a bare "Dolly" is 1
function dolliesInPackageText(pkg) {
  const s = String(pkg || '');
  const m = s.match(/(\d+)\s*doll(?:y|ies)/i);
  if (m) return parseInt(m[1], 10);
  return /doll(?:y|ies)/i.test(s) ? 1 : 0;
}

// "2–3 Bedrooms — 40 Totes + 2 Dollies — $169" -> 40; 0 when it doesn't say
function totesInPackageText(pkg) {
  const m = String(pkg || '').match(/(\d+)\s*totes?/i);
  return m ? parseInt(m[1], 10) : 0;
}

// The tightest day in [start, end] that's still ahead of us.
// Returns null when there's nothing to check (no dates, or all in the past).
// needDollies is checked too once the business tracks dollies (AVAIL.dolliesTracked);
// holdBack may carry dollies the same way it carries totes.
function checkAvailability(start, end, need, holdBack, needDollies) {
  if (!AVAIL || !start || !end || end < start) return null;
  let low = null, lowD = null;
  for (const d of AVAIL.days) {
    if (d.date < start || d.date > end) continue;
    const held = holdBack && d.date >= holdBack.start && d.date <= holdBack.end;
    const free = d.available + (held ? holdBack.totes : 0);
    if (!low || free < low.free) low = { free, date: d.date };
    if (typeof d.dolliesAvailable === 'number') {
      const freeD = d.dolliesAvailable + (held ? (holdBack.dollies || 0) : 0);
      if (!lowD || freeD < lowD.free) lowD = { free: freeD, date: d.date };
    }
  }
  if (!low) return null;
  const dolly = lowD && needDollies ? { ...lowD, need: needDollies, ok: lowD.free >= needDollies } : null;
  return { ...low, need: need || 0, ok: (!need || low.free >= need) && (!dolly || dolly.ok), totesOk: !need || low.free >= need, dolly };
}

function availabilityHtml(res) {
  if (AVAIL_FAILED) return '<span class="avail info">Couldn’t check availability. Check Inventory before confirming.</span>';
  if (!res) return '<span class="avail info">—</span>';
  const totesLine = toteAvailabilityHtml(res);
  if (!res.dolly) return totesLine;
  const dd = new Date(res.dolly.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const dollyLine = res.dolly.ok
    ? `<span class="avail ok">Enough dollies. ${res.dolly.free} free at the lowest point, this needs ${res.dolly.need}.</span>`
    : res.dolly.free < 0
      ? `<span class="avail short">Not enough dollies. ${dd} is already overbooked by ${-res.dolly.free}, and this needs ${res.dolly.need}.</span>`
      : `<span class="avail short">Not enough dollies. Only ${res.dolly.free} free on ${dd}, this needs ${res.dolly.need}.</span>`;
  return totesLine + ' ' + dollyLine;
}

function toteAvailabilityHtml(res) {
  const day = new Date(res.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!res.need) return `<span class="avail info">${res.free} totes free at the lowest point (${day}). Set a tote count to check it.</span>`;
  if (res.totesOk) return `<span class="avail ok">Enough totes. ${res.free} free at the lowest point (${day}), this needs ${res.need}.</span>`;
  if (res.free < 0) return `<span class="avail short">Not enough totes. ${day} is already overbooked by ${-res.free}, and this needs ${res.need}.</span>`;
  return `<span class="avail short">Not enough totes. Only ${res.free} free on ${day}, this needs ${res.need}.</span>`;
}

// Styles live here so pages that load this file don't need a new
// admin-shared.css version (it's served with an immutable cache header).
(function injectAvailabilityStyles() {
  const css = `
    .avail{display:inline-block; padding:3px 8px; border-radius:4px; font-size:13px; font-weight:600; line-height:1.4; margin:0 4px 4px 0;}
    .avail.ok{background:var(--green-bg); color:var(--green-ink);}
    .avail.short{background:var(--red-bg); color:var(--red-ink);}
    .avail.info{background:var(--track); color:var(--muted-ink); font-weight:500;}`;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();
