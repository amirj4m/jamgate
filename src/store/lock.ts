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

// timeoutMs is aligned with staleMs on purpose: a waiter only gives up and proceeds
// WITHOUT the lock once it has waited long enough that the holder's lock is itself stale
// — and a stale lock is stolen (see the loop below) before the give-up branch is ever
// reached. So under contention a live holder's write is never clobbered: a waiter either
// acquires the lock or steals a provably-abandoned one. The give-up path survives only as
// a last-resort liveness guard against pathological starvation.
const DEFAULTS = { staleMs: 30_000, retryMs: 25, timeoutMs: 30_000 };

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
 * process steals its lock. Acquisition has a `timeoutMs` after which we proceed WITHOUT
 * the lock rather than fail the user's save; because `timeoutMs` defaults to `staleMs`,
 * that give-up only comes due once the current lock is old enough to be stolen as stale
 * — which happens first — so a live holder's write is not clobbered under contention. For
 * the single-machine, local-disk MVP (D-010) this is sufficient; a hosted backend (D-019)
 * would rely on its database's own transactions instead of a file lock.
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

/** Is the lock file old enough to be presumed abandoned?
 *
 *  Subtlety that used to cause a lost-update flake: acquiring the lock is two steps —
 *  `open(wx)` creates an EMPTY file, then the holder writes its timestamp in a separate
 *  `await`. In that gap the file exists but is empty. A naive `Number("".trim())` is `0`,
 *  so `Date.now() - 0 > staleMs` read that just-born lock as ancient and STOLE it, letting
 *  two writers run at once → one write clobbered the other (the intermittent "24 saves,
 *  23 persisted" flake). So an empty/garbage body is NOT assumed stale: it is almost always
 *  a lock mid-creation. We fall back to the file's mtime to age it out, so a genuinely
 *  abandoned empty lock (holder crashed between create and write) still gets stolen after
 *  `staleMs`, while a fresh one is left alone and the waiter simply retries. */
export async function isStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const ts = Number(raw.trim());
    if (Number.isFinite(ts) && ts > 0) return Date.now() - ts > staleMs;
    // Empty or non-numeric body: mid-creation (fresh) or a crashed holder's leftover.
    // Judge by the file's own mtime instead of trusting the (missing) content.
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch (err) {
    // Vanished between EEXIST and now → not stale, just retry the create.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    return false;
  }
}
