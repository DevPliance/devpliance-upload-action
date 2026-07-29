#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { init } from "./commands/init.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { whoami } from "./commands/whoami.js";
import { submit } from "./commands/submit.js";
import { wordmark } from "./banner.js";

const program = new Command();

program
  .name("devpliance")
  .description("Collect compliance evidence from your gitops process.")
  .version("0.1.0");

program
  .command("init")
  .description(`Scaffold a .devpliance/ folder in the current repo.`)
  .option("-f, --force", "overwrite an existing .devpliance/ folder")
  .action(async (opts) => {
    await init({ force: opts.force });
  });

program
  .command("login")
  .description("Authenticate the CLI against a devpliance instance.")
  .option(
    "-i, --instance <name>",
    "instance name, e.g. \"acme\" for acme.devpliance.com"
  )
  .option(
    "-s, --secret <secret>",
    "API secret (or set DEVPLIANCE_API_SECRET)"
  )
  .action(async (opts) => {
    await login({ instance: opts.instance, secret: opts.secret });
  });

program
  .command("logout")
  .description("Remove locally stored devpliance credentials.")
  .action(async () => {
    await logout();
  });

program
  .command("whoami")
  .description("Show the devpliance instance you're currently logged in to.")
  .action(async () => {
    await whoami();
  });

program
  .command("submit")
  .description("Package the .devpliance/ folder and upload it to the server.")
  .action(async () => {
    await submit();
  });

// With no sub-command, print help rather than erroring. The full ASCII
// banner is reserved for `init` — this just gets the one-line wordmark.
if (process.argv.length <= 2) {
  process.stdout.write(`${wordmark()}\n\n`);
  program.outputHelp();
  process.exit(0);
}

// Commands only ever exit via their own fail()/process.exit() for expected
// errors; anything else (corrupt credentials file, unexpected I/O failure)
// would otherwise reach here as a raw, unhandled stack trace.
program.parseAsync(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(pc.red(`\n✗ ${message}\n`));
  process.exit(1);
});
