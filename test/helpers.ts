import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../src/store/fileStore.js";

/** A FileStore backed by a fresh temp file, plus its path and a cleanup hook. */
export async function tempStore(): Promise<{
  store: FileStore;
  path: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(join(tmpdir(), "jamgate-test-"));
  const path = join(dir, "memory.json");
  return {
    store: new FileStore(path),
    path,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}
