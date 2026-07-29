// Packages a .devpliance/ evidence folder into a gzip-compressed tar archive in memory, for upload
// to POST /api/v1/submissions. No zip/tar dependency — Node's zlib plus a minimal USTAR writer, the
// same tar.gz layout the devpliance CLI's `submit` produces, so the server accepts it identically.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * No zip dependency here on purpose — Node has no built-in ZIP writer, and
 * pulling one in for a single folder isn't worth it. `zlib` (built in) plus a
 * minimal USTAR tar writer gets the same result as a .tar.gz instead.
 */

interface Entry {
  /** Posix-style path relative to the archive root; directories end in "/". */
  path: string;
  isDirectory: boolean;
  content: Buffer;
}

async function collectEntries(root: string, dir: string, entries: Entry[]): Promise<void> {
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const abs = join(dir, item.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (item.isDirectory()) {
      entries.push({ path: `${rel}/`, isDirectory: true, content: Buffer.alloc(0) });
      await collectEntries(root, abs, entries);
    } else if (item.isFile()) {
      entries.push({ path: rel, isDirectory: false, content: await readFile(abs) });
    }
    // Symlinks and other special files aren't expected inside .devpliance/
    // and are skipped rather than followed or errored on.
  }
}

function writeOctalField(header: Buffer, value: number, offset: number, length: number, field: string): void {
  const octal = value.toString(8);
  if (octal.length > length - 1) {
    // A classic ustar header field can't represent this value (e.g. a file
    // over ~8GB in the 12-byte size field) — Buffer.write would otherwise
    // truncate it silently instead of failing loudly.
    throw new Error(`tar header field "${field}" overflow: ${value} needs more than ${length - 1} octal digits`);
  }
  header.write(octal.padStart(length - 1, '0'), offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function buildHeader(entry: Entry, mtimeSeconds: number): Buffer {
  if (Buffer.byteLength(entry.path, 'utf8') > 100) {
    // Classic ustar names are capped at 100 bytes; Buffer.write would
    // otherwise truncate (and potentially collide with another entry)
    // without any error.
    throw new Error(`tar entry path too long for a ustar header (max 100 bytes): "${entry.path}"`);
  }

  const header = Buffer.alloc(512);

  header.write(entry.path, 0, 100, 'utf8');
  writeOctalField(header, entry.isDirectory ? 0o755 : 0o644, 100, 8, 'mode');
  writeOctalField(header, 0, 108, 8, 'uid');
  writeOctalField(header, 0, 116, 8, 'gid');
  writeOctalField(header, entry.content.length, 124, 12, 'size');
  writeOctalField(header, mtimeSeconds, 136, 12, 'mtime');
  header.write('        ', 148, 8, 'ascii'); // chksum placeholder
  header.write(entry.isDirectory ? '5' : '0', 156, 1, 'ascii'); // typeflag
  header.write('ustar\0', 257, 6, 'ascii'); // magic
  header.write('00', 263, 2, 'ascii'); // version

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');

  return header;
}

function padToBlockSize(buf: Buffer): Buffer {
  const remainder = buf.length % 512;
  if (remainder === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(512 - remainder)]);
}

/** Packages `sourceDir` into a gzip-compressed tar archive, in memory. */
export async function createTarGz(sourceDir: string): Promise<Buffer> {
  const entries: Entry[] = [];
  await collectEntries(sourceDir, sourceDir, entries);

  const mtimeSeconds = Math.floor(Date.now() / 1000);
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(buildHeader(entry, mtimeSeconds));
    if (entry.content.length > 0) {
      chunks.push(padToBlockSize(entry.content));
    }
  }
  chunks.push(Buffer.alloc(1024)); // two zero blocks mark the end of the archive

  return gzipSync(Buffer.concat(chunks));
}
