// The OAuth 2.1 endpoints Jamgate serves in remote mode (Phase 9, D-034).
//
// Jamgate acts as BOTH the OAuth resource server (the /mcp endpoint) and the authorization
// server (same origin), implementing the subset of the MCP authorization spec a claude.ai /
// Claude-mobile custom connector actually needs:
//
//   GET  /.well-known/oauth-protected-resource   RFC 9728 — points clients at our AS
//   GET  /.well-known/oauth-authorization-server  RFC 8414 — advertises the endpoints below
//   POST /register                                RFC 7591 — dynamic client registration
//   GET  /authorize                               consent page (asks for the instance token)
//   POST /authorize                               verify token → issue single-use auth code
//   POST /token                                   PKCE code exchange / refresh → access token
//
// These endpoints are intentionally reachable WITHOUT the /mcp bearer gate — they are the path
// by which a client OBTAINS a bearer. All secret handling (PKCE, single-use codes, hashed
// tokens, exact redirect_uri match, no open redirect) lives in the OAuthStore + this router.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OAuthStore } from "./store.js";
import { constantTimeEqual } from "./store.js";
import { renderAuthorizePage, renderErrorPage } from "./authorizePage.js";

export interface OAuthContext {
  oauth: OAuthStore;
  /** The static instance token (JAMGATE_TOKEN); pasted on the consent page to authorize. */
  staticToken: string;
  /** The MCP endpoint path (default /mcp) — used to build the canonical resource identifier. */
  mcpPath: string;
}

const WELL_KNOWN_PR = "/.well-known/oauth-protected-resource";
const WELL_KNOWN_AS = "/.well-known/oauth-authorization-server";

/** True when the request path is (or is a path-suffixed variant of) `prefix`. MCP clients may
 *  request `/.well-known/oauth-protected-resource` or the path-aware
 *  `/.well-known/oauth-protected-resource/mcp` form — both must resolve to the same document. */
function matchesWellKnown(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Public base URL of this instance, honoring the reverse proxy's forwarded headers so the
 *  advertised endpoints are the externally-reachable HTTPS URLs, not the localhost bind. */
function baseUrl(req: IncomingMessage): string {
  const proto = (headerValue(req, "x-forwarded-proto") ?? "").split(",")[0].trim() || "http";
  const host = headerValue(req, "x-forwarded-host") ?? req.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

/** The canonical MCP resource identifier (RFC 8707) — base origin + the MCP path. */
function resourceIdentifier(req: IncomingMessage, mcpPath: string): string {
  return `${baseUrl(req)}${mcpPath}`;
}

/** The RFC 9728 metadata URL to advertise in a 401 `WWW-Authenticate` header from /mcp. */
export function resourceMetadataUrl(req: IncomingMessage): string {
  return `${baseUrl(req)}${WELL_KNOWN_PR}`;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
    "Access-Control-Max-Age": "86400",
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders(), ...extra });
  res.end(payload);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/** Read the raw request body as a string (bounded to avoid unbounded buffering on a bad client). */
async function readRawBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Parse a request body as form-encoded or JSON depending on Content-Type; returns a flat map.
 *  OAuth token/registration requests are form-encoded by spec, but some clients send JSON, so we
 *  accept both. */
async function readParams(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = await readRawBody(req);
  const ctype = (headerValue(req, "content-type") ?? "").toLowerCase();
  if (ctype.includes("application/json")) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined && v !== null) out[k] = Array.isArray(v) ? JSON.stringify(v) : String(v);
      }
      return out;
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

/** A redirect_uri is acceptable only if it is HTTPS or a loopback http URL (OAuth 2.1 §1.5 /
 *  the MCP spec: "All redirect URIs MUST be either localhost or use HTTPS"). */
function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false; // no fragment in a registered redirect
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") {
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  }
  return false;
}

/**
 * Route an OAuth request. Returns true when it handled the request (the caller then stops), or
 * false when the path/method is not an OAuth endpoint (the caller falls through to /mcp).
 */
export async function handleOAuth(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: OAuthContext,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // CORS preflight for the browser-callable JSON endpoints.
  if (
    method === "OPTIONS" &&
    (matchesWellKnown(path, WELL_KNOWN_PR) ||
      matchesWellKnown(path, WELL_KNOWN_AS) ||
      path === "/register" ||
      path === "/token")
  ) {
    res.writeHead(204, corsHeaders());
    res.end();
    return true;
  }

  // 1. RFC 9728 protected resource metadata → tells the client which AS to use.
  if (matchesWellKnown(path, WELL_KNOWN_PR) && method === "GET") {
    sendJson(res, 200, {
      resource: resourceIdentifier(req, ctx.mcpPath),
      authorization_servers: [baseUrl(req)],
      bearer_methods_supported: ["header"],
    });
    return true;
  }

  // 2. RFC 8414 authorization server metadata → advertises the endpoints + PKCE requirement.
  if (matchesWellKnown(path, WELL_KNOWN_AS) && method === "GET") {
    const base = baseUrl(req);
    sendJson(res, 200, {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["jamgate"],
    });
    return true;
  }

  // 3. RFC 7591 dynamic client registration.
  if (path === "/register" && method === "POST") {
    await handleRegister(req, res, ctx);
    return true;
  }

  // 4. Consent page (GET) and its submission (POST).
  if (path === "/authorize" && method === "GET") {
    await handleAuthorizeGet(req, res, url, ctx);
    return true;
  }
  if (path === "/authorize" && method === "POST") {
    await handleAuthorizePost(req, res, ctx);
    return true;
  }

  // 5. Token endpoint (PKCE code exchange / refresh).
  if (path === "/token" && method === "POST") {
    await handleToken(req, res, ctx);
    return true;
  }

  return false;
}

async function handleRegister(req: IncomingMessage, res: ServerResponse, ctx: OAuthContext): Promise<void> {
  let body: Record<string, unknown>;
  try {
    const raw = await readRawBody(req);
    body = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    sendJson(res, 400, { error: "invalid_client_metadata", error_description: "body must be JSON" });
    return;
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const cleaned = redirectUris.filter((u): u is string => typeof u === "string" && u.length > 0);
  if (cleaned.length === 0) {
    sendJson(res, 400, {
      error: "invalid_redirect_uri",
      error_description: "redirect_uris must be a non-empty array",
    });
    return;
  }
  for (const uri of cleaned) {
    if (!isAllowedRedirectUri(uri)) {
      sendJson(res, 400, {
        error: "invalid_redirect_uri",
        error_description: `redirect_uri must be https or a loopback http URL: ${uri}`,
      });
      return;
    }
  }

  const client = await ctx.oauth.registerClient({
    redirect_uris: cleaned,
    client_name: typeof body.client_name === "string" ? body.client_name : undefined,
  });

  sendJson(res, 201, {
    client_id: client.client_id,
    client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
    redirect_uris: client.redirect_uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    ...(client.client_name ? { client_name: client.client_name } : {}),
  });
}

/** Extract + validate the authorize parameters common to GET and POST. Returns either the
 *  validated params, or a typed failure telling the caller how to respond safely. */
type AuthorizeValidation =
  | { ok: true; params: ValidatedAuthorizeParams; clientName?: string }
  | { ok: false; kind: "page"; title: string; detail: string }
  | { ok: false; kind: "redirect"; redirect_uri: string; state?: string; error: string; error_description: string };

interface ValidatedAuthorizeParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  response_type: string;
  state?: string;
  scope?: string;
  resource?: string;
}

async function validateAuthorize(
  get: (name: string) => string | undefined,
  ctx: OAuthContext,
): Promise<AuthorizeValidation> {
  const client_id = get("client_id");
  const redirect_uri = get("redirect_uri");

  // Before we can trust redirect_uri enough to redirect errors to it, the client must exist and
  // the redirect_uri must EXACTLY match one it registered — otherwise we render an on-page error
  // (never redirect) so a forged redirect_uri can't turn us into an open redirect.
  if (!client_id) {
    return { ok: false, kind: "page", title: "Invalid request", detail: "Missing client_id." };
  }
  const client = await ctx.oauth.getClient(client_id);
  if (!client) {
    return { ok: false, kind: "page", title: "Unknown client", detail: "This client is not registered with this Jamgate instance." };
  }
  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
    return { ok: false, kind: "page", title: "Invalid redirect", detail: "The redirect URI does not match this client's registration." };
  }

  // redirect_uri is now trusted → remaining errors can be delivered back to the client.
  const state = get("state");
  const response_type = get("response_type");
  if (response_type !== "code") {
    return { ok: false, kind: "redirect", redirect_uri, state, error: "unsupported_response_type", error_description: "only response_type=code is supported" };
  }
  const code_challenge = get("code_challenge");
  const code_challenge_method = get("code_challenge_method") ?? "S256";
  if (!code_challenge) {
    return { ok: false, kind: "redirect", redirect_uri, state, error: "invalid_request", error_description: "PKCE code_challenge is required" };
  }
  if (code_challenge_method !== "S256") {
    return { ok: false, kind: "redirect", redirect_uri, state, error: "invalid_request", error_description: "code_challenge_method must be S256" };
  }

  return {
    ok: true,
    clientName: client.client_name,
    params: {
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      response_type,
      state,
      scope: get("scope"),
      resource: get("resource"),
    },
  };
}

function redirectWithError(
  res: ServerResponse,
  redirect_uri: string,
  error: string,
  error_description: string,
  state?: string,
): void {
  const loc = new URL(redirect_uri);
  loc.searchParams.set("error", error);
  loc.searchParams.set("error_description", error_description);
  if (state) loc.searchParams.set("state", state);
  res.writeHead(302, { Location: loc.toString() });
  res.end();
}

async function handleAuthorizeGet(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: OAuthContext,
): Promise<void> {
  const v = await validateAuthorize((name) => url.searchParams.get(name) ?? undefined, ctx);
  if (!v.ok) {
    if (v.kind === "page") sendHtml(res, 400, renderErrorPage(v.title, v.detail));
    else redirectWithError(res, v.redirect_uri, v.error, v.error_description, v.state);
    return;
  }
  sendHtml(res, 200, renderAuthorizePage(v.params, { clientName: v.clientName }));
}

async function handleAuthorizePost(req: IncomingMessage, res: ServerResponse, ctx: OAuthContext): Promise<void> {
  const params = await readParams(req);
  const get = (name: string) => (params[name] !== undefined ? params[name] : undefined);

  const v = await validateAuthorize(get, ctx);
  if (!v.ok) {
    if (v.kind === "page") sendHtml(res, 400, renderErrorPage(v.title, v.detail));
    else redirectWithError(res, v.redirect_uri, v.error, v.error_description, v.state);
    return;
  }

  // Verify the pasted instance token constant-time. On mismatch, re-render the consent page with
  // an error banner so the user can retry without restarting the whole OAuth flow.
  const presented = get("instance_token") ?? "";
  if (!presented || !constantTimeEqual(presented, ctx.staticToken)) {
    sendHtml(
      res,
      401,
      renderAuthorizePage(v.params, {
        clientName: v.clientName,
        error: "That token didn't match. Check your JAMGATE_TOKEN and try again.",
      }),
    );
    return;
  }

  // Token proven → mint a single-use, PKCE-bound authorization code and redirect back.
  const code = await ctx.oauth.createAuthCode({
    client_id: v.params.client_id,
    redirect_uri: v.params.redirect_uri,
    code_challenge: v.params.code_challenge,
    code_challenge_method: v.params.code_challenge_method,
    scope: v.params.scope,
    resource: v.params.resource,
  });

  const loc = new URL(v.params.redirect_uri);
  loc.searchParams.set("code", code);
  if (v.params.state) loc.searchParams.set("state", v.params.state);
  res.writeHead(302, { Location: loc.toString() });
  res.end();
}

async function handleToken(req: IncomingMessage, res: ServerResponse, ctx: OAuthContext): Promise<void> {
  const params = await readParams(req);
  const grantType = params.grant_type;

  if (grantType === "authorization_code") {
    const code = params.code;
    const redirect_uri = params.redirect_uri;
    const client_id = params.client_id;
    const code_verifier = params.code_verifier;
    if (!code || !redirect_uri || !client_id || !code_verifier) {
      sendJson(res, 400, { error: "invalid_request", error_description: "code, redirect_uri, client_id and code_verifier are required" });
      return;
    }
    const issued = await ctx.oauth.redeemAuthCode({ code, client_id, redirect_uri, code_verifier });
    if (!issued) {
      sendJson(res, 400, { error: "invalid_grant", error_description: "authorization code is invalid, expired, already used, or PKCE verification failed" });
      return;
    }
    sendJson(res, 200, issued, { "Cache-Control": "no-store" });
    return;
  }

  if (grantType === "refresh_token") {
    const refresh_token = params.refresh_token;
    const client_id = params.client_id;
    if (!refresh_token || !client_id) {
      sendJson(res, 400, { error: "invalid_request", error_description: "refresh_token and client_id are required" });
      return;
    }
    const issued = await ctx.oauth.refresh({ refresh_token, client_id });
    if (!issued) {
      sendJson(res, 400, { error: "invalid_grant", error_description: "refresh token is invalid or expired" });
      return;
    }
    sendJson(res, 200, issued, { "Cache-Control": "no-store" });
    return;
  }

  sendJson(res, 400, { error: "unsupported_grant_type", error_description: `unsupported grant_type: ${grantType ?? "(none)"}` });
}
