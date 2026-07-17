#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { FileStore } from "./store/fileStore.js";
import type { MemoryStore } from "./store/types.js";
import { prefilter } from "./gate/prefilter.js";

// Depend on the adapter contract, not a concrete backend (D-019).
const store: MemoryStore = new FileStore();

const server = new Server(
  { name: "jamgate", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

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
              "the newer replaces it (time-aware supersession). Strongly recommended.",
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
    const verdict = prefilter(text);
    if (!verdict.ok) {
      return { content: [{ type: "text", text: `Rejected by gate: ${verdict.reason}.` }] };
    }
    const result = await store.save({
      text,
      type: args.type as never,
      source: (args.source as never) ?? "agent-inferred",
      subject: args.subject ? String(args.subject) : undefined,
    });
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel; logs must go to stderr.
  console.error("jamgate MCP server running on stdio");
}

main().catch((err) => {
  console.error("jamgate fatal:", err);
  process.exit(1);
});
