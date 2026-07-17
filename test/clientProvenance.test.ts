import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";
import { tempStore } from "./helpers.js";

describe("client provenance stamping (D-024)", () => {
  it("stamps the SaveInput.client onto the stored memory", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const res = await store.save({
        text: "jam prefers dark mode",
        source: "user-explicit",
        client: { name: "cursor", version: "1.2.3" },
      });
      assert.equal(res.memory.client?.name, "cursor");
      assert.equal(res.memory.client?.version, "1.2.3");

      // Provenance survives a round-trip through disk.
      const [reloaded] = await store.recall("dark mode", 5);
      assert.equal(reloaded.client?.name, "cursor");
      assert.equal(reloaded.client?.version, "1.2.3");
    } finally {
      await cleanup();
    }
  });

  it("leaves client unset when none is supplied", async () => {
    const { store, cleanup } = await tempStore();
    try {
      const res = await store.save({ text: "jam uses vim", source: "user-explicit" });
      assert.equal(res.memory.client, undefined);
    } finally {
      await cleanup();
    }
  });

  it("captures clientInfo from the MCP initialize handshake, not the tool args", async () => {
    const { store, cleanup } = await tempStore();
    const server = createServer(store);
    const client = new Client({ name: "claude-code", version: "9.9.9" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      // The agent does NOT pass any client field — the server must derive it from the
      // handshake. Even if it tried, the server ignores tool-arg provenance.
      await client.callTool({ name: "save_memory", arguments: { text: "jam ships on Fridays" } });

      const [stored] = await store.recall("Fridays", 5);
      assert.equal(stored.client?.name, "claude-code");
      assert.equal(stored.client?.version, "9.9.9");
    } finally {
      await client.close();
      await server.close();
      await cleanup();
    }
  });
});
