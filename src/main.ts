import * as core from '@actions/core';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

// ─────────────────────────────────────────────────────────────────────────────
// tar.gz builder — ported from devpliance-cli (lib/archive.ts) so this action
// packages the evidence folder byte-for-byte the way `devpliance submit` does.
// No zip/tar dependency: Node's zlib plus a minimal USTAR writer.
// ─────────────────────────────────────────────────────────────────────────────
interface TarEntry {
  path: string;
  isDirectory: boolean;
  content: Buffer;
}

async function collectEntries(root: string, dir: string, entries: TarEntry[]): Promise<void> {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, item.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (item.isDirectory()) {
      entries.push({ path: `${rel}/`, isDirectory: true, content: Buffer.alloc(0) });
      await collectEntries(root, abs, entries);
    } else if (item.isFile()) {
      entries.push({ path: rel, isDirectory: false, content: await readFile(abs) });
    }
    // Symlinks/special files aren't expected in .devpliance/ and are skipped.
  }
}

function writeOctalField(header: Buffer, value: number, offset: number, length: number, field: string): void {
  const octal = value.toString(8);
  if (octal.length > length - 1) {
    throw new Error(`tar header field "${field}" overflow: ${value} needs more than ${length - 1} octal digits`);
  }
  header.write(octal.padStart(length - 1, '0'), offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function buildHeader(entry: TarEntry, mtimeSeconds: number): Buffer {
  if (Buffer.byteLength(entry.path, 'utf8') > 100) {
    throw new Error(`tar entry path too long for a ustar header (max 100 bytes): "${entry.path}"`);
  }
  const header = Buffer.alloc(512);
  header.write(entry.path, 0, 100, 'utf8');
  writeOctalField(header, entry.isDirectory ? 0o755 : 0o644, 100, 8, 'mode');
  writeOctalField(header, 0, 108, 8, 'uid');
  writeOctalField(header, 0, 116, 8, 'gid');
  writeOctalField(header, entry.content.length, 124, 12, 'size');
  writeOctalField(header, mtimeSeconds, 136, 12, 'mtime');
  header.write('        ', 148, 8, 'ascii'); // checksum placeholder (8 spaces)
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
  return remainder === 0 ? buf : Buffer.concat([buf, Buffer.alloc(512 - remainder)]);
}

async function createTarGz(sourceDir: string): Promise<Buffer> {
  const entries: TarEntry[] = [];
  await collectEntries(sourceDir, sourceDir, entries);

  const mtimeSeconds = Math.floor(Date.now() / 1000);
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(buildHeader(entry, mtimeSeconds));
    if (entry.content.length > 0) chunks.push(padToBlockSize(entry.content));
  }
  chunks.push(Buffer.alloc(1024)); // two zero blocks mark the end of the archive
  return gzipSync(Buffer.concat(chunks));
}

// ─────────────────────────────────────────────────────────────────────────────
// Action entry point
// ─────────────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
  try {
    const apiUrl = core.getInput('api-url', { required: true }).replace(/\/+$/, '');
    const apiKey = core.getInput('api-key', { required: true });
    core.setSecret(apiKey);
    const evidenceDir = core.getInput('evidence-dir') || '.devpliance';

    if (!(await isDirectory(evidenceDir))) {
      core.setFailed(
        `No '${evidenceDir}' directory found — add your .devpliance/ evidence folder to the repo, or set evidence-dir.`,
      );
      return;
    }

    core.info(`Packaging ${evidenceDir}/ ...`);
    const archive = await createTarGz(evidenceDir);
    core.info(`Archive: devpliance-evidence.tar.gz (${formatBytes(archive.length)})`);

    const url = `${apiUrl}/api/v1/submissions`;
    core.info(`Uploading to ${url} ...`);

    const form = new FormData();
    form.append(
      'evidence',
      new Blob([new Uint8Array(archive)], { type: 'application/gzip' }),
      'devpliance-evidence.tar.gz',
    );

    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch (err) {
      core.setFailed(`Could not reach ${apiUrl}: ${describeFetchError(err)}`);
      return;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      core.setFailed(`Upload failed: ${res.status} ${res.statusText}${body ? `\n${body}` : ''}`);
      return;
    }

    const data = (await res.json().catch(() => ({}))) as { controls?: unknown };
    const controls = Array.isArray(data.controls)
      ? data.controls.filter((c): c is string => typeof c === 'string')
      : [];

    core.info(`✓ Uploaded ${evidenceDir}/ — captured ${controls.length} control(s)`);
    for (const id of controls) core.info(`  • ${id}`);

    core.setOutput('controls', controls.join(','));
    core.setOutput('controls-parsed', String(controls.length));
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'DevPliance upload failed with an unknown error');
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

// fetch() rejects with an opaque "fetch failed" TypeError; the real reason (ECONNRESET, a TLS error,
// a proxy refusal, etc.) lives in err.cause — often nested. Surface the whole chain.
function describeFetchError(err: unknown): string {
  const top = err instanceof Error ? err.message : String(err);
  const chain: string[] = [];
  let cur: unknown = (err as { cause?: unknown }).cause;
  for (let depth = 0; cur && depth < 4; depth++) {
    const c = cur as { code?: string; message?: string; cause?: unknown };
    const line = [c.code, c.message].filter(Boolean).join(': ');
    if (line) chain.push(line);
    cur = c.cause;
  }
  return chain.length ? `${top} (${chain.join(' → ')})` : top;
}

run();
