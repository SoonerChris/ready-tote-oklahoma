// POST /.netlify/functions/on-my-way
// Calculates live (traffic-aware) driving time from a starting address to a
// rental's delivery or pickup address, then returns a pre-filled "on our
// way" text message ready to send.
//
// Body: { secret, key, type: "delivery"|"pickup", origin? }
//   - key: the rental's blob key (same as used elsewhere on this page)
//   - origin: optional starting address; falls back to HOME_ADDRESS env var,
//     then to the hardcoded DEFAULT_HOME_ADDRESS below
//
// Env vars required:
//   GOOGLE_PLACES_API_KEY - same Google Cloud API key used for reviews.
//                           Must also have "Distance Matrix API" enabled
//                           (Google Cloud Console -> APIs & Services).
//   HOME_ADDRESS           - optional; overrides the hardcoded default below

import { getStore } from "@netlify/blobs";
import { smsLink } from "./lib-reminders.mjs";

const DEFAULT_HOME_ADDRESS = "313 SW 166th St, Oklahoma City, OK 73170";

export default async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (!process.env.INVOICE_SECRET || body.secret !== process.env.INVOICE_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { key, type } = body;
  if (!key || (type !== "delivery" && type !== "pickup")) {
    return json({ error: "Missing or invalid key/type" }, 400);
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return json({ error: "Missing GOOGLE_PLACES_API_KEY env var" }, 500);
  }

  const store = getStore("rentals");
  let rental;
  try { rental = await store.get(key, { type: "json" }); } catch {}
  if (!rental) return json({ error: "Rental not found" }, 404);

  const destination = type === "delivery"
    ? (rental.dropoffAddress || rental.address || "")
    : (rental.pickupAddress || rental.address || "");
  if (!destination) {
    return json({ error: "No address on file for this rental" }, 400);
  }

  const origin = (body.origin || "").trim() || process.env.HOME_ADDRESS || DEFAULT_HOME_ADDRESS;

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&departure_time=now&key=${apiKey}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "OK") {
      console.error("Distance Matrix API error:", data.status, data.error_message || "");
      return json({ error: "Google Maps error: " + data.status }, 502);
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") {
      return json({ error: "Could not calculate travel time for that address. Double check it and try again." }, 502);
    }

    const durationText = (element.duration_in_traffic || element.duration).text;
    const durationSeconds = (element.duration_in_traffic || element.duration).value;
    const arrivalTime = formatArrivalTime(new Date(Date.now() + durationSeconds * 1000));

    const first = (rental.name || "there").split(" ")[0];
    const action = type === "delivery" ? "deliver your totes" : "pick up your totes";
    const message = `Hi ${first}, it's Chris with Ready Tote Oklahoma! We're on our way to ${action} and should be there around ${arrivalTime}. See you soon!`;

    return json({ message, sms: smsLink(rental.phone, message), arrivalTime, durationText, origin, destination });
  } catch (e) {
    console.error("Distance Matrix fetch failed:", e.message);
    return json({ error: "Network error calculating travel time" }, 500);
  }
};

// Formats a Date as a friendly clock time in Central time, e.g. "12pm" or
// "12:15pm" (drops ":00" for on-the-hour times).
function formatArrivalTime(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const hour = parts.find((p) => p.type === "hour").value;
  const minute = parts.find((p) => p.type === "minute").value;
  const period = parts.find((p) => p.type === "dayPeriod").value.toLowerCase();

  return minute === "00" ? `${hour}${period}` : `${hour}:${minute}${period}`;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
