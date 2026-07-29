import * as core from '@actions/core';
import { stat } from 'node:fs/promises';
import { createTarGz } from './archive';

// Self-contained: packages the .devpliance/ evidence folder (see ./archive) and uploads it as a
// multipart POST to /api/v1/submissions — the same request the devpliance CLI's `submit` makes.
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
