// POST /.netlify/functions/trip-miles
// Round-trip driving miles from home to a rental's drop-off or pickup
// address and back, for logging business mileage on Finance. Uses the
// Routes API through lib-routes.mjs, same as on-my-way.mjs.
// Admin only (signed-in session, see lib-auth.mjs).
//
// Body: { key, type: "delivery" | "pickup", origin? }
//
// Env vars:
//   GOOGLE_PLACES_API_KEY - same Google Cloud API key used for reviews
//   HOME_ADDRESS          - optional; where trips start and end

import { getStore } from "@netlify/blobs";
import { dropoffAddressOf, pickupAddressOf } from "./lib-reminders.mjs";
import { isAdmin } from "./lib-auth.mjs";
import { routeMatrix } from "./lib-routes.mjs";

const DEFAULT_HOME_ADDRESS = "313 SW 166th St, Oklahoma City, OK 73170";
const METERS_PER_MILE = 1609.344;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!isAdmin(request, body)) return json({ error: "Unauthorized" }, 401);
  if (!body.key || (body.type !== "delivery" && body.type !== "pickup")) return json({ error: "Missing or invalid key/type" }, 400);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return json({ error: "Missing GOOGLE_PLACES_API_KEY env var" }, 500);

  let rental;
  try { rental = await getStore({ name: "rentals", consistency: "strong" }).get(body.key, { type: "json" }); } catch {}
  if (!rental) return json({ error: "Rental not found" }, 404);
  const destination = body.type === "delivery" ? dropoffAddressOf(rental) : pickupAddressOf(rental);
  if (!destination) return json({ error: "No address on file for this rental" }, 400);
  const origin = String(body.origin || "").trim() || process.env.HOME_ADDRESS || DEFAULT_HOME_ADDRESS;

  try {
    // Out and back as two legs, since one-way distance can differ by direction
    const grid = await routeMatrix(apiKey, [origin, destination], [destination, origin]);
    const out = grid[0][0], back = grid[1][1];
    if (!out || !back) {
      return json({ error: "Couldn't find a driving route to that address. Check it and try again." }, 502);
    }
    const miles = Math.round(((out.meters + back.meters) / METERS_PER_MILE) * 10) / 10;
    return json({ miles, destination, origin });
  } catch (e) {
    console.error("trip-miles failed:", e.message);
    return json({ error: e.message || "Network error calculating miles" }, 502);
  }
};
