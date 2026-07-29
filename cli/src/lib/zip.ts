import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * No zip-reading dependency here either (mirrors the no-dep tar.gz writer in
 * archive.ts) — this only ever reads the .zip bundled under src/assets/, so a
 * minimal reader covering what that file actually uses (stored + deflate,
 * standard central directory, no zip64/multi-disk/encryption) is enough.
 */

export interface ZipEntry {
  /** Path as stored in the archive, forward-slash separated. */
  path: string;
  isDirectory: boolean;
  content: Buffer;
}

/**
 * Resolves a zip entry's path against a destination directory, rejecting
 * anything that would escape it ("Zip Slip": entries like "../../evil" or an
 * absolute path). Today's bundled template is trusted, but this is the kind
 * of check that has to live with the extraction code, not the trust level of
 * whatever zip happens to be in use at the time.
 */
export function resolveEntryPath(destRoot: string, entryPath: string): string {
  const root = resolve(destRoot);
  const dest = resolve(root, entryPath);
  if (dest !== root && !dest.startsWith(root + sep)) {
    throw new Error(
      `Refusing to extract "${entryPath}": resolves outside the destination directory.`
    );
  }
  return dest;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT_LENGTH = 65535;

function findEndOfCentralDirectory(buf: Buffer): number {
  // Fixed 22-byte record optionally followed by a comment, so scan backward
  // from the end of the file for its signature rather than assuming offset 0.
  const searchStart = Math.max(0, buf.length - EOCD_MIN_SIZE - MAX_COMMENT_LENGTH);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("Not a valid zip file: end-of-central-directory record not found.");
}

export async function readZipEntries(zipPath: string): Promise<ZipEntry[]> {
  const buf = await readFile(zipPath);
  const eocdOffset = findEndOfCentralDirectory(buf);

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error("Not a valid zip file: central directory record signature mismatch.");
    }

    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");

    const isDirectory = name.endsWith("/");

    if (isDirectory) {
      entries.push({ path: name, isDirectory: true, content: Buffer.alloc(0) });
    } else {
      if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
        throw new Error(`Not a valid zip file: local header signature mismatch for "${name}".`);
      }
      const localNameLength = buf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buf.subarray(dataStart, dataStart + compressedSize);

      let content: Buffer;
      if (method === 0) {
        content = Buffer.from(compressed);
      } else if (method === 8) {
        content = inflateRawSync(compressed);
      } else {
        throw new Error(`Unsupported zip compression method ${method} for "${name}".`);
      }

      if (content.length !== uncompressedSize) {
        throw new Error(`Corrupt zip entry "${name}": size mismatch after decompression.`);
      }

      entries.push({ path: name, isDirectory: false, content });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
