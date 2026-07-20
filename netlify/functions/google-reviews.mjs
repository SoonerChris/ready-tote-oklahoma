// GET /.netlify/functions/google-reviews
// Fetches real Google Place reviews via the Places API, caches for 24 hours
// in Netlify Blobs to avoid hitting the API on every page load.
//
// Env vars required:
//   GOOGLE_PLACES_API_KEY - Google Cloud API key with Places API enabled
//   GOOGLE_PLACE_ID       - your Google Business Profile's Place ID

import { getStore } from "@netlify/blobs";

const CACHE_KEY = "google-reviews-cache";
const CACHE_HOURS = 24;

export default async (request) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;

  if (!apiKey || !placeId) {
    return json({ reviews: [], error: "Missing GOOGLE_PLACES_API_KEY or GOOGLE_PLACE_ID env vars" });
  }

  const store = getStore("meta");

  // Check cache first
  try {
    const cached = await store.get(CACHE_KEY, { type: "json" });
    if (cached && cached.fetchedAt) {
      const age = (Date.now() - new Date(cached.fetchedAt).getTime()) / 3600000;
      if (age < CACHE_HOURS) {
        return json({ reviews: cached.reviews, cached: true });
      }
    }
  } catch {}

  // Fetch fresh from Google Places API (New)
  try {
    const url = `https://places.googleapis.com/v1/places/${placeId}?fields=reviews,rating,userRatingCount&key=${apiKey}`;
    const resp = await fetch(url, {
      headers: { "X-Goog-FieldMask": "reviews,rating,userRatingCount" },
    });

    if (!resp.ok) {
      // Fallback: try the legacy API
      const legacyUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating,user_ratings_total&key=${apiKey}`;
      const legacyResp = await fetch(legacyUrl);
      if (!legacyResp.ok) {
        console.error("Google Places API error:", resp.status, await resp.text());
        return json({ reviews: [], error: "Google API error" });
      }
      const legacyData = await legacyResp.json();
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
