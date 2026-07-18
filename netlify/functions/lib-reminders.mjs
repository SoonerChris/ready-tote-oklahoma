// Shared logic: given the rental log, compute which reminder texts are due today.
// "Today" is computed in Oklahoma time (America/Chicago).

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

function friendlyDate(isoDate) {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export function computeReminders(rentals, reviewLink, sentFlags = {}) {
  const today = todayInOklahoma();
  const out = { delivery: [], pickup: [], review: [] };

  for (const r of rentals) {
    const first = (r.name || "there").split(" ")[0];
    const dropAddr = r.dropoffAddress || r.address || "";
    const pickAddr = r.pickupAddress || r.address || "";
    const self = r.serviceType === "self";

    // Delivery reminder: drop-off is tomorrow
    if (r.dropoffDate === shiftDate(today, 1)) {
      const msg = self
        ? `Hi ${first}, it's Ready Tote Oklahoma! Reminder: your totes are ready for pickup tomorrow (${friendlyDate(r.dropoffDate)}) around ${r.dropoffTime}. See you then!`
        : `Hi ${first}, it's Ready Tote Oklahoma! Friendly reminder: your totes arrive tomorrow (${friendlyDate(r.dropoffDate)}) around ${r.dropoffTime}. Reply here with any questions!`;
      const flagId = "delivery:" + (r.key || r.phone + r.dropoffDate);
      if (!sentFlags[flagId]) out.delivery.push({ ...r, flagId, address: self ? "Customer pickup" : dropAddr, message: msg, sms: smsLink(r.phone, msg) });
    }

    // Pickup reminder: pickup is in 2 days
    if (r.pickupDate === shiftDate(today, 2)) {
      const msg = self
        ? `Hi ${first}, Ready Tote Oklahoma here. Friendly reminder to return your totes on ${friendlyDate(r.pickupDate)} around ${r.pickupTime}. Thanks!`
        : `Hi ${first}, Ready Tote Oklahoma here. We'll pick up your totes on ${friendlyDate(r.pickupDate)} around ${r.pickupTime}. Please have them empty and accessible. Thanks!`;
      const flagId = "pickup:" + (r.key || r.phone + r.pickupDate);
      if (!sentFlags[flagId]) out.pickup.push({ ...r, flagId, address: self ? "Customer return" : pickAddr, message: msg, sms: smsLink(r.phone, msg) });
    }

    // Review request: pickup was 3 days ago
    if (r.pickupDate === shiftDate(today, -3)) {
      const link = reviewLink || "[ADD GOOGLE_REVIEW_LINK ENV VAR]";
      const msg = `Hi ${first}, thanks for renting with Ready Tote Oklahoma! If we made your move easier, we'd love a quick Google review: ${link}`;
      const flagId = "review:" + (r.key || r.phone + r.pickupDate);
      if (!sentFlags[flagId]) out.review.push({ ...r, flagId, address: self ? "" : pickAddr, message: msg, sms: smsLink(r.phone, msg) });
    }
  }
  return out;
}

export function reviewMessageFor(rental, reviewLink) {
  const first = (rental.name || "there").split(" ")[0];
  const link = reviewLink || "[ADD GOOGLE_REVIEW_LINK ENV VAR]";
  const msg = `Hi ${first}, thanks for renting with Ready Tote Oklahoma! If we made your move easier, we'd love a quick Google review: ${link}`;
  return { message: msg, sms: smsLink(rental.phone, msg) };
}
