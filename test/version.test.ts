import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/version.js";

/**
 * Guard against the exact mistake that shipped 0.9.0 advertising "0.8.0": `src/version.ts` is
 * the single source of truth used by the MCP handshake and `/healthz`, and it is bumped BY HAND
 * alongside `package.json` each release (there is no codegen). Nothing enforced they stayed in
 * lockstep, so a release could — and did — go out with a stale VERSION. This test makes the two
 * numbers agree a build-breaking invariant, so a forgotten bump fails CI instead of the droplet.
 */
describe("VERSION source of truth", () => {
  it("matches package.json version exactly", () => {
    // From dist-test/test/version.test.js, ../../ resolves to the repo root regardless of cwd.
    const pkgUrl = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version: string };
    assert.equal(
      VERSION,
      pkg.version,
      `src/version.ts (${VERSION}) is out of sync with package.json (${pkg.version}); bump both on release`,
    );
  });
});
