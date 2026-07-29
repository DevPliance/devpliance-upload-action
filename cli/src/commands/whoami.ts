import pc from "picocolors";
import { readCredentials } from "../lib/credentials.js";

export async function whoami(): Promise<void> {
  const creds = await readCredentials();
  if (!creds) {
    process.stdout.write(
      pc.yellow("Not logged in.") + pc.dim(" Run `devpliance login` first.\n")
    );
    return;
  }

  process.stdout.write(
    pc.bold("URL:     ") + creds.baseUrl + "\n" +
      pc.bold("Secret:  ") + maskSecret(creds.secret) + "\n" +
      pc.bold("Since:   ") + pc.dim(creds.createdAt) + "\n"
  );
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  return secret.slice(0, 4) + "*".repeat(secret.length - 8) + secret.slice(-4);
}
