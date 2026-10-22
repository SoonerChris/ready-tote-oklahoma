// Driving distance and time between addresses, for "On the way" ETAs
// (on-my-way.mjs) and round-trip mileage (trip-miles.mjs).
//
// Uses Google's Routes API (Compute Route Matrix). Google moved the older
// Distance Matrix API to legacy and it can't be turned on for new Cloud
// projects, so it's only tried as a fallback for keys that still have it.
// The key needs "Routes API" enabled (and allowed, if the key restricts APIs).
//
// routeMatrix(apiKey, origins, destinations, { traffic })
//   -> grid[i][j] = { meters, seconds } or null when there's no route

export async function routeMatrix(apiKey, origins, destinations, { traffic = false } = {}) {
  try {
    return await viaRoutesApi(apiKey, origins, destinations, traffic);
  } catch (routesErr) {
    try {
      return await viaLegacyDistanceMatrix(apiKey, origins, destinations, traffic);
    } catch {
      throw routesErr;   // the Routes API error says what to fix
    }
  }
}

async function viaRoutesApi(apiKey, origins, destinations, traffic) {
  const resp = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration,condition",
    },
    body: JSON.stringify({
      origins: origins.map((address) => ({ waypoint: { address } })),
      destinations: destinations.map((address) => ({ waypoint: { address } })),
      travelMode: "DRIVE",
      routingPreference: traffic ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE",
    }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !Array.isArray(data)) {
    const status = data?.error?.status || data?.[0]?.error?.status || resp.status;
    const hint = status === "PERMISSION_DENIED" || resp.status === 403
      ? "Turn on the Routes API for your Google key (Google Cloud, APIs & Services)." : "";
    throw new Error(`Google Maps error: ${status}. ${hint}`.trim());
  }
  const grid = origins.map(() => destinations.map(() => null));
  for (const el of data) {
    if (el.condition !== "ROUTE_EXISTS") continue;
    grid[el.originIndex ?? 0][el.destinationIndex ?? 0] = {
      meters: el.distanceMeters ?? 0,
      seconds: parseInt(String(el.duration || "0").replace(/s$/, ""), 10) || 0,
    };
  }
  return grid;
}

async function viaLegacyDistanceMatrix(apiKey, origins, destinations, traffic) {
  const url = "https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial"
    + `&origins=${encodeURIComponent(origins.join("|"))}&destinations=${encodeURIComponent(destinations.join("|"))}`
    + (traffic ? "&departure_time=now" : "") + `&key=${apiKey}`;
  const data = await (await fetch(url)).json();
  if (data.status !== "OK") throw new Error("Google Maps error: " + data.status);
  return data.rows.map((row) => row.elements.map((e) => e.status === "OK"
    ? { meters: e.distance.value, seconds: (e.duration_in_traffic || e.duration).value } : null));
}
