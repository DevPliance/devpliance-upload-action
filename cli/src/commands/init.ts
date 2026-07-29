import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { wordmark } from "../banner.js";
import { readCredentials } from "../lib/credentials.js";
import { readZipEntries, resolveEntryPath } from "../lib/zip.js";

/**
 * The name of the folder we scaffold in the user's repo.
 * Dotfolder keeps it out of the way and signals "tool config, not source".
 */
export const DEVPLIANCE_DIR = ".devpliance";

/**
 * The template pack shipped with the CLI: a pre-built .devpliance/ folder
 * (config + control catalogue) that init extracts as-is. Its own
 * config/devp.yml carries the version/framework info that used to live in a
 * hand-written config.json here — the pack owns that now.
 */
const TEMPLATE_ZIP = fileURLToPath(
  new URL("../assets/devpliance-repo-pack.zip", import.meta.url)
);

interface InitOptions {
  force?: boolean;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function init(opts: InitOptions = {}): Promise<void> {
  process.stdout.write(`${wordmark()} init\n\n`);

  const creds = await readCredentials();
  if (!creds) {
    process.stderr.write(
      pc.red(`\n✗ Not logged in.`) +
        pc.dim(` Run \`devpliance login\` first.\n`)
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const dir = join(cwd, DEVPLIANCE_DIR);

  if ((await pathExists(dir)) && !opts.force) {
    process.stdout.write(
      pc.yellow(`\n${DEVPLIANCE_DIR}/ already exists here.\n`) +
        pc.dim(`Re-run with --force to overwrite the scaffold.\n`)
    );
    return;
  }

  const entries = await readZipEntries(TEMPLATE_ZIP);

  let fileCount = 0;
  for (const entry of entries) {
    const dest = resolveEntryPath(cwd, entry.path);
    if (entry.isDirectory) {
      await mkdir(dest, { recursive: true });
      continue;
    }
    await mkdir(join(dest, ".."), { recursive: true });
    await writeFile(dest, entry.content);
    fileCount++;
  }

  process.stdout.write(
    "\n" +
      pc.green(`✓ initialised ${DEVPLIANCE_DIR}/`) +
      pc.dim(` (${fileCount} files from the template pack)`) +
      "\n"
  );
}
