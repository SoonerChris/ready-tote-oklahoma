// How far a delivery address is, and what that costs.
//
// Free delivery: within FREE_MILES driving miles of home (the OKC zone), or
// within ADA_FREE_MILES of Ada (the Ada zone). Outside both, a flat fee by
// band from home: BANDS below; past the last band you quote it yourself.
// The same numbers are on the booking form, the FAQ and the delivery-area
// section of index.html, and in admin-invoice.html's mileage note.
//
// checkDistance(address) -> { miles, adaMiles, zone: "okc"|"ada"|"outside",
//   fee: 0 | dollars | null (quote it), label, checkedAt } or null when it
//   can't be worked out (no address, no Google key, no route).

import { routeMatrix } from "./lib-routes.mjs";
import { homeAddress } from "./lib-mileage.mjs";

export const FREE_MILES = 30;
export const ADA_FREE_MILES = 15;
export const ADA_CENTER = "Ada, OK";
export const BANDS = [{ upTo: 40, fee: 25 }, { upTo: 50, fee: 50 }];   // past 50: quote
const METERS_PER_MILE = 1609.344;

export function feeFor(miles, adaMiles) {
  if (miles <= FREE_MILES) return { zone: "okc", fee: 0, label: "Free delivery area" };
  if (adaMiles !== null && adaMiles <= ADA_FREE_MILES) return { zone: "ada", fee: 0, label: "Free delivery area (Ada)" };
  let from = FREE_MILES;
  for (const b of BANDS) {
    if (miles <= b.upTo) return { zone: "outside", fee: b.fee, label: `$${b.fee} mileage charge (${from} to ${b.upTo} miles)` };
    from = b.upTo;
  }
  return { zone: "outside", fee: null, label: `Over ${from} miles: quote the mileage charge` };
}

export async function checkDistance(address) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!address || !apiKey) return null;
  try {
    const grid = await routeMatrix(apiKey, [homeAddress(), ADA_CENTER], [address]);
    const home = grid[0][0], ada = grid[1][0];
    if (!home) return null;
    const miles = Math.round((home.meters / METERS_PER_MILE) * 10) / 10;
    const adaMiles = ada ? Math.round((ada.meters / METERS_PER_MILE) * 10) / 10 : null;
    return { miles, adaMiles, ...feeFor(miles, adaMiles), checkedAt: new Date().toISOString() };
  } catch (e) {
    console.error("Distance check failed:", e.message);
    return null;
  }
}
