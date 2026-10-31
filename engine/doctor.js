// /bindwright:doctor's engine step: a read-only health check of a set-up repo
// and this machine. Each check says what it found and, when something is
// wrong, the fix in plain words. Node only; doctor.py is the Python twin.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ANSWERS, PRISTINE, STAGING } from "./bind.js";
import { validate } from "./model.js";
import { MODS, readLayerFile, runSettings } from "./layers.js";
import { decode } from "./update.js";

// What to do about each finding, in plain words.
const FIX = {
  restore: "Restore it from git with `git checkout -- .bindwright/`, or set the repo up again.",
  update: "Run /bindwright:update: it keeps the repo's own edits.",
  plugin: "Update the Bindwright plugin from /plugin first. Until then, do not run /bindwright:update: "
    + "it would write this older plugin's files.",
  reinstall: "Reinstall the Bindwright plugin from /plugin.",
  guards: "Restore them from git with `git checkout -- .claude/hooks/`; an update does not bring back deleted files.",
  settings: "Fix or remove those values in the files named.",
  join: "Run /bindwright:join: it installs each one on a yes and remembers a no.",
  cli: "Update the CLI. In Claude Desktop, update the app: it ships its own copy of the CLI.",
  staged: "Run /bindwright:update, which walks through each one, or delete the ones you do not want.",
  unreadable: "Fix or remove the file it names.",
  roadmap: "Fix those lines: each item is one line that starts with its id (R4), at most five sit under Now, "
    + "and the Next id line is above every id in use.",
};

// The first CLI with mods; older ones load none of them.
export const MODS_SINCE = [2, 1, 287];

// "claude-code_2-1-286_agent", the variable the CLI sets for what it runs,
// as [2, 1, 286]; null when unknown. Read from the session, not from PATH,
// since Claude Desktop runs its own copy of the CLI.
export function cliVersionFrom(agent) {
  const m = /^claude-code_(\d+)-(\d+)-(\d+)_/.exec(typeof agent === "string" ? agent : "");
  return m ? m.slice(1).map(Number) : null;
}

const before = (a, b) => {
  const i = a.findIndex((n, k) => n !== b[k]);
  return i !== -1 && a[i] < b[i];
};

const parts = (v) => (typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);

// Every file still waiting under .bindwright/incoming/, as repo paths.
function staged(root) {
  const base = join(root, ...STAGING.split("/").filter(Boolean));
  const out = [];
  const walk = (dir, prefix) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else out.push(`${prefix}${entry.name}`);
    }
  };
  if (existsSync(base)) walk(base, "");
  return out;
}

const check = (id, ok, say, fix = null) => ({ id, ok, say, fix });

// The state files: present, readable, and the answers valid.
function stateChecks(root) {
  const at = (path) => join(root, ...path.split("/"));
  let answers;
  let pristine;
  try {
    answers = readLayerFile(at(ANSWERS), ANSWERS);
    pristine = readLayerFile(at(PRISTINE), PRISTINE);
  } catch (err) {
    return { checks: [check("state", false, `A Bindwright state file cannot be read: ${err.message}.`,
      FIX.restore)] };
  }
  if (answers === null || pristine === null) {
    return { checks: [check("state", false, "This repo is not set up with Bindwright.", "Run /bindwright:setup.")] };
  }
  try {
    validate(answers);
  } catch (err) {
    return { checks: [check("state", false, `The saved answers in ${ANSWERS} are broken: ${err.message}.`,
      `Restore the file from git with \`git checkout -- ${ANSWERS}\`.`)] };
  }
  const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const shaped = isObject(pristine) && isObject(pristine.files);
  if (!shaped) {
    return { checks: [check("state", false, `${PRISTINE} does not hold the files setup wrote.`,
      `Restore the file from git with \`git checkout -- ${PRISTINE}\`.`)] };
  }
  return { checks: [check("state", true, "The setup files are present and readable.")], answers, pristine };
}

function versionCheck(pristine, pluginVersion) {
  const [repo, plugin] = [parts(pristine.version), parts(pluginVersion)];
  if (!repo) return check("version", false, `${PRISTINE} names no version Bindwright can read.`, FIX.restore);
  if (!plugin) return check("version", false, "The plugin's own version cannot be read.", FIX.reinstall);
  const say = `The repo's Bindwright files come from ${pristine.version}; the plugin is ${pluginVersion}.`;
  if (before(repo, plugin)) return check("version", false, say, FIX.update);
  if (before(plugin, repo)) return check("version", false, say, FIX.plugin);
  return check("version", true, "The repo's files match the plugin's version.");
}

function guardCheck(root, answers, pristine) {
  const guards = [".claude/hooks/push-guard.py", ".claude/hooks/run-hook.sh"];
  const missing = answers.advanced.hookLocation === "repo"
    ? guards.filter((p) => Object.hasOwn(pristine.files, p) && !existsSync(join(root, ...p.split("/"))))
    : [];
  if (missing.length) {
    const say = `The repo's guard hooks are missing: ${missing.join(", ")}. Force pushes are not blocked here.`;
    return check("guards", false, say,
      FIX.guards);
  }
  return check("guards", true, "The guard hooks are in place.");
}

function settingsChecks(root, config) {
  let settings;
  try {
    settings = runSettings(root, config);
  } catch (err) {
    const say = `The settings cannot be read: ${err.message}.`;
    return { checks: [check("settings", false, say, FIX.unreadable)], installed: {} };
  }
  const out = [settings.ignored.length
    ? check("settings", false, `Some settings are not used: ${settings.ignored.join("; ")}.`, FIX.settings)
    : check("settings", true, "Every setting is in use.")];
  out.push(settings.drift.length
    ? check("extras", false, `The project expects extras this machine lacks: ${settings.drift.join(", ")}.`,
      FIX.join)
    : check("extras", true, "This machine has the extras the project expects."));
  return { checks: out, installed: settings.installed };
}

function cliCheck(installed, cliVersion) {
  // Only mods need the newer CLI; the guards are plain hooks.
  const mods = Object.entries(installed ?? {}).some(([name, has]) => has && MODS.includes(name));
  if (!mods || !cliVersion || !before(cliVersion, MODS_SINCE)) {
    return check("cli", true, "The CLI runs the installed mods.");
  }
  const [running, needed] = [cliVersion.join("."), MODS_SINCE.join(".")];
  const say = `This session runs CLI ${running}, older than the ${needed} the mods need, so none of them load.`;
  return check("cli", false, say,
    FIX.cli);
}

// A staging folder that cannot be read is a finding, not a crash: the doctor
// is what explains a broken repo.
function stagedCheck(root) {
  let files;
  try {
    files = staged(root);
  } catch {
    return check("staged", false, `${STAGING} cannot be read as a folder.`, FIX.unreadable);
  }
  return files.length
    ? check("staged", false, `${files.length} staged file(s) wait under ${STAGING}: ${files.join(", ")}.`, FIX.staged)
    : check("staged", true, "No staged files are waiting.");
}

// What breaks the ROADMAP.md shape /session-close keeps: items are one line
// that starts with an unused id, at most five sit under Now, and the Next id
// is above every id in use. A missing file is fine; the next close writes it.
export function roadmapProblems(text) {
  const problems = [];
  const ids = new Set();
  let section = null;
  let now = 0;
  let next = null;
  // Plain string tests and trim(), never \s, \S or ".": those classes differ
  // between the twins. Ids stop at nine digits so both compare exact numbers.
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.startsWith("## ")) section = line.slice(3).trim();
    const counter = /^Next id: R([0-9]{1,9}) *$/.exec(line);
    if (counter) next = Number(counter[1]);
    if (!line.startsWith("- ") || !["Now", "Next", "Later"].includes(section)) continue;
    const found = /^- R([0-9]{1,9}) /.exec(line);
    const item = found && line.slice(found[0].length).trim() ? found : null;
    if (!item) problems.push(`"${Array.from(line).slice(0, 60).join("")}" has no id`);
    else if (ids.has(item[1])) problems.push(`R${item[1]} is used twice`);
    else ids.add(item[1]);
    if (section === "Now") now++;
  }
  if (now > 5) problems.push(`${now} items sit under Now, more than five`);
  if (next === null) problems.push("the Next id line is missing");
  else if ([...ids].some((id) => Number(id) >= next)) problems.push(`Next id R${next} is not above every id in use`);
  return problems;
}

function roadmapCheck(root) {
  const file = join(root, "ROADMAP.md");
  if (!existsSync(file)) return check("roadmap", true, "No ROADMAP.md yet; the next /session-close writes it.");
  let problems;
  try {
    problems = roadmapProblems(decode(readFileSync(file), "ROADMAP.md"));
  } catch {
    return check("roadmap", false, "ROADMAP.md cannot be read.", FIX.unreadable);
  }
  return problems.length
    ? check("roadmap", false, `ROADMAP.md is out of shape: ${problems.join("; ")}.`, FIX.roadmap)
    : check("roadmap", true, "ROADMAP.md is in shape.");
}

// Every check for the repo at `root` and the config folder `config`.
// `pluginVersion` is "x.y.z"; `cliVersion` [major, minor, patch] or null.
export function runDoctor(root, config, { pluginVersion, cliVersion }) {
  const state = stateChecks(root);
  const checks = [...state.checks];
  if (state.answers) {
    checks.push(versionCheck(state.pristine, pluginVersion), guardCheck(root, state.answers, state.pristine));
    checks.push(stagedCheck(root));
    if (state.answers.advanced.tracker === "file") checks.push(roadmapCheck(root));
    const settings = settingsChecks(root, config);
    checks.push(...settings.checks, cliCheck(settings.installed, cliVersion));
  }
  return { problems: checks.filter((c) => !c.ok).length, checks };
}
