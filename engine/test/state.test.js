// The setup state a bind writes into .bindwright/: the answers as given and
// the pristine render, the base /bindwright:update merges against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bind, ANSWERS, PRISTINE, STAGING, GLOBAL } from "../bind.js";
import { defaults } from "../model.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readFile = async (p) => readFileSync(join(repo, p), "utf8");
const coreFiles = JSON.parse(readFileSync(join(repo, "engine", "core-files.json"), "utf8"));

function teamAnswers() {
  const a = defaults({ team: true, client: true });
  // Text outside ASCII and JSON's own escapes, so the saved bytes are tested too.
  a.project.licenseHolder = 'José "Ünï" \\ ✓ 𝄞';
  return a;
}

test("a bind saves its answers exactly as given", async () => {
  const a = teamAnswers();
  const files = await bind(a, { readFile, coreFiles, year: 2026, version: "2.0.0" });
  assert.equal(files.get(ANSWERS), `${JSON.stringify(a, null, 2)}\n`);
  assert.deepEqual(JSON.parse(files.get(ANSWERS)), teamAnswers());
});

test("the pristine render holds every repo file where it belongs", async () => {
  const files = await bind(teamAnswers(), { readFile, coreFiles, year: 2026, version: "2.0.0" });
  const pristine = JSON.parse(files.get(PRISTINE));
  assert.equal(pristine.version, "2.0.0");
  assert.equal(pristine.year, 2026);

  const expected = [...files]
    .filter(([p]) => !p.startsWith(GLOBAL) && p !== ANSWERS && p !== PRISTINE)
    .map(([p, text]) => [p.startsWith(STAGING) ? p.slice(STAGING.length) : p, text])
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  assert.deepEqual(Object.entries(pristine.files), expected);
  // A staged file is recorded under its own path, and nothing of .bindwright/ is.
  assert.ok(files.has(`${STAGING}CLAUDE.md`));
  assert.equal(pristine.files["CLAUDE.md"], files.get(`${STAGING}CLAUDE.md`));
  assert.deepEqual(Object.keys(pristine.files).filter((p) => p.startsWith(".bindwright/")), []);
});

test("the saved answers, year and version reproduce the render byte for byte", async () => {
  const first = await bind(teamAnswers(), { readFile, coreFiles, year: 2025, version: "2.0.0" });
  const { year, version } = JSON.parse(first.get(PRISTINE));
  const again = await bind(JSON.parse(first.get(ANSWERS)), { readFile, coreFiles, year, version });
  assert.deepEqual([...again], [...first]);
});

test("without a year or version the render records this year and no version", async () => {
  const pristine = JSON.parse((await bind(defaults(), { readFile, coreFiles })).get(PRISTINE));
  assert.equal(pristine.year, new Date().getFullYear());
  assert.equal(pristine.version, null);
});
