import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bind, STAGING } from "../bind.js";
import { defaults, DEFERRED, CODE_RESEARCH_TOOLS, PRECOMMIT_MANAGERS, ARCHITECTURES } from "../model.js";
import { listCore } from "../list-core.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readFile = async (p) => readFileSync(join(repo, p), "utf8");
const coreFiles = JSON.parse(readFileSync(join(repo, "engine", "core-files.json"), "utf8"));
const run = (answers) => bind(answers, { readFile, coreFiles, year: 2026 });

function assertClean(files) {
  for (const [path, text] of files) {
    assert.ok(!text.includes("<!-- TOGGLE:"), `${path} still has a toggle marker`);
    for (const [, name] of text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) {
      assert.ok(DEFERRED.has(name), `${path} has unfilled {{${name}}}`);
    }
  }
}

test("core-files.json matches _core/project-template", () => {
  assert.deepEqual(coreFiles, listCore(), "run: node engine/list-core.js");
});

for (const team of [false, true]) {
  for (const client of [false, true]) {
    test(`team=${team} client=${client} binds cleanly`, async () => {
      const files = await run(defaults({ team, client }));
      assertClean(files);
      assert.ok(files.has(`${STAGING}CLAUDE.md`));
      assert.ok(files.has(".claude/rules/git.md"));
      assert.equal(files.has(".claude/rules/collaboration.md"), team);
      assert.equal(files.has(`${STAGING}CONTRIBUTING.md`), team);
      assert.equal(files.has(".claude/rules/confidentiality.md"), client);
      assert.ok(![...files.keys()].some((p) => p.endsWith(".template")), "no .template names remain");
    });
  }
}

test("every code-research tool binds cleanly", async () => {
  for (const tool of Object.keys(CODE_RESEARCH_TOOLS)) {
    const a = defaults({ team: true });
    a.advanced.codeResearch = tool;
    assertClean(await run(a));
  }
});

test("every pre-commit manager lands its config file", async () => {
  for (const pc of PRECOMMIT_MANAGERS) {
    const a = defaults({ team: true });
    a.advanced.precommit = pc;
    const files = await run(a);
    assertClean(files);
    assert.ok([...files.keys()].some((p) => !p.startsWith(".claude") && !p.startsWith(".github") && !p.startsWith(STAGING) && p !== "docs/lazy/README.md"), `${pc} config missing`);
  }
});

test("architecture choice ships exactly one rule file", async () => {
  for (const arch of ARCHITECTURES.filter((x) => x !== "none")) {
    const a = defaults();
    a.advanced.architecture = arch;
    const files = await run(a);
    assert.ok(files.has(".claude/rules/architecture.md"));
    assert.ok(![...files.keys()].some((p) => p.startsWith(".claude/rules/architecture/")));
  }
});

test("turning AI review off drops the workflows", async () => {
  const a = defaults({ team: true });
  a.advanced.aiReview = false;
  const files = await run(a);
  assertClean(files);
  assert.ok(!files.has(".github/workflows/claude-code-review.yml"));
  assert.ok(!files.has(".github/workflows/claude.yml"));
});

test("trunk branching binds cleanly", async () => {
  const a = defaults();
  a.advanced.branching = "trunk";
  assertClean(await run(a));
});

test("license body is filled with holder and year", async () => {
  const a = defaults();
  a.project.licenseHolder = "Ada Lovelace";
  const license = (await run(a)).get(`${STAGING}LICENSE`);
  assert.match(license, /Copyright \(c\) 2026 Ada Lovelace/);
});

test("bad answers are rejected", async () => {
  const a = defaults();
  a.project.name = "../escape";
  await assert.rejects(run(a), /project name/);
});
