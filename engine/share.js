// What /bindwright:export and /bindwright:join write: the project's `setup`
// object in .bindwright/project.json, and one person's choices in their own
// settings layer. Each choice is checked the way layers.js reads it, and a
// bad one stops the write instead of being skipped. Nothing is written
// through a symbolic link. Node only; share.py is the Python twin.

import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ANSWERS, stateJson } from "./bind.js";
import { LOCAL, PERSONAL, SCHEMA, SETTINGS, readLayerFile, resolveLayers } from "./layers.js";

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function put(path, file, text, flag = "w") {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`Refusing to write through a symbolic link: ${file}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { encoding: "utf8", flag });
}

function refuse(what, problems) {
  if (problems.length) throw new Error(`Cannot ${what}: ${problems.join(", ")}`);
}

// Keys outside `allowed`, in sorted order.
const unknownKeys = (obj, allowed) => Object.keys(obj).sort().filter((k) => !allowed.includes(k));

// Writes `{ extras, required }` as the project's `setup` object, keeping
// every other key of .bindwright/project.json as it was. Both empty removes
// the object. Returns the setup written, or null.
export function exportSetup(root, choices) {
  if (!isObject(choices)) throw new Error("Cannot export: the choices must be a JSON object");
  refuse("export", unknownKeys(choices, ["extras", "required"]));
  const { extras = {}, required = [] } = choices;
  const path = join(root, ...ANSWERS.split("/"));
  const answers = readLayerFile(path, ANSWERS);
  if (answers === null) throw new Error(`${ANSWERS} is missing: this repo was not set up with /bindwright:setup`);
  if (!isObject(answers)) throw new Error(`${ANSWERS} must hold a JSON object`);
  const setup = { schema: SCHEMA, extras, required };
  refuse("export", resolveLayers({ project: { ...answers, setup } }).ignored);
  const out = { ...answers };
  delete out.setup;
  const empty = isObject(extras) && Object.keys(extras).length === 0 && required.length === 0;
  if (!empty) out.setup = setup;
  put(path, ANSWERS, stateJson(out));
  return empty ? null : setup;
}

// The layer file `name` names, for the repo at `root` and the config folder `config`.
function layerFile(name, root, config) {
  if (name === "personal") return [join(config, ...PERSONAL.split("/")), PERSONAL];
  if (name === "local") return [join(root, ...LOCAL.split("/")), LOCAL];
  throw new Error(`Unknown layer "${name}": use personal or local`);
}

// Merges `choices` ({ codeResearch, tracker, extras: { <extra>: true |
// false } }, null removing a key) into one person's layer. Only what the
// layers use is kept: anything they ignore is dropped and listed, so the file
// holds nothing but known names, true and false, and both twins write it
// byte for byte alike. Writing the local layer also writes
// .bindwright/.gitignore, so the file never reaches a commit.
export function rememberChoices(root, config, name, choices) {
  const [path, file] = layerFile(name, root, config);
  if (!isObject(choices)) throw new Error("Cannot remember: the choices must be a JSON object");
  refuse("remember", unknownKeys(choices, [...Object.keys(SETTINGS), "extras"]));
  if (own(choices, "extras") && !isObject(choices.extras)) refuse("remember", ["extras"]);
  const before = resolveLayers({ [name]: readLayerFile(path, file) }); // refuses a file it cannot read
  const set = Object.fromEntries(Object.entries(choices).filter(([k, v]) => k !== "extras" && v !== null));
  const wanted = Object.fromEntries(Object.entries(choices.extras ?? {}).filter(([, v]) => v !== null));
  refuse("remember", resolveLayers({ [name]: { ...set, extras: wanted } }).ignored);
  const next = Object.fromEntries(Object.entries(before.settings).map(([k, s]) => [k, s.value]));
  const extras = Object.fromEntries(Object.entries(before.extras).map(([k, e]) => [k, e.want]));
  for (const [key, value] of Object.entries(choices)) {
    if (key === "extras") continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  for (const [extra, value] of Object.entries(choices.extras ?? {})) {
    if (value === null) delete extras[extra];
    else extras[extra] = value;
  }
  next.schema = SCHEMA;
  if (Object.keys(extras).length || own(choices, "extras")) {
    next.extras = Object.fromEntries(Object.keys(extras).sort().map((k) => [k, extras[k]]));
  }
  put(path, file, stateJson(Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]))));
  if (name === "local") {
    const ignore = join(root, ".bindwright", ".gitignore");
    if (!lstatSync(ignore, { throwIfNoEntry: false })) put(ignore, ".bindwright/.gitignore", "local.json\n", "wx");
  }
  return { remembered: file, dropped: before.ignored };
}
