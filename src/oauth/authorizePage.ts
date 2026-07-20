// The one HTML page in Jamgate: the OAuth consent screen (Phase 9, D-034).
//
// When claude.ai / the Claude mobile app begin the MCP OAuth flow they open this page in the
// user's browser. It asks the human — once — to paste their instance token (JAMGATE_TOKEN) to
// prove they own this Jamgate instance. On submit it POSTs back to /authorize, which verifies
// the token constant-time and redirects to the client with an authorization code.
//
// Self-contained: inline CSS, no external assets, no JS. Renders fine on a phone. The OAuth
// parameters ride along as hidden fields so the POST carries the same request the GET validated.

interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state?: string;
  scope?: string;
  resource?: string;
  response_type: string;
}

/** HTML-escape a value before it goes into an attribute or text node. Every dynamic value on
 *  this page is attacker-influenceable (query params), so nothing is interpolated unescaped. */
function esc(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hidden(name: string, value: string | undefined): string {
  if (value === undefined) return "";
  return `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`;
}

/**
 * Render the consent page. `error` (e.g. "That token didn't match — try again.") is shown as a
 * banner when a previous submit had the wrong token, so the user can retry without restarting
 * the flow. `clientName` is the registered client's name, shown so the user knows who is asking.
 */
export function renderAuthorizePage(
  params: AuthorizeParams,
  opts: { error?: string; clientName?: string } = {},
): string {
  const who = opts.clientName ? esc(opts.clientName) : "An application";
  const errorBanner = opts.error
    ? `<div class="error" role="alert">${esc(opts.error)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Authorize · Jamgate</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f5f4; color: #1c1917;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0c0a09; color: #e7e5e4; }
    .card { background: #1c1917; border-color: #292524; }
    input { background: #0c0a09; border-color: #44403c; color: #e7e5e4; }
    .muted { color: #a8a29e; }
  }
  .card {
    width: 100%; max-width: 420px; background: #fff; border: 1px solid #e7e5e4;
    border-radius: 14px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,.06);
  }
  .brand { font-weight: 700; font-size: 20px; letter-spacing: -.01em; margin: 0 0 4px; }
  h1 { font-size: 16px; font-weight: 600; margin: 20px 0 6px; }
  p { margin: 0 0 16px; }
  .muted { color: #78716c; font-size: 13.5px; }
  label { display: block; font-weight: 600; font-size: 13px; margin: 0 0 6px; }
  input[type="password"] {
    width: 100%; padding: 11px 12px; border: 1px solid #d6d3d1; border-radius: 9px;
    font-size: 15px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  input:focus { outline: 2px solid #6366f1; outline-offset: 1px; border-color: #6366f1; }
  button {
    width: 100%; margin-top: 18px; padding: 12px; border: 0; border-radius: 9px;
    background: #4f46e5; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  button:hover { background: #4338ca; }
  .error {
    background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 9px;
    padding: 10px 12px; margin: 0 0 16px; font-size: 13.5px;
  }
  @media (prefers-color-scheme: dark) {
    .error { background: #2a1414; color: #fca5a5; border-color: #7f1d1d; }
  }
  .who { font-weight: 600; }
</style>
</head>
<body>
  <main class="card">
    <p class="brand">Jamgate</p>
    <p class="muted">This is your Jamgate instance — your shared, cross-agent memory.</p>
    ${errorBanner}
    <h1><span class="who">${who}</span> wants to connect.</h1>
    <p class="muted">Enter your instance token to authorize it. You'll only need to do this once
      per client.</p>
    <form method="POST" action="/authorize" autocomplete="off">
      <label for="token">Instance token</label>
      <input id="token" name="instance_token" type="password" autocomplete="off"
        autocapitalize="off" autocorrect="off" spellcheck="false"
        placeholder="Your JAMGATE_TOKEN" required autofocus />
      ${hidden("client_id", params.client_id)}
      ${hidden("redirect_uri", params.redirect_uri)}
      ${hidden("code_challenge", params.code_challenge)}
      ${hidden("code_challenge_method", params.code_challenge_method)}
      ${hidden("response_type", params.response_type)}
      ${hidden("state", params.state)}
      ${hidden("scope", params.scope)}
      ${hidden("resource", params.resource)}
      <button type="submit">Authorize</button>
    </form>
  </main>
</body>
</html>`;
}

/** A minimal standalone error page for authorize failures that must NOT redirect (e.g. an
 *  unregistered redirect_uri — redirecting there would be an open-redirect / phishing vector). */
export function renderErrorPage(title: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(title)} · Jamgate</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f5f5f4; color: #1c1917;
  }
  @media (prefers-color-scheme: dark) { body { background: #0c0a09; color: #e7e5e4; } .card { background:#1c1917; border-color:#292524; } }
  .card { max-width: 420px; background: #fff; border: 1px solid #e7e5e4; border-radius: 14px; padding: 32px; }
  h1 { font-size: 17px; margin: 0 0 8px; }
  p { margin: 0; color: #78716c; }
</style>
</head>
<body>
  <main class="card">
    <h1>${esc(title)}</h1>
    <p>${esc(detail)}</p>
  </main>
</body>
</html>`;
}
