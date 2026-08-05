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

/**
 * Same invariant, second copy of the number. `server.json` is the MCP registry manifest, and
 * it declared `0.1.0` while the package was at `0.10.0` — nine releases stale — because
 * nothing read it during a normal build or test run. A registry entry pointing at a version
 * that was never published is worse than no entry: it is a wrong answer to "what is current".
 * It carries the version TWICE (top level and inside `packages[]`), so both are checked.
 */
describe("server.json (MCP registry manifest)", () => {
  const serverJson = () => {
    const url = new URL("../../server.json", import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")) as {
      version: string;
      name: string;
      packages: Array<{ identifier: string; version: string }>;
    };
  };
  const pkg = () => {
    const url = new URL("../../package.json", import.meta.url);
    return JSON.parse(readFileSync(url, "utf8")) as { version: string; name: string; mcpName: string };
  };

  it("declares the same version as package.json, at both levels", () => {
    const s = serverJson();
    const p = pkg();
    assert.equal(
      s.version,
      p.version,
      `server.json version (${s.version}) is out of sync with package.json (${p.version}); bump both on release`,
    );
    for (const entry of s.packages) {
      assert.equal(
        entry.version,
        p.version,
        `server.json packages["${entry.identifier}"].version (${entry.version}) is out of sync with package.json (${p.version})`,
      );
    }
  });

  it("names the same package the registry would install", () => {
    const s = serverJson();
    const p = pkg();
    assert.equal(s.name, p.mcpName);
    assert.ok(s.packages.length > 0, "server.json must declare at least one package");
    for (const entry of s.packages) assert.equal(entry.identifier, p.name);
  });
});
