import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../src/assets", import.meta.url));
const dest = fileURLToPath(new URL("../dist/assets", import.meta.url));

cpSync(src, dest, { recursive: true });
