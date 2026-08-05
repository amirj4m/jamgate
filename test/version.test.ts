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

/**
 * Third copy of the number, and the one nobody thinks about. `package-lock.json` records the
 * version twice, `npm install` rewrites it silently, and nothing in a build or test run reads
 * it — so it drifted to three releases behind (`0.9.2` while the package was `0.10.2`) without
 * ever failing anything. A stale lockfile version is not a runtime bug, but it is a lie in a
 * file people read to answer "what version is this checkout", and it is exactly the kind of
 * quiet drift D-060 exists to stop. Same guard, same reason.
 */
describe("package-lock.json", () => {
  it("records the same version as package.json, at both levels", () => {
    const lockUrl = new URL("../../package-lock.json", import.meta.url);
    const lock = JSON.parse(readFileSync(lockUrl, "utf8")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    const pkgUrl = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version: string };
    assert.equal(
      lock.version,
      pkg.version,
      `package-lock.json (${lock.version}) is out of sync with package.json (${pkg.version}); run npm install after bumping`,
    );
    assert.equal(
      lock.packages[""]?.version,
      pkg.version,
      `package-lock.json packages[""].version (${lock.packages[""]?.version}) is out of sync with package.json (${pkg.version})`,
    );
  });
});
