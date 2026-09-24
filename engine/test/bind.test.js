import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
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
  // Bash rule matching as documented at code.claude.com/docs/en/permissions#wildcard-patterns:
  // `*` matches any text including spaces, at any position; a trailing `:*` equals a trailing
  // ` *`; and a trailing ` *` that is the rule's only wildcard also matches the bare command.
  const toRegex = (rule) => {
    const p = rule.replace(/:\*$/, " *");
    const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    if (p.endsWith(" *") && p.indexOf("*") === p.length - 1) return new RegExp(`^${esc(p.slice(0, -2))}( .*)?$`);
    return new RegExp("^" + p.split("*").map(esc).join(".*") + "$");
  };
  // The matcher must reproduce the docs' own example table before it judges our rules.
  for (const [rule, yes, no] of [
    ["npm run *", ["npm run build", "npm run test --watch", "npm run"], ["npm install"]],
    ["git log * main", ["git log --oneline main", "git log -5 main"], ["git log main", "git push origin main"]],
    ["git * main", ["git merge main", "git push origin main"], ["git log"]],
    ["* --version", ["node --version"], ["node -v"]],
    ["ls *", ["ls -la", "ls"], ["lsof"]],
    ["ls:*", ["ls -la", "ls"], ["lsof"]],
    ["ls*", ["ls -la", "lsof"], []],
    ["* --help *", ["npm --help x"], ["npm --help"]],
  ]) {
    for (const cmd of yes) assert.ok(toRegex(rule).test(cmd), `matcher: ${rule} should match ${cmd}`);
    for (const cmd of no) assert.ok(!toRegex(rule).test(cmd), `matcher: ${rule} should not match ${cmd}`);
  }
  const rules = settings.permissions.deny.map((r) => r.match(/^Bash\((.*)\)$/)?.[1]).filter(Boolean).map(toRegex);
  const denied = (cmd) => rules.some((r) => r.test(cmd));
  for (const cmd of ["git push --force", "git push --force origin x", "git push origin x --force", "git push -f origin x",
    "git push origin -f", "git push -fu origin x", "git push origin x -fu", "git push -uf origin x", "git push origin -uf x",
    "git push origin +main", "git push --mirror origin", "git push origin --mirror"]) {
    assert.ok(denied(cmd), `${cmd} should be denied`);
  }
  for (const cmd of ["git push --force-with-lease origin x", "git push origin x --force-with-lease", "git push origin feature/x",
    "git push -u origin feature/x", "git push --follow-tags origin x"]) {
    assert.ok(!denied(cmd), `${cmd} should be allowed`);
  }
  // Short-flag bundles like `-qf` cannot be denied by text rules without also denying
  // `--force-with-lease`; only the global push guard catches them. Without it, they must
  // at least not be auto-approved, so the person sees the command before it runs.
  const allows = settings.permissions.allow.map((r) => r.match(/^Bash\((.*)\)$/)?.[1]).filter(Boolean).map(toRegex);
  for (const cmd of ["git push -qf origin main", "git push -vf origin main", "git push -uqf origin main",
    "git push origin main -qf", "git push -u origin x -qf"]) {
    assert.ok(!allows.some((r) => r.test(cmd)), `${cmd} must not be auto-approved`);
  }
  assert.ok(allows.some((r) => r.test("git push")), "a bare git push stays auto-approved");
});

// `python` first: on Windows, `python3` is often an App Execution Alias, and starting
// an interpreter by its full path after that alias crashes Node 20's process spawner.
const python = ["python", "python3"].find((cmd) => spawnSync(cmd, ["-c", "import sys; assert sys.version_info >= (3, 8)"]).status === 0);

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

test("the push guard blocks force pushes in any flag bundle", { skip: !python && "needs Python 3.8+" }, async () => {
  // The guard is installed globally by setup, never shipped into the project.
  assert.ok(!coreFiles.some((f) => f.includes("push-guard")), "no project copy of the push guard");
  assert.equal(JSON.parse((await run(defaults())).get(".claude/settings.local.json").replace(/\{\{[A-Z0-9_]+\}\}/g, "")).hooks,
    undefined, "no project-level hooks");

  // Register it exactly as SETUP.md Phase 7c documents: its JSON entry, with this
  // machine's interpreter and a temporary home. Exec form, so no shell is involved.
  const setup = readFileSync(join(repo, "SETUP.md"), "utf8");
  const step = setup.slice(setup.indexOf("7c. **Install the push guard GLOBALLY**"));
  const exe = spawnSync(python, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
  const home = mkdtempSync(join(tmpdir(), "push-guard-")).split("\\").join("/");
  const entry = JSON.parse(step.match(/```json\r?\n([\s\S]*?)```/)[1]
    .replace("<python>", JSON.stringify(exe).slice(1, -1)).replace("<home>", home)).hooks[0];
  assert.equal(entry.command, exe);
  assert.ok(Array.isArray(entry.args), "exec form, so no shell expands the path");
  mkdirSync(join(home, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(home, ".claude", "hooks", "push-guard.py"), readFileSync(join(repo, "_core/global-template/hooks/push-guard.py")));
  const runHook = (root, input) => spawnSync(entry.command, entry.args.map((s) => s.split(home).join(root)), { input, encoding: "utf8" });
  // "deny" is exit 2; "ask" is exit 0 with an ask decision on stdout; "allow" is a silent exit 0.
  const decide = (r) => r.status === 2 ? "deny"
    : r.status === 0 && /"permissionDecision": "ask"/.test(r.stdout) ? "ask"
    : r.status === 0 && r.stdout === "" ? "allow" : `exit ${r.status}: ${r.stdout}${r.stderr}`;
  const verdict = (tool, command) => decide(runHook(home, JSON.stringify({ tool_name: tool, tool_input: { command } })));
  const missing = runHook(mkdtempSync(join(tmpdir(), "no-hook-")), JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }));
  assert.notEqual(missing.status, 2, "a missing hook file must not block every call");
  // Certain force pushes in plain commands are blocked.
  const both = [
    "git push --force", "git push origin main --force", "git push -f origin x", "git push origin x -f",
    "git push -fu origin x", "git push -uf origin x", "git push -qf origin main", "git push -vf origin main",
    "git push origin main -qf", "git push -uqf origin main", "git push origin +main", "git push origin -- +main",
    "git -C repo push -f", "cd repo && git push --force origin x", "echo hi; git push -qf", "GIT_TRACE=1 git push -f",
    "/usr/bin/git push -f", "git push --force=true origin x", "git push --mirror origin", "git push --mirr origin",
    "git push --m origin", "git --config-env core.x=HOME push -f origin main", "git --attr-source HEAD push -qf origin main",
    "(git push -qf origin main)", "if x; then git push -qf origin main; fi",
    "for r in a; do git push -qf origin main; done", "GIT.EXE push -f origin main",
  ];
  const bashOnly = [
    "git commit -m \"fix \\\"x\" && git push -qf origin main", "a & git push -qf origin main",
    // Line continuations are joined first, and quotes or escapes inside `push` are read as the shell reads them.
    "git push origin main \\\n-qf", "cd repo && \\\ngit push -qf origin main",
    "git pu''sh -qf origin main", "git \"pu\"sh -qf origin main", "git pu\\sh -qf origin main",
  ];
  const powershellOnly = ["& \"C:\\Program Files\\Git\\cmd\\git.exe\" push -qf origin main", "git -C \"C:\\repo\\\" push -f",
    "git push origin main `\n-qf"];
  // Silent passes: pushes on the allow-list, commands that never push, and text that only mentions one.
  const allowed = [
    "git push", "git push -u origin feature/fix-bug", "git push --force-with-lease origin x",
    "git push origin x --force-with-lease=x:abc", "git push --force-if-includes --force-with-lease origin x",
    "git push --follow-tags origin x", "git push --tags", "git push origin --delete old-branch",
    "git push origin HEAD:refs/heads/x", "cd repo && git push -u origin feature/x", "git push origin x 2>&1",
    "git log -f", "git commit -m \"push -f later\"", "echo \"git push -f\"",
    "git commit -m \"Never run \\\"cd repo && git push -f\\\" here\"",
    "cat <<-EOF > notes.md\n\tnotes\n\tEOF", "(( n = 1 << 2 ))\necho done", "git remote add origin https://example.com/a.git",
    // Pushes that are not git's, and a push next to segments known to leave git alone.
    "git stash push -m wip", "gh run list --event push", "docker push img:1",
    "git add . && git commit -m \"x\" && git push origin x", "git fetch origin && git push -u origin x",
    "cat hooks/push-guard.py", "git add _core/global-template/hooks/push-guard.py", "git log --grep=push",
  ];
  // Everything else that mentions a push asks: never a guess, never a silent pass.
  const asked = [
    "sudo -u me git push -qf origin main", "eval \"git push -qf origin main\"", "git commit -m \"unbalanced && git push -f",
    "git push -o ci.skip origin x", "git push origin main:+notes", "git push -- +main", "git push --repo=origin",
    "echo $(git push -qf origin main)", "out=$(git push -qf origin main 2>&1)", "echo \"$(git push -qf origin main)\"",
    "x=`git push -qf origin main`", "diff <(git push -qf origin main) x", "git push $FLAGS origin main",
    "git push origin {-qf,x}", "{ git push -qf origin main; }", "git push origin x # never -f here",
    "echo hi # && git push -qf origin main", "cat > notes.md <<'EOF'\n## Force pushes\ngit push -f origin main\nEOF",
    "cat > notes.md <<'EOF'\nnotes\nEOF\ngit push -qf origin main", "cat <<EOF\n$(git push -qf origin main)\nEOF",
    "(( n = 1 << 2 ))\ngit push -qf origin main", "echo $((x << y))\ngit push -qf origin main",
    "wc -c <<< hello\ngit push -qf origin main", "cat <<EOF\nnever closed\ngit push -qf origin main",
    // A redirect glued to `push` hides the word from a plain reading.
    "git push>/dev/null -qf origin main", "git push<in -qf origin main", "git push&>/dev/null -qf origin main",
    // Settings that make a later plain `git push` force or mirror, from the command line or the environment.
    "git -c remote.origin.push=+main:main push origin", "git remote add --mirror=push b https://example.com/b.git",
    "git config remote.b.mirror true", "git remote add --mirror b https://example.com/b.git",
    "git remote add --mirr=push b https://example.com/b.git",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.push GIT_CONFIG_VALUE_0=+main:main git push origin",
    "GIT_CONFIG_PARAMETERS=\"'remote.origin.push=+main:main'\" git push origin",
    // xargs appends its input as arguments, so the push's own words do not show the flag.
    "echo -qf | xargs git push origin main",
    "git push >| /dev/null -qf origin main", "git remote add --m''irror=push b https://example.com/b.git",
    "git remote add --m\\irror=push b https://example.com/b.git",
    "V=+main:main git --config-env=remote.origin.push=V push origin",
    "git --config-env=remote.origin.mirror=HOME push origin",
    // A redirected print writes a file (here git's config), and an environment change points git elsewhere.
    "printf '[remote \"origin\"]\\n\\tpush = +main:main\\n' >> .git/config", "export HOME=/tmp/e; git push origin",
    "HOME=/tmp/e; git push origin", "readonly HOME=/tmp/e; git push origin", "printf -v HOME /tmp/e; git push origin",
    "read HOME < f; git push origin", "eval HOME=/tmp/e; git push origin",
    // Config written by the same command without the word `push` in its text, and a mirror clone.
    "printf '[remote \"origin\"]\\n\\tpu%sh = +main:main\\n' s >> .git/config; git push origin",
    "git clone --mi ../stale d && cd d && git push origin",
    // An option the guard does not know could take the next word as its value.
    "git --super-prefix x push -qf origin main",
  ];
  for (const cmd of both) {
    assert.equal(verdict("Bash", cmd), "deny", `Bash should block: ${cmd}`);
    assert.equal(verdict("PowerShell", cmd), "deny", `PowerShell should block: ${cmd}`);
  }
  for (const cmd of bashOnly) assert.equal(verdict("Bash", cmd), "deny", `Bash should block: ${cmd}`);
  for (const cmd of powershellOnly) assert.equal(verdict("PowerShell", cmd), "deny", `PowerShell should block: ${cmd}`);
  for (const cmd of allowed) assert.equal(verdict("Bash", cmd), "allow", `should allow: ${cmd}`);
  for (const cmd of asked) assert.equal(verdict("Bash", cmd), "ask", `should ask: ${cmd}`);
  for (const cmd of ["$s = @'\ngit push -qf origin main\n'@", "git push @args", "git push $flags origin main",
    // PowerShell reads curly quotes as quotes and Unicode spaces as whitespace.
    "git push origin main \u201c-qf\u201d", "git push origin \"x\u201c -qf \u201cy\"", "git push origin main\u00a0-qf",
    // PowerShell evaluates a parenthesized argument; Set-Item changes the environment next to a push.
    "git push origin main ('-q'+'f')", "Set-Item Env:HOME C:/e; git push origin",
    "Write-Output (git push -qf origin main)", "echo (git push -qf origin main)",
    "git commit -m (git push -qf origin main)"]) {
    assert.equal(verdict("PowerShell", cmd), "ask", `PowerShell should ask: ${cmd}`);
  }
  // Hooks run in the project directory; a repo's own json.py must not replace the hook's imports.
  const shadowed = mkdtempSync(join(tmpdir(), "push-guard-cwd-"));
  writeFileSync(join(shadowed, "json.py"), "raise SystemExit(1)\n");
  const inShadow = spawnSync(entry.command, entry.args, { cwd: shadowed, encoding: "utf8",
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push -qf origin main" } }) });
  assert.equal(decide(inShadow), "deny", "a project json.py must not disable the guard");
  assert.equal(verdict("Read", "git push -f"), "allow", "other tools pass");
  assert.equal(decide(runHook(home, "not json")), "allow", "bad input fails open");
});

test("bad answers are rejected", async () => {
  const a = defaults();
  a.project.name = "../escape";
  await assert.rejects(run(a), /project name/);
});
