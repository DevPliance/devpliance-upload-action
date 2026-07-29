import pc from "picocolors";
import { banner } from "../banner.js";
import {
  CREDENTIALS_PATH,
  isValidApiKey,
  sanitizeSecret,
  writeCredentials,
} from "../lib/credentials.js";
import { promptHidden, promptVisible } from "../lib/prompt.js";

interface LoginOptions {
  instance?: string;
  secret?: string;
}

const INSTANCE_DOMAIN = "devpliance.com";

// A single DNS label: letters/digits/hyphens, no leading/trailing hyphen,
// max 63 chars — matches what's valid as a subdomain of INSTANCE_DOMAIN.
const INSTANCE_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export async function login(opts: LoginOptions = {}): Promise<void> {
  process.stdout.write(banner());

  let instance = opts.instance;
  if (!instance) {
    if (!process.stdin.isTTY) {
      fail("Missing --instance and no TTY to prompt for it. Pass --instance <name>.");
    }
    instance = await promptVisible("Devpliance instance name: ");
  }
  const baseUrl = resolveBaseUrl(instance);

  let secret = opts.secret ?? process.env.DEVPLIANCE_API_SECRET;
  if (!secret) {
    if (!process.stdin.isTTY) {
      fail(
        "Missing API secret. Pass --secret <secret> or set DEVPLIANCE_API_SECRET (no TTY to prompt)."
      );
    }
    secret = await promptHidden("API secret: ");
  }
  secret = sanitizeSecret(secret ?? "");
  if (!secret) {
    fail("An API secret is required to log in.");
  }

  // Validate the shape before storing. There's no server-side verify endpoint yet, but
  // this alone catches the common ways a key gets mangled on the way in — a paste that
  // dragged in terminal escape sequences, a doubled or truncated copy, stray whitespace —
  // so a bad credential is rejected here instead of failing cryptically at `submit`.
  if (!isValidApiKey(secret)) {
    fail(
      "That doesn't look like a valid API key. It should be `dp_key_` followed by 32 " +
        "hex characters. Copy it exactly from the dashboard (Register Repository, or a " +
        "repo's Settings → Rotate API key). Tip: pass it with --secret to avoid paste issues."
    );
  }

  await writeCredentials({
    baseUrl,
    secret,
    createdAt: new Date().toISOString(),
  });

  process.stdout.write(
    "\n" +
      pc.green(`✓ Logged in to ${pc.bold(baseUrl)}`) +
      "\n" +
      pc.dim(`Credentials saved to ${CREDENTIALS_PATH}\n`)
  );
}

function resolveBaseUrl(instance: string): string {
  const name = instance.trim().toLowerCase();
  if (name.includes("://") || name.includes("/") || name.includes(".")) {
    return fail(
      `"${instance}" looks like a URL, not an instance name. Pass just the instance name ` +
        `(e.g. --instance acme), not the full ${INSTANCE_DOMAIN} address.`
    );
  }
  if (!INSTANCE_NAME_RE.test(name)) {
    return fail(
      `"${instance}" isn't a valid instance name. Use only letters, digits, and hyphens (e.g. "acme").`
    );
  }
  return `https://${name}.${INSTANCE_DOMAIN}`;
}

function fail(message: string): never {
  process.stderr.write(pc.red(`\n✗ ${message}\n`));
  process.exit(1);
}
