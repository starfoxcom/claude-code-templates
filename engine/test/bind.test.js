import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bind, STAGING } from "../bind.js";
import { defaults, flagsFor, DEFERRED, CODE_RESEARCH_TOOLS, PRECOMMIT_MANAGERS, ARCHITECTURES } from "../model.js";
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

test("merge style picks the matching merge command", async () => {
  for (const style of ["squash", "merge", "rebase"]) {
    const a = defaults();
    a.advanced.mergeStyle = style;
    const git = (await run(a)).get(".claude/rules/git.md");
    assert.match(git, new RegExp(`gh pr merge <pr> --${style} --delete-branch`));
    for (const other of ["squash", "rebase"].filter((s) => s !== style)) {
      assert.doesNotMatch(git, new RegExp(`gh pr merge <pr> --${other}`), `${style} bind mentions --${other}`);
    }
    assert.match(git, /Release PRs .* always use `--merge`/, "gitflow releases stay merge commits");
  }
});

test("default-branch choice flips the workflow-change guidance", async () => {
  const a = defaults();
  const mainDefault = (await run(a)).get(".claude/rules/git.md");
  assert.match(mainDefault, /lands on `main` first as a `hotfix\/<name>` PR/);
  a.advanced.devIsDefault = true;
  const devDefault = (await run(a)).get(".claude/rules/git.md");
  assert.match(devDefault, /workflow changes are ordinary work PRs into `develop`/);
  assert.doesNotMatch(devDefault, /always pass `--base develop`/);
});

test("rules carry no stale model names or polling loops", async () => {
  const files = await run(defaults({ team: true, client: true }));
  for (const [path, text] of files) {
    if (!path.startsWith(".claude/rules/") && !path.endsWith("CONTRIBUTING.md")) continue;
    assert.doesNotMatch(text, /\b(Sonnet|Opus)\b/, `${path} names a model`);
    assert.doesNotMatch(text, /sleep 420/, `${path} teaches a sleep loop`);
  }
});

test("every flag is read by a template or by bind.js", () => {
  const templates = coreFiles.map((f) => readFileSync(join(repo, "_core/project-template", f), "utf8")).join("\n");
  const bindSource = readFileSync(join(repo, "engine/bind.js"), "utf8");
  for (const name of Object.keys(flagsFor(defaults()))) {
    const used = templates.includes(`TOGGLE:${name} `) || templates.includes(`TOGGLE:${name}:off `) || bindSource.includes(`flags.${name}`);
    assert.ok(used, `flag "${name}" controls nothing`);
  }
});

test("always-on rules ship to every setup, the writing rule only on request", async () => {
  const a = defaults();
  let files = await run(a);
  for (const rule of ["task-tracking.md", "testing.md", "code-size.md"]) {
    assert.ok(files.has(`.claude/rules/${rule}`), `${rule} missing`);
  }
  assert.ok(!files.has(".claude/rules/shipped-text.md"));
  a.advanced.plainWriting = true;
  files = await run(a);
  assert.ok(files.has(".claude/rules/shipped-text.md"));
});

test("path-scoped rules keep their frontmatter at the top", async () => {
  const files = await run(defaults());
  for (const rule of ["testing.md", "code-size.md"]) {
    assert.match(files.get(`.claude/rules/${rule}`), /^---\npaths:\n/, `${rule} lost its paths frontmatter`);
  }
});

test("every code-research tool gets exactly one lookup sequence and no retired tools", async () => {
  for (const tool of Object.keys(CODE_RESEARCH_TOOLS)) {
    const a = defaults();
    a.advanced.codeResearch = tool;
    const files = await run(a);
    assert.equal(files.get(".claude/skills/find/SKILL.md").match(/^## Sequence$/gm).length, 1, `${tool}: /find sequence count`);
    for (const [path, text] of files) {
      assert.doesNotMatch(text, /ast-grep|sourcegraph|semgrep|ctags/i, `${tool}: ${path} mentions a retired tool`);
    }
  }
});

test("the adherence script ships only with a code-research tool", async () => {
  const script = ".claude/scripts/research-adherence.py";
  assert.ok(!(await run(defaults())).has(script));
  for (const tool of Object.keys(CODE_RESEARCH_TOOLS).filter((t) => t !== "none")) {
    const a = defaults();
    a.advanced.codeResearch = tool;
    const text = (await run(a)).get(script);
    const pattern = text.match(/TOOL = re\.compile\(r"(.*)"\)/)[1];
    assert.doesNotThrow(() => new RegExp(pattern), `${tool}: bad match pattern`);
    assert.match(CODE_RESEARCH_TOOLS[tool].match, /./);
  }
});

test("the deny list blocks force pushes but allows --force-with-lease", async () => {
  const files = await run(defaults());
  // Deferred placeholders are filled by setup later; blank them to parse.
  const settings = JSON.parse(files.get(".claude/settings.local.json").replace(/\{\{[A-Z0-9_]+\}\}/g, ""));
  // Claude Code permission rules: `*` matches anything; a trailing `:*` is a prefix match.
  const rules = settings.permissions.deny.map((r) => r.match(/^Bash\((.*)\)$/)?.[1]).filter(Boolean).map((p) =>
    new RegExp("^" + p.replace(/:\*$/, "*").split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"));
  const denied = (cmd) => rules.some((r) => r.test(cmd));
  for (const cmd of ["git push --force", "git push --force origin x", "git push origin x --force", "git push -f origin x", "git push origin -f"]) {
    assert.ok(denied(cmd), `${cmd} should be denied`);
  }
  for (const cmd of ["git push --force-with-lease origin x", "git push origin x --force-with-lease", "git push origin feature/x"]) {
    assert.ok(!denied(cmd), `${cmd} should be allowed`);
  }
});

const python = ["python3", "python"].find((cmd) => spawnSync(cmd, ["-c", "import sys; assert sys.version_info >= (3, 8)"]).status === 0);

test("the adherence script counts only code searches", { skip: !python && "needs Python 3.8+" }, async () => {
  const a = defaults();
  a.advanced.codeResearch = "tokensave";
  const text = (await run(a)).get(".claude/scripts/research-adherence.py");
  const marker = text.match(/BYPASS = "(.*)"/)[1];
  const cases = [
    ["tokensave_search", { query: "x" }, "research"],
    ["Grep", { pattern: "foo", path: "src" }, "fallback"],
    ["Grep", { pattern: "foo", glob: "*.md" }, null],
    ["Grep", { pattern: "foo", type: "md" }, null],
    ["Glob", { pattern: "**/*.ts" }, "fallback"],
    ["Glob", { pattern: "docs/**/*.md" }, null],
    ["Bash", { command: "grep -rn foo src/" }, "fallback"],
    ["Bash", { command: "rg foo" }, "fallback"],
    ["Bash", { command: "git grep -n foo" }, "fallback"],
    ["Bash", { command: "cd src && rg foo" }, "fallback"],
    ["Bash", { command: "gh run view 1 --log | grep error" }, null],
    ["Bash", { command: "cat app.log | grep -r x" }, null],
    ["Bash", { command: "grep -rn TODO docs/*.md" }, null],
    ["Bash", { command: 'rg "foo|bar" docs/*.md' }, null],
    ["Bash", { command: 'grep -rn "a\\|b" src/ | head -5' }, "fallback"],
    ["Bash", { command: "grep foo file.ts" }, null],
    ["Bash", { command: "grep --regexp=foo file.ts" }, null],
    ["Bash", { command: `rg foo # ${marker} reason` }, "bypass"],
    ["PowerShell", { command: "Get-ChildItem -Recurse src | Select-String foo" }, "fallback"],
    ["PowerShell", { command: "Get-Content x.log | Select-String err" }, null],
    ["Read", { file_path: "src/a.ts" }, null],
  ];
  const dir = mkdtempSync(join(tmpdir(), "adherence-"));
  const script = join(dir, "research_adherence.py");
  writeFileSync(script, text);
  const transcript = join(dir, "session.jsonl");
  writeFileSync(transcript, cases.map(([name, input]) =>
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } })).join("\n"));

  const probe = spawnSync(python, ["-c", [
    "import importlib.util, json, sys",
    "spec = importlib.util.spec_from_file_location('m', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "print(json.dumps([m.classify(n, a) for n, a in json.loads(sys.argv[2])]))",
  ].join("\n"), script, JSON.stringify(cases.map(([n, i]) => [n, i]))], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const got = JSON.parse(probe.stdout);
  cases.forEach(([name, input, want], i) => assert.equal(got[i], want, `${name} ${JSON.stringify(input)}`));

  const out = spawnSync(python, [script, transcript], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /1 calls, plain code searches: 8 \(plus 1 marked bypasses\) -> 11%/);
});

test("bad answers are rejected", async () => {
  const a = defaults();
  a.project.name = "../escape";
  await assert.rejects(run(a), /project name/);
});
