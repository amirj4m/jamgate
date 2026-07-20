// Persistent OAuth state for Jamgate's remote mode (Phase 9, D-034).
//
// When a Jamgate instance is added to claude.ai / the Claude mobile app as a custom MCP
// connector, those clients only speak the MCP OAuth flow (RFC 9728 + 8414 + 7591 + PKCE) —
// they cannot paste a static bearer token. This store holds the small amount of durable OAuth
// state that flow needs: dynamically-registered clients, short-lived authorization codes, and
// issued access/refresh tokens.
//
// It lives NEXT TO the memory store (~/.jamgate/oauth.json by default) and uses the exact same
// robustness discipline as the FileStore (D-020..D-023):
//   - every read-modify-write runs under the shared file-lock (withFileLock),
//   - writes are atomic + durable (temp file in the same dir → fsync → rename),
//   - it re-reads the file fresh inside the lock so concurrent writers never lose an update.
//
// SECRETS ARE HASHED AT REST. Authorization codes, access tokens and refresh tokens are stored
// only as their SHA-256 hex digest — the plaintext is returned once to the client and never
// written to disk, so a leaked oauth.json cannot be replayed against the instance. Revoking a
// token is deleting its entry. No new runtime dependencies: Node's crypto + fs only.

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { withFileLock } from "../store/lock.js";

/** A client registered via RFC 7591 Dynamic Client Registration. `client_id` is a public,
 *  non-secret identifier; we run public (PKCE) clients only, so there is no client secret. */
export interface OAuthClient {
  client_id: string;
  redirect_uris: string[];
  client_name?: string;
  createdAt: string;
}

/** A pending authorization code, keyed in the file by the code's SHA-256 hex digest. Bound to
 *  the client + redirect_uri it was issued for and to a PKCE challenge; single-use and short. */
interface StoredAuthCode {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  /** Always "S256" — we reject "plain" at the authorize endpoint. */
  code_challenge_method: string;
  scope?: string;
  /** The RFC 8707 resource the client asked the token be bound to, if any. */
  resource?: string;
  expiresAt: number;
}

/** An issued access or refresh token, keyed by its SHA-256 hex digest. */
interface StoredToken {
  client_id: string;
  scope?: string;
  resource?: string;
  expiresAt: number;
  createdAt: string;
}

interface OAuthFile {
  version: number;
  clients: Record<string, OAuthClient>;
  authCodes: Record<string, StoredAuthCode>;
  accessTokens: Record<string, StoredToken>;
  refreshTokens: Record<string, StoredToken>;
}

const CURRENT_VERSION = 1;
const DEFAULT_PATH = join(homedir(), ".jamgate", "oauth.json");

/** Authorization codes are single-use and must be redeemed almost immediately; the spec calls
 *  for ≤60s. We issue them with a 60s life. */
const DEFAULT_AUTH_CODE_TTL_MS = 60_000;
/** Access tokens are long-lived so a phone/desktop connector keeps working without re-auth;
 *  90 days, revocable by deleting the entry. */
const DEFAULT_ACCESS_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Refresh tokens outlive access tokens and are rotated on every use (OAuth 2.1 public-client
 *  rule). 180 days. */
const DEFAULT_REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface OAuthStoreOptions {
  authCodeTtlMs?: number;
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
  /** Injectable clock (defaults to Date.now) so tests can exercise expiry deterministically. */
  now?: () => number;
}

/** SHA-256 hex digest — how every secret (code/token) is keyed and compared at rest. */
export function sha256hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time string equality for secrets that are NOT length-public (raw instance token). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Compare against self so the work (and timing) doesn't reveal the expected length.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** A fresh, URL-safe random secret (43 base64url chars from 32 bytes). Used for auth codes and
 *  tokens; the plaintext is returned to the client once and only its hash is persisted. */
function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** BASE64URL(SHA-256(verifier)) — the PKCE S256 transform (RFC 7636). Compared against the
 *  stored `code_challenge` when the code is redeemed. */
export function pkceS256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

/** The result of a successful token issuance. Plaintext secrets — returned to the client, never
 *  logged or persisted (only their hashes go to disk). */
export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
}

/**
 * The durable OAuth state for one Jamgate instance. One instance = one human (D-029), so this is
 * deliberately a small single-file store, not a multi-tenant IdP. Mirrors FileStore's lock +
 * atomic-write discipline exactly (it even reuses the same `withFileLock`).
 */
export class OAuthStore {
  private path: string;
  private lockPath: string;
  private authCodeTtlMs: number;
  private accessTokenTtlMs: number;
  private refreshTokenTtlMs: number;
  private now: () => number;

  constructor(
    path: string = process.env.JAMGATE_OAUTH_STORE ?? DEFAULT_PATH,
    opts: OAuthStoreOptions = {},
  ) {
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.authCodeTtlMs = opts.authCodeTtlMs ?? DEFAULT_AUTH_CODE_TTL_MS;
    this.accessTokenTtlMs = opts.accessTokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
    this.refreshTokenTtlMs = opts.refreshTokenTtlMs ?? DEFAULT_REFRESH_TOKEN_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  get storePath(): string {
    return this.path;
  }

  private empty(): OAuthFile {
    return { version: CURRENT_VERSION, clients: {}, authCodes: {}, accessTokens: {}, refreshTokens: {} };
  }

  /** Load the file, tolerating a missing/empty file (fresh instance) and filling in any keys a
   *  future older format might miss so callers can assume the full shape. */
  private async load(): Promise<OAuthFile> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return this.empty();
      throw err;
    }
    if (raw.trim() === "") return this.empty();
    const parsed = JSON.parse(raw) as Partial<OAuthFile>;
    return {
      version: parsed.version ?? CURRENT_VERSION,
      clients: parsed.clients ?? {},
      authCodes: parsed.authCodes ?? {},
      accessTokens: parsed.accessTokens ?? {},
      refreshTokens: parsed.refreshTokens ?? {},
    };
  }

  /** Atomic, durable write — identical technique to FileStore.writeAll: serialize to a temp
   *  file in the same directory, fsync, then rename over the target (atomic on POSIX). */
  private async writeAll(file: OAuthFile): Promise<void> {
    const dir = dirname(this.path);
    await fs.mkdir(dir, { recursive: true });
    const data = JSON.stringify(file, null, 2);
    const tmp = join(dir, `.${basename(this.path)}.${randomBytes(8).toString("hex")}.tmp`);
    try {
      const handle = await fs.open(tmp, "w");
      try {
        await handle.writeFile(data, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, this.path);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  /** Ensure the directory exists (the lock lives there too) and run `fn` under the file lock,
   *  mirroring FileStore.withLock so both stores serialize on the same discipline. */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    return withFileLock(this.lockPath, fn);
  }

  /** Drop every expired code and token in place. Called inside each write so the file
   *  self-prunes and can't accumulate dead secrets without a background job. */
  private prune(file: OAuthFile, nowMs: number): void {
    for (const [k, v] of Object.entries(file.authCodes)) {
      if (v.expiresAt <= nowMs) delete file.authCodes[k];
    }
    for (const [k, v] of Object.entries(file.accessTokens)) {
      if (v.expiresAt <= nowMs) delete file.accessTokens[k];
    }
    for (const [k, v] of Object.entries(file.refreshTokens)) {
      if (v.expiresAt <= nowMs) delete file.refreshTokens[k];
    }
  }

  /** Register a client (RFC 7591). `redirect_uris` is validated by the caller (handler) against
   *  the transport rules; here we just persist and mint a public `client_id`. */
  async registerClient(input: {
    redirect_uris: string[];
    client_name?: string;
  }): Promise<OAuthClient> {
    return this.withLock(async () => {
      const file = await this.load();
      this.prune(file, this.now());
      const client: OAuthClient = {
        client_id: randomBytes(16).toString("hex"),
        redirect_uris: input.redirect_uris,
        client_name: input.client_name,
        createdAt: new Date(this.now()).toISOString(),
      };
      file.clients[client.client_id] = client;
      await this.writeAll(file);
      return client;
    });
  }

  /** Look up a registered client. Read-only, so it runs without the lock — the atomic write
   *  path guarantees a reader always sees a whole file. */
  async getClient(client_id: string): Promise<OAuthClient | undefined> {
    const file = await this.load();
    return file.clients[client_id];
  }

  /**
   * Mint a single-use authorization code bound to (client_id, redirect_uri, PKCE challenge).
   * Returns the plaintext code (given to the client via the redirect); only its hash is stored.
   */
  async createAuthCode(input: {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    scope?: string;
    resource?: string;
  }): Promise<string> {
    return this.withLock(async () => {
      const file = await this.load();
      const nowMs = this.now();
      this.prune(file, nowMs);
      const code = randomToken();
      file.authCodes[sha256hex(code)] = {
        client_id: input.client_id,
        redirect_uri: input.redirect_uri,
        code_challenge: input.code_challenge,
        code_challenge_method: input.code_challenge_method,
        scope: input.scope,
        resource: input.resource,
        expiresAt: nowMs + this.authCodeTtlMs,
      };
      await this.writeAll(file);
      return code;
    });
  }

  /**
   * Redeem an authorization code exactly once. Verifies the code exists, is unexpired, was
   * issued to this client + redirect_uri, and that the PKCE `code_verifier` matches the stored
   * S256 challenge. On success the code is DELETED (single-use) and fresh access + refresh
   * tokens are issued in the same locked write. Returns null on any failure (the caller maps it
   * to an `invalid_grant` error) — a reused or tampered code never yields a token.
   */
  async redeemAuthCode(input: {
    code: string;
    client_id: string;
    redirect_uri: string;
    code_verifier: string;
  }): Promise<IssuedTokens | null> {
    return this.withLock(async () => {
      const file = await this.load();
      const nowMs = this.now();
      this.prune(file, nowMs);

      const key = sha256hex(input.code);
      const entry = file.authCodes[key];
      if (!entry) return null;
      // Consume unconditionally: a code presented even once is spent, so a bad verifier can't be
      // retried and a replay of the same code finds nothing.
      delete file.authCodes[key];

      if (entry.expiresAt <= nowMs) {
        await this.writeAll(file);
        return null;
      }
      if (entry.client_id !== input.client_id || entry.redirect_uri !== input.redirect_uri) {
        await this.writeAll(file);
        return null;
      }
      if (entry.code_challenge_method !== "S256") {
        await this.writeAll(file);
        return null;
      }
      const expected = entry.code_challenge;
      const actual = pkceS256Challenge(input.code_verifier);
      if (!constantTimeEqual(actual, expected)) {
        await this.writeAll(file);
        return null;
      }

      const issued = this.mintTokens(file, {
        client_id: entry.client_id,
        scope: entry.scope,
        resource: entry.resource,
        nowMs,
      });
      await this.writeAll(file);
      return issued;
    });
  }

  /**
   * Rotate a refresh token (OAuth 2.1 requires refresh-token rotation for public clients): the
   * presented refresh token is invalidated and a brand-new access + refresh pair is issued.
   * Returns null if the refresh token is unknown, expired, or not owned by this client.
   */
  async refresh(input: { refresh_token: string; client_id: string }): Promise<IssuedTokens | null> {
    return this.withLock(async () => {
      const file = await this.load();
      const nowMs = this.now();
      this.prune(file, nowMs);

      const key = sha256hex(input.refresh_token);
      const entry = file.refreshTokens[key];
      if (!entry) return null;
      delete file.refreshTokens[key]; // rotate: the old refresh token is now dead
      if (entry.expiresAt <= nowMs || entry.client_id !== input.client_id) {
        await this.writeAll(file);
        return null;
      }
      const issued = this.mintTokens(file, {
        client_id: entry.client_id,
        scope: entry.scope,
        resource: entry.resource,
        nowMs,
      });
      await this.writeAll(file);
      return issued;
    });
  }

  /** Create an access + refresh token pair and record their hashes on `file` (does not write).
   *  Shared by the code-exchange and refresh paths. */
  private mintTokens(
    file: OAuthFile,
    input: { client_id: string; scope?: string; resource?: string; nowMs: number },
  ): IssuedTokens {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    file.accessTokens[sha256hex(accessToken)] = {
      client_id: input.client_id,
      scope: input.scope,
      resource: input.resource,
      expiresAt: input.nowMs + this.accessTokenTtlMs,
      createdAt: new Date(input.nowMs).toISOString(),
    };
    file.refreshTokens[sha256hex(refreshToken)] = {
      client_id: input.client_id,
      scope: input.scope,
      resource: input.resource,
      expiresAt: input.nowMs + this.refreshTokenTtlMs,
      createdAt: new Date(input.nowMs).toISOString(),
    };
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: Math.floor(this.accessTokenTtlMs / 1000),
      scope: input.scope,
    };
  }

  /**
   * Validate a bearer access token presented at /mcp. Returns the token record when the token is
   * known and unexpired, else null. Read-only (no lock, no prune-write) so it stays cheap on the
   * hot request path; expired entries are swept on the next write.
   */
  async verifyAccessToken(token: string): Promise<StoredToken | null> {
    if (!token) return null;
    const file = await this.load();
    const entry = file.accessTokens[sha256hex(token)];
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) return null;
    return entry;
  }
}
