// Spam / junk checks for booking requests.
//
// Used by submission-created.mjs. The same rules (phone and Oklahoma ZIP) are
// repeated in plain JS inside index.html so real customers get a friendly
// message before sending; keep the two in sync if you change them.

// Minimum time between the page loading and the form being sent. A person
// can't read and fill in this form this fast; scripts can.
export const MIN_FILL_MS = 3000;

// Oklahoma ZIP codes all start with 73 or 74.
const OK_ZIP = /\b7[34]\d{3}\b/;

// "+1 (580) 399-3202", "580.399.3202" and "5803993202" are fine. Anything
// else (like a +49 German number) is not.
export function isUsPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 && /^[2-9]/.test(d);
}

export function hasOklahomaZip(text) {
  return OK_ZIP.test(String(text || ""));
}

// Returns a list of short reasons this request looks like junk. Empty list
// means it looks fine.
//   phone       - phone number as typed
//   addressText - delivery address as typed (one line)
//   selfPickup  - true when no delivery address is needed
//   fillMs      - milliseconds the page measured between loading and
//                 sending (hidden fill_ms field). It's elapsed time, not a
//                 clock time, so a wrong phone clock can't cause a false flag.
export function suspectReasons({ phone, addressText, selfPickup, fillMs }) {
  const reasons = [];

  if (!isUsPhone(phone)) reasons.push("phone is not a US number");

  if (!selfPickup && !hasOklahomaZip(addressText)) {
    reasons.push("delivery address has no Oklahoma zip code");
  }

  // Only judged when the page sent it (older cached pages won't).
  const ms = Number(fillMs);
  if (String(fillMs ?? "").trim() !== "" && Number.isFinite(ms) && ms >= 0 && ms < MIN_FILL_MS) {
    reasons.push("form was sent in under " + MIN_FILL_MS / 1000 + " seconds");
  }

  return reasons;
}
