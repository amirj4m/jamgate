import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isStale } from "../src/store/lock.js";

/** Run `body` with a throwaway lock file at a fresh temp path. */
async function withLockFile(body: (path: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-lock-"));
  const path = join(dir, "memory.json.lock");
  try {
    await body(path);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("lock staleness", () => {
  // Regression guard for the lost-update flake: acquiring the lock is open(wx) THEN write the
  // timestamp, so for a moment the lock file exists but is EMPTY. The old check did
  // Number("") === 0 and read that fresh lock as ancient, so a concurrent waiter stole it and
  // two writers ran at once — dropping a write ("24 saves, 23 persisted"). A fresh empty lock
  // must be treated as held, not stale.
  it("does NOT consider a freshly-created empty lock stale", async () => {
    await withLockFile(async (path) => {
      await fs.writeFile(path, "", "utf8"); // the empty mid-creation window
      assert.equal(await isStale(path, 30_000), false);
    });
  });

  it("does NOT consider a non-numeric body with a fresh mtime stale", async () => {
    await withLockFile(async (path) => {
      await fs.writeFile(path, "not-a-timestamp", "utf8");
      assert.equal(await isStale(path, 30_000), false);
    });
  });

  it("considers an empty lock stale once its mtime ages past staleMs", async () => {
    await withLockFile(async (path) => {
      await fs.writeFile(path, "", "utf8");
      // Backdate the file well beyond the stale window (a holder that crashed mid-creation).
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(path, old, old);
      assert.equal(await isStale(path, 30_000), true);
    });
  });

  it("uses the written timestamp when present", async () => {
    await withLockFile(async (path) => {
      await fs.writeFile(path, String(Date.now()), "utf8");
      assert.equal(await isStale(path, 30_000), false, "a just-stamped lock is held");

      await fs.writeFile(path, String(Date.now() - 60_000), "utf8");
      assert.equal(await isStale(path, 30_000), true, "an old-stamped lock is abandoned");
    });
  });
});
