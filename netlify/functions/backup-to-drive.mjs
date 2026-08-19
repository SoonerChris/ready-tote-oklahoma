// Scheduled function: runs weekly, Monday 8:00 AM UTC (2-3 AM Central,
// depending on DST) — a quiet time, well before the day's work starts.
//
// Exports every structured data store (rentals, requests, inventory events,
// finance, outreach, and the meta store's paid/sent flags) into one dated
// JSON file and uploads it straight to a Google Drive folder. This is the
// backup this business didn't have — everything currently lives only in
// Netlify Blobs with no export or recovery path.
//
// Deliberately excludes the "photos" store (delivery/pickup proof photos).
// Those are documentation, not the records the business can't run without,
// and including them would balloon this into binary/base64 territory for
// comparatively low value. Worth adding later if it turns out to matter.
//
// Setup required (see the PR notes for full walkthrough):
//   GOOGLE_SERVICE_ACCOUNT_JSON   - paste the entire downloaded service
//                                   account JSON key as this variable's value
//   GOOGLE_DRIVE_BACKUP_FOLDER_ID - the ID of the Drive folder shared with
//                                   that service account's email
//
// No admin-secret auth on this function, matching daily-reminders.mjs —
// only Netlify's own scheduler is expected to call it. Can also be tested
// manually by visiting its URL directly after deploying.

import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const STORES_TO_BACK_UP = ["rentals", "requests", "inventory", "finance", "outreach"];

async function dumpStore(name) {
  const store = getStore(name);
  const { blobs } = await store.list();
  const out = {};
  for (const b of blobs) {
    try {
      out[b.key] = await store.get(b.key, { type: "json" });
    } catch {
      // Not JSON for some reason — grab it as text rather than losing it.
      try { out[b.key] = await store.get(b.key); } catch { out[b.key] = null; }
    }
  }
  return out;
}

async function dumpMetaFlags() {
  const store = getStore("meta");
  const paidFlags = (await store.get("paidFlags", { type: "json" }).catch(() => null)) || {};
  const sentFlags = (await store.get("sentFlags", { type: "json" }).catch(() => null)) || {};
  return { paidFlags, sentFlags };
}

// Signs a service-account JWT and exchanges it for a short-lived access
// token. Hand-rolled with Node's built-in crypto rather than adding the
// googleapis/google-auth-library dependency — this project only pulls in
// @netlify/blobs today, and RS256 JWT signing is a small, well-understood
// piece of code, not worth a new dependency for.
async function getGoogleAccessToken() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: creds.client_email,
    // drive.file: only files this service account creates/opens — not
    // full access to the whole shared Drive. Least privilege for a
    // service that only ever needs to create new backup files.
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64url(header)}.${b64url(claims)}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), creds.private_key);
  const jwt = `${unsigned}.${signature.toString("base64url")}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resp.ok) throw new Error("Google auth failed: " + (await resp.text()));
  const data = await resp.json();
  return data.access_token;
}

async function uploadToDrive(accessToken, filename, jsonText, folderId) {
  const boundary = "rto-backup-" + Date.now();
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${jsonText}\r\n` +
    `--${boundary}--`;

  const resp = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!resp.ok) throw new Error("Drive upload failed: " + (await resp.text()));
  return resp.json();
}

export default async () => {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID) {
    console.error("Backup skipped: GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_BACKUP_FOLDER_ID not set.");
    return new Response("Missing configuration", { status: 500, headers: { "Content-Type": "text/plain" } });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  try {
    const dump = { exportedAt: new Date().toISOString(), exportedForDate: today };
    for (const storeName of STORES_TO_BACK_UP) {
      dump[storeName] = await dumpStore(storeName);
    }
    dump.meta = await dumpMetaFlags();

    const jsonText = JSON.stringify(dump, null, 2);
    const filename = `ready-tote-backup-${today}.json`;

    const accessToken = await getGoogleAccessToken();
    const uploaded = await uploadToDrive(accessToken, filename, jsonText, process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID);
    console.log(`Backup uploaded: ${filename} (Drive file id ${uploaded.id})`);
    return new Response(`Backup uploaded: ${filename}`, { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    // Covers failures reading Blobs, signing the Google JWT, or the Drive
    // upload itself — previously only the Drive-upload half was caught,
    // so a Blobs read failure crashed uncaught with an empty response
    // instead of a message explaining what went wrong.
    console.error("Backup failed:", err.stack || err.message || err);
    return new Response("Backup failed: " + (err.message || err), { status: 500, headers: { "Content-Type": "text/plain" } });
  }
};

export const config = {
  schedule: "0 8 * * 1",
};
