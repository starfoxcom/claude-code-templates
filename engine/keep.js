// The parts of a set-up repo that belong to the project, which
// /bindwright:update never changes: whole files listed in .bindwright/owned,
// and sections of shared files between keep markers. keep.py is the Python
// twin; a test runs both on the same cases.

export const OWNED = ".bindwright/owned";

// One pattern per line, a repo path from the root; blank lines and lines
// starting with # are skipped. `*` matches within one path segment, `**`
// across segments, `?` one character other than "/", and a pattern ending
// in "/" covers everything under that folder.
export function ownedPatterns(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.replace(/^\/+/, ""));
}

const SPECIAL = /[.+^${}()|[\]\\]/;

function patternRegex(pattern) {
  let out = "";
  const p = pattern.endsWith("/") ? `${pattern}**` : pattern;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      // "**/" also matches no folder at all, so "a/**/b" covers "a/b".
      out += p[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += p[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += SPECIAL.test(c) ? `\\${c}` : c;
    }
  }
  // "u": `?` is one character, as in Python, not half of an emoji.
  return new RegExp(`^${out}$`, "su");
}

// True when the repo path matches any pattern from ownedPatterns.
export function isOwned(path, patterns) {
  return patterns.some((p) => patternRegex(p).test(path));
}

const OPEN = "bindwright:keep";
const CLOSE = "bindwright:end-keep";

// A line holding `bindwright:keep` opens a kept section and a line holding
// `bindwright:end-keep` closes it, inside whatever comment the file's
// language uses. Returns [first, last] line numbers (1-based, marker lines
// included). Nested, unopened or unclosed markers fail, naming the line.
export function keptSections(text, file) {
  const sections = [];
  let open = 0;
  text.split("\n").forEach((line, i) => {
    const n = i + 1;
    if (line.includes(CLOSE)) {
      if (!open) throw new Error(`${file} line ${n}: ${CLOSE} without a ${OPEN} before it`);
      sections.push([open, n]);
      open = 0;
    } else if (line.includes(OPEN)) {
      if (open) throw new Error(`${file} line ${n}: ${OPEN} inside the section opened on line ${open}`);
      open = n;
    }
  });
  if (open) throw new Error(`${file} line ${open}: ${OPEN} is never closed`);
  return sections;
}
