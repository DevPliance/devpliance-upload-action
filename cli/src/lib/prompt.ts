import * as readline from "node:readline";

/** Prompt for a line of input, echoed normally (e.g. a URL, not a secret). */
export function promptVisible(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Control codes checked by charCode below rather than escape-sequence string
// literals, so the source stays plain ASCII instead of embedding raw
// unprintable bytes.
const CTRL_C = 3;
const CTRL_D = 4;
const BACKSPACE = 8;
const DEL = 127;

const ESC = String.fromCharCode(27);

/**
 * In raw mode a paste is delivered verbatim, so a terminal with bracketed paste
 * enabled wraps it in ESC[200~ … ESC[201~ markers, and arrow/function keys
 * arrive as ESC[… sequences too. Left in the captured string these corrupt the
 * value — and the raw ESC byte is illegal in an HTTP header, which surfaces much
 * later as an opaque "fetch failed". Strip CSI escape sequences and any other
 * control characters here, at the point of capture.
 */
function stripEscapes(s: string): string {
  return s
    .replace(new RegExp(ESC + "\\[[0-9;?]*[~A-Za-z]", "g"), "")
    .replace(new RegExp("[\\u0000-\\u001f\\u007f]", "g"), "");
}

/**
 * Prompt for a line of input without echoing it back to the terminal, e.g. an
 * API secret. Requires a TTY; callers should fall back to --secret or an env
 * var when stdin isn't interactive (piped input, CI).
 */
export function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    process.stdout.write(query);

    let input = "";
    stdin.resume();
    stdin.setEncoding("utf8");
    if (stdin.isTTY) stdin.setRawMode(true);

    const cleanup = () => {
      if (stdin.isTTY) stdin.setRawMode(!!wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    function onData(chunk: string) {
      // A single "data" event can carry more than one character — e.g. a
      // pasted secret, often with a trailing newline from a clipboard
      // manager — so each character needs handling individually rather than
      // treating the whole chunk as one keystroke.
      for (const char of chunk.toString()) {
        const code = char.charCodeAt(0);

        if (char === "\n" || char === "\r" || code === CTRL_D) {
          cleanup();
          process.stdout.write("\n");
          resolve(stripEscapes(input).trim());
          return;
        }
        if (code === CTRL_C) {
          cleanup();
          process.stdout.write("\n");
          process.exit(1);
        }
        if (code === BACKSPACE || code === DEL) {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
      }
    }

    stdin.on("data", onData);
  });
}
