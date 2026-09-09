// POST /.netlify/functions/upload-military-id
// Public, UNAUTHENTICATED endpoint — deliberately not protected by
// INVOICE_SECRET. book.html calls this while a customer is still filling
// out the booking form, before any request record exists to attach a
// photo to, so there's no admin secret available on that page yet (and
// there shouldn't be — it's public). The client generates its own random
// key (crypto.randomUUID) and sends it along as a hidden "military_id_key"
// field with the rest of the booking form; submission-created.mjs then
// saves that key on the request record so the admin pages can look the
// photo up later via get-photo, which stays secret-protected.
//
// Kept deliberately narrow to limit what an open endpoint like this can
// do: the stored type is hardcoded to "military_id" (never client-set),
// and this endpoint can only write — it has no read/list capability, so
// an uploaded ID can never be fetched back through here. Reading a photo
// back always goes through the admin-only get-photo.mjs.

import { getStore } from "@netlify/blobs";

const MAX_BYTES = 6 * 1024 * 1024; // stay well under Netlify Functions' body limit
const TYPE = "military_id";
const KEY_RE = /^[a-zA-Z0-9_-]{1,100}$/;

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!body.key || !KEY_RE.test(body.key)) {
    return new Response("Missing or invalid key", { status: 400 });
  }
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
    const blobKey = `${body.key}:${TYPE}`;
    // Trim the Buffer view down to a plain ArrayBuffer for @netlify/blobs.
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    await store.set(blobKey, arrayBuffer, {
      metadata: { mimeType, uploadedAt: new Date().toISOString() },
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error("upload-military-id failed:", e.message);
    return new Response("Storage error", { status: 502 });
  }
};
