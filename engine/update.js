// /bindwright:update's engine step: a three-way merge of each repo file. The
// base is the file as the last bind rendered it (.bindwright/pristine.json),
// ours is the repo's copy, theirs is the same answers rendered from today's
// templates. update.py is the Python twin; a test runs both on the same cases.

import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { STAGING, ANSWERS, PRISTINE, stateJson } from "./bind.js";
import { OWNED, isOwned, keptSections, ownedPatterns } from "./keep.js";
import { safe } from "./apply.js";

// The rendered repo files under the paths they belong at, as the pristine
// render records them: staged ones without the staging prefix, and none of
// setup's own files.
export function repoFiles(rendered) {
  const out = new Map();
  for (const [dest, text] of rendered) {
    if (dest.startsWith(STAGING)) out.set(dest.slice(STAGING.length), text);
    else if (!dest.startsWith(".bindwright/")) out.set(dest, text);
  }
  return out;
}

// True when every kept section of `ours` survives in `merged` word for word.
function keepsSections(ours, merged, path) {
  const lines = ours.split("\n");
  return keptSections(ours, path).every(([first, last]) => merged.includes(lines.slice(first - 1, last).join("\n")));
}

// What can happen to a file. "deleted": the repo removed a file the bind
// wrote, which stays removed; "removed": the templates dropped a file the repo
// never changed, which the skill offers to delete; "removed_edited": the same
// for a file the repo changed, which stays.
export const OUTCOMES = [
  "updated", "merged", "added", "staged", "unchanged", "conflict", "owned", "deleted", "removed", "removed_edited",
];

function decide(path, { ours, base, theirs }, merge) {
  if (theirs === undefined) {
    if (ours === null) return ["deleted"];
    return ours === base ? ["removed"] : ["removed_edited"];
  }
  if (base === undefined) {
    if (ours === null) return ["added", theirs];
    return ours === theirs ? ["unchanged"] : ["staged", theirs];
  }
  if (ours === null) return ["deleted"];
  if (ours === theirs || base === theirs) return ["unchanged"];
  if (ours === base) return ["updated", theirs];
  const { text, conflicts } = merge(ours, base, theirs);
  if (conflicts || !keepsSections(ours, text, path)) return ["conflict", text];
  return ["merged", text];
}

// Decides every file. `rendered` is the new bind's Map, `pristine` the parsed
// pristine.json, `readRepo(path)` the repo's text or null, `owned` the
// patterns from .bindwright/owned, `merge(ours, base, theirs)` gives
// { text, conflicts }. Returns the lists by outcome, the files to write and
// stage, and the new pristine render. A conflicted file is staged as the
// merge left it, markers and all, and its base still moves on, so once the
// user settles it the next update does not raise the same clash again.
export function planUpdate(rendered, pristine, { readRepo, owned, merge, version }) {
  const theirsAll = repoFiles(rendered);
  const paths = [...new Set([...Object.keys(pristine.files), ...theirsAll.keys()])].sort();
  const result = { write: [], stage: [], pristine: {} };
  for (const outcome of OUTCOMES) result[outcome] = [];
  for (const path of paths) {
    const base = pristine.files[path];
    const theirs = theirsAll.get(path);
    if (isOwned(path, owned)) {
      result.owned.push(path);
      if (theirs !== undefined) result.pristine[path] = theirs;
      continue;
    }
    const [outcome, text] = decide(path, { ours: readRepo(path), base, theirs }, merge);
    result[outcome].push(path);
    if (outcome === "updated" || outcome === "merged" || outcome === "added") result.write.push([path, text]);
    if (outcome === "staged" || outcome === "conflict") result.stage.push([STAGING + path, text]);
    if (theirs !== undefined) result.pristine[path] = theirs;
  }
  result.pristine = { version, year: pristine.year, files: result.pristine };
  return result;
}

// A three-way merge by git, which every set-up repo has: its exit status is
// the number of conflicts. Each clash shows all three versions, labelled.
export const MERGE_LABELS = ["this repo", "last setup or update", "today's templates"];

export function gitMerge(ours, base, theirs) {
  const dir = mkdtempSync(join(tmpdir(), "bindwright-merge-"));
  try {
    const at = (name, text) => {
      writeFileSync(join(dir, name), text);
      return join(dir, name);
    };
    const labels = MERGE_LABELS.flatMap((l) => ["-L", l]);
    const args = ["merge-file", "-p", "--diff3", ...labels, at("ours", ours), at("base", base), at("theirs", theirs)];
    try {
      return { text: decode(execFileSync("git", args), "git merge-file's output"), conflicts: 0 };
    } catch (err) {
      const clashes = typeof err.status === "number" && err.status > 0 && err.status < 128;
      if (clashes) return { text: decode(err.stdout, "git merge-file's output"), conflicts: err.status };
      throw err;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Strict UTF-8 that keeps a byte order mark, as Python's decoder does: a file
// that is not UTF-8 stops the update instead of being written back damaged.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function decode(bytes, what) {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new Error(`${what} is not UTF-8 text`);
  }
}

// The repo's text at a path with \r\n turned into \n, or null when it has none.
function reader(root) {
  return (path) => {
    let bytes;
    try {
      bytes = readFileSync(join(root, ...path.split("/")));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
    return decode(bytes, path).replace(/\r\n/g, "\n");
  };
}

function put(root, path, text, flag = "w") {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, { encoding: "utf8", flag });
}

// What sits at a path without following a link: "link", "other" or null.
function entry(root, path) {
  const stat = lstatSync(join(root, ...path.split("/")), { throwIfNoEntry: false });
  if (!stat) return null;
  return stat.isSymbolicLink() ? "link" : "other";
}

// Binds the saved answers with today's templates and the saved year, writes
// what merged cleanly, stages new files the repo already has and conflicts,
// and records the new pristine render. `bindWith(answers, { year, version })`
// returns a bind. Returns every outcome list plus `skipped`: staged copies
// left from before, which stay as they were.
export async function runUpdate(root, { bindWith, version }) {
  const read = reader(root);
  const [answers, saved] = [ANSWERS, PRISTINE].map(read);
  if (answers === null || saved === null) {
    throw new Error(`${ANSWERS} or ${PRISTINE} is missing: this repo was not set up with /bindwright:setup`);
  }
  const pristine = JSON.parse(saved);
  const bad = Object.keys(pristine.files).filter((p) => !safe(p));
  if (bad.length) throw new Error(`Refusing paths outside the repo in ${PRISTINE}: ${bad.join(", ")}`);
  const rendered = await bindWith(JSON.parse(answers), { year: pristine.year, version });
  const owned = ownedPatterns(read(OWNED) ?? "");
  const plan = planUpdate(rendered, pristine, { readRepo: read, owned, merge: gitMerge, version });
  // Every check before the first write, so a refusal leaves the repo as it was.
  const targets = [...plan.write.map(([path]) => path), PRISTINE];
  const links = targets.filter((path) => entry(root, path) === "link");
  if (links.length) throw new Error(`Refusing to write through a symbolic link: ${links.join(", ")}`);
  const skipped = plan.stage.filter(([path]) => entry(root, path) !== null).map(([path]) => path.slice(STAGING.length));
  for (const path of skipped) {
    // The old staged copy is unsettled, so its file keeps the old base and the next update stages it again.
    if (path in pristine.files) plan.pristine.files[path] = pristine.files[path];
    else delete plan.pristine.files[path];
  }
  for (const [path, text] of plan.write) put(root, path, text);
  for (const [path, text] of plan.stage) {
    if (!skipped.includes(path.slice(STAGING.length))) put(root, path, text, "wx");
  }
  put(root, PRISTINE, stateJson(plan.pristine));
  return { ...Object.fromEntries(OUTCOMES.map((o) => [o, plan[o]])), skipped };
}
