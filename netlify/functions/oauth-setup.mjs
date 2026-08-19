// ONE-TIME SETUP HELPER — not used by the actual backup, safe to delete
// once you've copied the refresh token out of it.
//
// Service accounts turned out to be a dead end for uploading to a personal
// Google Drive (Google restricts them to Shared Drives, which aren't
// available on a plain personal account). This function does the one-time
// authorization dance to let backup-to-drive.mjs act as your real Google
// account instead, which does have real storage quota.
//
// How to use:
//   1. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Netlify
//      (from a Web application OAuth client in Google Cloud Console, with
//      this function's own URL added as an authorized redirect URI).
//   2. Deploy, then visit this function's URL in your browser.
//   3. It redirects you to Google — log in as yourself, approve access.
//   4. Google sends you back here with a code, which this function
//      exchanges for a refresh token and displays on screen.
//   5. Copy that refresh token into a new GOOGLE_OAUTH_REFRESH_TOKEN
//      variable in Netlify. That's the one backup-to-drive.mjs actually
//      uses going forward — this file's job is done at that point.

const REDIRECT_URI = "https://readytoteokc.com/.netlify/functions/oauth-setup";

export default async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return new Response(
      "Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in Netlify. Set both, then reload this page.",
      { status: 500, headers: { "Content-Type": "text/plain" } }
    );
  }

  // Step 1: no code yet — send them to Google to approve access.
  if (!code) {
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
    // access_type=offline + prompt=consent together guarantee Google
    // actually issues a refresh token, not just a short-lived access token.
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    return Response.redirect(authUrl.toString(), 302);
  }

  // Step 2: Google sent us back with a code — exchange it for tokens.
  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.refresh_token) {
      return new Response(
        "Token exchange failed or no refresh_token returned. If you've done this before, Google " +
        "only issues a refresh token on the FIRST consent — go to myaccount.google.com/permissions, " +
        "remove this app's access, then try this URL again.\n\nFull response:\n" + JSON.stringify(data, null, 2),
        { status: 400, headers: { "Content-Type": "text/plain" } }
      );
    }

    return new Response(
      "Success! Copy the value below into a new Netlify environment variable named GOOGLE_OAUTH_REFRESH_TOKEN:\n\n" +
      data.refresh_token +
      "\n\nOnce that's saved, this setup function has done its job — safe to delete oauth-setup.mjs.",
      { status: 200, headers: { "Content-Type": "text/plain" } }
    );
  } catch (err) {
    return new Response("Error exchanging code: " + (err.message || err), {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
};
