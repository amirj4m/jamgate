import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Memory, MemorySource, MemoryStore, SaveInput, SaveResult } from "./types.js";

/** How much we trust a memory by where it came from. A lower-trust source must not
 *  silently overwrite a higher-trust one — that's a contradiction to confirm, not an
 *  update to apply (RULES §2.3). */
const TRUST: Record<MemorySource, number> = {
  "agent-inferred": 1,
  "user-confirmed": 2,
  "user-explicit": 3,
};

const DEFAULT_PATH = join(homedir(), ".jamgate", "memory.json");

/**
 * The default store for the MVP (RULES §8: file/SQLite first, BYO stores later).
 * Implements the `MemoryStore` adapter contract (D-019) so a hosted store can drop in
 * later without touching the gate. Real, not a stub — save/recall/forget all persist.
 */
export class FileStore implements MemoryStore {
  private path: string;

  constructor(path: string = process.env.JAMGATE_STORE ?? DEFAULT_PATH) {
    this.path = path;
  }

  private async readAll(): Promise<Memory[]> {
    try {
      const raw = await fs.readFile(this.path, "utf8");
      return JSON.parse(raw) as Memory[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async writeAll(memories: Memory[]): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, JSON.stringify(memories, null, 2), "utf8");
  }

  /**
   * Write a memory through the stateful checks:
   *  - exact-duplicate dedup (RULES §2.2)
   *  - time-aware supersession (RULES §2.3, D-015): a newer memory with the same
   *    `subject` retires the old one by recency (kept, not deleted, for audit).
   *  - contradiction guard (RULES §2.3): a lower-trust source can't silently overwrite
   *    a higher-trust one on the same subject → returns "conflict" for confirmation.
   */
  async save(input: SaveInput): Promise<SaveResult> {
    const memories = await this.readAll();
    const norm = input.text.trim().toLowerCase();

    const existing = memories.find(
      (m) => m.status === "active" && m.text.trim().toLowerCase() === norm,
    );
    if (existing) return { action: "duplicate", memory: existing };

    const now = new Date().toISOString();
    const memory: Memory = {
      id: randomUUID(),
      text: input.text.trim(),
      type: input.type,
      subject: input.subject?.trim().toLowerCase() || undefined,
      source: input.source,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    let retired: Memory[] = [];
    if (memory.subject) {
      const matches = memories.filter(
        (m) => m.status === "active" && m.subject === memory.subject,
      );
      if (matches.length > 0) {
        const maxTrust = Math.max(...matches.map((m) => TRUST[m.source]));
        if (TRUST[memory.source] < maxTrust) {
          // Lower-trust fact can't silently overwrite a higher-trust one → flag, don't store.
          return { action: "conflict", memory, conflictsWith: matches };
        }
        // Equal-or-higher trust + newer → supersede by recency (D-015).
        retired = matches;
        for (const old of retired) {
          old.status = "superseded";
          old.supersededBy = memory.id;
          old.supersededAt = now;
          old.updatedAt = now;
        }
      }
    }

    memories.push(memory);
    await this.writeAll(memories);
    return retired.length > 0
      ? { action: "superseded", memory, retired }
      : { action: "created", memory };
  }

  /** Recall returns ACTIVE memories only — retired/superseded states are never
   *  surfaced as current facts (D-015: don't confront the user with stale words). */
  async recall(query: string, limit = 5, includeSuperseded = false): Promise<Memory[]> {
    const memories = (await this.readAll()).filter(
      (m) => includeSuperseded || m.status === "active",
    );
    const q = query.trim().toLowerCase();
    if (!q) return memories.slice(-limit).reverse();
    return memories
      .map((m) => ({ m, score: overlapScore(q, m.text.toLowerCase()) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.m);
  }

  async forget(id: string): Promise<boolean> {
    const memories = await this.readAll();
    const next = memories.filter((m) => m.id !== id);
    if (next.length === memories.length) return false;
    await this.writeAll(next);
    return true;
  }
}

/** Crude word-overlap relevance for the MVP. Embeddings come later (DECISIONS open item). */
function overlapScore(query: string, text: string): number {
  const qWords = new Set(query.split(/\W+/).filter(Boolean));
  if (qWords.size === 0) return 0;
  let hits = 0;
  for (const w of qWords) if (text.includes(w)) hits++;
  return hits / qWords.size;
}
