import { stat } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { wordmark } from "../banner.js";
import { readCredentials } from "../lib/credentials.js";
import { createTarGz } from "../lib/archive.js";
import { DEVPLIANCE_DIR } from "./init.js";

const SUBMISSIONS_PATH = "/api/v1/submissions";
const ARCHIVE_NAME = "devpliance-evidence.tar.gz";

export async function submit(): Promise<void> {
  process.stdout.write(`${wordmark()} submit\n\n`);

  const creds = await readCredentials();
  if (!creds) {
    fail("Not logged in. Run `devpliance login` first.");
  }

  const dir = join(process.cwd(), DEVPLIANCE_DIR);
  if (!(await isDirectory(dir))) {
    fail(`No ${DEVPLIANCE_DIR}/ folder here. Run \`devpliance init\` first.`);
  }

  process.stdout.write(pc.dim(`Packaging ${DEVPLIANCE_DIR}/ ...\n`));
  const archive = await createTarGz(dir);
  process.stdout.write(
    pc.dim(`Archive: ${ARCHIVE_NAME} (${formatBytes(archive.length)})\n`)
  );

  const url = `${creds.baseUrl}${SUBMISSIONS_PATH}`;
  process.stdout.write(pc.dim(`Uploading to ${url} ...\n`));

  const form = new FormData();
  form.append(
    "evidence",
    // Buffer's backing ArrayBufferLike admits SharedArrayBuffer, which
    // BlobPart doesn't accept — copy into a plain Uint8Array<ArrayBuffer>.
    new Blob([new Uint8Array(archive)], { type: "application/gzip" }),
    ARCHIVE_NAME
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.secret}` },
      body: form,
    });
  } catch (err) {
    // fetch() rejects with an opaque "fetch failed" TypeError; the real reason (ECONNRESET,
    // ETIMEDOUT, a TLS error, a proxy refusal, etc.) lives in err.cause — often nested. Surface
    // the whole chain so a transport failure is actually diagnosable.
    fail(`Could not reach ${creds.baseUrl}: ${describeFetchError(err)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(
      `Upload failed: ${res.status} ${res.statusText}` + (body ? `\n${body}` : "")
    );
  }

  let controls: string[] = [];
  try {
    const body = (await res.json()) as { controls?: unknown };
    if (Array.isArray(body.controls)) {
      controls = body.controls.filter((c): c is string => typeof c === "string");
    }
  } catch {
    // A non-JSON or empty body doesn't undo a 2xx submission — just skip the control summary.
  }

  process.stdout.write(
    "\n" + pc.green(`✓ Submitted ${DEVPLIANCE_DIR}/ to ${pc.bold(creds.baseUrl)}`) + "\n"
  );

  if (controls.length > 0) {
    const label = controls.length === 1 ? "control" : "controls";
    process.stdout.write(pc.dim(`\nControls updated (${controls.length} ${label}):\n`));
    for (const id of controls) {
      process.stdout.write(`  ${pc.cyan("•")} ${id}\n`);
    }
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
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function describeFetchError(err: unknown): string {
  const top = err instanceof Error ? err.message : String(err);
  const chain: string[] = [];
  let cur: unknown = (err as { cause?: unknown })?.cause;
  for (let depth = 0; cur && depth < 4; depth++) {
    const c = cur as { code?: string; message?: string; cause?: unknown };
    const line = [c.code, c.message].filter(Boolean).join(": ");
    if (line) chain.push(line);
    cur = c.cause;
  }
  return chain.length ? `${top} (${chain.join(" → ")})` : top;
}

function fail(message: string): never {
  process.stderr.write(pc.red(`\n✗ ${message}\n`));
  process.exit(1);
}
