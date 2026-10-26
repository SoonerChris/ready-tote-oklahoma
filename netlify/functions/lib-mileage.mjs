// Business mileage for deliveries and pickups.
//
// roundTripMiles() is the home -> stop -> home driving distance (Routes API
// via lib-routes.mjs), used by trip-miles.mjs (the Finance "fill in miles"
// button) and by logTrip() below.
//
// logTrip() runs when a stop is marked Delivered or Picked up (edit-rental
// .mjs): it adds the trip to Finance's mileage log, tied to the rental and
// leg so Finance counts it as logged. It skips customer pick-ups, the
// handover legs of an extension, trips already logged or cleared on
// Finance, and everything when the switch is off (settings.mjs).
// unlogTrip() takes back a trip it logged, for Undo.
//
// One car carries up to 40 totes. A bigger rental takes two cars (three
// past 80), and every car drives the round trip, so the miles multiply.

import { getStore } from "@netlify/blobs";
import { routeMatrix } from "./lib-routes.mjs";
import { dropoffAddressOf, pickupAddressOf } from "./lib-reminders.mjs";
import { getSettings } from "./settings.mjs";
import { totesFor } from "./lib-stock.mjs";

export const DEFAULT_HOME_ADDRESS = "313 SW 166th St, Oklahoma City, OK 73170";
const METERS_PER_MILE = 1609.344;
export const TOTES_PER_CAR = 40;

export const carsFor = (rental) => Math.max(1, Math.ceil(totesFor(rental || {}) / TOTES_PER_CAR));
const times = (miles, cars) => Math.round(miles * cars * 10) / 10;

export const homeAddress = () => process.env.HOME_ADDRESS || DEFAULT_HOME_ADDRESS;

// Out and back as two legs, since one-way distance can differ by direction.
// Returns miles to one decimal, or throws.
export async function roundTripMiles(apiKey, origin, destination) {
  const grid = await routeMatrix(apiKey, [origin, destination], [destination, origin]);
  const out = grid[0][0], back = grid[1][1];
  if (!out || !back) throw new Error("Couldn't find a driving route to that address. Check it and try again.");
  return Math.round(((out.meters + back.meters) / METERS_PER_MILE) * 10) / 10;
}

const okDate = (at = new Date()) => at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

async function tripsFor(store, rentalKey, leg) {
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    if (!b.key.startsWith("mile_")) continue;
    const m = await store.get(b.key, { type: "json" }).catch(() => null);
    if (m && m.rentalKey === rentalKey && m.leg === leg) out.push({ key: b.key, ...m });
  }
  return out;
}

// Returns { logged: miles } or { skipped: reason }. Never throws: a failed
// lookup just leaves the trip for Finance's "not logged" list.
export async function logTrip(rentalKey, rental, leg, at = new Date()) {
  try {
    if (!(await getSettings()).autoMileage) return { skipped: "switched off" };
    if (rental.serviceType === "self") return { skipped: "customer pick-up" };
    if (leg === "delivery" && rental.extendsKey) return { skipped: "extension, no delivery" };
    if (leg === "pickup" && rental.extendedBy) return { skipped: "extended, no pickup" };
    const destination = leg === "delivery" ? dropoffAddressOf(rental) : pickupAddressOf(rental);
    if (!destination) return { skipped: "no address" };
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return { skipped: "no Google key" };
    const store = getStore({ name: "finance", consistency: "strong" });
    if ((await tripsFor(store, rentalKey, leg)).length) return { skipped: "already logged" };
    let skips = {};
    try { skips = (await getStore({ name: "meta", consistency: "strong" }).get("tripSkips", { type: "json" })) || {}; } catch {}
    if (skips[`${rentalKey}:${leg}`]) return { skipped: "cleared on Finance" };

    const cars = carsFor(rental);
    const miles = times(await roundTripMiles(apiKey, homeAddress(), destination), cars);
    const date = okDate(at);
    await store.setJSON(`mile_${date}_${Date.now()}`, {
      date,
      purpose: `${leg === "delivery" ? "Deliver" : "Pick up"}, ${rental.name || "customer"}${cars > 1 ? ` (${cars} cars)` : ""}, ${destination}`.slice(0, 200),
      miles, rentalKey, leg, auto: true, ...(cars > 1 ? { cars } : {}),
    });
    return { logged: miles };
  } catch (e) {
    console.error("Automatic trip log failed:", e.message);
    return { skipped: "lookup failed" };
  }
}

// Undo of Delivered / Picked up: remove the trip logTrip() added (a trip
// typed in by hand stays).
export async function unlogTrip(rentalKey, leg) {
  try {
    const store = getStore({ name: "finance", consistency: "strong" });
    for (const t of await tripsFor(store, rentalKey, leg)) if (t.auto) await store.delete(t.key);
  } catch (e) {
    console.error("Automatic trip removal failed:", e.message);
  }
}
