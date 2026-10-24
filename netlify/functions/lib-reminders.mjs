// Shared logic: given the rental log, compute which reminder texts are due today.
// "Today" is computed in Oklahoma time (America/Chicago).

// Shows any stored time as "2:30 PM", even older records saved as "14:30".
// Who customer texts are from. Change it here (and TEXT_SIGNER in
// admin-shared.js for the texts built in the browser) if someone else sends.
export const SIGNER = "Chris with Ready Tote Oklahoma";
const PHONE = "580.399.3202";
const hi = (first) => `Hi ${first}, it's ${SIGNER}!`;

export function friendlyTime(t) {
  const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  return (h % 12 || 12) + ":" + m[2] + " " + (h >= 12 ? "PM" : "AM");
}

export function todayInOklahoma() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // YYYY-MM-DD
}

function shiftDate(isoDate, days) {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits ? "+" + digits : "";
}

export function smsLink(phone, message) {
  // ?& form works across iOS and Android
  return `sms:${normalizePhone(phone)}?&body=${encodeURIComponent(message)}`;
}

// ---- Address composition ----
// Rentals store addresses as separate street/city/state/zip fields. This
// joins them into one display/lookup string, same logic as formatAddress
// in admin-shared.js, kept in sync intentionally. Returns "" if every
// part is blank.
export function formatAddress(street, city, state, zip) {
  const line2 = [city, state].filter(Boolean).join(", ");
  return [street, [line2, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

// Records saved before the street/city/state/zip split still have a
// single combined string under the old field name (dropoffAddress/
// pickupAddress, or the oldest records' plain address). These fall back
// to that legacy string so old records keep working without a migration.
export function dropoffAddressOf(rental) {
  return formatAddress(rental.dropoffAddressStreet, rental.dropoffAddressCity, rental.dropoffAddressState, rental.dropoffAddressZip)
    || rental.dropoffAddress || rental.address || "";
}
export function pickupAddressOf(rental) {
  return formatAddress(rental.pickupAddressStreet, rental.pickupAddressCity, rental.pickupAddressState, rental.pickupAddressZip)
    || rental.pickupAddress || rental.address || "";
}

// The pickup address on file is often just a copy of the drop-off address
// (the invoice form defaults to "same as drop-off", and legacy records fall
// back to one combined address). For the "confirm pickup address" check that
// copy is never a confirmed pickup address, so it is treated as unknown.
// Returns "" when the pickup address is blank or matches the drop-off address.
function normalizeAddress(a) {
  return String(a || "").toLowerCase().replace(/[\s,.]+/g, " ").trim();
}
export function confirmedPickupAddressOf(rental) {
  const pick = pickupAddressOf(rental);
  if (!pick) return "";
  return normalizeAddress(pick) === normalizeAddress(dropoffAddressOf(rental)) ? "" : pick;
}

function friendlyDate(isoDate) {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

// Each reminder has a due day and a last day it still makes sense to send.
// It shows from its due day until it's marked sent or its last day passes,
// so a day the dashboard isn't opened doesn't mean a missed text. Items
// carry dueDate and overdue (true once today is past the due day).
//
//   delivery          day before drop-off      -> drop-off day ("today" wording on the day)
//   pickup (2 days)   2 days before pickup     -> that day only; "pickup tomorrow" is its catch-up
//   pickupTomorrow    day before pickup        -> pickup day ("today" wording on the day)
//   addressCheck      5 days before pickup     -> 2 days before pickup
//   review            3 days after pickup      -> 14 days after pickup
//   followup          3 days after invoicing   -> 4 days after; unpaid, no payment reminder sent yet
//   emailReminder     5 days after invoicing   -> 30 days after, unpaid; waits 2 days after a
//                     follow-up text, and clears when either the email or the text reminder is sent
//
// Two days before pickup the address check and the "pickup in 2 days" text
// would both go to the same person, so that day the address check carries
// the pickup reminder too and "pickup in 2 days" is skipped. Review texts
// are skipped entirely while GOOGLE_REVIEW_LINK isn't set.
export function computeReminders(rentals, reviewLink, sentFlags = {}, paidFlags = {}) {
  const today = todayInOklahoma();
  // The Oklahoma date a flag was set ("" if never)
  const sentOn = (id) => {
    const v = sentFlags[id]; if (!v) return "";
    const d = new Date(v); return isNaN(d) ? "" : d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  };
  const out = { delivery: [], pickupTomorrow: [], pickup: [], review: [], followup: [], emailReminder: [], addressCheck: [] };
  const open = (due, last) => today >= due && today <= last;
  const timing = (due) => ({ dueDate: due, overdue: today > due });

  for (const r of rentals) {
    if (r.cancelled) continue;   // cancelled rentals get no texts
    const first = (r.name || "there").split(" ")[0];
    const dropAddr = dropoffAddressOf(r);
    const pickAddr = pickupAddressOf(r);
    const self = r.serviceType === "self";

    // Confirm pickup address: delivery-service rentals only (self-service has
    // no real pickup address to confirm). Catches cases where the address on
    // file was a placeholder or has since changed.
    if (!self && !r.pickedUpAt && r.pickupDate && open(shiftDate(r.pickupDate, -5), shiftDate(r.pickupDate, -2))) {
      const flagId = "addressCheck:" + (r.key || r.phone + r.pickupDate);
      if (!sentFlags[flagId]) {
        const { message, sms } = pickupAddressRequestMessageFor(r, { withPickup: today === shiftDate(r.pickupDate, -2) });
        out.addressCheck.push({ ...r, flagId, ...timing(shiftDate(r.pickupDate, -5)), address: confirmedPickupAddressOf(r) || "Pickup address not confirmed yet", message, sms });
      }
    }

    // Invoice follow-up: skip historical backfilled entries and paid invoices
    const paymentNudged = sentFlags["emailReminder:" + r.key] || sentFlags["textReminder:" + r.key];
    if (!r.backfilled && r.invoicedAt && !paidFlags[r.key] && !paymentNudged) {
      const invoicedDate = r.invoicedAt.slice(0, 10);
      if (open(shiftDate(invoicedDate, 3), shiftDate(invoicedDate, 4))) {
        const msg = `${hi(first)} Just wanted to make sure you got the invoice we sent over for your tote rental. Let me know if you have any questions, happy to help however I can!`;
        const flagId = "followup:" + (r.key || r.phone + invoicedDate);
        if (!sentFlags[flagId]) {
          out.followup.push({ ...r, flagId, ...timing(shiftDate(invoicedDate, 3)), address: `Invoiced ${friendlyDate(invoicedDate)}`, message: msg, sms: smsLink(r.phone, msg) });
        }
      }
    }

    // Email/text payment reminder: still unpaid 5+ days after invoicing, skip backfilled entries
    if (!r.backfilled && r.invoicedAt && !paidFlags[r.key] && !paymentNudged) {
      const invoicedDate = r.invoicedAt.slice(0, 10);
      const followedUp = sentOn("followup:" + r.key);
      let due = shiftDate(invoicedDate, 5);
      if (followedUp && shiftDate(followedUp, 2) > due) due = shiftDate(followedUp, 2);
      if (open(due, shiftDate(invoicedDate, 30))) {
        const flagId = "emailReminder:" + (r.key || r.phone + invoicedDate);
        if (!sentFlags[flagId]) {
          const { message, sms } = paymentReminderMessageFor(r);
          out.emailReminder.push({ ...r, flagId, ...timing(due), message, sms });
        }
      }
    }

    // Delivery reminder: the day before drop-off, or on the day if missed.
    // Not once it's marked delivered (or picked up) on the Dashboard.
    if (r.dropoffDate && !r.deliveredAt && !r.pickedUpAt && open(shiftDate(r.dropoffDate, -1), r.dropoffDate)) {
      const when = r.dropoffDate === today ? "today" : "tomorrow";
      const msg = self
        ? `${hi(first)} Reminder: your totes are ready for pickup ${when} (${friendlyDate(r.dropoffDate)}) around ${friendlyTime(r.dropoffTime)}. See you then!`
        : `${hi(first)} Friendly reminder: your totes arrive ${when} (${friendlyDate(r.dropoffDate)}) around ${friendlyTime(r.dropoffTime)}. Reply here with any questions!`;
      const flagId = "delivery:" + (r.key || r.phone + r.dropoffDate);
      if (!sentFlags[flagId]) out.delivery.push({ ...r, flagId, ...timing(shiftDate(r.dropoffDate, -1)), address: self ? "Customer pickup" : dropAddr, message: msg, sms: smsLink(r.phone, msg) });
    }

    // Pickup reminder: the day before pickup, or on the day if missed.
    // Not once it's marked picked up (totes came back early).
    if (r.pickupDate && !r.pickedUpAt && open(shiftDate(r.pickupDate, -1), r.pickupDate)) {
      const when = r.pickupDate === today ? "today" : "tomorrow";
      const msg = self
        ? `${hi(first)} Reminder: please have your totes ready for return ${when} (${friendlyDate(r.pickupDate)}) around ${friendlyTime(r.pickupTime)}. Thanks!`
        : `${hi(first)} Reminder: we'll be picking up your totes ${when} (${friendlyDate(r.pickupDate)}) around ${friendlyTime(r.pickupTime)}. Please have them empty and accessible. Thanks!`;
      const flagId = "pickupTomorrow:" + (r.key || r.phone + r.pickupDate);
      if (!sentFlags[flagId]) out.pickupTomorrow.push({ ...r, flagId, ...timing(shiftDate(r.pickupDate, -1)), address: self ? "Customer return" : pickAddr, message: msg, sms: smsLink(r.phone, msg) });
    }

    // Pickup reminder: pickup is in 2 days (the day-before text covers a miss)
    // Skipped when the address check (still due, or sent today) carries it
    const addrId = "addressCheck:" + (r.key || r.phone + r.pickupDate);
    const carriedByAddressCheck = !self && (!sentFlags[addrId] || sentOn(addrId) === today);
    if (r.pickupDate === shiftDate(today, 2) && !r.pickedUpAt && !carriedByAddressCheck) {
      const msg = self
        ? `${hi(first)} Friendly reminder to return your totes on ${friendlyDate(r.pickupDate)} around ${friendlyTime(r.pickupTime)}. Thanks!`
        : `${hi(first)} We'll pick up your totes on ${friendlyDate(r.pickupDate)} around ${friendlyTime(r.pickupTime)}. Please have them empty and accessible. Thanks!`;
      const flagId = "pickup:" + (r.key || r.phone + r.pickupDate);
      if (!sentFlags[flagId]) out.pickup.push({ ...r, flagId, ...timing(today), address: self ? "Customer return" : pickAddr, message: msg, sms: smsLink(r.phone, msg) });
    }

    // Review request: from 3 days after pickup, for up to two weeks. Not
    // while it's marked delivered but not yet picked up (a late pickup).
    const stillOut = r.deliveredAt && !r.pickedUpAt;
    if (reviewLink && r.pickupDate && !stillOut && open(shiftDate(r.pickupDate, 3), shiftDate(r.pickupDate, 14))) {
      const link = reviewLink;
      const msg = `${hi(first)} Thanks for renting with us. If we made your move easier, we'd love a quick Google review: ${link}`;
      const flagId = "review:" + (r.key || r.phone + r.pickupDate);
      if (!sentFlags[flagId]) out.review.push({ ...r, flagId, ...timing(shiftDate(r.pickupDate, 3)), address: self ? "" : pickAddr, message: msg, sms: smsLink(r.phone, msg) });
    }
  }
  return out;
}

export function pickupAddressRequestMessageFor(rental, { withPickup = false } = {}) {
  const first = (rental.name || "there").split(" ")[0];
  const onFile = confirmedPickupAddressOf(rental);
  // Two days out: one text covering the pickup reminder and the address
  if (withPickup) {
    const when = `${friendlyDate(rental.pickupDate)} around ${friendlyTime(rental.pickupTime)}`;
    const msg = onFile
      ? `${hi(first)} We'll pick up your totes on ${when}. We have your pickup address as ${onFile}. Is that still right? Please have the totes empty and accessible. Thanks!`
      : `${hi(first)} We'll pick up your totes on ${when}. What address should we pick them up from? Please reply with the full street address, city, and zip. Thanks!`;
    return { message: msg, sms: smsLink(rental.phone, msg) };
  }
  const msg = onFile
    ? `${hi(first)} Quick check before we pick up your totes on ${friendlyDate(rental.pickupDate)}. We have your pickup address as ${onFile}. Let us know if that's still correct, or send us the right address if it's changed!`
    : `${hi(first)} Quick check before we pick up your totes on ${friendlyDate(rental.pickupDate)}. What address should we pick them up from? Please reply with the full street address, city, and zip. Thanks!`;
  return { message: msg, sms: smsLink(rental.phone, msg) };
}

export function reviewMessageFor(rental, reviewLink) {
  const first = (rental.name || "there").split(" ")[0];
  // No link set: no review text at all, rather than a placeholder
  if (!reviewLink) return { message: "", sms: "" };
  const link = reviewLink;
  const msg = `${hi(first)} Thanks for renting with us. If we made your move easier, we'd love a quick Google review: ${link}`;
  return { message: msg, sms: smsLink(rental.phone, msg) };
}

export function followupMessageFor(rental) {
  const first = (rental.name || "there").split(" ")[0];
  const msg = `${hi(first)} Just wanted to make sure you got the invoice we sent over for your tote rental. Let me know if you have any questions, happy to help however I can!`;
  return { message: msg, sms: smsLink(rental.phone, msg) };
}

// "Just sent your invoice" nudge: on-demand only (no due date of its own),
// meant to go out right when an invoice is sent, before the 3-day follow-up
// or 5-day payment reminder would ever fire.
export function invoiceSentMessageFor(rental) {
  const first = (rental.name || "there").split(" ")[0];
  const link = rental.stripeUrl || "";
  const msg = link
    ? `${hi(first)} Just sent your invoice over. Here's the payment link: ${link} Let me know if you have any questions!`
    : `${hi(first)} Just sent your invoice over. Check your email for the payment link. Let me know if you have any questions!`;
  return { message: msg, sms: smsLink(rental.phone, msg) };
}

export function paymentReminderMessageFor(rental) {
  const first = (rental.name || "there").split(" ")[0];
  const link = rental.stripeUrl || "";
  const msg = link
    ? `${hi(first)} Just checking in, your tote rental invoice is still open. Here's your payment link again: ${link} Let me know if you have any questions!`
    : `${hi(first)} Just checking in, your tote rental invoice is still open. Let me know if you'd like me to resend the payment link!`;
  return { message: msg, sms: smsLink(rental.phone, msg) };
}

export function deliveryMessageFor(rental) {
  const first = (rental.name || "there").split(" ")[0];
  const self = rental.serviceType === "self";
  const msg = self
    ? `${hi(first)} Reminder: your totes are ready for pickup (${friendlyDate(rental.dropoffDate)}) around ${friendlyTime(rental.dropoffTime)}. See you then!`
    : `${hi(first)} Friendly reminder: your totes arrive ${friendlyDate(rental.dropoffDate)} around ${friendlyTime(rental.dropoffTime)}. Reply here with any questions!`;
  return { message: msg, sms: smsLink(rental.phone, msg) };
}

export function pickupTomorrowMessageFor(rental) {
  const first = (rental.name || "there").split(" ")[0];
  const self = rental.serviceType === "self";
  const msg = self
    ? `${hi(first)} Reminder: please have your totes ready for return tomorrow (${friendlyDate(rental.pickupDate)}) around ${friendlyTime(rental.pickupTime)}. Thanks!`
    : `${hi(first)} Reminder: we'll be picking up your totes tomorrow (${friendlyDate(rental.pickupDate)}) around ${friendlyTime(rental.pickupTime)}. Please have them empty and accessible. Thanks!`;
  return { message: msg, sms: smsLink(rental.phone, msg) };
}

export function pickupMessageFor(rental) {
  const first = (rental.name || "there").split(" ")[0];
  const self = rental.serviceType === "self";
  const msg = self
    ? `${hi(first)} Friendly reminder to return your totes on ${friendlyDate(rental.pickupDate)} around ${friendlyTime(rental.pickupTime)}. Thanks!`
    : `${hi(first)} We'll pick up your totes on ${friendlyDate(rental.pickupDate)} around ${friendlyTime(rental.pickupTime)}. Please have them empty and accessible. Thanks!`;
  return { message: msg, sms: smsLink(rental.phone, msg) };
}

// ---- ICS calendar file generation ----
export function generateICS(event) {
  // event: { title, date (YYYY-MM-DD), time (e.g. "10:00 AM"), durationMinutes, location, description }
  const dt = parseDateTime(event.date, event.time);
  const end = new Date(dt.getTime() + (event.durationMinutes || 60) * 60000);
  const uid = `${event.date}-${Date.now()}@readytoteokc.com`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ready Tote Oklahoma//readytoteokc.com//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${icsDate(dt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    event.location ? `LOCATION:${icsEscape(event.location)}` : '',
    event.description ? `DESCRIPTION:${icsEscape(event.description)}` : '',
    'STATUS:CONFIRMED',
    `BEGIN:VALARM`,
    `TRIGGER:-PT1H`,
    `ACTION:DISPLAY`,
    `DESCRIPTION:Reminder`,
    `END:VALARM`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function parseDateTime(dateStr, timeStr) {
  // "2026-07-23" + "10:00 AM" -> Date in Central time (UTC-5 or -6)
  let hours = 10, minutes = 0;
  if (timeStr) {
    const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (m) {
      hours = parseInt(m[1]);
      minutes = parseInt(m[2]);
      if (m[3]) {
        const pm = m[3].toUpperCase() === 'PM';
        if (pm && hours < 12) hours += 12;
        if (!pm && hours === 12) hours = 0;
      }
    }
  }
  // Assume Central time: UTC-5 (CDT) as a reasonable default
  const utcHours = hours + 5;
  return new Date(`${dateStr}T${String(utcHours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00Z`);
}

function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Calendar files for a rental's drop-off and pickup. The default wording is
// for us (daily digest); { forCustomer: true } words it for the customer's
// own calendar (invoice and receipt emails).
export function rentalToICSAttachments(rental, { forCustomer = false } = {}) {
  const first = (rental.name || 'Customer').split(' ')[0];
  const self = rental.serviceType === 'self';
  const ours = `Ready Tote Oklahoma: ${PHONE}`;
  const legs = [
    {
      date: rental.dropoffDate, time: rental.dropoffTime, file: 'delivery',
      location: self ? '' : dropoffAddressOf(rental),
      title: forCustomer ? (self ? 'Pick up your totes (Ready Tote Oklahoma)' : 'Totes delivered (Ready Tote Oklahoma)')
        : (self ? `Tote Pickup — ${rental.name}` : `Tote Delivery — ${rental.name}`),
      description: forCustomer
        ? `${rental.package}\n${self ? 'Pick up your totes from us.' : 'We drop off your totes. We\'ll text when we\'re on the way.'}\n${ours}`
        : `${rental.package}\n${self ? 'Customer picks up totes' : 'Deliver totes to customer'}\nPhone: ${rental.phone || ''}`,
    },
    {
      date: rental.pickupDate, time: rental.pickupTime, file: 'pickup',
      location: self ? '' : pickupAddressOf(rental),
      title: forCustomer ? (self ? 'Return your totes (Ready Tote Oklahoma)' : 'Tote pickup (Ready Tote Oklahoma)')
        : (self ? `Tote Return — ${rental.name}` : `Tote Pickup — ${rental.name}`),
      description: forCustomer
        ? `${rental.package}\n${self ? 'Bring the totes back, empty.' : 'Have the totes empty and ready.'} Need them longer? Let us know before today.\n${ours}`
        : `${rental.package}\n${self ? 'Customer returns totes' : 'Pick up totes from customer'}\nPhone: ${rental.phone || ''}`,
    },
  ];
  return legs.map((l) => ({
    filename: forCustomer ? `ready-tote-${l.file}-${l.date}.ics` : `${l.file}-${first}-${l.date}.ics`,
    content: Buffer.from(generateICS({ title: l.title, date: l.date, time: l.time || '10:00 AM', durationMinutes: 30, location: l.location, description: l.description })).toString('base64'),
  }));
}
