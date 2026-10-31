// The engine as a command, for machines with Node and no Python. Same flags,
// output and exit status as bind.py's command (without --batch):
//   node engine/cli.js [--year N] < answers.json     -> {"files": [[dest, text], ...]}
//   node engine/cli.js --code bw1-...                -> the answers come from a setup code
//   node engine/cli.js --code bw1-... --write DIR    -> {"written": [...], "staged": [...], "skipped": [...]}
//   ... --write DIR --adopt                          -> the same, with every file outside .bindwright/ staged
//   node engine/cli.js --update DIR                  -> the saved answers rebound and merged (update.js)
//   node engine/cli.js --settings DIR                -> the settings layers resolved for that repo (layers.js)
//   node engine/cli.js --audit DIR                   -> how its rules held up in recent sessions (audit.js)
//   node engine/cli.js --export DIR < choices.json   -> the project's setup object written (share.js)
//   node engine/cli.js --remember DIR --layer L < choices.json -> one person's choices written to layer L
//   node engine/cli.js --doctor DIR                  -> a health check of that repo and this machine (doctor.js)
// A failure gives {"error": message} and exit status 1.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bind } from "./bind.js";
import { MAX_DEPTH, decodeSetupCode, depthOf } from "./setupcode.js";
import { applyFiles } from "./apply.js";
import { decode, runUpdate } from "./update.js";
import { runSettings } from "./layers.js";
import { runAudit } from "./audit.js";
import { exportSetup, rememberChoices } from "./share.js";
import { cliVersionFrom, runDoctor } from "./doctor.js";
import { draftReport } from "./report.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The value after `name`, or undefined when the flag is absent.
function option(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  if (i + 1 === argv.length || argv[i + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return argv[i + 1];
}

async function run(argv) {
  const flags = [
    "--code", "--year", "--write", "--update", "--settings",
    "--export", "--remember", "--layer", "--doctor", "--report", "--audit",
  ];
  const [code, year, folder, update, settings, exported, remember, layer, doctor, report, audit] =
    flags.map((n) => option(argv, n));
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  if (report !== undefined) return reportRepo(report, config);
  if (doctor !== undefined) return doctorRepo(doctor, config);
  if (update !== undefined) return updateRepo(update);
  if (settings !== undefined) return runSettings(settings, config);
  if (audit !== undefined) return runAudit(audit, config);
  if (exported !== undefined) return { setup: exportSetup(exported, choicesFromStdin()) };
  if (remember !== undefined && layer === undefined) throw new Error("--remember needs --layer personal or local");
  if (remember !== undefined) return rememberChoices(remember, config, layer, choicesFromStdin());
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

// A scrubbed bug report for the repo at `folder`, from { title, command, error, expected } on stdin.
function reportRepo(folder, config) {
  const what = JSON.parse(readFileSync(0, "utf8"));
  const pluginVersion = readFileSync(join(root, "VERSION"), "utf8").trim().replace(/^v+/, "");
  const cliVersion = cliVersionFrom(process.env.AI_AGENT);
  const facts = { pluginVersion, cliVersion, os: process.platform, engine: "node" };
  const who = { repo: resolve(folder), home: homedir(), user: process.env.USERNAME || process.env.USER || "" };
  return draftReport(folder, config, what, facts, who);
}

// The doctor, for the CLI this session runs (its AI_AGENT) and this plugin's VERSION.
function doctorRepo(folder, config) {
  const pluginVersion = readFileSync(join(root, "VERSION"), "utf8").trim().replace(/^v+/, "");
  return runDoctor(folder, config, { pluginVersion, cliVersion: cliVersionFrom(process.env.AI_AGENT) });
}

// The choices /bindwright:export and /bindwright:join pass on standard input.
function choicesFromStdin() {
  const text = decode(readFileSync(0), "the choices on standard input");
  if (depthOf(text) > MAX_DEPTH) throw new Error("the choices on standard input nest too deeply");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("the choices on standard input are not valid JSON");
  }
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
