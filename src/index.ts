#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { VERSION } from "./version.js";
import { FileStore } from "./store/fileStore.js";
import { loadTransformersEmbedder, resolveDupThreshold } from "./embeddings/embedder.js";
import { parseCliOptions, startHttpServer } from "./http.js";
import { OAuthStore } from "./oauth/store.js";
import { setupCommand, statusCommand } from "./setup/cli.js";
import { exportCommand, importCommand } from "./backup/cli.js";
import type { ClientInfo, MemoryStore } from "./store/types.js";
import { resolveGateLogConfig, type GateLogConfig } from "./gate/log.js";
import { saveThroughGate } from "./gate/pipeline.js";

/**
 * Build the Jamgate MCP server around a given store. Factored out of the stdio bootstrap
 * so tests can drive the real handlers over an in-memory transport (e.g. to prove that
 * client provenance is captured from the handshake, D-024) without spawning a process.
 */
export function createServer(
  store: MemoryStore,
  gateLog: GateLogConfig = resolveGateLogConfig(),
): Server {
  const server = new Server(
    { name: "jamgate", version: VERSION },
    { capabilities: { tools: {} } },
  );

  /** The MCP client behind the current connection, taken from the `clientInfo` the client
   *  sent in the `initialize` handshake (D-024). This is server-observed provenance — the
   *  calling agent cannot spoof it through tool arguments. Undefined until the handshake
   *  completes or if the client sent no name. */
  function clientInfoFromHandshake(): ClientInfo | undefined {
    const impl = server.getClientVersion();
    if (!impl?.name) return undefined;
    return { name: impl.name, version: impl.version };
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "save_memory",
        description:
          "Save a durable memory about the user through the Jamgate quality gate. " +
          "Only call this for things worth remembering across sessions — identity, " +
          "projects, preferences, lasting state — not chatter. Trivial or duplicate " +
          "input is rejected by the gate.",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description:
                "The memory, as a clear standalone statement. Canonical field — always " +
                "prefer it; `content` and `memory` are accepted as aliases for clients " +
                "that send the memory under another name.",
            },
            type: {
              type: "string",
              enum: ["identity", "project", "preference", "state"],
              description: "Which memory layer this belongs to (RULES §4).",
            },
            subject: {
              type: "string",
              description:
                "What this memory is about, e.g. 'operating-system', 'location', " +
                "'current-project'. If a newer memory shares a subject with an older one, " +
                "the newer replaces it (time-aware supersession). ALWAYS pass this when " +
                "the memory updates something already tracked — a progress figure, a " +
                "balance, a status, a current choice — and reuse the EXACT subject string " +
                "the earlier memory used. Without a matching subject the gate cannot tell " +
                "an update from a new fact and both stay active. If omitted, the gate " +
                "derives a best-effort subject from the text, and declines to guess when " +
                "the text is long or covers several topics.",
            },
            source: {
              type: "string",
              enum: ["agent-inferred", "user-confirmed", "user-explicit"],
              description: "Where this memory came from. Defaults to agent-inferred.",
            },
            scope: {
              type: "string",
              description:
                "Optional namespace to save into, e.g. 'amir/greek'. Memories in different " +
                "scopes never interfere — the gate (dedup, supersession, conflict) applies " +
                "per scope, and recall/forget are per scope. Omit for the single default " +
                "namespace, which is the normal single-user behaviour.",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "recall_memory",
        description: "Recall stored memories about the user relevant to a query.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to recall. Empty returns the most recent." },
            limit: { type: "number", description: "Max results (default 5)." },
            scope: {
              type: "string",
              description:
                "Optional namespace to recall from, e.g. 'amir/greek'. Only memories saved " +
                "into this scope are returned. Omit for the default namespace.",
            },
          },
        },
      },
      {
        name: "forget_memory",
        description:
          "Delete a stored memory by the id shown in recall_memory output. The full id is " +
          "safest; an unambiguous prefix of 8+ characters also resolves.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "The memory id to forget, exactly as recall_memory printed it (or an " +
                "unambiguous first-8-characters-or-more prefix of it).",
            },
            scope: {
              type: "string",
              description:
                "Optional namespace the memory lives in, e.g. 'amir/greek'. Forget only " +
                "resolves ids within this scope, so one namespace can't delete another's " +
                "memory. Omit for the default namespace. Use the same scope you recalled " +
                "the id from.",
            },
          },
          required: ["id"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    if (name === "save_memory") {
      // Validate the ARGUMENT before judging the MEMORY (D-037). A missing, misnamed or
      // non-string `text` is a tool-usage error, not a verdict about the content — and
      // `String(args.text ?? "")` used to turn it into `""` (reported back as the absurd
      // "too short" for a memory the agent believed was 1700 characters) or, worse, into the
      // literal "[object Object]" when a client wrapped the text in a content block. Say
      // exactly what is wrong and what arrived, so the caller can correct itself.
      //
      // Real clients in the wild send the memory under another name — claude.ai/Cowork
      // sends `content` (D-039). Accept the aliases silently and identically: a caller
      // that got the field name wrong still meant to save a memory, and answering it with
      // an error teaches nothing the description doesn't already say. `text` stays
      // canonical and wins whenever it is usable.
      const usable = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
      const rawText = usable(args.text)
        ? args.text
        : usable(args.content)
          ? args.content
          : usable(args.memory)
            ? args.memory
            : args.text;
      if (typeof rawText !== "string" || rawText.trim() === "") {
        const keys = Object.keys(args);
        const received =
          keys.length === 0
            ? "no arguments were provided"
            : `received keys: ${keys.join(", ")}${
                rawText !== undefined && typeof rawText !== "string"
                  ? ` ("text" was ${Array.isArray(rawText) ? "an array" : typeof rawText}, not a string)`
                  : ""
              }`;
        // Surfaced on stderr too: on a hardened deployment the gate log may be unwritable,
        // and this class of client mismatch is invisible without a trace somewhere.
        console.error(`jamgate: save_memory called without a valid "text" argument — ${received}`);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `save_memory failed: "text" is required and must be a non-empty string — ` +
                `${received}. Pass the memory itself as a plain string, e.g. ` +
                `{"text": "jam prefers TypeScript", "type": "preference"}. ` +
                `Nothing was saved and the gate did not judge this call.`,
            },
          ],
        };
      }
      const text = rawText;
      const client = clientInfoFromHandshake();
      // Run the exact same gate the REST API runs (D-049): prefilter → subject → store.save
      // → gate log, scoped per D-048. The handler keeps only its own concerns — argument
      // shape above, and the human-readable reply below.
      const outcome = await saveThroughGate(
        store,
        {
          text,
          type: args.type ? String(args.type) : undefined,
          subject: args.subject ? String(args.subject) : undefined,
          source: args.source ? String(args.source) : undefined,
          scope: args.scope ? String(args.scope) : undefined,
          // Provenance from the MCP initialize handshake, not the agent's tool arguments (D-024).
          client,
        },
        gateLog,
      );
      if (!outcome.ok) {
        return { content: [{ type: "text", text: `Rejected by gate: ${outcome.reason}.` }] };
      }
      const result = outcome.result;
      let msg: string;
      if (result.action === "duplicate") {
        msg = `Already known (no duplicate added): "${result.memory.text}" [id ${result.memory.id}]`;
      } else if (result.action === "superseded") {
        const old = (result.retired ?? []).map((m) => `"${m.text}"`).join(", ");
        msg =
          `Saved and superseded by recency — retired ${old} in favor of ` +
          `"${result.memory.text}" [id ${result.memory.id}]`;
      } else if (result.action === "conflict") {
        const conflicts = (result.conflictsWith ?? [])
          .map((m) => `"${m.text}" (${m.source})`)
          .join(", ");
        msg =
          `Not saved — conflict on subject "${result.memory.subject}". A more-trusted ` +
          `memory already exists: ${conflicts}. The new fact "${result.memory.text}" came ` +
          `from a less-trusted source (${result.memory.source}). Confirm with the user; to ` +
          `apply it, re-save with source "user-confirmed" or "user-explicit".`;
      } else if (result.action === "possible_duplicate") {
        const near = (result.possibleDuplicates ?? [])
          .map((d) => `"${d.memory.text}" [id ${d.memory.id}] (~${d.similarity.toFixed(2)})`)
          .join(", ");
        msg =
          `Not saved — "${result.memory.text}" looks like a semantic duplicate of an ` +
          `existing memory: ${near}. If it is genuinely the same fact, nothing to do. ` +
          // The advice has to match what the caller actually sent. Since 0.8.0 this branch
          // is reachable WITH a subject (D-044), and telling an agent that just supplied
          // one to "re-save with a subject" reads as the gate ignoring its input. Point it
          // at the existing memory's subject, which is the thing that would actually work.
          (result.memory.subject
            ? `If it is an UPDATE to that memory, re-save it with the EXISTING memory's ` +
              `subject (shown above) rather than "${result.memory.subject}" — supersession ` +
              `matches on the subject string, so a different spelling reads as a different ` +
              `topic. If it is a genuinely distinct fact, say so and re-save it.`
            : `If it is a distinct fact or an update, re-save with a \`subject\` so the gate ` +
              `treats it as its own memory (or a time-aware update of that subject).`);
      } else {
        msg = `Saved: "${result.memory.text}" [id ${result.memory.id}]`;
        // A "did you mean to update?" hint, never an action (D-045). Two saves tracking the
        // same value ("savings 5/10, €640" → "7/10, €768") are only 0.67 apart — nowhere
        // near a duplicate, yet plainly one subject. The gate cannot tell those from two
        // genuinely different facts, but the AGENT has the conversation and can. So we
        // store the memory and name what it resembles.
        const related = result.relatedMemories ?? [];
        if (related.length > 0) {
          const list = related
            .slice(0, 3)
            .map(
              (r) =>
                `"${r.memory.text}" [id ${r.memory.id}]` +
                (r.memory.subject ? ` (subject "${r.memory.subject}")` : "") +
                ` (~${r.similarity.toFixed(2)})`,
            )
            .join(", ");
          msg +=
            `\nNote — this looks related to: ${list}. If the new memory UPDATES the same ` +
            `thing rather than adding a separate fact, re-save it with that memory's ` +
            `\`subject\` so the older one is retired instead of both staying active; then ` +
            `forget the copy just saved [id ${result.memory.id}].`;
        }
      }
      return { content: [{ type: "text", text: msg }] };
    }

    if (name === "recall_memory") {
      const hits = await store.recall(
        String(args.query ?? ""),
        Number(args.limit ?? 5),
        false,
        args.scope ? String(args.scope) : undefined,
      );
      if (hits.length === 0) return { content: [{ type: "text", text: "No matching memories." }] };
      // The id goes on its own line, last, with nothing punctuating it (D-041). Inline
      // `(id …, <date>)` put a comma against the id and buried it after a memory that can
      // run for paragraphs — agents copied a truncated or comma-suffixed id into
      // forget_memory and got "No memory with that id".
      const body = hits
        .map(
          (m) =>
            `- [${m.type ?? "untyped"}] ${m.text}\n` +
            `  created ${m.createdAt}\n` +
            `  id: ${m.id}`,
        )
        .join("\n");
      return { content: [{ type: "text", text: body }] };
    }

    if (name === "forget_memory") {
      const given = String(args.id ?? "");
      const res = await store.forget(given, args.scope ? String(args.scope) : undefined);
      if (res.ok) return { content: [{ type: "text", text: `Forgotten (id ${res.id}).` }] };
      const msg =
        res.reason === "ambiguous"
          ? `"${given}" matches ${res.matches.length} memories (${res.matches.join(", ")}). ` +
            `Pass more of the id.`
          : `No memory with id "${given}". Ids come from recall_memory — pass the full id ` +
            `(or at least its first 8 characters), with no surrounding punctuation.`;
      return { content: [{ type: "text", text: msg }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  });

  return server;
}

/** Build the default FileStore, wiring in optional local embeddings (D-026). Shared by the
 *  stdio and HTTP bootstraps so both run identical gate/store behaviour. */
async function buildStore(): Promise<FileStore> {
  // Loading is lazy and best-effort so the base install and offline/CI runs work unchanged.
  const embedder = await loadTransformersEmbedder();
  if (embedder) console.error(`jamgate: semantic embeddings active (${embedder.id})`);
  else console.error("jamgate: running on fuzzy recall (no embedding model loaded)");

  // Depend on the adapter contract, not a concrete backend (D-019).
  return new FileStore(undefined, {
    embedder: embedder ?? undefined,
    dupThreshold: resolveDupThreshold(),
  });
}

async function main() {
  const argv = process.argv.slice(2);

  // Install-helper subcommands run before any store/server bootstrap — they only touch client
  // config files, never the memory store or a transport (the One-Click Install phase, D-030).
  if (argv[0] === "setup") {
    process.exitCode = await setupCommand(argv.slice(1));
    return;
  }
  if (argv[0] === "status") {
    process.exitCode = await statusCommand();
    return;
  }
  // Backup & migration (D-033): dump or reload the store as JSON. Like setup/status these run
  // before any server bootstrap — they only touch the store file, never open a transport.
  if (argv[0] === "export") {
    process.exitCode = await exportCommand(argv.slice(1));
    return;
  }
  if (argv[0] === "import") {
    process.exitCode = await importCommand(argv.slice(1));
    return;
  }

  const opts = parseCliOptions(argv);
  const store = await buildStore();

  if (opts.http) {
    // Opt-in remote mode (D-029). stdio stays the default; this only runs on --http /
    // JAMGATE_HTTP. A bearer token is mandatory — refuse to start without one, rather than
    // silently exposing a memory over the network.
    const token = process.env.JAMGATE_TOKEN;
    if (!token || token.trim() === "") {
      console.error(
        "jamgate: HTTP mode requires a bearer token, but JAMGATE_TOKEN is not set.\n" +
          "  Set a strong secret and restart, e.g.:\n" +
          "    JAMGATE_TOKEN=$(openssl rand -hex 32) jamgate --http\n" +
          "  TLS must be terminated by a reverse proxy (caddy/nginx); see the README " +
          '"Remote mode" section. Refusing to start.',
      );
      process.exit(1);
    }
    // MCP OAuth (D-034) is on by default in remote mode so the instance can be added to
    // claude.ai / the Claude mobile app, which only speak the OAuth flow. The static token keeps
    // working (existing Claude Code connections are unaffected). Opt out with JAMGATE_OAUTH=off.
    const oauthDisabled = ["off", "none", "0", "false"].includes(
      (process.env.JAMGATE_OAUTH ?? "").trim().toLowerCase(),
    );
    const oauth = oauthDisabled ? undefined : new OAuthStore();
    const running = await startHttpServer({ store, token, port: opts.port, oauth });
    console.error(
      `jamgate MCP server running on http://${running.host}:${running.port}${running.path} ` +
        "(bearer auth required; terminate TLS at a reverse proxy)" +
        (oauth ? "\njamgate: MCP OAuth enabled — add this instance to claude.ai and enter your token when prompted" : ""),
    );
    return;
  }

  const server = createServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel; logs must go to stderr.
  console.error("jamgate MCP server running on stdio");
}

/** True when this module is the process entrypoint (run as the CLI), not imported by a test.
 *  Must compare against the *realpath* of `process.argv[1]`: npm/npx install the bin as a
 *  symlink (`node_modules/.bin/jamgate` → the real `dist/index.js`), so `process.argv[1]` is
 *  the symlink path while `import.meta.url` is the resolved target. A naive equality check
 *  fails there and `main()` never runs — the wizard exits 0 with no output (the 0.4.0 bug).
 *  Resolving the symlink first makes both sides the same real file. */
function isMainEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    // realpathSync throws if the path doesn't exist; fall back to the raw comparison.
    return import.meta.url === pathToFileURL(entry).href;
  }
}

if (isMainEntrypoint()) {
  main().catch((err) => {
    console.error("jamgate fatal:", err);
    process.exit(1);
  });
}
