// POST /.netlify/functions/upload-photo
// Stores a delivery or pickup proof photo for a rental (e.g. left at the
// door when the customer wasn't home). Images should be compressed
// client-side before upload — admin-reminders.html does this via canvas
// before sending base64 here. Stored as raw bytes in a dedicated "photos"
// Blob store, keyed by `${rentalKey}:${type}`. Protected by INVOICE_SECRET.

import { getStore } from "@netlify/blobs";

const MAX_BYTES = 6 * 1024 * 1024; // stay well under Netlify Functions' body limit
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
  if (!body.imageBase64) return new Response("Missing imageBase64", { status: 400 });

  const mimeType = body.mimeType || "image/jpeg";
  if (!/^image\/(jpeg|jpg|png|webp)$/.test(mimeType)) {
    return new Response("Invalid mimeType", { status: 400 });
  }

  let buf;
  try {
    buf = Buffer.from(body.imageBase64, "base64");
  } catch {
    return new Response("Invalid image data", { status: 400 });
  }
  if (!buf.length) return new Response("Empty image data", { status: 400 });
  if (buf.length > MAX_BYTES) return new Response("Image too large", { status: 413 });

  try {
    const store = getStore("photos");
    const blobKey = `${body.key}:${body.type}`;
    // Trim the Buffer view down to a plain ArrayBuffer for @netlify/blobs.
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    await store.set(blobKey, arrayBuffer, {
      metadata: { mimeType, uploadedAt: new Date().toISOString() },
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("upload-photo failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
