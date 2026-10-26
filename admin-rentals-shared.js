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
    return `<button type="button" class="unsend-btn" data-undo-flag="${escAttr(flagId)}" title="Mark as not sent" style="width:auto; padding:8px 16px; font-size:14px; background:var(--track); color:var(--steel); border:1px solid transparent; border-radius:6px; cursor:pointer;">${esc(label)} sent · Undo</button>`;
  }
  return `<a class="sms-btn" href="${escAttr(smsLink)}" data-text data-flag="${escAttr(flagId)}" data-what="${escAttr(label.replace(/^text\s+/i, ''))}" style="padding:8px 16px; font-size:14px;">${esc(/^text\b/i.test(label) ? label : 'Text: ' + label)}</a>`;
}

// ---- "Sent to Hannah?" after tapping a Text button ----
// Tapping Text opens Messages; the card then asks whether it went out, in
// its .card-ask box (cards carry data-key and data-first). Open questions
// are remembered by card, so a reload puts them back.
const TEXT_ASKS = new Map();   // card key -> { flag, what }
function askFor(key, first) {
  const a = TEXT_ASKS.get(key);
  return `<div class="card-ask" data-card-ask${a ? '' : ' hidden'}>${a ? askInner(a, first) : ''}</div>`;
}
function askInner(a, first) {
  const what = a.what && !/^text$/i.test(a.what) ? ' the ' + esc(a.what.toLowerCase()) + ' text' : '';
  return `<span>Sent${what} to ${esc(first || 'them')}?</span>
    <button type="button" data-ask-yes>Yes, sent</button>
    <button type="button" class="linklike" data-ask-no>Not yet</button>`;
}
function wireTextAsks(root) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-text],[data-ask-yes],[data-ask-no],[data-skip],[data-undo-flag]');
    if (!t) return;
    const card = t.closest('[data-key]');
    const key = card && card.dataset.key;
    if (t.matches('[data-text]')) {
      const a = { flag: t.dataset.flag, what: t.dataset.what || '' };
      TEXT_ASKS.set(key, a);
      setTimeout(() => {
        const box = card.querySelector('[data-card-ask]');
        if (box) { box.innerHTML = askInner(a, card.dataset.first); box.hidden = false; }
      }, 400);
    } else if (t.matches('[data-ask-no]')) {
      TEXT_ASKS.delete(key);
      t.closest('[data-card-ask]').hidden = true;
    } else if (t.matches('[data-ask-yes]')) {
      const a = TEXT_ASKS.get(key); if (!a) return;
      t.disabled = true; TEXT_ASKS.delete(key);
      markSent(a.flag);
    } else if (t.matches('[data-skip]')) {
      t.disabled = true; TEXT_ASKS.delete(key);
      markSent(t.dataset.flag, { skip: true });
    } else if (t.matches('[data-undo-flag]')) {
      t.disabled = true;
      unmarkSent(t.dataset.undoFlag);
    }
  });
}

window.markSent = async (flagId, extra = {}) => {
  const secret = $('secret').value.trim();
  if (!secret) return showErr('Enter the admin secret first.');
  try {
    const resp = await fetch('/.netlify/functions/mark-sent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, flagId, ...extra }),
    });
    if (resp.ok) { $('loadBtn').click(); }
    else {
      const detail = await resp.text().catch(() => '');
      showErr('Mark sent failed (' + resp.status + '): ' + detail);
    }
  } catch { showErr('Network error.'); }
};

window.unmarkSent = async (flagId) => {
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
    return `<span class="no-link" style="display:inline-block; font-size:13px; color:var(--steel);">No payment link on file, so no reminder email. Resend the invoice instead.</span>`;
  }
  if (sent) {
    return `<button type="button" class="email-reminder-btn" data-key="${esc(r.key)}" title="Resends with whatever price and payment link are currently on file" style="width:auto; padding:8px 16px; font-size:14px; background:var(--track); color:var(--steel); border:1px solid transparent; border-radius:6px; cursor:pointer;">Emailed ${esc(fmtDate(sent))} · Resend</button>`;
  }
  return `<button type="button" class="email-reminder-btn" data-key="${esc(r.key)}" style="width:auto; padding:8px 16px; font-size:14px; background:var(--white); color:var(--ink); border:1px solid var(--control); border-radius:6px; cursor:pointer;">Send reminder</button>`;
}

// Text version of the same nudge. Independent of the email reminder —
// either, both, or neither can be sent, tracked by its own flagId via
// the shared textBtn() sent/unsend pattern above.
function textReminderBtn(r) {
  if (!r.invoicedAt || r.backfilled || PAID_FLAGS[r.key]) return '';
  const link = r.paymentReminderSms || r.sms;
  if (!r.phone || !link) return '';
  return textBtn('textReminder', r.key, link, '', 'Text reminder', 'var(--green)');
}

// "Just sent your invoice" text — on-demand only, meant for right after
// invoicing (before the 3-day follow-up or 5-day payment reminder would
// ever fire). Tracked under its own 'invoiceSent' flag, independent of
// the follow-up and payment-reminder flags.
function invoiceReminderBtn(r) {
  if (!r.invoicedAt || r.backfilled || PAID_FLAGS[r.key]) return '';
  if (!r.phone || !r.invoiceSentSms) return '';
  return textBtn('invoiceSent', r.key, r.invoiceSentSms, '', 'Text invoice sent', 'var(--green)');
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
