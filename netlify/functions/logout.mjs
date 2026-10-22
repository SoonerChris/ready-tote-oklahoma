// POST /.netlify/functions/logout
// Ends the admin session on this device by clearing its cookie. To sign out
// every device at once, change INVOICE_SECRET (sessions are signed with it).

import { clearedSessionCookie } from "./lib-auth.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": clearedSessionCookie() },
  });
};
