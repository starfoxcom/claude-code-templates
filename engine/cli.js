// The engine as a command, for machines with Node and no Python. Same flags,
// output and exit status as bind.py's command (without --batch):
//   node engine/cli.js [--year N] < answers.json     -> {"files": [[dest, text], ...]}
//   node engine/cli.js --code bw1-...                -> the answers come from a setup code
//   node engine/cli.js --code bw1-... --write DIR    -> {"written": [...], "skipped": [...]}
// A failure gives {"error": message} and exit status 1.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bind } from "./bind.js";
import { decodeSetupCode } from "./setupcode.js";
import { applyFiles } from "./apply.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The value after `name`, or undefined when the flag is absent.
function option(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  if (i + 1 === argv.length || argv[i + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return argv[i + 1];
}

async function run(argv) {
  const [code, year, folder] = ["--code", "--year", "--write"].map((n) => option(argv, n));
  if (year !== undefined && !/^[0-9]+$/.test(year)) throw new Error("--year needs a whole number");
  const answers = code === undefined ? JSON.parse(readFileSync(0, "utf8")) : decodeSetupCode(code);
  const coreFiles = JSON.parse(readFileSync(join(root, "engine", "core-files.json"), "utf8"));
  const readFile = async (p) => readFileSync(join(root, p), "utf8");
  const files = [...(await bind(answers, { readFile, coreFiles, year: year === undefined ? undefined : Number(year) })).entries()];
  return folder === undefined ? { files } : applyFiles(files, folder);
}

let result;
try {
  result = await run(process.argv.slice(2));
} catch (err) {
  result = { error: err.message };
}
// ASCII output, as bind.py writes it, so no console code page can mangle it.
const ascii = JSON.stringify(result).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
process.stdout.write(ascii);
process.exitCode = "error" in result ? 1 : 0;
