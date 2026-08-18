// Ready Tote Oklahoma — shared logic between admin-reminders.html
// (Today's Reminders) and admin-rentals.html (All Rentals).
//
// These two pages used to be one 790-line file. Splitting them apart
// still leaves real overlap — both send payment-nudge texts/emails and
// both track which texts have been sent — so that overlap lives here
// instead of being copy-pasted into each page a second time.
//
// Load AFTER admin-shared.js and BEFORE each page's own inline <script>.
// Assumes each page defines $(id), showErr(msg), and has #secret/#loadBtn
// elements — same convention as every other admin page.

let SENT_FLAGS = {};
let PAID_FLAGS = {};

// Toggles every card in a section open/closed together, and flips its
// own label to whatever it'll do next time. Used both by the due-today
// sections on Reminders and the All Rentals list.
window.toggleAllSection = (containerId, btn) => {
  const container = $(containerId);
  const cards = container.querySelectorAll('.rem');
  const anyClosed = Array.from(cards).some(c => !c.classList.contains('open'));
  cards.forEach(c => c.classList.toggle('open', anyClosed));
  btn.textContent = anyClosed ? 'Collapse all' : 'Expand all';
};

// Text button with sent/unsent status, shared by every reminder type on
// both pages (delivery, pickup, review, follow-up, address-check, and
// the on-demand buttons in All Rentals).
function textBtn(type, key, smsLink, icon, label, color) {
  const flagId = type + ':' + (key || 'unknown');
  const sent = SENT_FLAGS[flagId];
  if (sent) {
    return `<button type="button" class="unsend-btn" data-flagid="${flagId}" title="Click to mark as unsent" style="width:auto; padding:8px 16px; font-size:0.8rem; background:var(--cream); color:var(--steel); border:1px solid var(--line); border-radius:8px; cursor:pointer;">${icon} ✓ Sent ↩</button>`;
  }
  return `<a class="sms-btn" href="${smsLink}" onclick="setTimeout(()=>confirmSent('${flagId}'),500)" style="padding:8px 16px; font-size:0.8rem; background:${color};${color==='var(--gold)'?' color:var(--ink);':''}">${icon} ${label}</a>`;
}

window.confirmSent = async (flagId) => {
  if (!confirm('Did you send the text? Mark as sent?')) return;
  await markSent(flagId);
};

window.markSent = async (flagId) => {
  const secret = $('secret').value.trim();
  if (!secret) return showErr('Enter the admin secret first.');
  try {
    const resp = await fetch('/.netlify/functions/mark-sent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, flagId }),
    });
    if (resp.ok) { $('loadBtn').click(); }
    else {
      const detail = await resp.text().catch(() => '');
      showErr('Mark sent failed (' + resp.status + '): ' + detail);
    }
  } catch { showErr('Network error.'); }
};

window.unmarkSent = async (flagId) => {
  if (!confirm('Mark this text as unsent? It will show as due again.')) return;
  const secret = $('secret').value.trim();
  if (!secret) return showErr('Enter the admin secret first.');
  try {
    const resp = await fetch('/.netlify/functions/mark-sent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, flagId, unsent: true }),
    });
    if (resp.ok) { $('loadBtn').click(); }
    else {
      const detail = await resp.text().catch(() => '');
      showErr('Unmark failed (' + resp.status + '): ' + detail);
    }
  } catch { showErr('Network error.'); }
};

// Button/status used both in the computed "due today" email-reminder list
// on Reminders and on-demand in the All Rentals list.
function emailReminderBtn(r) {
  if (!r.invoicedAt || r.backfilled || PAID_FLAGS[r.key]) return '';
  const flagId = 'emailReminder:' + r.key;
  const sent = SENT_FLAGS[flagId];
  if (!r.email || !r.stripeUrl) {
    return `<span style="display:inline-block; font-size:0.78rem; color:var(--steel);">📧 No payment link on file — resend the invoice instead</span>`;
  }
  if (sent) {
    return `<span style="display:inline-block; padding:8px 16px; font-size:0.8rem; background:var(--cream); color:var(--steel); border:1px solid var(--line); border-radius:8px;">📧 ✓ Emailed ${esc(fmtDate(sent))}</span>`;
  }
  return `<button type="button" class="email-reminder-btn" data-key="${esc(r.key)}" style="width:auto; padding:8px 16px; font-size:0.8rem; background:var(--gold); color:var(--ink); border:none; border-radius:8px; cursor:pointer;">📧 Send reminder</button>`;
}

// Text version of the same nudge. Independent of the email reminder —
// either, both, or neither can be sent, tracked by its own flagId via
// the shared textBtn() sent/unsend pattern above.
function textReminderBtn(r) {
  if (!r.invoicedAt || r.backfilled || PAID_FLAGS[r.key]) return '';
  const link = r.paymentReminderSms || r.sms;
  if (!r.phone || !link) return '';
  return textBtn('textReminder', r.key, link, '💬', 'Text reminder', 'var(--green)');
}

window.sendEmailReminder = async (key) => {
  const secret = $('secret').value.trim();
  if (!secret) return showErr('Enter the admin secret first.');
  try {
    const resp = await fetch('/.netlify/functions/send-payment-reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, key }),
    });
    if (resp.ok) { $('loadBtn').click(); }
    else {
      const detail = await resp.text().catch(() => '');
      showErr('Send reminder failed (' + resp.status + '): ' + detail);
    }
  } catch { showErr('Network error.'); }
};

function fmtPrice(p) {
  const s = String(p || '').trim();
  return s ? (s.startsWith('$') ? esc(s) : '$' + esc(s)) : '';
}
