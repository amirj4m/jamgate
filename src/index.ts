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
import { setupCommand, statusCommand } from "./setup/cli.js";
import type { ClientInfo, MemoryStore } from "./store/types.js";
import { prefilter } from "./gate/prefilter.js";
import { deriveSubject } from "./gate/subject.js";
import {
  appendGateLog,
  resolveGateLogConfig,
  type GateDecision,
  type GateLogConfig,
} from "./gate/log.js";

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
            text: { type: "string", description: "The memory, as a clear standalone statement." },
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
                "the newer replaces it (time-aware supersession). Strongly recommended; " +
                "if omitted, the gate derives a best-effort subject from the text.",
            },
            source: {
              type: "string",
              enum: ["agent-inferred", "user-confirmed", "user-explicit"],
              description: "Where this memory came from. Defaults to agent-inferred.",
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
          },
        },
      },
      {
        name: "forget_memory",
        description: "Delete a stored memory by its id.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string", description: "The memory id to forget." } },
          required: ["id"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    if (name === "save_memory") {
      const text = String(args.text ?? "");
      const client = clientInfoFromHandshake();
      const verdict = prefilter(text);
      if (!verdict.ok) {
        // Record the rejection too — the classifier learns from what the gate turns away.
        await appendGateLog(
          {
            decision: "rejected",
            reason: verdict.reason,
            type: args.type ? String(args.type) : undefined,
            subject: args.subject ? String(args.subject) : undefined,
            source: args.source ? String(args.source) : undefined,
            client: client?.name,
            text,
          },
          gateLog,
        );
        return { content: [{ type: "text", text: `Rejected by gate: ${verdict.reason}.` }] };
      }
      // Use the agent's subject when given; otherwise try to derive one conservatively
      // (D-027). A derived subject only fires on a confident rule match, else stays unset.
      const subject = args.subject ? String(args.subject) : deriveSubject(text);
      const result = await store.save({
        text,
        type: args.type as never,
        source: (args.source as never) ?? "agent-inferred",
        subject,
        // Provenance from the MCP initialize handshake, not the agent's tool arguments (D-024).
        client,
      });
      // Log the gate's decision to the local-only training buffer (D-025).
      const decision: GateDecision = result.action === "created" ? "saved" : result.action;
      await appendGateLog(
        {
          decision,
          type: result.memory.type,
          subject: result.memory.subject,
          source: result.memory.source,
          client: result.memory.client?.name,
          text: result.memory.text,
        },
        gateLog,
      );
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
          `existing memory: ${near}. If it is genuinely the same fact, nothing to do. If it ` +
          `is a distinct fact or an update, re-save with a \`subject\` so the gate treats it ` +
          `as its own memory (or a time-aware update of that subject).`;
      } else {
        msg = `Saved: "${result.memory.text}" [id ${result.memory.id}]`;
      }
      return { content: [{ type: "text", text: msg }] };
    }

    if (name === "recall_memory") {
      const hits = await store.recall(String(args.query ?? ""), Number(args.limit ?? 5));
      if (hits.length === 0) return { content: [{ type: "text", text: "No matching memories." }] };
      const body = hits
        .map((m) => `- [${m.type ?? "untyped"}] ${m.text} (id ${m.id}, ${m.createdAt})`)
        .join("\n");
      return { content: [{ type: "text", text: body }] };
    }

    if (name === "forget_memory") {
      const ok = await store.forget(String(args.id ?? ""));
      return { content: [{ type: "text", text: ok ? "Forgotten." : "No memory with that id." }] };
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
    const running = await startHttpServer({ store, token, port: opts.port });
    console.error(
      `jamgate MCP server running on http://${running.host}:${running.port}${running.path} ` +
        "(bearer auth required; terminate TLS at a reverse proxy)",
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
