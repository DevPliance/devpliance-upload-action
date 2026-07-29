import pc from "picocolors";
import { CREDENTIALS_PATH, clearCredentials } from "../lib/credentials.js";

export async function logout(): Promise<void> {
  const removed = await clearCredentials();
  if (removed) {
    process.stdout.write(
      pc.green(`✓ Logged out`) + pc.dim(` (removed ${CREDENTIALS_PATH})\n`)
    );
  } else {
    process.stdout.write(pc.dim(`Not logged in — nothing to do.\n`));
  }
}
