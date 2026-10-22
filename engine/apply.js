// Writes a bind's files into a repo, never over an existing file. When the
// repo already has a file, the new text goes to STAGING under the same path
// instead, for setup to merge. A file whose staged copy exists too, or one in
// .bindwright/ (setup's own working files), is skipped.
// Node only (the browser offers a zip instead); apply.py is the Python twin.

import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The folder bind.js stages merge targets in. bind.js runs in the browser
// too, so it cannot import this file; a test keeps the two in step.
export const STAGING = ".bindwright/incoming/";

// Relative paths of plain segments only: no drive, root, backslash, "." or "..".
const SEGMENT = /^[^/\\:\x00-\x1f]+$/;

function safe(path) {
  return path.split("/").every((p) => SEGMENT.test(p) && p !== "." && p !== "..");
}

function exists(target) {
  try {
    lstatSync(target);
    return true;
  } catch {
    return existsSync(target);
  }
}

function write(target, text) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, { encoding: "utf8", flag: "wx" });
}

// files: [[path, text], ...]. Returns { written, staged, skipped }, each a
// list of the given paths; a staged file sits at STAGING + path.
export function applyFiles(files, root) {
  const bad = files.map(([path]) => path).filter((path) => !safe(path));
  if (bad.length) throw new Error(`Refusing to write outside the repo: ${bad.join(", ")}`);
  const result = { written: [], staged: [], skipped: [] };
  const at = (path) => join(root, ...path.split("/"));
  for (const [path, text] of files) {
    if (!exists(at(path))) {
      write(at(path), text);
      result.written.push(path);
    } else if (!path.startsWith(".bindwright/") && !exists(at(STAGING + path))) {
      write(at(STAGING + path), text);
      result.staged.push(path);
    } else {
      result.skipped.push(path);
    }
  }
  return result;
}
