// The code-size check a bind ships (.github/scripts/size_check.py), run on
// throwaway git repos. A stand-in lizard reads its functions from the
// LIZARD_STUB variable, so the function rows run the same with or without the
// real lizard installed; Python's -S keeps the real one out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { python } from "./python.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(repo, "_core", "project-template", ".github", "scripts", "size_check.py");
const RULE = join(repo, "_core", "project-template", ".claude", "rules", "code-size.md");
const skip = !python && "needs Python 3.8+";

const SMALL_RULE = `---
paths:
  - "**/*.{py,rb,dart}"
---
| Construct | Soft | Hard |
|---|---|---|
| Parameters | 2 | 3 |
| Cyclomatic complexity per function | 3 | 5 |

| Language | File | Function | Line length |
|---|---|---|---|
| Python | 10 / 20 | 5 / 8 | 30 / 40 |
| Other | 1 000 / 1 500 (.x 9) | 50 / 100 | 100 / 120 |
`;

const STUB = `import json, os
class _F:
    def __init__(self, d):
        self.name, self.start_line, self.end_line = d["name"], 1, d["length"]
        self.cyclomatic_complexity = d.get("ccn", 1)
        self.parameters = d.get("names") or ["p"] * d.get("params", 0)
        self.parameter_count = len(self.parameters)
class _R:
    def __init__(self, fns): self.function_list = fns
def get_reader_for(path):
    return None if path.endswith(".dart") else object()
def analyze_file(path):
    table = json.loads(os.environ.get("LIZARD_STUB", "{}"))
    key = os.path.relpath(path, os.getcwd()).replace(os.sep, "/")
    return _R([_F(d) for d in table.get(key, [])])
`;

const lines = (n, width = 1) => `${Array.from({ length: n }, () => "x".repeat(width)).join("\n")}\n`;

// A git repo holding the script, a rule and the given files. Only the given
// files are staged, so the script and the stand-in are not measured.
function makeRepo(files, rule = SMALL_RULE) {
  const root = mkdtempSync(join(tmpdir(), "size-check-"));
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  mkdirSync(join(root, ".github", "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(root, ".github", "scripts", "size_check.py"));
  put(".claude/rules/code-size.md", rule);
  put("stub/lizard.py", STUB);
  for (const [path, text] of Object.entries(files)) put(path, text);
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["add", "--", ...Object.keys(files)], { cwd: root });
  return { root, put, git: (...args) => spawnSync("git", args, { cwd: root }) };
}

function check(root, args = [], { stub = {}, lizard = true } = {}) {
  const env = { ...process.env, LIZARD_STUB: JSON.stringify(stub), PYTHONPATH: lizard ? join(root, "stub") : "" };
  const r = spawnSync(python, ["-S", ".github/scripts/size_check.py", ...args], { cwd: root, env, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("a new hard breach fails, and the baseline lets it stay but never grow", { skip }, () => {
  const { root, put, git } = makeRepo({ "app.py": lines(21) });
  let r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SIZE_BREACH_NEW: app\.py: file - = 21 \(hard limit 20\)/);

  r = check(root, ["--write-baseline"]);
  assert.equal(r.code, 0, r.out);
  assert.match(readFileSync(join(root, ".github/size-check/baseline.txt"), "utf8"), /^app\.py\|file\|-\|21$/m);
  git("add", ".github/size-check/baseline.txt");
  assert.equal(check(root).code, 0);

  put("app.py", lines(22));
  r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SIZE_BREACH_GREW: app\.py: file - = 22 \(baseline 21\)/);

  // Once the code complies, its baseline line must go, or it would excuse the next breach.
  put("app.py", lines(20));
  r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SIZE_LEDGER_LEFTOVER: app\.py\|file\|- is listed 1 times in the baseline but breaches 0 times/);
  put(".github/size-check/baseline.txt", "# path|construct|name|value\n");
  r = check(root, ["--report"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /soft: app\.py: file - = 20 \(soft limit 10\)/);
});

test("a leftover same-named baseline line cannot excuse a new breach", { skip }, () => {
  const { root, put, git } = makeRepo({ "app.py": "x\n" });
  put(".github/size-check/baseline.txt", "app.py|function|(anonymous)|30\napp.py|function|(anonymous)|20\n");
  git("add", ".github/size-check/baseline.txt");
  // The 30-line one shrank below the limit and the 20-line one grew to 25.
  const r = check(root, [], { stub: { "app.py": [{ name: "(anonymous)", length: 25 }] } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SIZE_LEDGER_LEFTOVER: app\.py\|function\|\(anonymous\) is listed 2 times .* breaches 1 times/);
});

test("each limit trips one step past its hard value, not at it", { skip }, () => {
  const stub = {
    "ok.py": [
      { name: "fine", length: 8, ccn: 5, params: 3 }, { name: "method", length: 2, names: ["self", "a", "b", "c"] },
    ],
    "bad.py": [
      { name: "long", length: 9 }, { name: "branchy", length: 2, ccn: 6 }, { name: "wide", length: 2, params: 4 },
      { name: "selfish", length: 2, names: ["a", "self", "b", "c"] },
    ],
  };
  const { root } = makeRepo({ "ok.py": lines(20, 40), "bad.py": `${"y".repeat(41)}\n${"y".repeat(41)}\n` });
  const r = check(root, [], { stub });
  assert.equal(r.code, 1, r.out);
  assert.doesNotMatch(r.out, /ok\.py/);
  assert.match(r.out, /bad\.py: function long = 9 \(hard limit 8\)/);
  assert.match(r.out, /bad\.py: ccn branchy = 6 \(hard limit 5\)/);
  assert.match(r.out, /bad\.py: params wide = 4 \(hard limit 3\)/);
  // Only a leading self or cls is the method's own; a later one counts.
  assert.match(r.out, /bad\.py: params selfish = 4 \(hard limit 3\)/);
  assert.match(r.out, /bad\.py: line_length - = 2 \(hard limit 40\)/);
});

test("a second same-named breach is new, not hidden behind the recorded one", { skip }, () => {
  const one = [{ name: "(anonymous)", length: 12 }];
  const { root, git } = makeRepo({ "app.py": "x\n" });
  assert.equal(check(root, ["--write-baseline"], { stub: { "app.py": one } }).code, 0);
  git("add", ".github/size-check/baseline.txt");
  assert.equal(check(root, [], { stub: { "app.py": one } }).code, 0);

  const two = [...one, { name: "(anonymous)", length: 9 }];
  let r = check(root, [], { stub: { "app.py": two } });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SIZE_BREACH_NEW: app\.py: function \(anonymous\) = 9/);
  r = check(root, [], { stub: { "app.py": [{ name: "(anonymous)", length: 13 }] } });
  assert.match(r.out, /SIZE_BREACH_GREW: app\.py: function \(anonymous\) = 13 \(baseline 12\)/);
});

test("a name holding the ledger's separator reads back from the baseline", { skip }, () => {
  const stub = { "app.py": [{ name: "operator|=", length: 12 }] };
  const { root, git } = makeRepo({ "app.py": "x\n" });
  assert.equal(check(root, ["--write-baseline"], { stub }).code, 0);
  git("add", ".github/size-check/baseline.txt");
  const r = check(root, [], { stub });
  assert.equal(r.code, 0, r.out);
});

test("a rule that names no file type fails instead of passing empty", { skip }, () => {
  const { root } = makeRepo({ "app.py": "x\n" }, "# Code size\n\nNo tables.\n");
  const r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SIZE_RULE_EMPTY/);
});

test("tests get half again the file limit, and skipped folders are out of scope", { skip }, () => {
  const { root } = makeRepo({
    "tests/test_app.py": lines(30), "app_test.py": lines(31),
    "vendor/big.py": lines(500), "node_modules/x/big.py": lines(500),
  });
  const r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.doesNotMatch(r.out, /tests\/test_app\.py|vendor|node_modules/);
  assert.match(r.out, /app_test\.py: file - = 31 \(hard limit 30\)/);
});

test("exceptions cover a breach with a reason, and stale entries fail", { skip }, () => {
  const { root } = makeRepo({
    "gen.py": lines(25),
    "big.py": lines(25),
    ".github/size-check/exceptions.txt":
      "# why\ngen.py|file|-|generated table\nbig.py|file|*|codegen | see Makefile\ngone.py|file|*|deleted file\n",
  });
  const r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.doesNotMatch(r.out, /SIZE_BREACH/);
  assert.match(r.out, /SIZE_LEDGER_STALE: gone\.py\|file\|\* names a file that is no longer tracked/);
});

test("without lizard the check fails loudly and writes no baseline", { skip }, () => {
  const { root } = makeRepo({ "app.py": lines(3) });
  let r = check(root, [], { lizard: false });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /SIZE_CHECK_DEGRADED/);
  r = check(root, ["--write-baseline"], { lizard: false });
  assert.equal(r.code, 1, r.out);
  assert.ok(!existsSync(join(root, ".github/size-check/baseline.txt")));
});

test("a language lizard cannot read still gets its file rows, with a note", { skip }, () => {
  const { root } = makeRepo({ "main.dart": lines(1501) });
  const r = check(root, ["--report"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /main\.dart: file - = 1501 \(hard limit 1500\)/);
  assert.match(r.out, /note: lizard reads no functions from \.dart files/);
});

test("the shipped rule's tables parse: named rows, Other, and spaced thousands", { skip }, () => {
  const files = { "a.py": lines(1001), "b.rb": lines(1201), "c.h": lines(1501), "d.ts": lines(800) };
  const { root } = makeRepo(files, readFileSync(RULE, "utf8"));
  const r = check(root);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /a\.py: file - = 1001 \(hard limit 1000\)/);
  assert.match(r.out, /b\.rb: file - = 1201 \(hard limit 1200\)/);
  assert.match(r.out, /c\.h: file - = 1501 \(hard limit 1500\)/);
  assert.doesNotMatch(r.out, /d\.ts/);
});
