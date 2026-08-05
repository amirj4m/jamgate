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
 * Is this text in a language the bundled model can actually represent?
 *
 * all-MiniLM-L6-v2 is an **English** model. Fed Persian, Greek, Chinese or Japanese it still
 * returns a 384-dimensional vector — it just does not mean anything, and measurement shows
 * exactly what it degenerates into: a similarity score for *"is this the same script"*.
 *
 *   0.62  "ποδήλατο" (bicycle)  ~  a Greek memory about studying Greek in Athens
 *   0.46  "自転車"   (bicycle)  ~  a Chinese memory about coffee and languages
 *   0.42  "دوچرخه"  (bicycle)  ~  a Persian memory about studying Greek and Linux
 *   0.27  "コーヒー"  (coffee)   ~  a CHINESE memory that is partly about coffee
 *
 * Every one of those bicycles is unrelated to the memory it matched, and each outscores the
 * true coffee match. Above the 0.35 recall floor (D-063), so a non-English user with the
 * optional package installed got recall dominated by "is it in my language" noise — and after
 * the tokenizer fix (D-065) their lexical recall finally worked, only for this to bury it.
 *
 * So the semantic layer is applied only to text the model was trained on. Non-Latin text is
 * not embedded at all: no vector is stored, no semantic score is computed, and recall falls
 * back to the fuzzy lexical path — which, unlike the embedding, genuinely works in any script.
 * Mixed text (a Latin sentence with a few foreign words) still embeds; the bar is what the
 * text is mostly made of, not purity.
 *
 * This is a property of the bundled model, not of embeddings in general. A multilingual model
 * behind the same `Embedder` interface would lift the restriction, and that is the reason to
 * want one.
 */
export function isModelLanguage(text: string): boolean {
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return true; // digits/symbols only — harmless either way
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return latin / letters.length >= 0.8;
}

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
    if (missingPackage) {
      // The overwhelmingly common case, and NOT a fault: the optional peer is optional, so on
      // a default install it is absent by design. This used to print a three-line diagnostic
      // with a stack-ish "Cannot find package … imported from /path/to/embedder.js" and the
      // word "cause:", at every single startup. Users read their client's MCP log, saw that,
      // and reasonably concluded the server was broken — for a feature they never asked for.
      // One calm line that says what is off and how to turn it on. The loud diagnostic below
      // is reserved for the case that IS a fault: the package is installed and still failed.
      console.error(
        "jamgate: semantic recall off (optional). Recall uses fuzzy matching; " +
          "`npm install @huggingface/transformers` to add synonym matching. Nothing is broken.",
      );
      return null;
    }
    console.error(
      `jamgate: optional embeddings unavailable, falling back to fuzzy recall — ${message}`,
    );
    console.error(
      `jamgate:   cause: '${MODEL_ID}' could not be loaded. The model is downloaded on ` +
        "first use and cached inside the package directory — a sandboxed service (systemd " +
        "ProtectSystem/ProtectHome) may be unable to write that cache or reach the network. " +
        "Pre-download the model as the service user, or point HF_HOME at a writable path.",
    );
    return null;
  }
}
