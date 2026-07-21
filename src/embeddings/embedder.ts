// Optional local embedding backend (Phase 3, item 4).
//
// Jamgate's base install stays zero-heavy-deps: `@huggingface/transformers` is an OPTIONAL
// peer dependency, not a hard one. This module dynamically imports it only on demand and
// degrades gracefully — if the package (or its model) is absent, `loadTransformersEmbedder`
// returns null and the store runs on fuzzy lexical recall alone. Nothing here runs in CI:
// loading the model would hit the network to download it. The store depends only on the
// small `Embedder` interface, so tests inject a deterministic mock instead.
//
// Model: all-MiniLM-L6-v2 (the Xenova ONNX port), 384-dimensional sentence embeddings,
// mean-pooled and L2-normalized. It is a ~23 MB quantized download, fetched locally on
// first use and cached by Transformers.js under its own cache dir. No text ever leaves the
// machine — inference is fully local (RULES: never send data to any cloud AI; D-026).

/** The minimal contract the store needs from an embedding backend. Injected, so the store
 *  never imports a heavy ML runtime directly and tests can supply a deterministic fake. */
export interface Embedder {
  /** Embed one text into a fixed-length vector. Implementations should L2-normalize. */
  embed(text: string): Promise<number[]>;
  /** Vector length (384 for all-MiniLM-L6-v2). */
  readonly dimensions: number;
  /** Human-readable id for logs/diagnostics. */
  readonly id: string;
}

/** The near-duplicate similarity threshold, overridable via env. Falls back to the module
 *  default when unset or garbage. Kept here so the whole embedding config lives in one place. */
export function resolveDupThreshold(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.JAMGATE_DUP_THRESHOLD;
  if (raw === undefined) return undefined; // caller uses its own default
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return undefined;
  return n;
}

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DIMENSIONS = 384;

/**
 * Try to build the real Transformers.js embedder. Returns null (never throws) when the
 * optional dependency or the model is unavailable, so the caller can fall back to fuzzy
 * recall. Embedding is opt-out via `JAMGATE_EMBEDDINGS=off`.
 *
 * The heavy import is dynamic and behind a runtime string so the base build never resolves
 * the module at type-check time and a missing package is a graceful null, not a crash.
 */
export async function loadTransformersEmbedder(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Embedder | null> {
  const flag = env.JAMGATE_EMBEDDINGS?.trim().toLowerCase();
  if (flag && ["off", "none", "0", "false"].includes(flag)) return null;

  try {
    const pkg = "@huggingface/transformers";
    const mod = (await import(/* @vite-ignore */ pkg as string)) as {
      pipeline: (task: string, model: string) => Promise<
        (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>
      >;
    };
    const extractor = await mod.pipeline("feature-extraction", MODEL_ID);
    return {
      id: MODEL_ID,
      dimensions: DIMENSIONS,
      async embed(text: string): Promise<number[]> {
        const output = await extractor(text, { pooling: "mean", normalize: true });
        return Array.from(output.data);
      },
    };
  } catch (err) {
    // Package missing, model download blocked, or runtime error → degrade to fuzzy recall.
    //
    // Name the CAUSE, not just the symptom. The degraded path is silent by design — recall
    // still works, saves still succeed — so the only evidence that the semantic layer is
    // missing is this line. When a stress test later shows duplicates slipping through, the
    // first question is "was the embedder even loaded?", and "unavailable" does not answer
    // it. A missing peer dependency and a blocked model download need different fixes.
    const message = (err as Error)?.message ?? String(err);
    const missingPackage = /Cannot find (package|module)/i.test(message);
    console.error(
      `jamgate: optional embeddings unavailable, falling back to fuzzy recall — ${message}`,
    );
    if (missingPackage) {
      console.error(
        "jamgate:   cause: the optional peer '@huggingface/transformers' is not installed. " +
          "Semantic near-duplicate detection and synonym recall are OFF until it is. " +
          "Install it alongside jamgate to enable them.",
      );
    } else {
      console.error(
        `jamgate:   cause: '${MODEL_ID}' could not be loaded. The model is downloaded on ` +
          "first use and cached inside the package directory — a sandboxed service (systemd " +
          "ProtectSystem/ProtectHome) may be unable to write that cache or reach the network. " +
          "Pre-download the model as the service user, or point HF_HOME at a writable path.",
      );
    }
    return null;
  }
}
