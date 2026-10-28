// Customer links that open a page for one rental without logging in.
//
// The pickup-address link (readytoteokc.com/a/CODE, address.html and
// pickup-address.mjs) uses a code made from the rental's key with the
// site's secret (SESSION_SECRET, else INVOICE_SECRET), so nothing has to be
// stored and the same rental always gets the same link. Without a secret
// there's no link and the texts ask for a reply instead.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function linkKey(purpose) {
  const base = process.env.SESSION_SECRET || process.env.INVOICE_SECRET;
  return base ? createHash("sha256").update(`rto-link-${purpose}-v1:` + base).digest() : null;
}

export function addressCode(rentalKey) {
  const k = linkKey("address");
  return k && rentalKey ? createHmac("sha256", k).update(String(rentalKey)).digest("base64url").slice(0, 18) : "";
}

export const addressLink = (rentalKey) => {
  const code = addressCode(rentalKey);
  return code ? "readytoteokc.com/a/" + code : "";
};

// The rental key a code belongs to, from a list of keys (constant-time compare)
export function keyForAddressCode(code, keys) {
  const want = Buffer.from(String(code || ""));
  if (want.length !== 18) return null;
  for (const key of keys) {
    const got = Buffer.from(addressCode(key));
    if (got.length === want.length && timingSafeEqual(got, want)) return key;
  }
  return null;
}
