// POST /.netlify/functions/send-invoice
// Sends a branded invoice email to a customer with a Stripe payment button,
// and logs the rental (lib-invoice.mjs, shared with automatic invoices).
// Admin only (signed-in session, see lib-auth.mjs).
//
// Env vars required:
//   RESEND_API_KEY - Resend API key
//   RESEND_FROM    - verified sender
//   INVOICE_SECRET - a password you choose; the admin page asks for it

import { isAdmin } from "./lib-auth.mjs";
import { sendInvoice } from "./lib-invoice.mjs";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Auth check
  if (!isAdmin(request, body)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { autoInvoiced, ...data } = body;   // only confirm-booking marks those
  const result = await sendInvoice(data);
  if (!result.ok) {
    return result.status === 502
      ? new Response(JSON.stringify({ ok: false, error: result.error }), { status: 502 })
      : new Response(result.error, { status: result.status });
  }
  return new Response(JSON.stringify({ ok: true, key: result.key }), { status: 200 });
};
