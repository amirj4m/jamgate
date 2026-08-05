import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";

const execFileAsync = promisify(execFile);

/**
 * Regression guard for the 0.4.0 "silent exit" bug: `npx jamgate setup` printed nothing and
 * exited 0. npm installs the bin as a symlink (`node_modules/.bin/jamgate` → the real
 * `dist/index.js`), so `process.argv[1]` is the symlink path while `import.meta.url` is the
 * resolved target. The entrypoint guard compared them directly, so `main()` never ran through
 * a symlink and the wizard produced no output.
 *
 * This test exercises the BUILT binary exactly the way npx does — through a symlink — and
 * asserts the report actually reaches stdout. It must fail if that guard ever regresses.
 */
describe("built binary entrypoint (0.4.0 silent-exit regression)", () => {
  // The compiled bin, relative to this test file at dist-test/test/binEntrypoint.test.js.
  const builtBin = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
  const cleanups: Array<() => Promise<void>> = [];

  after(async () => {
    for (const c of cleanups) await c();
  });

  async function symlinkedBin(): Promise<string> {
    const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-bin-"));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const link = join(dir, "jamgate");
    // Mirror npm's `.bin` layout: a symlink whose target is the real built entrypoint.
    await fs.symlink(builtBin, link);
    return link;
  }

  it("prints a non-empty setup report when run through a symlink (the npx path)", async () => {
    const link = await symlinkedBin();
    const { stdout } = await execFileAsync(process.execPath, [link, "setup", "--dry-run"], {
      // A throwaway HOME so the dry run never touches the developer's real client config.
      env: { ...process.env, HOME: await fs.mkdtemp(join(tmpdir(), "jamgate-home-")) },
    });
    assert.ok(stdout.trim().length > 0, "setup --dry-run produced no stdout");
    assert.match(stdout, /jamgate setup/);
    assert.match(stdout, /dry run/);
  });

  it("prints a non-empty status report when run through a symlink", async () => {
    const link = await symlinkedBin();
    const { stdout } = await execFileAsync(process.execPath, [link, "status"], {
      env: { ...process.env, HOME: await fs.mkdtemp(join(tmpdir(), "jamgate-home-")) },
    });
    assert.ok(stdout.trim().length > 0, "status produced no stdout");
    assert.match(stdout, /jamgate status/);
  });

  /**
   * The first command a new user types. Before 0.10.5 `--help`, `-h`, `--version` and `-v`
   * all fell through to the default branch and started an MCP stdio server, which prints one
   * line to stderr and then waits forever for JSON-RPC nobody is going to type — so the CLI
   * appeared to hang on its most predictable input. These run with a HARD timeout: a
   * regression here is a hang, and a hang must fail the suite rather than stall it.
   */
  for (const flag of ["--help", "-h", "help"]) {
    it(`answers ${flag} instead of starting a silent server`, async () => {
      const link = await symlinkedBin();
      const { stdout } = await execFileAsync(process.execPath, [link, flag], {
        env: { ...process.env, HOME: await fs.mkdtemp(join(tmpdir(), "jamgate-home-")) },
        timeout: 10_000,
      });
      assert.match(stdout, /USAGE/);
      assert.match(stdout, /jamgate setup/);
      assert.ok(!/running on stdio/.test(stdout), "help must not start the server");
    });
  }

  for (const flag of ["--version", "-v", "version"]) {
    it(`prints the bare version for ${flag}`, async () => {
      const link = await symlinkedBin();
      const { stdout } = await execFileAsync(process.execPath, [link, flag], {
        env: { ...process.env, HOME: await fs.mkdtemp(join(tmpdir(), "jamgate-home-")) },
        timeout: 10_000,
      });
      assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
    });
  }

  it("rejects a mistyped subcommand instead of serving on stdio", async () => {
    const link = await symlinkedBin();
    await assert.rejects(
      execFileAsync(process.execPath, [link, "setpu"], {
        env: { ...process.env, HOME: await fs.mkdtemp(join(tmpdir(), "jamgate-home-")) },
        timeout: 10_000,
      }),
      (err: NodeJS.ErrnoException & { code?: number; stderr?: string }) => {
        assert.equal(err.code, 1, "a typo must exit nonzero, not start a server");
        assert.match(err.stderr ?? "", /unknown command "setpu"/);
        return true;
      },
    );
  });
});
