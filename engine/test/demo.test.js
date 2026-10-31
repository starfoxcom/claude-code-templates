// The demo project the page's before-and-after panes are recorded on: it
// runs, its tests pass, and every planted problem in recordings/planted.json
// is still there, so a well-meant cleanup cannot quietly empty a demo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const demo = join(repo, "demo");
const planted = JSON.parse(readFileSync(join(repo, "recordings", "planted.json"), "utf8")).planted;
const needsTs = { skip: !process.features?.typescript && "needs Node 23.6+ (runs TypeScript as is)" };

test("every planted problem is still in the demo", () => {
  assert.ok(planted.length > 0);
  assert.equal(new Set(planted.map((p) => p.id)).size, planted.length, "ids are unique");
  for (const p of planted) {
    const file = join(repo, ...p.file.split("/"));
    assert.ok(existsSync(file), `${p.id}: ${p.file} is missing`);
    assert.match(readFileSync(file, "utf8"), new RegExp(p.evidence), `${p.id}: no longer planted in ${p.file}`);
  }
});

test("the demo app runs and its own tests pass", needsTs, () => {
  const tests = spawnSync(process.execPath, ["--test"], { cwd: demo, encoding: "utf8" });
  assert.equal(tests.status, 0, tests.stdout + tests.stderr);
  const run = spawnSync(process.execPath, ["src/cli.ts", "examples/dinner.json"], { cwd: demo, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  // The lost cent is part of the demo: the shares add up to more than the total.
  assert.match(run.stdout, /Total \(with 18% tip\): \$53\.69/);
});

// Only where `npm install` has run in demo/; the planted problems are not type errors.
const tsc = join(demo, "node_modules", "typescript", "bin", "tsc");
test("the demo type-checks clean", { skip: !existsSync(tsc) && "run npm install in demo/ first" }, () => {
  const out = spawnSync(process.execPath, [tsc, "--noEmit"], { cwd: demo, encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout + out.stderr);
});
