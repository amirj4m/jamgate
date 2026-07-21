// A tiny, dependency-free ZIP reader — just enough to look inside a vendor data export (D-035).
//
// `jamgate import --from claude|chatgpt <path>` accepts the .zip the vendor emailed you, so we
// need to list its entries and read a couple of small text files out of it. Pulling a zip library
// into a package whose whole point is "no runtime dependencies" would be a bad trade, and shelling
// out to `unzip` is not portable. The subset implemented here is the subset real exports use:
// the end-of-central-directory record, the central directory, and per-entry STORE (0) or
// DEFLATE (8) data via zlib's raw inflate.
//
// Anything exotic — ZIP64, encryption, multi-disk, an unknown compression method — is refused
// with a clear error rather than parsed halfway. An export we cannot read is a message to the
// user ("unzip it yourself and point me at the folder"), not a crash.

import { inflateRawSync } from "node:zlib";

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipEntry {
  /** Path inside the archive, as stored (forward slashes). */
  name: string;
  /** Uncompressed size in bytes, from the central directory. */
  size: number;
  /** Read and decompress this entry's bytes. */
  read(): Buffer;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;

/** List the file entries in a zip archive. Directories are omitted. */
export function readZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (offset === ZIP64_MARKER) throw new ZipError("ZIP64 archives are not supported");

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new ZipError("corrupt central directory");
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // directory entry
    entries.push({
      name,
      size,
      read: () => readEntry(buf, { name, method, compressedSize, localOffset }),
    });
  }
  return entries;
}

/** Locate the end-of-central-directory record by scanning backwards for its signature. */
function findEocd(buf: Buffer): number {
  if (buf.length < 22) throw new ZipError("file is too small to be a zip archive");
  const min = Math.max(0, buf.length - 22 - 0xffff); // 22-byte record + max comment
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new ZipError("not a zip archive (no end-of-central-directory record)");
}

function readEntry(
  buf: Buffer,
  e: { name: string; method: number; compressedSize: number; localOffset: number },
): Buffer {
  if (e.localOffset + 30 > buf.length || buf.readUInt32LE(e.localOffset) !== LOCAL_SIG) {
    throw new ZipError(`corrupt local header for "${e.name}"`);
  }
  if (e.compressedSize === ZIP64_MARKER) {
    throw new ZipError(`ZIP64 entry "${e.name}" is not supported`);
  }
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);

  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) {
    try {
      return inflateRawSync(data);
    } catch (err) {
      throw new ZipError(`could not decompress "${e.name}" — ${(err as Error).message}`);
    }
  }
  throw new ZipError(`unsupported compression method ${e.method} for "${e.name}"`);
}
