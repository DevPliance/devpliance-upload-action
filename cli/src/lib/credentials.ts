import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Global, not per-repo: one login is meant to work across every repo on the
 * machine, mirroring how `az`/`gh` scope their credential store to the home
 * directory rather than the current project.
 */
export const CREDENTIALS_DIR = join(homedir(), ".devpliance");
export const CREDENTIALS_PATH = join(CREDENTIALS_DIR, "credentials.json");

export interface Credentials {
  baseUrl: string;
  secret: string;
  createdAt: string;
}

const ESC = String.fromCharCode(27);

/**
 * An API secret is a bearer token used verbatim in an Authorization header, so it
 * must contain no control characters — a raw ESC or newline (e.g. bracketed-paste
 * markers captured by the hidden `login` prompt) makes the header invalid and fetch
 * throws an opaque error. Strip ANSI escape sequences and control characters and
 * trim, both when storing and when reading back, so a value that slipped through
 * elsewhere still can't crash `submit`.
 */
export function sanitizeSecret(secret: string): string {
  return secret
    .replace(new RegExp(ESC + "\\[[0-9;?]*[~A-Za-z]", "g"), "")
    .replace(new RegExp("[\\u0000-\\u001f\\u007f]", "g"), "")
    .trim();
}

/**
 * The exact shape the server issues (ControlPlaneStore.generateApiKey): the literal
 * prefix `dp_key_` followed by 32 lowercase hex characters. Validating against this
 * at login is an allowlist, not a blocklist: it rejects a secret that's been doubled,
 * truncated, whitespace-padded, escape-corrupted, or is simply the wrong string —
 * failing loudly at input instead of writing a bad credential that only breaks later.
 * Update this if the server key format changes.
 */
export function isValidApiKey(secret: string): boolean {
  return /^dp_key_[0-9a-f]{32}$/.test(secret);
}

export async function writeCredentials(creds: Credentials): Promise<void> {
  const clean = { ...creds, secret: sanitizeSecret(creds.secret) };
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(clean, null, 2) + "\n", {
    mode: 0o600,
  });
  // `mode` on writeFile only applies when the file is newly created; chmod
  // also covers re-login overwriting an existing file. Best-effort: a no-op
  // on Windows and can fail on some filesystems, neither of which should
  // block login.
  await chmod(CREDENTIALS_PATH, 0o600).catch(() => {});
}

export async function readCredentials(): Promise<Credentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf8");
    const creds = JSON.parse(raw) as Credentials;
    return { ...creds, secret: sanitizeSecret(creds.secret) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export async function clearCredentials(): Promise<boolean> {
  try {
    await rm(CREDENTIALS_PATH);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw err;
  }
}
