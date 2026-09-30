// The Python twin (bind.py) must produce what the JS engine produces, byte for
// byte, and fail with the same message on the same bad answers. One Python
// run binds every case, so the test stays fast on Windows too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bind } from "../bind.js";
import {
  defaults, LICENSES, CODE_RESEARCH_TOOLS, PRECOMMIT_MANAGERS, ARCHITECTURES, MERGE_STYLES, HOOK_LOCATIONS, DENY_PROFILES,
} from "../model.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(engine, "..");
const cache = new Map();
const readFile = async (p) => {
  if (!cache.has(p)) cache.set(p, readFileSync(join(repo, p), "utf8"));
  return cache.get(p);
};
const coreFiles = JSON.parse(readFileSync(join(engine, "core-files.json"), "utf8"));

// The interpreter's full path, found by a throwaway Node process. On Windows
// `python` is often an App Execution Alias, and once a process has started one,
// Node 20 aborts on its next start of an interpreter by full path
// (AssignProcessToJobObject: (87)). This process starts interpreters by full path only.
const python = spawnSync(process.execPath, ["-e", `
  const { spawnSync } = require("node:child_process");
  for (const cmd of ["python", "python3"]) {
    const r = spawnSync(cmd, ["-c", "import sys; assert sys.version_info >= (3, 8); print(sys.executable)"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) { process.stdout.write(r.stdout.trim()); break; }
  }`], { encoding: "utf8" }).stdout || undefined;

const clone = (x) => JSON.parse(JSON.stringify(x));

// Every advanced choice and switch, one at a time, from each of the four presets.
function oneAtATime() {
  const choices = {
    codeResearch: Object.keys(CODE_RESEARCH_TOOLS), precommit: ["none", ...PRECOMMIT_MANAGERS], architecture: ARCHITECTURES,
    branching: ["gitflow", "trunk"], mergeStyle: MERGE_STYLES, hookLocation: HOOK_LOCATIONS, denyProfile: DENY_PROFILES,
  };
  const switches = ["aiReview", "deepEscalation", "uiRule", "confidentiality", "cleanRoom", "plainWriting", "devIsDefault", "attributionGuard"];
  const cases = [];
  for (const team of [false, true]) {
    for (const client of [false, true]) {
      const base = defaults({ team, client });
      cases.push(base);
      for (const [key, values] of Object.entries(choices)) {
        for (const v of values) if (v !== base.advanced[key]) cases.push({ ...clone(base), advanced: { ...base.advanced, [key]: v } });
      }
      for (const key of switches) cases.push({ ...clone(base), advanced: { ...base.advanced, [key]: !base.advanced[key] } });
      for (const license of Object.keys(LICENSES)) {
        if (license !== base.project.license) cases.push({ ...clone(base), project: { ...base.project, license } });
      }
      const named = clone(base);
      named.project = { ...named.project, name: "Ember.holm_2-x", repoUrl: "https://example.com/r", licenseHolder: "Ana Núñez 😀" };
      named.advanced.plainWriting = true;
      // U+0085 passes JavaScript's trim() but not Python's strip().
      named.advanced.shippedTextPaths = ["**/*.gd", "i18n/$&-$1.json", "docs/#public/**", "notes\u0085"];
      cases.push(named);
    }
  }
  return cases;
}

// Mixed settings from a fixed seed, so a failure always reproduces.
function seeded(count) {
  let s = 0x5eed;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const bool = () => rand() < 0.5;
  return Array.from({ length: count }, () => {
    const a = defaults({ team: bool(), client: bool() });
    a.project.license = pick(Object.keys(LICENSES));
    Object.assign(a.advanced, {
      aiReview: bool(), deepEscalation: bool(), uiRule: bool(), confidentiality: bool(), cleanRoom: bool(), plainWriting: bool(),
      devIsDefault: bool(), attributionGuard: bool(),
      codeResearch: pick(Object.keys(CODE_RESEARCH_TOOLS)), precommit: pick(["none", ...PRECOMMIT_MANAGERS]),
      architecture: pick(ARCHITECTURES), branching: pick(["gitflow", "trunk"]), mergeStyle: pick(MERGE_STYLES),
      hookLocation: pick(HOOK_LOCATIONS), denyProfile: pick(DENY_PROFILES),
      shippedTextPaths: bool() ? null : ["src/**/*.ts", "README*"],
    });
    return a;
  });
}

// Bad answers both engines must refuse with the same message.
function refused() {
  const edits = [
    (a) => { a.team = "yes"; },
    (a) => { a.advanced.cleanRoom = 1; },
    (a) => { delete a.advanced.uiRule; },
    (a) => { a.project.name = "-leading-dash"; },
    (a) => { a.project.name = "name\n"; },
    (a) => { a.project.name = 123; },
    (a) => { a.project.repoUrl = null; },
    (a) => { a.project.license = "toString"; },
    (a) => { a.project.license = ["MIT", "x"]; },
    (a) => { a.advanced.codeResearch = "constructor"; },
    (a) => { a.advanced.codeResearch = { name: "x" }; },
    (a) => { a.advanced.precommit = "npm"; },
    (a) => { a.advanced.architecture = null; },
    (a) => { a.advanced.branching = "github-flow"; },
    (a) => { a.advanced.mergeStyle = true; },
    (a) => { a.advanced.devIsDefault = "false"; },
    (a) => { a.advanced.hookLocation = 2.5; },
    (a) => { a.advanced.attributionGuard = null; },
    (a) => { a.advanced.denyProfile = "paranoid"; },
    (a) => { a.advanced.shippedTextPaths = []; },
    (a) => { a.advanced.shippedTextPaths = ["﻿docs/**"]; },
    (a) => { a.advanced.shippedTextPaths = ["😀".repeat(101)]; },
  ];
  return edits.map((edit) => { const a = defaults(); edit(a); return a; });
}

// First differing file and line, so a failure names what to fix.
function firstDifference(js, py) {
  const jsKeys = js.map(([k]) => k);
  const pyKeys = py.map(([k]) => k);
  if (jsKeys.join("\n") !== pyKeys.join("\n")) return `file lists differ:\n  js: ${jsKeys.join(", ")}\n  py: ${pyKeys.join(", ")}`;
  for (let i = 0; i < js.length; i++) {
    if (js[i][1] === py[i][1]) continue;
    const a = js[i][1].split("\n");
    const b = py[i][1].split("\n");
    const line = a.findIndex((l, n) => l !== b[n]);
    const n = line === -1 ? a.length : line;
    return `${js[i][0]} line ${n + 1}:\n  js: ${JSON.stringify(a[n])}\n  py: ${JSON.stringify(b[n])}`;
  }
  return null;
}

test("the Python engine binds exactly what the JS engine binds", { skip: !python && "needs Python 3.8+" }, async () => {
  const cases = [...oneAtATime(), ...seeded(40), ...refused()];
  const out = spawnSync(python, [join(engine, "bind.py"), "--batch"], {
    input: JSON.stringify(cases.map((answers) => ({ answers, year: 2026 }))), encoding: "utf8", maxBuffer: 1 << 30,
  });
  assert.equal(out.status, 0, out.stderr);
  const results = JSON.parse(out.stdout);
  assert.equal(results.length, cases.length);

  let bound = 0;
  for (const [i, answers] of cases.entries()) {
    const label = `case ${i}: ${JSON.stringify(answers)}`;
    let js;
    try {
      js = { files: [...(await bind(clone(answers), { readFile, coreFiles, year: 2026 })).entries()] };
    } catch (err) {
      js = { error: err.message };
    }
    const py = results[i];
    if (js.error || py.error) {
      assert.equal(py.error, js.error, label);
      continue;
    }
    assert.equal(firstDifference(js.files, py.files), null, label);
    bound++;
  }
  assert.ok(bound > 150, `only ${bound} cases bound; the rest were refused`);
  assert.equal(cases.length - bound, refused().length, "every refused case is one of the bad answers");
});
