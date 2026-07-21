import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { MemoryStore } from "./store/types.js";
import { VERSION } from "./version.js";
import { createServer } from "./index.js";
import { resolveGateLogConfig, type GateLogConfig } from "./gate/log.js";
import type { OAuthStore } from "./oauth/store.js";
import { handleOAuth, resourceMetadataUrl } from "./oauth/handlers.js";

/**
 * Optional REMOTE mode for Jamgate (Phase 5, D-029).
 *
 * stdio stays the default and the local-first story is unchanged; this module adds an
 * opt-in Streamable HTTP transport so ONE self-hosted Jamgate instance can serve all of a
 * single human's MCP clients at once — the phone app, claude.ai, Claude Code on a laptop,
 * a ChatGPT connector — sharing one memory. It is a generic feature for every Jamgate user,
 * not bespoke to any deployment.
 *
 * Security model (see README "Remote mode"):
 *  - A bearer token (JAMGATE_TOKEN) gates every request; the comparison is constant-time.
 *  - TLS is terminated by a reverse proxy (caddy/nginx), never in-process — we bind to
 *    localhost by default so the proxy is the only public entry point.
 *  - One instance = one human. Whoever holds the token holds the memory. There is no
 *    multi-user tenancy by design (D-029).
 */

const DEFAULT_PORT = 8420;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MCP_PATH = "/mcp";
const HEALTH_PATH = "/healthz";

/** How to run: stdio (default) or the opt-in HTTP transport. Parsed from argv + env so the
 *  bootstrap in index.ts stays a thin switch and the parsing is unit-testable. */
export interface CliOptions {
  http: boolean;
  port: number;
}

/**
 * Decide the run mode from CLI args and environment. HTTP mode is opt-in via the `--http`
 * flag or a truthy `JAMGATE_HTTP` env var; stdio is the default when neither is set. The
 * port comes from `--port <n>`, else `JAMGATE_PORT`, else the platform's `PORT` (PaaS hosts
 * such as Railway and Render inject it), else {@link DEFAULT_PORT}. An invalid port falls
 * back to the default rather than crashing the server on a typo.
 */
export function parseCliOptions(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  const http = argv.includes("--http") || isTruthyEnv(env.JAMGATE_HTTP);

  let port: number | undefined;
  const flagIndex = argv.indexOf("--port");
  if (flagIndex !== -1 && flagIndex + 1 < argv.length) {
    port = Number(argv[flagIndex + 1]);
  } else if (env.JAMGATE_PORT) {
    port = Number(env.JAMGATE_PORT);
  } else if (env.PORT) {
    // Deploy platforms (Railway, Render, Heroku, …) assign the listen port via $PORT and
    // expect the app to honor it. JAMGATE_PORT still wins so an explicit override is possible.
    port = Number(env.PORT);
  }
  if (port === undefined || !Number.isInteger(port) || port < 0 || port > 65535) {
    port = DEFAULT_PORT;
  }

  return { http, port };
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header against the expected
 * token. Returns false for a missing/malformed header or any mismatch. The comparison uses
 * `timingSafeEqual` so an attacker can't learn the token byte-by-byte from response timing;
 * when the lengths differ we still run one comparison (against the presented value itself)
 * to avoid leaking the token length through an early return.
 */
export function bearerTokenMatches(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorizationHeader) return false;
  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return false;
  const presented = Buffer.from(authorizationHeader.slice(prefix.length).trim(), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  if (presented.length !== expected.length) {
    // Length already differs, so it can't match — but compare presented against itself so
    // the work (and thus the timing) doesn't depend on the expected token's length.
    timingSafeEqual(presented, presented);
    return false;
  }
  return timingSafeEqual(presented, expected);
}

/** Pull the raw token out of an `Authorization: Bearer <token>` header, or undefined if the
 *  header is missing or not a Bearer credential. Used to hand OAuth access tokens to the store
 *  for validation (the static-token path uses the constant-time {@link bearerTokenMatches}). */
export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return undefined;
  const token = authorizationHeader.slice(prefix.length).trim();
  return token.length > 0 ? token : undefined;
}

export interface HttpServerOptions {
  /** The shared store. ALL HTTP sessions write through this one instance; the Phase 2 file
   *  lock + re-read-before-write make concurrent saves from multiple sessions safe. */
  store: MemoryStore;
  /** The bearer token required on every request. Must be non-empty (the caller enforces). */
  token: string;
  /** Port to listen on. 0 picks an ephemeral port (used by tests). */
  port?: number;
  /** Interface to bind. Defaults to localhost so a reverse proxy is the only public door. */
  host?: string;
  /** The MCP endpoint path. Defaults to `/mcp`. */
  path?: string;
  /** Gate-decision log config, forwarded to each session's server (D-025). Defaults to the
   *  env-resolved config; tests pass a disabled config to avoid touching `~/.jamgate`. */
  gateLog?: GateLogConfig;
  /** OAuth authorization-server state (D-034). When provided, the instance also serves the MCP
   *  OAuth flow (metadata, /register, /authorize, /token) so it can be added to claude.ai / the
   *  Claude mobile app, and /mcp accepts issued access tokens in addition to the static token.
   *  When omitted, behaviour is exactly as before: static-token-only, no OAuth endpoints. */
  oauth?: OAuthStore;
}

export interface RunningHttpServer {
  server: HttpServer;
  /** The actual port the server bound to (resolves an ephemeral 0 to the real number). */
  port: number;
  host: string;
  path: string;
  close: () => Promise<void>;
}

/**
 * Start the HTTP transport and resolve once it is listening. Each MCP session gets its own
 * `StreamableHTTPServerTransport` and its own `createServer(store)` instance (so the
 * per-connection handshake provenance in D-024 still works over HTTP), all sharing the one
 * injected store. Sessions are tracked by the `mcp-session-id` header per the SDK's stateful
 * Streamable HTTP pattern, and torn down when the client disconnects or DELETEs the session.
 */
export function startHttpServer(opts: HttpServerOptions): Promise<RunningHttpServer> {
  const host = opts.host ?? process.env.JAMGATE_HOST ?? DEFAULT_HOST;
  const path = opts.path ?? DEFAULT_MCP_PATH;
  const port = opts.port ?? DEFAULT_PORT;
  const gateLog = opts.gateLog ?? resolveGateLogConfig();

  // Live sessions, keyed by the session id the transport assigns at initialize time.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer((req, res) => {
    handleRequest(req, res, { store: opts.store, token: opts.token, path, transports, gateLog, oauth: opts.oauth }).catch(
      (err) => {
        console.error("jamgate http: unhandled request error:", err);
        if (!res.headersSent) {
          sendJson(res, 500, {
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        } else {
          res.end();
        }
      },
    );
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", reject);
      const addr = httpServer.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server: httpServer,
        port: boundPort,
        host,
        path,
        close: () =>
          new Promise<void>((res2, rej2) => {
            for (const t of transports.values()) void t.close();
            transports.clear();
            httpServer.close((err) => (err ? rej2(err) : res2()));
          }),
      });
    });
  });
}

interface RequestContext {
  store: MemoryStore;
  token: string;
  path: string;
  transports: Map<string, StreamableHTTPServerTransport>;
  gateLog: GateLogConfig;
  oauth?: OAuthStore;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  // 0. Health check — deliberately BEFORE the auth gate and outside the MCP endpoint. Deploy
  //    platforms (Railway, Render, …) probe an unauthenticated URL to decide if the container
  //    is live, so this must answer 200 without a token. It exposes only liveness + version —
  //    never any memory, session, or config data (RULES §10: nothing leaks).
  const reqPath = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
  if (reqPath === HEALTH_PATH) {
    if (req.method === "GET" || req.method === "HEAD") {
      sendJson(res, 200, { status: "ok", version: VERSION });
    } else {
      res.setHeader("Allow", "GET, HEAD");
      sendJson(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: `Method ${req.method} not allowed` },
        id: null,
      });
    }
    return;
  }

  // 1. OAuth endpoints (D-034). When OAuth is enabled, the discovery/registration/authorize/
  //    token endpoints are served BEFORE the bearer gate — they are the path by which a client
  //    (claude.ai, Claude mobile) obtains a token in the first place. They never touch memory.
  if (ctx.oauth) {
    const handled = await handleOAuth(req, res, { oauth: ctx.oauth, staticToken: ctx.token, mcpPath: ctx.path });
    if (handled) return;
  }

  // 2. Auth gate — before anything else on the MCP endpoint, on every method. A request is
  //    authorized if it carries EITHER the static instance token (backward compatible: existing
  //    Claude Code connections keep working) OR an OAuth access token this instance issued. A
  //    missing/wrong credential is a flat 401; we never fall through to session handling.
  const staticOk = bearerTokenMatches(req.headers.authorization, ctx.token);
  let oauthOk = false;
  if (!staticOk && ctx.oauth) {
    const presented = extractBearerToken(req.headers.authorization);
    oauthOk = presented !== undefined && (await ctx.oauth.verifyAccessToken(presented)) !== null;
  }
  if (!staticOk && !oauthOk) {
    // Per RFC 9728 §5.1, point unauthenticated MCP clients at the protected-resource metadata so
    // they can discover the OAuth flow. Only advertise it when OAuth is actually enabled.
    const wwwAuth = ctx.oauth
      ? `Bearer realm="jamgate", resource_metadata="${resourceMetadataUrl(req)}"`
      : 'Bearer realm="jamgate"';
    res.setHeader("WWW-Authenticate", wwwAuth);
    sendJson(res, 401, {
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: valid bearer token required" },
      id: null,
    });
    return;
  }

  // 3. Past the auth gate, only the MCP endpoint exists (the unauthenticated `/healthz` and the
  //    OAuth endpoints were already handled above). Everything else is 404.
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== ctx.path) {
    sendJson(res, 404, {
      jsonrpc: "2.0",
      error: { code: -32601, message: `Not found. MCP endpoint is ${ctx.path}` },
      id: null,
    });
    return;
  }

  const sessionId = header(req, "mcp-session-id");

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (body === PARSE_ERROR) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error: request body is not valid JSON" },
        id: null,
      });
      return;
    }

    let transport = sessionId ? ctx.transports.get(sessionId) : undefined;

    if (!transport) {
      if (isInitializeRequest(body)) {
        // New session: spin up a fresh transport + its own server, sharing the store.
        // Note we accept an initialize even when it still carries a stale `Mcp-Session-Id`
        // header. The spec has the client re-initialize *without* one, but a client that
        // forgets to strip it is trying to do exactly the right thing; answering 404 to its
        // recovery attempt would strand it for good. It gets a brand-new session id back.
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            ctx.transports.set(sid, transport!);
          },
        });
        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) ctx.transports.delete(sid);
        };
        const server = createServer(ctx.store, ctx.gateLog);
        await server.connect(transport);
      } else if (sessionId) {
        sendSessionNotFound(res);
        return;
      } else {
        // No session id at all and not an initialize → the client must initialize first.
        // Streamable HTTP §Session Management point 2: a server that requires a session id
        // SHOULD answer 400 Bad Request here. This is NOT the expired-session case.
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: no session id; send an initialize request first",
          },
          id: null,
        });
        return;
      }
    }

    await transport.handleRequest(req, res, body);
    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    // GET opens the server→client SSE stream; DELETE ends the session. Both need a session.
    const transport = sessionId ? ctx.transports.get(sessionId) : undefined;
    if (!transport) {
      if (sessionId) {
        sendSessionNotFound(res);
      } else {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: missing session id" },
          id: null,
        });
      }
      return;
    }
    await transport.handleRequest(req, res);
    return;
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  sendJson(res, 405, {
    jsonrpc: "2.0",
    error: { code: -32000, message: `Method ${req.method} not allowed` },
    id: null,
  });
}

/**
 * Answer a request that carries an `Mcp-Session-Id` we don't know (D-038).
 *
 * Sessions live in this process's memory, so every restart of the service — a deploy, a
 * crash, an OOM kill — silently invalidates every session id its clients are still holding.
 * The MCP Streamable HTTP spec has one recovery path for exactly this, and it is a status
 * code: "The server MAY terminate the session at any time, after which it MUST respond to
 * requests containing that session ID with HTTP 404 Not Found", and "When a client receives
 * HTTP 404 in response to a request containing an Mcp-Session-Id, it MUST start a new session
 * by sending a new InitializeRequest without a session ID attached."
 *
 * We used to answer 400 here. A conforming client (claude.ai) reads 400 as "that request was
 * malformed", not "your session is gone", so it never re-handshakes — the conversation stays
 * wedged on a dead session id until the user restarts the client. The 404 is the signal that
 * makes recovery automatic and invisible; it is the entire fix.
 */
function sendSessionNotFound(res: ServerResponse): void {
  sendJson(res, 404, {
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message:
        "Session not found: this session id is unknown or expired (the server may have " +
        "restarted). Send a new initialize request without a session id to start a new session.",
    },
    id: null,
  });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

const PARSE_ERROR = Symbol("parse-error");

/** Read and JSON-parse the request body. Returns the parsed value, `undefined` for an empty
 *  body, or the {@link PARSE_ERROR} sentinel when the body isn't valid JSON. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await new Promise<string>((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return PARSE_ERROR;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}
