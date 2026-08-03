// POST /.netlify/functions/get-photo
// Returns a stored delivery/pickup proof photo as base64, so the admin page
// can display it (no email attached to a URL — kept internal, same secret
// pattern as every other admin function). Protected by INVOICE_SECRET.

import { getStore } from "@netlify/blobs";

const ALLOWED_TYPES = ["delivery", "pickup"];

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!process.env.INVOICE_SECRET || body.secret !== process.env.INVOICE_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!body.key) return new Response("Missing key", { status: 400 });
  if (!ALLOWED_TYPES.includes(body.type)) return new Response("Invalid type", { status: 400 });

  try {
    const store = getStore("photos");
    const blobKey = `${body.key}:${body.type}`;
    const result = await store.getWithMetadata(blobKey, { type: "arrayBuffer" });
    if (!result) return new Response("Not found", { status: 404 });

    const mimeType = (result.metadata && result.metadata.mimeType) || "image/jpeg";
    const imageBase64 = Buffer.from(result.data).toString("base64");
    return new Response(JSON.stringify({ imageBase64, mimeType }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("get-photo failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
