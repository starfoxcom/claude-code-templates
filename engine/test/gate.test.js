// A bound project gets the review gate this repo runs: bound with this repo's
// own choices, the workflows and the gate's scripts come out byte for byte as
// the live copies, and the settings file holds the gate's defaults. Other
// choices flip only the two switches they map to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bind } from "../bind.js";
import { defaults } from "../model.js";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(engine, "..");
const live = (p) => readFileSync(join(repo, p), "utf8").replace(/\r\n/g, "\n");
const readFile = async (p) => readFileSync(join(repo, p), "utf8");
const coreFiles = JSON.parse(readFileSync(join(engine, "core-files.json"), "utf8"));
const bound = (answers) => bind(answers, { readFile, coreFiles, year: 2026 });

const SHIPPED = [
  ".github/workflows/claude-code-review.yml",
  ".github/workflows/claude.yml",
  ".github/scripts/review_gate.py",
  ".github/scripts/setup-review-gate.sh",
  ".github/scripts/pin_check.py",
  ".github/workflows/pin-check.yml",
];
const GATE_FILES = [...SHIPPED, ".github/review-gate.yml", ".github/review-guide.md"];

// This repo's own choices: Gitflow on main and develop, both review tiers,
// automatic escalation and the attribution guard.
const OWN = defaults({ team: true });

// The settings as the gate reads them, from the gate script itself.
function settings(text) {
  const dir = mkdtempSync(join(tmpdir(), "bw-gate-"));
  try {
    const file = join(dir, "review-gate.yml");
    writeFileSync(file, text);
    const r = spawnSync(python, ["-I", join(repo, ".github", "scripts", "review_gate.py"), "settings", "--file", file],
      { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("this repo's choices bind the live workflows and scripts byte for byte", async () => {
  const out = await bound(OWN);
  for (const path of SHIPPED) assert.equal(out.get(path), live(path), path);
});

test("the bound settings hold the gate's defaults", { skip: !python && "needs Python 3.8+" }, async () => {
  const out = await bound(OWN);
  assert.equal(settings(out.get(".github/review-gate.yml")), settings(""));
});

test("the escalation and attribution choices map to the two switches", { skip: !python && "needs Python 3.8+" }, async () => {
  const own = settings((await bound(OWN)).get(".github/review-gate.yml"));
  const off = structuredClone(OWN);
  off.advanced = { ...off.advanced, deepEscalation: false, attributionGuard: false };
  const got = settings((await bound(off)).get(".github/review-gate.yml"));
  const flipped = own.replace("prescreen_attribution=on", "prescreen_attribution=off").replace("escalate_auto=on", "escalate_auto=off");
  assert.notEqual(flipped, own);
  assert.equal(got, flipped);
});

test("the guide names the project and follows the escalation choice", async () => {
  const guide = (await bound(OWN)).get(".github/review-guide.md");
  assert.match(guide, /\*\*my-project\*\*/);
  assert.match(guide, /## Also escalate when the diff includes/);
  const off = structuredClone(OWN);
  off.advanced = { ...off.advanced, deepEscalation: false };
  const manual = (await bound(off)).get(".github/review-guide.md");
  assert.doesNotMatch(manual, /## Also escalate when the diff includes/);
  assert.match(manual, /Automatic escalation is off/);
});

test("a trunk project's routine review runs on its one branch", async () => {
  const trunk = structuredClone(OWN);
  trunk.advanced = { ...trunk.advanced, branching: "trunk" };
  const review = (await bound(trunk)).get(".github/workflows/claude-code-review.yml");
  assert.match(review, /^ {4}branches: \[main, main\]$/m);
});

test("without AI review no gate file is bound", async () => {
  const none = structuredClone(OWN);
  none.advanced = { ...none.advanced, aiReview: false };
  const out = await bound(none);
  for (const path of GATE_FILES) assert.equal(out.has(path), false, path);
});
