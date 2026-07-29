import pc from "picocolors";

// Generated with figlet's "big" font (`figlet -f big devpliance`). Kept as a
// template string so it survives copy/paste and doesn't depend on a figlet
// runtime dep. Not tagged with String.raw — the \` escapes below need to
// resolve to literal backticks, not backslash-backtick pairs.
const BANNER = `
      _                  _ _
     | |                | (_)
   __| | _____   ___ __ | |_  __ _ _ __   ___ ___
  / _\` |/ _ \\ \\ / / '_ \\| | |/ _\` | '_ \\ / __/ _ \\
 | (_| |  __/\\ V /| |_) | | | (_| | | | | (_|  __/
  \\__,_|\\___| \\_/ | .__/|_|_|\\__,_|_| |_|\\___\\___|
                  | |
                  |_|
`;

/**
 * Render the banner. Colour is suppressed automatically by picocolors when
 * output is not a TTY (e.g. piped into a file or a CI log), so this is safe
 * to print unconditionally.
 */
export function banner(): string {
  return pc.cyan(BANNER) + "\n";
}

/**
 * A one-line version for sub-commands where the full banner would be noise.
 */
export function wordmark(): string {
  return pc.cyan(pc.bold("devpliance"));
}
