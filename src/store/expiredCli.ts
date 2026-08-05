// Terminal front-end for `jamgate expired` (D-055).
//
// Soft expiry hides a record from recall without deleting it, and that was designed to be
// quiet. Auditing a real store showed how quiet: 17 of 39 live records — 44% — had aged out
// and there was no way to see them short of reading the JSON by hand, so a store could shrink
// to nothing and no surface anywhere would say a word.
//
// This command is the missing surface. It lists what recall is hiding, oldest deadline first,
// with the date each record becomes eligible for physical deletion — which is the date by
// which it has to be rescued (re-saved under a durable type) or it is gone for good.

import { FileStore } from "./fileStore.js";
import { resolveDupThreshold } from "../embeddings/embedder.js";
import { DEFAULT_SCOPE, normalizeScope } from "./scope.js";

const USAGE = `Usage: jamgate expired [--scope <name>] [--json]

Lists memories that have expired out of recall but are still on disk.

  --scope <name>   Only this namespace (default: the "${DEFAULT_SCOPE}" scope).
  --json           Machine-readable output on stdout.

Nothing is modified. A record shown here is invisible to recall today and will be
deleted by compaction on the date given; re-save it with a durable type
(identity / preference / project) if it should have lasted.`;

/** `jamgate expired` — report, never mutate. Exit 0 even when the list is empty; an empty
 *  list is a valid, informative answer, not a failure. */
export async function expiredCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  let scope: string | undefined;
  const scopeIndex = argv.indexOf("--scope");
  if (scopeIndex !== -1) {
    const value = argv[scopeIndex + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error("jamgate expired: --scope needs a namespace name.\n");
      console.error(USAGE);
      return 2;
    }
    scope = value;
  }
  const asJson = argv.includes("--json");

  const store = new FileStore(env.JAMGATE_STORE, { dupThreshold: resolveDupThreshold(env) });
  const expired = await store.listExpired(scope);

  if (asJson) {
    console.log(JSON.stringify({ scope: normalizeScope(scope), expired }, null, 2));
    return 0;
  }

  console.log(`store: ${store.storePath}`);
  console.log(`scope: ${normalizeScope(scope)}`);
  if (expired.length === 0) {
    console.log("\nNothing has expired out of recall in this scope.");
    return 0;
  }

  console.log(
    `\n${expired.length} memor${expired.length === 1 ? "y is" : "ies are"} expired and hidden ` +
      `from recall (still on disk):\n`,
  );
  for (const { memory, compactableAt } of expired) {
    console.log(`- [${memory.type ?? "untyped"}] ${memory.text}`);
    console.log(`  source ${memory.source} · saved ${memory.createdAt.slice(0, 10)}`);
    console.log(
      `  expired ${(memory.expiresAt ?? "").slice(0, 10)} · deletable by compaction from ` +
        `${compactableAt.slice(0, 10)}`,
    );
    console.log(`  id: ${memory.id}`);
  }
  // The ones a human explicitly asked to keep are the ones worth naming twice.
  const humanSourced = expired.filter(
    (e) => e.memory.source === "user-explicit" || e.memory.source === "user-confirmed",
  );
  if (humanSourced.length > 0) {
    console.log(
      `\n${humanSourced.length} of these came from the user directly (user-explicit / ` +
        `user-confirmed). Those are the likeliest mistakes — re-save each one with a durable ` +
        `type (identity, preference, or project) before its compaction date.`,
    );
  }
  return 0;
}
