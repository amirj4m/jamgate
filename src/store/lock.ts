// Cross-process advisory file lock (Phase 2, item 3).
//
// Two MCP server processes may share one store file (e.g. Claude Code and Cursor both
// pointed at ~/.jamgate/memory.json). Without coordination, a read-modify-write in one
// process can clobber a concurrent one (both read the same base, both write, last
// rename wins → lost update). This lock serializes those writers.

import { promises as fs } from "node:fs";

export interface LockOptions {
  /** A lock older than this is presumed abandoned by a crashed holder and stolen. */
  staleMs?: number;
  /** Delay between acquisition attempts while another holder has the lock. */
  retryMs?: number;
  /** Give up waiting after this long and proceed best-effort (see below). */
  timeoutMs?: number;
}

const DEFAULTS = { staleMs: 30_000, retryMs: 25, timeoutMs: 10_000 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` while holding an exclusive on-disk lock at `lockPath`.
 *
 * Mechanism: create the lock file with the `wx` flag — `open(2)` with `O_CREAT|O_EXCL`,
 * an atomic "create only if it does not exist". If creation fails with EEXIST the lock
 * is held: wait and retry, unless the existing lock is older than `staleMs`, in which
 * case we assume the holder died without releasing and steal it. On success we always
 * remove the lock in a `finally`.
 *
 * WHAT THIS GUARANTEES: mutual exclusion between writers that (a) run on the same host,
 * (b) share a real local filesystem, and (c) all go through this function. That is
 * exactly the target case — several MCP server processes on one machine sharing one
 * ~/.jamgate/memory.json. Combined with the caller's re-read-before-write (each holder
 * loads the file fresh inside the lock), no committed write is lost.
 *
 * WHAT THIS DOES NOT GUARANTEE: it is not safe over NFS/SMB or other network
 * filesystems, whose `O_EXCL` semantics are unreliable. Stale-lock stealing has an
 * inherent small race: a holder stalled past `staleMs` could resume just as another
 * process steals its lock. And if acquisition times out we proceed WITHOUT the lock
 * (best-effort) rather than fail the user's save — re-read-before-write still bounds the
 * damage, but simultaneity is then possible. For the single-machine, local-disk MVP
 * (D-010) this is sufficient; a hosted backend (D-019) would rely on its database's own
 * transactions instead of a file lock.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const { staleMs, retryMs, timeoutMs } = { ...DEFAULTS, ...options };
  const deadline = Date.now() + timeoutMs;
  let acquired = false;

  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(String(Date.now()), "utf8");
      await handle.close();
      acquired = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (await isStale(lockPath, staleMs)) {
        await fs.rm(lockPath, { force: true }); // steal an abandoned lock
        continue;
      }
      if (Date.now() >= deadline) break; // give up and proceed without the lock
      await sleep(retryMs);
    }
  }

  try {
    return await fn();
  } finally {
    // Only remove the lock if we actually own it — never delete someone else's lock
    // (which is what we would be doing had acquisition timed out).
    if (acquired) await fs.rm(lockPath, { force: true });
  }
}

/** Is the lock file old enough to be presumed abandoned? Unreadable/garbage → stale. */
async function isStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const ts = Number(raw.trim());
    if (!Number.isFinite(ts)) return true;
    return Date.now() - ts > staleMs;
  } catch (err) {
    // Vanished between EEXIST and now → not stale, just retry the create.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    return false;
  }
}
