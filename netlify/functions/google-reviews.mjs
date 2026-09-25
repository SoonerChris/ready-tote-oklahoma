// GET /.netlify/functions/google-reviews
// Fetches real Google Place reviews via the Places API, caches for 24 hours
// in Netlify Blobs to avoid hitting the API on every page load.
//
// Reviews are fetched newest-first via the Legacy Place Details API
// (reviews_sort=newest). The New Places API has no sort parameter, it
// always returns up to 5 reviews chosen by Google's relevance algorithm,
// which is often NOT the newest ones, so it's kept only as a fallback if
// the legacy call fails. Confirmed via Google's official docs, Sept 2026.
//
// Env vars required:
//   GOOGLE_PLACES_API_KEY - Google Cloud API key with Places API enabled
//   GOOGLE_PLACE_ID       - your Google Business Profile's Place ID (recommended, skips search)

import { getStore } from "@netlify/blobs";

const CACHE_KEY = "google-reviews-cache";
const CACHE_HOURS = 24;

export default async (request) => {
  // Computed first so every response, including error responses, knows
  // whether to disable caching (see json() below).
  const url = new URL(request.url);
  const debug = url.searchParams.has("debug");

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  let placeId = process.env.GOOGLE_PLACE_ID || "";
  const placeName = process.env.GOOGLE_PLACE_NAME || "Ready Tote Oklahoma";
  const placePhone = process.env.GOOGLE_PLACE_PHONE || ""; // E.164 format, e.g. +15803993202

  if (!apiKey) {
    return json({ reviews: [], error: "Missing GOOGLE_PLACES_API_KEY env var" }, { noStore: debug });
  }

  const store = getStore("meta");

  // Check cache first (skip cache if ?debug=1 is on the URL)
  if (!debug) {
    try {
      const cached = await store.get(CACHE_KEY, { type: "json" });
      if (cached && cached.fetchedAt) {
        const age = (Date.now() - new Date(cached.fetchedAt).getTime()) / 3600000;
        if (age < CACHE_HOURS) {
          return json({ reviews: cached.reviews, overallRating: cached.overallRating, totalReviews: cached.totalReviews, cached: true });
        }
      }
    } catch {}
  }

  // If no Place ID, find it. Ready Tote Oklahoma is a Service Area Business
  // (no public storefront address), and Google's Places API excludes those
  // by default. The new Places API Text Search endpoint requires an explicit
  // opt-in flag to include them, confirmed via Google Maps Platform Support
  // case, Aug 2026.
  if (!placeId) {
    try {
      let findData = { candidates: [] };
      let newApiStatus = null;

      // Primary method: new Places API Text Search with the service-area
      // business flag. This is the one that actually works for this listing.
      try {
        const sabResp = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "places.id",
          },
          body: JSON.stringify({
            textQuery: placeName,
            includePureServiceAreaBusinesses: true,
          }),
        });
        newApiStatus = sabResp.status;
        const sabData = await sabResp.json();
        if (sabData.places && sabData.places.length > 0) {
          placeId = sabData.places[0].id;
        } else {
          console.error("SAB-aware Text Search returned nothing. status:", sabResp.status, "body:", JSON.stringify(sabData));
        }
      } catch (e) {
        console.error("SAB-aware Text Search failed:", e.message);
      }

      // Phone number match, exact match fallback.
      if (!placeId && placePhone) {
        const phoneUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(placePhone)}&inputtype=phonenumber&fields=place_id&key=${apiKey}`;
        const phoneResp = await fetch(phoneUrl);
        findData = await phoneResp.json();
        if (findData.candidates && findData.candidates.length > 0) {
          placeId = findData.candidates[0].place_id;
        } else {
          console.error("Find Place by phone returned no candidates. status:", findData.status, "error_message:", findData.error_message);
        }
      }

      // Legacy Find Place by name (won't find pure SABs, kept as a safety
      // net in case the business later adds a public address)
      if (!placeId) {
        const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(placeName)}&inputtype=textquery&fields=place_id&key=${apiKey}`;
        const findResp = await fetch(findUrl);
        findData = await findResp.json();

        if (findData.candidates && findData.candidates.length > 0) {
          placeId = findData.candidates[0].place_id;
        } else {
          console.error("Find Place returned no candidates. status:", findData.status, "error_message:", findData.error_message);
        }
      }

      // Legacy Text Search as a last resort (also won't find pure SABs, but
      // harmless to try)
      let searchData = null;
      if (!placeId) {
        const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(placeName + " Oklahoma")}&location=35.327,-97.555&radius=50000&key=${apiKey}`;
        const searchResp = await fetch(searchUrl);
        searchData = await searchResp.json();
        if (searchData.results && searchData.results.length > 0) {
          placeId = searchData.results[0].place_id;
        } else {
          console.error("Text Search returned no results. status:", searchData.status, "error_message:", searchData.error_message);
        }
      }

      if (!placeId) {
        console.error("Could not find Place ID for:", placeName);
        // Surface the real Google status so this isn't a black box anymore.
        const findStatus = findData.status || "UNKNOWN";
        const searchStatus = searchData ? (searchData.status || "UNKNOWN") : "NOT_ATTEMPTED";
        const errMsg = findData.error_message || (searchData && searchData.error_message) || null;
        return json({
          reviews: [],
          error: "Business not found on Google",
          debug: debug ? {
            sabSearchHttpStatus: newApiStatus,
            phoneLookupAttempted: !!placePhone,
            findPlaceStatus: findStatus,
            textSearchStatus: searchStatus,
            googleErrorMessage: errMsg,
            hint: errMsg
              ? "See googleErrorMessage above, that's Google's actual reason."
              : "Even the SAB-aware search (includePureServiceAreaBusinesses) found nothing. Double check GOOGLE_PLACE_NAME matches the Business Profile name exactly, or set GOOGLE_PLACE_ID directly."
          } : undefined,
        }, { noStore: debug });
      }
    } catch (e) {
      console.error("Find Place failed:", e.message);
      return json({ reviews: [], error: "Find Place API error", debug: debug ? { message: e.message } : undefined }, { noStore: debug });
    }
  }

  // Fetch reviews using the Place ID.
  // Legacy Place Details is used FIRST because it's the only endpoint that
  // supports reviews_sort=newest. The New Places API is a fallback only,
  // since it can't be sorted and will hand back Google's relevance picks
  // instead of the actual latest reviews.
  try {
    const legacyUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating,user_ratings_total&reviews_sort=newest&key=${apiKey}`;
    const legacyResp = await fetch(legacyUrl);
    const legacyData = await legacyResp.json();

    if (legacyResp.ok && legacyData.status === "OK") {
      const result = legacyData.result || {};
      const reviews = (result.reviews || []).slice(0, 5).map(r => ({
        author: r.author_name || "Customer",
        rating: r.rating || 5,
        text: r.text || "",
        time: r.relative_time_description || "",
        profilePhoto: r.profile_photo_url || "",
      }));
      const payload = {
        reviews,
        overallRating: result.rating || null,
        totalReviews: result.user_ratings_total || 0,
        fetchedAt: new Date().toISOString(),
      };
      try { await store.setJSON(CACHE_KEY, payload); } catch {}
      return json(payload, { noStore: debug });
    }

    console.error("Legacy Places API (newest sort) error:", legacyData.status, legacyData.error_message);

    // Fallback: New Places API. No sort control here, this returns
    // Google's relevance picks, not necessarily the newest reviews.
    const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}?fields=reviews,rating,userRatingCount`;
    const resp = await fetch(detailsUrl, {
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "reviews,rating,userRatingCount" },
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("New Places API error:", resp.status, errBody);
      return json({
        reviews: [],
        error: "Google API error",
        debug: debug ? {
          legacyStatus: legacyData.status,
          legacyErrorMessage: legacyData.error_message,
          newApiStatus: resp.status,
          newApiBody: errBody,
        } : undefined,
      }, { noStore: debug });
    }

    const data = await resp.json();
    const reviews = (data.reviews || []).slice(0, 5).map(r => ({
      author: r.authorAttribution?.displayName || "Customer",
      rating: r.rating || 5,
      text: r.text?.text || r.originalText?.text || "",
      time: r.relativePublishTimeDescription || "",
      profilePhoto: r.authorAttribution?.photoUri || "",
    }));
    const payload = {
      reviews,
      overallRating: data.rating || null,
      totalReviews: data.userRatingCount || 0,
      fetchedAt: new Date().toISOString(),
      sortFallback: true, // came from relevance sort, not newest, legacy call failed
      debug: debug ? {
        legacyHttpOk: legacyResp.ok,
        legacyStatus: legacyData.status,
        legacyErrorMessage: legacyData.error_message || null,
      } : undefined,
    };
    try { await store.setJSON(CACHE_KEY, payload); } catch {}
    return json(payload, { noStore: debug });
  } catch (e) {
    console.error("Google reviews fetch failed:", e.message);
    return json({ reviews: [], error: e.message }, { noStore: debug });
  }
};

function json(obj, { noStore = false } = {}) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Debug requests (?debug=1) must never be cached by the CDN edge or
      // the browser, or a repeat debug check just replays the first
      // response instead of actually re-running the function.
      "Cache-Control": noStore ? "no-store" : "public, max-age=3600",
    },
  });
}
