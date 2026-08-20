// GET /.netlify/functions/google-reviews
// Fetches real Google Place reviews via the Places API, caches for 24 hours
// in Netlify Blobs to avoid hitting the API on every page load.
//
// Env vars required:
//   GOOGLE_PLACES_API_KEY - Google Cloud API key with Places API enabled
//   GOOGLE_PLACE_ID       - your Google Business Profile's Place ID (recommended, skips search)

import { getStore } from "@netlify/blobs";

const CACHE_KEY = "google-reviews-cache";
const CACHE_HOURS = 24;

export default async (request) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  let placeId = process.env.GOOGLE_PLACE_ID || "";
  const placeName = process.env.GOOGLE_PLACE_NAME || "Ready Tote Oklahoma";

  if (!apiKey) {
    return json({ reviews: [], error: "Missing GOOGLE_PLACES_API_KEY env var" });
  }

  const store = getStore("meta");

  // Check cache first (skip cache if ?debug=1 is on the URL)
  const url = new URL(request.url);
  const debug = url.searchParams.has("debug");

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

  // If no Place ID, find it by business name
  if (!placeId) {
    try {
      // Try Find Place first
      const findUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(placeName)}&inputtype=textquery&fields=place_id&key=${apiKey}`;
      const findResp = await fetch(findUrl);
      const findData = await findResp.json();

      if (findData.candidates && findData.candidates.length > 0) {
        placeId = findData.candidates[0].place_id;
      } else {
        console.error("Find Place returned no candidates. status:", findData.status, "error_message:", findData.error_message);
      }

      // Fallback: Text Search with location bias (better for new listings)
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
            findPlaceStatus: findStatus,
            textSearchStatus: searchStatus,
            googleErrorMessage: errMsg,
            hint: errMsg
              ? "See googleErrorMessage above, that's Google's actual reason."
              : (findStatus === "ZERO_RESULTS" && searchStatus === "ZERO_RESULTS"
                  ? "Google genuinely has no listing matching this name. Check Google Maps directly and/or set GOOGLE_PLACE_ID once you find the correct Place ID."
                  : "Non-ZERO_RESULTS status usually means REQUEST_DENIED (key restrictions, API not enabled, or billing not enabled) or INVALID_REQUEST. Check Netlify function logs for the full status.")
          } : undefined,
        });
      }
    } catch (e) {
      console.error("Find Place failed:", e.message);
      return json({ reviews: [], error: "Find Place API error", debug: debug ? { message: e.message } : undefined });
    }
  }

  // Fetch reviews using the Place ID
  try {
    const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}?fields=reviews,rating,userRatingCount`;
    const resp = await fetch(detailsUrl, {
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "reviews,rating,userRatingCount" },
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error("New Places API error:", resp.status, errBody);

      // Fallback: try the legacy API
      const legacyUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating,user_ratings_total&key=${apiKey}`;
      const legacyResp = await fetch(legacyUrl);
      const legacyData = await legacyResp.json();

      if (!legacyResp.ok || legacyData.status !== "OK") {
        console.error("Legacy Places API error:", legacyData.status, legacyData.error_message);
        return json({
          reviews: [],
          error: "Google API error",
          debug: debug ? {
            newApiStatus: resp.status,
            newApiBody: errBody,
            legacyStatus: legacyData.status,
            legacyErrorMessage: legacyData.error_message,
          } : undefined,
        });
      }

      const result = legacyData.result || {};
      const reviews = (result.reviews || []).map(r => ({
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
      return json(payload);
    }

    const data = await resp.json();
    const reviews = (data.reviews || []).map(r => ({
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
    };
    try { await store.setJSON(CACHE_KEY, payload); } catch {}
    return json(payload);
  } catch (e) {
    console.error("Google reviews fetch failed:", e.message);
    return json({ reviews: [], error: e.message });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
