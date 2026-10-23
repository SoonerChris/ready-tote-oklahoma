// POST /.netlify/functions/staff-accounts
// Inventory-only logins (e.g. Shon): someone who can see Inventory, log
// stock changes and mark totes clean, and nothing else. Admin only.
//
// Body: { action, ... }
//   list                       -> { accounts: [{ username, createdAt, updatedAt }] }
//   set    { username, password } -> creates the login, or changes its password
//   remove { username }          -> deletes the login (signs that person out)
//
// Passwords are kept as scrypt hashes (lib-auth.mjs), never as text.

import { isAdmin, getStaffAccounts, saveStaffAccounts, hashPassword, normUser } from "./lib-auth.mjs";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const list = (accts) => Object.entries(accts).map(([username, a]) => ({ username, createdAt: a.createdAt, updatedAt: a.updatedAt || a.createdAt }));

export default async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!isAdmin(request, body)) return json({ error: "Unauthorized" }, 401);

  try {
    const accts = await getStaffAccounts();
    switch (body.action) {
      case "list":
        return json({ accounts: list(accts) });
      case "set": {
        const username = normUser(body.username);
        const password = String(body.password || "");
        if (!/^[a-z0-9._-]{2,40}$/.test(username)) return json({ error: "Username: 2 to 40 letters or numbers, no spaces." }, 400);
        if (process.env.ADMIN_USERNAME && username === normUser(process.env.ADMIN_USERNAME)) return json({ error: "That's the admin username. Pick another." }, 400);
        if (password.length < 8) return json({ error: "Password: at least 8 characters." }, 400);
        const now = new Date().toISOString();
        const prev = accts[username];
        accts[username] = { ...hashPassword(password), v: (prev?.v || 0) + 1, createdAt: prev?.createdAt || now, updatedAt: now };
        await saveStaffAccounts(accts);
        return json({ ok: true, accounts: list(accts) });
      }
      case "remove": {
        delete accts[normUser(body.username)];
        await saveStaffAccounts(accts);
        return json({ ok: true, accounts: list(accts) });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("staff-accounts failed:", body.action, e.message);
    return json({ error: "Storage error" }, 502);
  }
};
