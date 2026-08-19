// POST /.netlify/functions/login
// Verifies a username/password pair for the admin login page.
//
// Reuses INVOICE_SECRET as the password value on purpose — every other
// protected function already checks body.secret against INVOICE_SECRET,
// so this keeps that unchanged and adds exactly one new env var:
//   ADMIN_USERNAME - the username admin-login.html asks for
//
// Does not set a session/cookie. admin-login.html stores the verified
// username/password in localStorage and every other admin page sends
// them back as { secret: password, ... } on each request, same as before.

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  let body;
  try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }

  const { username, password } = body;

  const passwordOk = !!process.env.INVOICE_SECRET && password === process.env.INVOICE_SECRET;
  // If ADMIN_USERNAME hasn't been set in Netlify yet, don't enforce it —
  // any username is accepted as long as the password is right. This is a
  // deliberate safety net: forgetting to set this one env var shouldn't be
  // able to lock Chris out of his own admin tools. Set it to actually
  // require a specific username.
  const usernameOk = !process.env.ADMIN_USERNAME || username === process.env.ADMIN_USERNAME;
  const ok = passwordOk && usernameOk;

  if (!ok) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
