// The setup code and the writer, in both engines. A code the page makes reads
// back as the same answers in both decoders, both refuse the same bad codes
// with the same message, and the two commands write the same files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bind, STAGING as BIND_STAGING } from "../bind.js";
import { defaults } from "../model.js";
import { PREFIX, encodeSetupCode, decodeSetupCode } from "../setupcode.js";
import { applyFiles, STAGING } from "../apply.js";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(engine, "..");
const noPython = !python && "needs Python 3.8+";

const codeOf = (text) => PREFIX + Buffer.from(text).toString("base64url");
const named = () => {
  const a = defaults({ team: true, client: true });
  a.project = { ...a.project, name: "Ember.holm_2-x", licenseHolder: "Ana Núñez 😀" };
  return a;
};
const ANSWERS = [defaults(), defaults({ team: true }), named(), {}];

const START = "Invalid setup code: it must start with bw1-";
const LONG = "Invalid setup code: it is too long";
const B64 = "Invalid setup code: the part after the prefix is not base64url";
const JSON_ = "Invalid setup code: it does not hold UTF-8 JSON";
const DEEP = "Invalid setup code: it nests too deeply";
const OBJECT = "Invalid setup code: the answers must be an object";
const BAD = [
  [123, START], [null, START], ["", START], ["bw2-e30", START], ["BW1-e30", START],
  ["bw1-", B64], ["bw1-e30=", B64], ["bw1-e3+", B64], ["bw1-e3/", B64], ["bw1-e 30", B64],
  ["bw1-A", B64], ["bw1-AAAAA", B64],
  [PREFIX + "A".repeat(20001), LONG], [PREFIX + "A".repeat(20000), JSON_], ["bw1-AB", JSON_],
  [codeOf(Buffer.from([0xff])), JSON_], [codeOf(Buffer.from([0xed, 0xa0, 0x80])), JSON_],
  [codeOf(Buffer.from([0xc0, 0xaf])), JSON_],
  [codeOf("\ufeff\ufeff{}"), JSON_], [codeOf('{"a":NaN}'), JSON_], [codeOf("Infinity"), JSON_],
  [codeOf('{"a":1,}'), JSON_], [codeOf("{'a':1}"), JSON_], [codeOf('{"a":"\t"}'), JSON_], [codeOf("{}\u00a0"), JSON_],
  [codeOf("[".repeat(65) + "]".repeat(65)), DEEP], [codeOf('{"a":'.repeat(65) + "1" + "}".repeat(65)), DEEP],
  [codeOf("[]"), OBJECT], [codeOf("null"), OBJECT], [codeOf("1"), OBJECT], [codeOf('"x"'), OBJECT],
  [codeOf("true"), OBJECT], [codeOf("[".repeat(64) + "]".repeat(64)), OBJECT],
];
// Codes both decoders accept that the page would never make.
const ODD = [
  codeOf("\ufeff{}"), codeOf(" {} "), codeOf('{"a":1,"a":2}'), codeOf('{"a":"\\ud800"}'),
  codeOf(`{"a":"${"[".repeat(100)}"}`), codeOf(`{"a":"\\"${"{".repeat(100)}"}`),
];

function decodeJs(code) {
  try {
    return { answers: decodeSetupCode(code) };
  } catch (err) {
    return { error: err.message };
  }
}

// Runs a Python snippet with the engine folder importable; JSON in, JSON out.
function runPython(script, input) {
  const out = spawnSync(python, ["-I", "-c", script, engine], { input: JSON.stringify(input), encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

const PY_DECODE = `
import json, sys
sys.path.insert(0, sys.argv[1])
from setupcode import decode_setup_code, SetupCodeError
out = []
for code in json.loads(sys.stdin.buffer.read().decode("utf-8")):
    try:
        out.append({"answers": decode_setup_code(code)})
    except SetupCodeError as e:
        out.append({"error": str(e)})
sys.stdout.write(json.dumps(out, ensure_ascii=True))
`;

const PY_APPLY = `
import json, sys
sys.path.insert(0, sys.argv[1])
from apply import apply_files, ApplyError
job = json.loads(sys.stdin.buffer.read().decode("utf-8"))
try:
    out = apply_files(job["files"], job["root"])
except ApplyError as e:
    out = {"error": str(e)}
sys.stdout.write(json.dumps(out, ensure_ascii=True))
`;

test("a setup code reads back as the answers it was made from", () => {
  for (const a of ANSWERS) {
    const code = encodeSetupCode(a);
    assert.match(code, /^bw1-[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeSetupCode(code), a);
  }
});

test("bad setup codes are refused with a message that says why", () => {
  for (const [code, message] of BAD) assert.deepEqual(decodeJs(code), { error: message }, String(code).slice(0, 80));
  for (const code of ODD) assert.ok(decodeJs(code).answers, code);
});

test("the Python decoder reads every code as the JS decoder does", { skip: noPython }, () => {
  const codes = [...ANSWERS.map(encodeSetupCode), ...BAD.map(([code]) => code), ...ODD];
  const py = runPython(PY_DECODE, codes);
  for (const [i, code] of codes.entries()) assert.deepEqual(py[i], decodeJs(code), String(code).slice(0, 80));
});

// Every file under `root`, as [relative path, bytes], sorted.
function tree(root, dir = "") {
  return readdirSync(join(root, dir)).sort().flatMap((name) => {
    const rel = dir ? `${dir}/${name}` : name;
    return statSync(join(root, rel)).isDirectory() ? tree(root, rel) : [[rel, readFileSync(join(root, rel))]];
  });
}

function withTemp(fn) {
  const root = mkdtempSync(join(tmpdir(), "bw-setup-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const UNSAFE = ["../x", "a/../b", "/abs", "C:/x", "a\\b", "", "a//b", "./a", "a/.", "x\u0001y", "a:b"];

test("both writers refuse paths outside the repo and write nothing", { skip: noPython }, () => {
  withTemp((root) => {
    const files = [["ok.txt", "x"], ...UNSAFE.map((p) => [p, "x"])];
    const message = `Refusing to write outside the repo: ${UNSAFE.join(", ")}`;
    assert.throws(() => applyFiles(files, join(root, "js")), { message });
    assert.deepEqual(runPython(PY_APPLY, { files, root: join(root, "py") }), { error: message });
    assert.deepEqual(readdirSync(root), []);
  });
});

test("the writer stages in the folder the engine stages in", () => {
  assert.equal(STAGING, BIND_STAGING);
});

test("both writers write new files, stage what exists and skip what is staged", { skip: noPython }, () => {
  withTemp((root) => {
    // No emoji in names: Node 20.9 on Windows fails to create them (ENOENT),
    // and no template has one.
    const files = [
      ["a/b/c.txt", "x\r\ny\n"], ["ñ/中.md", "é 😀"], ["keep.txt", "new"], ["dir", "z"], ["both.md", "new"],
      [`${STAGING}CLAUDE.md`, "staged"], [".bindwright/global/hooks/a.py", "new"],
    ];
    const old = ["keep.txt", "both.md", `${STAGING}both.md`, `${STAGING}CLAUDE.md`, ".bindwright/global/hooks/a.py"];
    for (const side of ["js", "py"]) {
      mkdirSync(join(root, side, "dir"), { recursive: true });
      mkdirSync(join(root, side, ".bindwright", "incoming"), { recursive: true });
      mkdirSync(join(root, side, ".bindwright", "global", "hooks"), { recursive: true });
      for (const name of old) writeFileSync(join(root, side, name), "old");
    }
    const expected = {
      written: ["a/b/c.txt", "ñ/中.md"], staged: ["keep.txt", "dir"],
      skipped: ["both.md", `${STAGING}CLAUDE.md`, ".bindwright/global/hooks/a.py"],
    };
    assert.deepEqual(applyFiles(files, join(root, "js")), expected);
    assert.deepEqual(runPython(PY_APPLY, { files, root: join(root, "py") }), expected);
    assert.deepEqual(tree(join(root, "py")), tree(join(root, "js")));
    const read = (p) => readFileSync(join(root, "js", p), "utf8");
    assert.equal(read("a/b/c.txt"), "x\r\ny\n");
    assert.equal(read("keep.txt"), "old");
    assert.equal(read(`${STAGING}keep.txt`), "new");
    assert.equal(read(`${STAGING}dir`), "z");
    assert.equal(read(`${STAGING}both.md`), "old");
    assert.equal(read(`${STAGING}CLAUDE.md`), "old");
  });
});

const run = (cmd, args) => spawnSync(cmd, args, { cwd: repo, encoding: "utf8" });
const commands = (args) => [
  run(process.execPath, [join(engine, "cli.js"), ...args]),
  run(python, [join(engine, "bind.py"), ...args]),
];

test("both commands bind a setup code to the same output", { skip: noPython }, async () => {
  const code = encodeSetupCode(named());
  const [js, py] = commands(["--code", code, "--year", "2026"]);
  assert.equal(js.status, 0, js.stderr);
  assert.equal(py.stdout, js.stdout);
  const readFile = async (p) => readFileSync(join(repo, p), "utf8");
  const coreFiles = JSON.parse(readFileSync(join(engine, "core-files.json"), "utf8"));
  // The commands record the repo's VERSION, without its "v", in the pristine render.
  const version = readFileSync(join(repo, "VERSION"), "utf8").trim().replace(/^v/, "");
  const files = [...(await bind(named(), { readFile, coreFiles, year: 2026, version })).entries()];
  assert.deepEqual(JSON.parse(js.stdout), { files });

  const refusals = [
    ["--code", "bad"], ["--code"], ["--code", code, "--year", "1_0"], ["--code", codeOf('{"team":"yes"}')],
    ["--code", code, "--adopt"],
  ];
  for (const args of refusals) {
    const [jsBad, pyBad] = commands(args);
    assert.equal(jsBad.status, 1, args.join(" "));
    assert.equal(pyBad.status, 1, args.join(" "));
    assert.equal(pyBad.stdout, jsBad.stdout, args.join(" "));
    assert.ok(JSON.parse(jsBad.stdout).error, args.join(" "));
  }
});

test("both commands write the same files and never overwrite", { skip: noPython }, () => {
  withTemp((root) => {
    const code = encodeSetupCode(named());
    const [js, py] = [
      run(process.execPath, [join(engine, "cli.js"), "--code", code, "--write", join(root, "js")]),
      run(python, [join(engine, "bind.py"), "--code", code, "--write", join(root, "py")]),
    ];
    assert.equal(js.status, 0, js.stderr);
    assert.equal(py.stdout, js.stdout);
    const result = JSON.parse(js.stdout);
    assert.ok(result.written.length > 10);
    assert.deepEqual([result.staged, result.skipped], [[], []]);
    assert.deepEqual(tree(join(root, "py")), tree(join(root, "js")));

    // A second run stages every file the first one wrote in place, and a
    // third finds everything staged already.
    const mine = join(root, "js", "CLAUDE.md");
    writeFileSync(mine, "mine");
    const write = [join(engine, "cli.js"), "--code", code, "--write", join(root, "js")];
    const again = () => JSON.parse(run(process.execPath, write).stdout);
    const inPlace = result.written.filter((p) => !p.startsWith(".bindwright/"));
    const staged = result.written.filter((p) => p.startsWith(".bindwright/"));
    assert.deepEqual(again(), { written: [], staged: inPlace, skipped: staged });
    assert.deepEqual(again(), { written: [], staged: [], skipped: result.written });
    assert.equal(readFileSync(mine, "utf8"), "mine");
  });
});

test("adopt mode stages every file and writes only setup's own folder", { skip: noPython }, () => {
  withTemp((root) => {
    const code = encodeSetupCode(named());
    for (const side of ["js", "py"]) {
      mkdirSync(join(root, side, ".claude", "rules"), { recursive: true });
      writeFileSync(join(root, side, ".claude", "rules", "git.md"), "the project's own rule");
    }
    const [js, py] = [
      run(process.execPath, [join(engine, "cli.js"), "--code", code, "--write", join(root, "js"), "--adopt"]),
      run(python, [join(engine, "bind.py"), "--code", code, "--write", join(root, "py"), "--adopt"]),
    ];
    assert.equal(js.status, 0, js.stderr);
    assert.equal(py.stdout, js.stdout);
    assert.deepEqual(tree(join(root, "py")), tree(join(root, "js")));
    const result = JSON.parse(js.stdout);
    assert.deepEqual(result.written.filter((p) => !p.startsWith(".bindwright/")), []);
    assert.ok(result.written.includes(".bindwright/pristine.json"));
    assert.ok(result.staged.includes(".claude/rules/git.md") && result.staged.length > 10);
    assert.deepEqual(result.skipped, []);
    const outside = tree(join(root, "js")).map(([p]) => p).filter((p) => !p.startsWith(".bindwright/"));
    assert.deepEqual(outside, [".claude/rules/git.md"]);
    assert.equal(readFileSync(join(root, "js", ".claude", "rules", "git.md"), "utf8"), "the project's own rule");
  });
});
