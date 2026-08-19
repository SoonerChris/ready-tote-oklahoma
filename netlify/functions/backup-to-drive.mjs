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
// Authenticates as a real Google account via OAuth, not a service account —
// service accounts have zero storage quota on a personal Drive and can only
// write into Shared Drives, which aren't available on a plain personal
// account. See oauth-setup.mjs for the one-time authorization step.
//
// Setup required:
//   GOOGLE_OAUTH_CLIENT_ID       - from a Web application OAuth client
//   GOOGLE_OAUTH_CLIENT_SECRET   - from that same OAuth client
//   GOOGLE_OAUTH_REFRESH_TOKEN   - obtained once via oauth-setup.mjs
//   GOOGLE_DRIVE_BACKUP_FOLDER_ID - the ID of the destination Drive folder
//
// No admin-secret auth on this function, matching daily-reminders.mjs — it
// has no public HTTP URL in production at all (Netlify's own scheduler is
// the only thing that invokes it there). Test manually with the "Run now"
// button on the Functions page in the Netlify dashboard, not by visiting a
// URL — scheduled functions don't have one once deployed.

import { getStore } from "@netlify/blobs";

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

// Exchanges a long-lived refresh token for a short-lived access token.
// Authenticates as a real Google account (via the one-time authorization
// done through oauth-setup.mjs) rather than a service account — service
// accounts turned out to have zero storage quota on a personal Drive and
// can only write into Shared Drives, which aren't available on a plain
// personal Google account.
async function getGoogleAccessToken() {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
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
  const required = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN", "GOOGLE_DRIVE_BACKUP_FOLDER_ID"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Backup skipped: missing " + missing.join(", "));
    return new Response("Missing configuration: " + missing.join(", "), { status: 500, headers: { "Content-Type": "text/plain" } });
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
