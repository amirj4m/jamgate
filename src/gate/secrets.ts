// Credential detection (gate layer 1, D-042).
//
// A shared, cross-agent memory is the worst possible place for a secret: it is read back
// verbatim into every future agent session, it syncs to a remote instance, and it lands in
// the gate log. A real stress test saved a fake API key and a password without a murmur —
// the gate had no notion of credentials at all.
//
// So this module answers one question — "is the caller trying to store a credential?" —
// and it answers PRECISION-FIRST. A false negative stores a secret, which is bad; a false
// positive refuses a legitimate memory, which is worse in a different way: it teaches the
// agent the gate is unreliable and the user works around it. Normal prose that merely
// contains a long identifier (a git sha, a UUID, a case number, a URL) must pass.
//
// Two independent grounds for a rejection, and NOTHING else:
//
//   1. SHAPE — the text contains a token matching a known credential format (`sk-…`,
//      `AKIA…`, `ghp_…`, a JWT, a PEM private-key block, `Bearer <token>`). These prefixes
//      were designed by their vendors to be unambiguous, so matching one is near-proof.
//   2. ENTROPY + CONTEXT — a high-entropy, mixed-alphabet token AND a credential keyword
//      nearby. Neither half alone is enough. Entropy alone flags git shas; keywords alone
//      flag "jam uses a password manager".
//
// The char-class requirement is what keeps hex identifiers out: a 40-character git sha is
// pure lowercase hex (ONE class), so it can never satisfy the entropy rule no matter how
// long it is. That is a deliberate, checkable line, not a tuned threshold.

/** Known credential formats. Each is anchored on a vendor-assigned prefix plus a minimum
 *  body length, so the pattern cannot fire on ordinary words. */
const SHAPE_RULES: Array<{ label: string; pattern: RegExp }> = [
  // OpenAI / Anthropic style, incl. `sk-ant-…` and project keys.
  { label: "an API key (sk-… format)", pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  // Stripe secret/restricted keys.
  { label: "a Stripe key", pattern: /\b[srp]k_(live|test)_[A-Za-z0-9]{10,}/ },
  // AWS access key id.
  { label: "an AWS access key id", pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  // GitHub personal access / OAuth / app tokens.
  { label: "a GitHub token", pattern: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  // npm automation token.
  { label: "an npm token", pattern: /\bnpm_[A-Za-z0-9]{30,}/ },
  // Slack bot/user/app tokens.
  { label: "a Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  // Google API key.
  { label: "a Google API key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  // SendGrid.
  { label: "a SendGrid API key", pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/ },
  // GitLab personal access token.
  { label: "a GitLab token", pattern: /\bglpat-[A-Za-z0-9_-]{16,}/ },
  // Twilio account/API sid paired with a secret is the risky half; the SID alone is public.
  { label: "a Twilio auth token", pattern: /\bSK[0-9a-f]{32}\b/ },
  // JSON Web Token — three base64url segments, the first decoding to a JOSE header.
  { label: "a JWT", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  // Any PEM private key block.
  { label: "a PEM private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // An Authorization header pasted whole.
  { label: "a bearer token", pattern: /\bBearer\s+[A-Za-z0-9_\-.=+/]{20,}/i },
];

/** Words that mark the surrounding text as being ABOUT a credential. Used only as the
 *  context half of the entropy rule, and for the assignment rule below — never alone. */
const CREDENTIAL_KEYWORDS =
  /\b(api[ _-]?key|secret[ _-]?key|access[ _-]?token|auth[ _-]?token|refresh[ _-]?token|client[ _-]?secret|private[ _-]?key|passphrase|password|passwd|pwd|credentials?|token|secret)\b/i;

/**
 * A credential ASSIGNMENT: the keyword sits immediately against a separator, and the value
 * looks like a credential rather than a word.
 *
 * The adjacency is load-bearing. "jam's password manager is 1Password" contains the keyword,
 * a copula and a mixed-case 9-character value — and is a perfectly good memory. It survives
 * because `password` is followed by `manager`, not by `:`/`=`/`is`. Requiring the separator
 * to touch the keyword is what separates "here IS my password" from "here is a fact ABOUT
 * passwords".
 */
const ASSIGNMENT =
  /\b(password|passwd|pwd|passphrase|api[ _-]?key|secret[ _-]?key|access[ _-]?token|auth[ _-]?token|client[ _-]?secret)\b\s*(?::|=|==>|->|\bis\b|\bwas\b)\s*["'`]?(\S{6,})/i;

/** Minimum length for the entropy rule. Below this a token is too short to be a modern
 *  credential and too likely to be an ordinary word or code identifier. */
const ENTROPY_MIN_LENGTH = 20;

/** Minimum Shannon entropy per character. Random base62 sits near 5.0–5.9 for tokens of
 *  this length; English words and code identifiers sit well below 3.5. */
const ENTROPY_MIN_BITS = 3.5;

/** Minimum distinct character classes (lower / upper / digit / symbol). Three is what
 *  excludes every hex identifier — a git sha, a UUID and an MD5 all have at most two. */
const ENTROPY_MIN_CLASSES = 3;

/** Shannon entropy of a string in bits per character. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** How many of {lowercase, uppercase, digit, symbol} appear in `s`. */
export function charClasses(s: string): number {
  let n = 0;
  if (/[a-z]/.test(s)) n++;
  if (/[A-Z]/.test(s)) n++;
  if (/[0-9]/.test(s)) n++;
  if (/[^A-Za-z0-9]/.test(s)) n++;
  return n;
}

/** Candidate tokens for entropy scoring: whitespace-separated runs, stripped of the
 *  punctuation prose wraps around them (quotes, brackets, a trailing comma or period). */
function candidateTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-z0-9+/=_-]+/, "").replace(/[^A-Za-z0-9+/=_-]+$/, ""))
    .filter((t) => t.length >= ENTROPY_MIN_LENGTH);
}

/**
 * True when `token` is high-entropy enough to be a credential body. Requires three
 * character classes, which is precisely what a hex digest can never have.
 */
export function looksHighEntropy(token: string): boolean {
  if (token.length < ENTROPY_MIN_LENGTH) return false;
  if (charClasses(token) < ENTROPY_MIN_CLASSES) return false;
  return shannonEntropy(token) >= ENTROPY_MIN_BITS;
}

export interface SecretFinding {
  /** Human-readable description of what was matched, for the rejection reason. */
  label: string;
}

/**
 * Scan `text` for a credential. Returns the finding, or null when the text is clean.
 * Deterministic, dependency-free, and never sees the network.
 */
export function detectSecret(text: string): SecretFinding | null {
  for (const rule of SHAPE_RULES) {
    if (rule.pattern.test(text)) return { label: rule.label };
  }

  const assigned = ASSIGNMENT.exec(text);
  if (assigned) {
    const value = assigned[2];
    // A value is credential-ish if it mixes alphabets or is simply long. This keeps
    // "password is required" (a word, one class, short) from tripping the rule.
    if (charClasses(value) >= 2 || value.length >= 10) {
      return { label: "a password or key assignment" };
    }
  }

  if (CREDENTIAL_KEYWORDS.test(text)) {
    for (const token of candidateTokens(text)) {
      if (looksHighEntropy(token)) {
        return { label: "a high-entropy token next to credential wording" };
      }
    }
  }

  return null;
}
