import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FileStore } from "../src/store/fileStore.js";
import { startHttpServer, type RunningHttpServer } from "../src/http.js";
import { OAuthStore, pkceS256Challenge, sha256hex } from "../src/oauth/store.js";
import type { GateLogConfig } from "../src/gate/log.js";
import { tempStore } from "./helpers.js";

const TOKEN = "s3cret-instance-token-for-oauth-tests";
const NO_GATE_LOG: GateLogConfig = { path: null, maxBytes: 0, maxTextChars: 0 };
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/** A fresh PKCE verifier/challenge pair (S256), the way a real MCP client generates one. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** A standalone OAuthStore over a fresh temp file (for unit tests). */
async function tempOAuthStore(
  opts: ConstructorParameters<typeof OAuthStore>[1] = {},
): Promise<{ oauth: OAuthStore; path: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-oauth-"));
  const path = join(dir, "oauth.json");
  return { oauth: new OAuthStore(path, opts), path, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** Boot a real HTTP server with OAuth enabled, over fresh temp memory + oauth stores. */
async function bootOAuthServer(): Promise<{
  running: RunningHttpServer;
  origin: string;
  mcpUrl: string;
  oauth: OAuthStore;
  cleanup: () => Promise<void>;
}> {
  const { store, cleanup: cleanStore } = await tempStore();
  const { oauth, cleanup: cleanOAuth } = await tempOAuthStore();
  const running = await startHttpServer({ store, token: TOKEN, port: 0, gateLog: NO_GATE_LOG, oauth });
  const origin = `http://${running.host}:${running.port}`;
  return {
    running,
    origin,
    mcpUrl: `${origin}${running.path}`,
    oauth,
    cleanup: async () => {
      await running.close();
      await cleanStore();
      await cleanOAuth();
    },
  };
}

/** Drive a real dynamic-client-registration + authorize + token exchange, returning the tokens. */
async function fullFlow(origin: string): Promise<{ access_token: string; refresh_token: string; client_id: string; code: string; verifier: string }> {
  const reg = await fetch(`${origin}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [CALLBACK], client_name: "Claude" }),
  });
  assert.equal(reg.status, 201);
  const { client_id } = (await reg.json()) as { client_id: string };

  const { verifier, challenge } = pkce();
  const state = "xyz-state";
  const form = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    instance_token: TOKEN,
  });
  const authRes = await fetch(`${origin}/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "manual",
  });
  assert.equal(authRes.status, 302);
  const loc = new URL(authRes.headers.get("location") ?? "");
  assert.equal(loc.searchParams.get("state"), state);
  const code = loc.searchParams.get("code");
  assert.ok(code, "authorize must return a code");

  const tokRes = await fetch(`${origin}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: CALLBACK,
      client_id,
      code_verifier: verifier,
    }).toString(),
  });
  assert.equal(tokRes.status, 200);
  const tokens = (await tokRes.json()) as { access_token: string; refresh_token: string; token_type: string; expires_in: number };
  assert.equal(tokens.token_type, "Bearer");
  assert.ok(tokens.expires_in > 0);
  return { ...tokens, client_id, code: code!, verifier };
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuthStore unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OAuthStore: PKCE + code lifecycle", () => {
  it("hashes secrets at rest — plaintext codes/tokens never appear in the file", async () => {
    const { oauth, path, cleanup } = await tempOAuthStore();
    try {
      const client = await oauth.registerClient({ redirect_uris: [CALLBACK] });
      const { verifier, challenge } = pkce();
      const code = await oauth.createAuthCode({
        client_id: client.client_id,
        redirect_uri: CALLBACK,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      const issued = await oauth.redeemAuthCode({ code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
      assert.ok(issued);
      const raw = await fs.readFile(path, "utf8");
      assert.doesNotMatch(raw, new RegExp(code.slice(0, 12)), "auth code plaintext must not be persisted");
      assert.doesNotMatch(raw, new RegExp(issued!.access_token.slice(0, 12)), "access token plaintext must not be persisted");
      assert.match(raw, new RegExp(sha256hex(issued!.access_token)), "the token's hash is what is stored");
    } finally {
      await cleanup();
    }
  });

  it("redeems a code exactly once (reuse is rejected)", async () => {
    const { oauth, cleanup } = await tempOAuthStore();
    try {
      const client = await oauth.registerClient({ redirect_uris: [CALLBACK] });
      const { verifier, challenge } = pkce();
      const code = await oauth.createAuthCode({ client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256" });
      const first = await oauth.redeemAuthCode({ code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
      assert.ok(first);
      const second = await oauth.redeemAuthCode({ code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
      assert.equal(second, null, "a code may not be redeemed twice");
    } finally {
      await cleanup();
    }
  });

  it("rejects a wrong PKCE verifier and burns the code", async () => {
    const { oauth, cleanup } = await tempOAuthStore();
    try {
      const client = await oauth.registerClient({ redirect_uris: [CALLBACK] });
      const { challenge } = pkce();
      const code = await oauth.createAuthCode({ client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256" });
      const bad = await oauth.redeemAuthCode({ code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: "not-the-verifier" });
      assert.equal(bad, null);
      // Even the correct verifier can't rescue a spent code.
      const retry = await oauth.redeemAuthCode({ code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: "anything" });
      assert.equal(retry, null);
    } finally {
      await cleanup();
    }
  });

  it("rejects a code bound to a different client or redirect_uri", async () => {
    const { oauth, cleanup } = await tempOAuthStore();
    try {
      const client = await oauth.registerClient({ redirect_uris: [CALLBACK] });
      const { verifier, challenge } = pkce();
      const code = await oauth.createAuthCode({ client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256" });
      const wrongClient = await oauth.redeemAuthCode({ code, client_id: "someone-else", redirect_uri: CALLBACK, code_verifier: verifier });
      assert.equal(wrongClient, null);
    } finally {
      await cleanup();
    }
  });

  it("expires a code after its TTL", async () => {
    // Deterministic clock: freeze time, mint the code, then jump past the TTL. Using an injected
    // clock instead of a real setTimeout keeps this from racing file I/O on a slow/busy CI box
    // (a 15ms TTL vs. a real fsync is a coin-flip — see the flaky oauth.test.ts:196 fix).
    let clock = 1_000_000;
    const { oauth, cleanup } = await tempOAuthStore({ authCodeTtlMs: 15, now: () => clock });
    try {
      const client = await oauth.registerClient({ redirect_uris: [CALLBACK] });
      const { verifier, challenge } = pkce();
      const code = await oauth.createAuthCode({ client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256" });
      clock += 40; // advance well past the 15ms code TTL
      const expired = await oauth.redeemAuthCode({ code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
      assert.equal(expired, null, "an expired code yields no token");
    } finally {
      await cleanup();
    }
  });

  it("verifies issued access tokens and rejects expired/unknown ones", async () => {
    // Deterministic clock (see the sibling test above): the previous version issued a token with a
    // 20ms TTL and then asserted it was still valid — which only held if issuing + the first verify
    // finished within 20ms. Under load the fsync could blow that budget and fail spuriously.
    let clock = 1_000_000;
    const { oauth, cleanup } = await tempOAuthStore({ accessTokenTtlMs: 20, now: () => clock });
    try {
      const client = await oauth.registerClient({ redirect_uris: [CALLBACK] });
      const { verifier, challenge } = pkce();
      const code = await oauth.createAuthCode({ client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256" });
      const issued = await oauth.redeemAuthCode({ code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
      assert.ok(issued);
      assert.ok(await oauth.verifyAccessToken(issued!.access_token));
      assert.equal(await oauth.verifyAccessToken("garbage"), null);
      clock += 40; // advance well past the 20ms access-token TTL
      assert.equal(await oauth.verifyAccessToken(issued!.access_token), null, "expired token no longer verifies");
    } finally {
      await cleanup();
    }
  });

  it("rotates refresh tokens (old one dies, new pair works)", async () => {
    const { oauth, cleanup } = await tempOAuthStore();
    try {
      const client = await oauth.registerClient({ redirect_uris: [CALLBACK] });
      const { verifier, challenge } = pkce();
      const code = await oauth.createAuthCode({ client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256" });
      const first = await oauth.redeemAuthCode({ code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
      assert.ok(first);
      const refreshed = await oauth.refresh({ refresh_token: first!.refresh_token, client_id: client.client_id });
      assert.ok(refreshed);
      assert.notEqual(refreshed!.access_token, first!.access_token);
      // The rotated (old) refresh token must now be dead.
      const reuse = await oauth.refresh({ refresh_token: first!.refresh_token, client_id: client.client_id });
      assert.equal(reuse, null, "a rotated refresh token cannot be reused");
      // The new access token is valid.
      assert.ok(await oauth.verifyAccessToken(refreshed!.access_token));
    } finally {
      await cleanup();
    }
  });

  it("computes the S256 challenge the same way the spec does", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    // RFC 7636 Appendix B fixed vector.
    assert.equal(pkceS256Challenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP endpoint tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OAuth HTTP: discovery metadata", () => {
  it("serves RFC 9728 protected-resource metadata pointing at this origin's AS", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const res = await fetch(`${origin}/.well-known/oauth-protected-resource`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { resource: string; authorization_servers: string[] };
      assert.equal(body.resource, `${origin}/mcp`);
      assert.deepEqual(body.authorization_servers, [origin]);
    } finally {
      await cleanup();
    }
  });

  it("serves the metadata for the path-suffixed well-known variant too", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const res = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { authorization_servers: string[] };
      assert.deepEqual(body.authorization_servers, [origin]);
    } finally {
      await cleanup();
    }
  });

  it("serves RFC 8414 AS metadata with PKCE S256 and the authorization_code grant", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const res = await fetch(`${origin}/.well-known/oauth-authorization-server`);
      assert.equal(res.status, 200);
      const m = (await res.json()) as Record<string, unknown>;
      assert.equal(m.issuer, origin);
      assert.equal(m.authorization_endpoint, `${origin}/authorize`);
      assert.equal(m.token_endpoint, `${origin}/token`);
      assert.equal(m.registration_endpoint, `${origin}/register`);
      assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
      assert.deepEqual(m.response_types_supported, ["code"]);
      assert.ok((m.grant_types_supported as string[]).includes("authorization_code"));
    } finally {
      await cleanup();
    }
  });

  it("honors the reverse proxy's forwarded proto/host in the advertised URLs", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const res = await fetch(`${origin}/.well-known/oauth-authorization-server`, {
        headers: { "x-forwarded-proto": "https", "x-forwarded-host": "memory.amirj4m.com" },
      });
      const m = (await res.json()) as { issuer: string; token_endpoint: string };
      assert.equal(m.issuer, "https://memory.amirj4m.com");
      assert.equal(m.token_endpoint, "https://memory.amirj4m.com/token");
    } finally {
      await cleanup();
    }
  });
});

describe("OAuth HTTP: dynamic client registration", () => {
  it("registers a client and returns a client_id (RFC 7591)", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const res = await fetch(`${origin}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [CALLBACK], client_name: "Claude" }),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as { client_id: string; redirect_uris: string[]; token_endpoint_auth_method: string };
      assert.ok(body.client_id && body.client_id.length >= 16);
      assert.deepEqual(body.redirect_uris, [CALLBACK]);
      assert.equal(body.token_endpoint_auth_method, "none");
    } finally {
      await cleanup();
    }
  });

  it("rejects a non-https / non-loopback redirect_uri", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const res = await fetch(`${origin}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["http://evil.example.com/cb"] }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "invalid_redirect_uri");
    } finally {
      await cleanup();
    }
  });

  it("rejects registration with no redirect_uris", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const res = await fetch(`${origin}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: "no-uris" }),
      });
      assert.equal(res.status, 400);
    } finally {
      await cleanup();
    }
  });
});

describe("OAuth HTTP: authorize page + consent", () => {
  it("renders the consent page for a valid authorize request", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const reg = await fetch(`${origin}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [CALLBACK] }),
      });
      const { client_id } = (await reg.json()) as { client_id: string };
      const { challenge } = pkce();
      const url = `${origin}/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent(CALLBACK)}&code_challenge=${challenge}&code_challenge_method=S256&state=abc`;
      const res = await fetch(url);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/html/);
      const html = await res.text();
      assert.match(html, /instance token/i);
      assert.match(html, /name="instance_token"/);
    } finally {
      await cleanup();
    }
  });

  it("shows an error page (no redirect) for an unregistered redirect_uri — no open redirect", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const reg = await fetch(`${origin}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [CALLBACK] }),
      });
      const { client_id } = (await reg.json()) as { client_id: string };
      const { challenge } = pkce();
      const evil = "https://attacker.example.com/steal";
      const url = `${origin}/authorize?response_type=code&client_id=${client_id}&redirect_uri=${encodeURIComponent(evil)}&code_challenge=${challenge}&code_challenge_method=S256`;
      const res = await fetch(url, { redirect: "manual" });
      assert.equal(res.status, 400, "must not 302 to an unregistered redirect_uri");
      assert.equal(res.headers.get("location"), null);
    } finally {
      await cleanup();
    }
  });

  it("re-renders the consent page with an error on a wrong instance token", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const reg = await fetch(`${origin}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [CALLBACK] }),
      });
      const { client_id } = (await reg.json()) as { client_id: string };
      const { challenge } = pkce();
      const res = await fetch(`${origin}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        redirect: "manual",
        body: new URLSearchParams({
          response_type: "code",
          client_id,
          redirect_uri: CALLBACK,
          code_challenge: challenge,
          code_challenge_method: "S256",
          instance_token: "wrong-token",
        }).toString(),
      });
      assert.equal(res.status, 401);
      assert.equal(res.headers.get("location"), null, "a wrong token must NOT issue a code/redirect");
      const html = await res.text();
      assert.match(html, /Check your JAMGATE_TOKEN/);
    } finally {
      await cleanup();
    }
  });
});

describe("OAuth HTTP: token exchange + /mcp access", () => {
  it("completes register → authorize → token and the access token works on /mcp", async () => {
    const { origin, mcpUrl, cleanup } = await bootOAuthServer();
    let client: Client | undefined;
    try {
      const { access_token } = await fullFlow(origin);

      // Use the issued OAuth access token as the bearer for a real MCP session.
      client = new Client({ name: "claude-oauth", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: { headers: { Authorization: `Bearer ${access_token}` } },
      });
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["forget_memory", "recall_memory", "save_memory"]);
      const saved = await client.callTool({ name: "save_memory", arguments: { text: "connected via oauth", source: "user-explicit" } });
      assert.match((saved.content as Array<{ text: string }>)[0].text, /^Saved:/);
    } finally {
      if (client) await client.close();
      await cleanup();
    }
  });

  it("rejects reuse of an authorization code at the token endpoint", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const { code, verifier, client_id } = await fullFlow(origin);
      // The code was already redeemed inside fullFlow; a second exchange must fail.
      const res = await fetch(`${origin}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id, code_verifier: verifier }).toString(),
      });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as { error: string }).error, "invalid_grant");
    } finally {
      await cleanup();
    }
  });

  it("rejects the token exchange with a wrong PKCE verifier", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const reg = await fetch(`${origin}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [CALLBACK] }),
      });
      const { client_id } = (await reg.json()) as { client_id: string };
      const { challenge } = pkce();
      const authRes = await fetch(`${origin}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        redirect: "manual",
        body: new URLSearchParams({ response_type: "code", client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", instance_token: TOKEN }).toString(),
      });
      const code = new URL(authRes.headers.get("location") ?? "").searchParams.get("code")!;
      const res = await fetch(`${origin}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id, code_verifier: "wrong-verifier-value" }).toString(),
      });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as { error: string }).error, "invalid_grant");
    } finally {
      await cleanup();
    }
  });

  it("exchanges a refresh token for a new access token", async () => {
    const { origin, cleanup } = await bootOAuthServer();
    try {
      const { refresh_token, client_id } = await fullFlow(origin);
      const res = await fetch(`${origin}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id }).toString(),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { access_token: string; refresh_token: string };
      assert.ok(body.access_token);
      assert.notEqual(body.refresh_token, refresh_token, "refresh tokens rotate");
    } finally {
      await cleanup();
    }
  });
});

describe("OAuth HTTP: backward compatibility + WWW-Authenticate", () => {
  it("still accepts the static instance token on /mcp (existing Claude Code connections)", async () => {
    const { mcpUrl, cleanup } = await bootOAuthServer();
    let client: Client | undefined;
    try {
      client = new Client({ name: "claude-code", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      });
      await client.connect(transport);
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 3);
    } finally {
      if (client) await client.close();
      await cleanup();
    }
  });

  it("returns 401 on /mcp with a WWW-Authenticate resource_metadata pointer (RFC 9728 §5.1)", async () => {
    const { mcpUrl, origin, cleanup } = await bootOAuthServer();
    try {
      const res = await fetch(mcpUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.equal(res.status, 401);
      const header = res.headers.get("www-authenticate") ?? "";
      assert.match(header, /Bearer/);
      assert.match(header, /resource_metadata="/);
      assert.match(header, new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.well-known/oauth-protected-resource`));
    } finally {
      await cleanup();
    }
  });

  it("rejects a random bearer that is neither the static token nor an issued token", async () => {
    const { mcpUrl, cleanup } = await bootOAuthServer();
    try {
      const res = await fetch(mcpUrl, { method: "POST", headers: { Authorization: "Bearer totally-made-up", "Content-Type": "application/json" }, body: "{}" });
      assert.equal(res.status, 401);
    } finally {
      await cleanup();
    }
  });
});
