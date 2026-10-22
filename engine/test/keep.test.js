// The project-owned parts of a repo (keep.js): the owned-file patterns and
// the keep markers, and the Python twin (keep.py) agreeing on every case.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ownedPatterns, isOwned, keptSections } from "../keep.js";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");

const OWNED_TEXT = [
  "# Files this project keeps as its own",
  "",
  "  .github/workflows/deploy.yml  ",
  "/docs/internal/",
  ".claude/rules/*.md",
  "src/**/gen_?.ts",
  "**/secret[1].txt",
  "a.b+c(d)",
].join("\n");

const PATHS = [
  [".github/workflows/deploy.yml", true],
  [".github/workflows/deploy.yaml", false],
  ["docs/internal/a.md", true],
  ["docs/internal/deep/b.md", true],
  ["docs/internals.md", false],
  [".claude/rules/git.md", true],
  [".claude/rules/sub/git.md", false],
  ["src/gen_a.ts", true],
  ["src/x/y/gen_b.ts", true],
  ["src/gen_ab.ts", false],
  ["src/gen_😀.ts", true],
  ["secret[1].txt", true],
  ["deep/er/secret[1].txt", true],
  ["secret1.txt", false],
  ["a.b+c(d)", true],
  ["aXb+c(d)", false],
];

const SECTIONS = [
  ["one", "a\n<!-- bindwright:keep -->\nmine\n<!-- bindwright:end-keep -->\nb\n# bindwright:keep\n# bindwright:end-keep\n"],
  ["none", "no markers here\n"],
  ["unopened", "x\n# bindwright:end-keep\n"],
  ["nested", "# bindwright:keep\n# bindwright:keep\n# bindwright:end-keep\n"],
  ["unclosed", "a\nb\n// bindwright:keep\n"],
];

function sectionsJs(text, file) {
  try {
    return { sections: keptSections(text, file) };
  } catch (err) {
    return { error: err.message };
  }
}

test("owned patterns skip comments and blanks and match from the repo root", () => {
  const patterns = ownedPatterns(OWNED_TEXT);
  assert.deepEqual(patterns, [
    ".github/workflows/deploy.yml", "docs/internal/", ".claude/rules/*.md", "src/**/gen_?.ts", "**/secret[1].txt", "a.b+c(d)",
  ]);
  for (const [path, owned] of PATHS) assert.equal(isOwned(path, patterns), owned, path);
  assert.equal(isOwned("anything", []), false);
});

test("keep markers give each section's lines and refuse broken ones", () => {
  const got = Object.fromEntries(SECTIONS.map(([file, text]) => [file, sectionsJs(text, file)]));
  assert.deepEqual(got.one, { sections: [[2, 4], [6, 7]] });
  assert.deepEqual(got.none, { sections: [] });
  assert.deepEqual(got.unopened, { error: "unopened line 2: bindwright:end-keep without a bindwright:keep before it" });
  assert.deepEqual(got.nested, { error: "nested line 2: bindwright:keep inside the section opened on line 1" });
  assert.deepEqual(got.unclosed, { error: "unclosed line 3: bindwright:keep is never closed" });
});

const PY = `
import json, sys
sys.path.insert(0, sys.argv[1])
from keep import owned_patterns, is_owned, kept_sections, KeepError
job = json.loads(sys.stdin.buffer.read().decode("utf-8"))
patterns = owned_patterns(job["owned"])
sections = []
for file, text in job["sections"]:
    try:
        sections.append({"sections": kept_sections(text, file)})
    except KeepError as e:
        sections.append({"error": str(e)})
out = {"patterns": patterns, "owned": [is_owned(p, patterns) for p in job["paths"]], "sections": sections}
sys.stdout.write(json.dumps(out, ensure_ascii=True))
`;

// Seeded paths from a small alphabet, so the sweep hits slashes, dots and
// pattern characters often. Prints the seed on failure.
function randomPaths(seed, count) {
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const chars = ["a", "b", "/", ".", "_", "-", "gen", "src", "docs", "internal", "😀", "?", "*"];
  return Array.from({ length: count }, () => Array.from({ length: 1 + Math.floor(next() * 8) }, () => chars[Math.floor(next() * chars.length)]).join(""));
}

test("the Python twin reads patterns and markers as the JS one does", { skip: !python && "needs Python 3.8+" }, () => {
  const seed = 415;
  const paths = [...PATHS.map(([p]) => p), ...randomPaths(seed, 400)];
  const job = { owned: `${OWNED_TEXT}\nsrc/*\n**/b\n*.?`, paths, sections: SECTIONS };
  const out = spawnSync(python, ["-I", "-c", PY, engine], { input: JSON.stringify(job), encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  const py = JSON.parse(out.stdout);
  const patterns = ownedPatterns(job.owned);
  assert.deepEqual(py.patterns, patterns);
  paths.forEach((p, i) => assert.equal(py.owned[i], isOwned(p, patterns), `seed ${seed}: ${p}`));
  assert.deepEqual(py.sections, SECTIONS.map(([file, text]) => sectionsJs(text, file)));
});
