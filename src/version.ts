/**
 * The single source of truth for the Jamgate version string in code.
 *
 * Kept in sync with `package.json` by hand on each release (the build has no codegen step).
 * Used for the MCP server `serverInfo.version` and the `/healthz` payload, so both report
 * the same number without importing `package.json` at runtime (which would break once the
 * code is bundled or the file layout changes between `dist/` and the published package).
 */
export const VERSION = "0.9.1";
