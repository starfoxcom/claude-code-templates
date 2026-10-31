// The three settings layers of docs/v2/HANDOFF.md, lowest first: personal
// (<config>/bindwright/settings.json), the project (.bindwright/project.json,
// committed) and personal-in-this-project (.bindwright/local.json, never
// committed). A later layer wins, except where the project requires a value.
// Every layer is data only: an unknown key or a bad value is listed in
// `ignored`, never applied, and a file from a newer Bindwright is refused.
// Keys are read in sorted order, so both twins list them alike.
// Node only; layers.py is the Python twin.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CODE_RESEARCH_TOOLS, TRACKERS } from "./model.js";
import { MAX_DEPTH, depthOf } from "./setupcode.js";
import { ANSWERS } from "./bind.js";
import { decode } from "./update.js";

export const SCHEMA = 1;
export const LOCAL = ".bindwright/local.json";
export const PERSONAL = "bindwright/settings.json";

// The extras setup offers for ~/.claude, by the file that shows each is there.
const GUARD_FILES = { "attribution-guard": "hooks/no-ai-attribution.py", "push-guard": "hooks/push-guard.py" };
const MODS = [
  "ci-watch", "compact-handoff", "mods", "runners", "session-facts",
  "session-info", "shared-pc", "skill-check", "tasks", "usage-guard",
];
export const EXTRAS = [...Object.keys(GUARD_FILES), ...MODS].sort();
const LEVELS = ["required", "recommended"];

const own = (obj, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// The settings a layer may hold, each with its test for a valid value.
export const SETTINGS = {
  codeResearch: (v) => own(CODE_RESEARCH_TOOLS, v),
  tracker: (v) => typeof v === "string" && TRACKERS.includes(v),
};

// Refuses a file from a newer Bindwright, or one whose version is not a whole number.
function checkSchema(schema, file) {
  if (schema === undefined) return;
  if (!Number.isInteger(schema) || schema < 1) throw new Error(`${file} has no valid schema number`);
  if (schema > SCHEMA) throw new Error(`${file} was written by a newer Bindwright: update the plugin`);
}

function readExtras(extras, name, isValid, ignored) {
  const out = {};
  if (extras === undefined) return out;
  if (!isObject(extras)) {
    ignored.push(`${name}: extras`);
    return out;
  }
  for (const extra of Object.keys(extras).sort()) {
    const value = extras[extra];
    if (EXTRAS.includes(extra) && isValid(value)) out[extra] = value;
    else ignored.push(`${name}: extras.${extra}`);
  }
  return out;
}

// A personal layer: { schema, codeResearch, tracker, extras: { <extra>: true | false } }.
function readPersonal(raw, name, file) {
  const layer = { settings: {}, extras: {}, required: [], ignored: [] };
  if (raw === null) return layer;
  if (!isObject(raw)) throw new Error(`${file} must hold a JSON object`);
  checkSchema(raw.schema, file);
  for (const key of Object.keys(raw).sort()) {
    const value = raw[key];
    if (key === "schema") continue;
    if (key === "extras") layer.extras = readExtras(value, name, (v) => typeof v === "boolean", layer.ignored);
    else if (own(SETTINGS, key) && SETTINGS[key](value)) layer.settings[key] = value;
    else layer.ignored.push(`${name}: ${key}`);
  }
  return layer;
}

// The project layer: the answers' own choices, plus the `setup` object
// /bindwright:export writes: { schema, extras: { <extra>: "required" |
// "recommended" }, required: [<setting>, ...] }.
function readProject(answers) {
  const layer = { settings: {}, extras: {}, required: [], ignored: [] };
  if (answers === null) return layer;
  if (!isObject(answers)) throw new Error(`${ANSWERS} must hold a JSON object`);
  const advanced = isObject(answers.advanced) ? answers.advanced : {};
  for (const key of Object.keys(SETTINGS)) {
    if (SETTINGS[key](advanced[key])) layer.settings[key] = advanced[key];
  }
  const setup = answers.setup;
  if (setup === undefined) return layer;
  if (!isObject(setup)) {
    layer.ignored.push("project: setup");
    return layer;
  }
  checkSchema(setup.schema, `${ANSWERS} (setup)`);
  for (const key of Object.keys(setup).sort()) {
    const value = setup[key];
    if (key === "schema") continue;
    if (key === "extras") layer.extras = readExtras(value, "project", (v) => LEVELS.includes(v), layer.ignored);
    else if (key === "required" && Array.isArray(value)) {
      for (const item of value) {
        if (own(SETTINGS, item) && own(layer.settings, item)) layer.required.push(item);
        else layer.ignored.push(typeof item === "string" ? `project: required.${item}` : "project: required");
      }
    } else layer.ignored.push(`project: setup.${key}`);
  }
  return layer;
}

// One setting across the layers: the project's value when it requires one,
// else the highest layer that sets it. A lower value it overrides is noted.
function resolveSetting(key, { personal, project, local }, ignored) {
  const required = project.required.includes(key);
  if (required) {
    for (const [name, layer] of [["personal", personal], ["local", local]]) {
      const value = layer.settings[key];
      const overridden = value !== undefined && value !== project.settings[key];
      if (overridden) ignored.push(`${name}: ${key} (the project requires it)`);
    }
    return { value: project.settings[key], from: "project", required };
  }
  for (const [name, layer] of [["local", local], ["project", project], ["personal", personal]]) {
    if (own(layer.settings, key)) return { value: layer.settings[key], from: name, required };
  }
  return null;
}

// One extra: whether the person wants it, and how the project rates it.
// `want` is null while nobody has decided, which /bindwright:join asks about.
function resolveExtra(extra, { personal, project, local }, ignored) {
  const level = project.extras[extra] ?? null;
  if (level === "required") {
    for (const [name, layer] of [["personal", personal], ["local", local]]) {
      if (layer.extras[extra] === false) ignored.push(`${name}: extras.${extra} (the project requires it)`);
    }
    return { project: level, want: true, from: "project" };
  }
  for (const [name, layer] of [["local", local], ["personal", personal]]) {
    if (own(layer.extras, extra)) return { project: level, want: layer.extras[extra], from: name };
  }
  return level === null ? null : { project: level, want: null, from: null };
}

// The layers resolved: { settings, extras, ignored }. Each argument is a
// parsed file or null when it is missing.
export function resolveLayers({ personal = null, project = null, local = null }) {
  const layers = {
    personal: readPersonal(personal, "personal", PERSONAL),
    project: readProject(project),
    local: readPersonal(local, "local", LOCAL),
  };
  const ignored = [...layers.personal.ignored, ...layers.project.ignored, ...layers.local.ignored];
  const settings = {};
  for (const key of Object.keys(SETTINGS)) {
    const resolved = resolveSetting(key, layers, ignored);
    if (resolved) settings[key] = resolved;
  }
  const extras = {};
  for (const extra of EXTRAS) {
    const resolved = resolveExtra(extra, layers, ignored);
    if (resolved) extras[extra] = resolved;
  }
  return { settings, extras, ignored };
}

// The extras present under the config folder (~/.claude), by name.
export function installedExtras(config) {
  const at = (extra) => (own(GUARD_FILES, extra) ? GUARD_FILES[extra] : `mods/${extra}`);
  return Object.fromEntries(EXTRAS.map((extra) => [extra, existsSync(join(config, ...at(extra).split("/")))]));
}

// A settings file's JSON, or null when it is missing.
export function readLayerFile(path, file) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const text = decode(bytes, file);
  if (depthOf(text) > MAX_DEPTH) throw new Error(`${file} nests too deeply`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
}

// The resolved settings of the repo at `root` for the person whose config
// folder is `config`, with which extras are installed and `drift`: the
// extras the project rates that this machine lacks and nobody declined.
export function runSettings(root, config) {
  const at = (path) => join(root, ...path.split("/"));
  const resolved = resolveLayers({
    personal: readLayerFile(join(config, ...PERSONAL.split("/")), PERSONAL),
    project: readLayerFile(at(ANSWERS), ANSWERS),
    local: readLayerFile(at(LOCAL), LOCAL),
  });
  const installed = installedExtras(config);
  const drift = Object.entries(resolved.extras)
    .filter(([extra, e]) => e.project !== null && e.want !== false && !installed[extra])
    .map(([extra]) => extra);
  return { ...resolved, installed, drift };
}
