// The engine as a command, for machines with Node and no Python. Same flags,
// output and exit status as bind.py's command (without --batch):
//   node engine/cli.js [--year N] < answers.json     -> {"files": [[dest, text], ...]}
//   node engine/cli.js --code bw1-...                -> the answers come from a setup code
//   node engine/cli.js --code bw1-... --write DIR    -> {"written": [...], "staged": [...], "skipped": [...]}
//   ... --write DIR --adopt                          -> the same, with every file outside .bindwright/ staged
//   node engine/cli.js --update DIR                  -> the saved answers rebound and merged (update.js)
//   node engine/cli.js --settings DIR                -> the settings layers resolved for that repo (layers.js)
//   node engine/cli.js --audit DIR                   -> how its rules held up in recent sessions (audit.js)
// A failure gives {"error": message} and exit status 1.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bind } from "./bind.js";
import { decodeSetupCode } from "./setupcode.js";
import { applyFiles } from "./apply.js";
import { runUpdate } from "./update.js";
import { runSettings } from "./layers.js";
import { runAudit } from "./audit.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The value after `name`, or undefined when the flag is absent.
function option(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  if (i + 1 === argv.length || argv[i + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return argv[i + 1];
}

async function run(argv) {
  const flags = ["--code", "--year", "--write", "--update", "--settings", "--audit"];
  const [code, year, folder, update, settings, audit] = flags.map((n) => option(argv, n));
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  if (update !== undefined) return updateRepo(update);
  if (settings !== undefined) return runSettings(settings, config);
  if (audit !== undefined) return runAudit(audit, config);
  const adopt = argv.includes("--adopt");
  if (adopt && folder === undefined) throw new Error("--adopt needs --write");
  if (year !== undefined && !/^[0-9]+$/.test(year)) throw new Error("--year needs a whole number");
  const answers = code === undefined ? JSON.parse(readFileSync(0, "utf8")) : decodeSetupCode(code);
  const coreFiles = JSON.parse(readFileSync(join(root, "engine", "core-files.json"), "utf8"));
  const readFile = async (p) => readFileSync(join(root, p), "utf8");
  // The template version the pristine render records: VERSION without its "v".
  const version = (await readFile("VERSION")).trim().replace(/^v+/, "");
  const bound = await bind(answers, { readFile, coreFiles, year: year === undefined ? undefined : Number(year), version });
  const files = [...bound.entries()];
  return folder === undefined ? { files } : applyFiles(files, folder, { adopt });
}

async function updateRepo(folder) {
  const coreFiles = JSON.parse(readFileSync(join(root, "engine", "core-files.json"), "utf8"));
  const readFile = async (p) => readFileSync(join(root, p), "utf8");
  const version = (await readFile("VERSION")).trim().replace(/^v+/, "");
  const bindWith = (answers, { year }) => bind(answers, { readFile, coreFiles, year, version });
  return runUpdate(folder, { bindWith, version });
}

let result;
try {
  result = await run(process.argv.slice(2));
} catch (err) {
  result = { error: err.message };
}
// ASCII output, as bind.py writes it, so no console code page can mangle it.
const escape = (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
process.stdout.write(JSON.stringify(result).replace(/[^\x00-\x7f]/g, escape));
process.exitCode = "error" in result ? 1 : 0;
