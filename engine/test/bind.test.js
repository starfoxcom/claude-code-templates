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
    "git push origin +main", "git push --mirror origin", "git push origin --mirror",
    // `--upload-pack` runs a shell command, so the `git fetch`/`git pull` allows must not approve it.
    "git fetch --upload-pack=x .", "git fetch origin --upl=x", "git pull --upload-pack=x . main",
    // A mirror remote turns a later bare `git push`, which the allow list approves, into a mirror force push.
    "git remote add --mirror=push origin https://x/y", "git remote add --mi origin https://x/y",
    "git remote -v add --mirror=push origin https://x/y",
    // `gh repo sync --force` hard-resets a branch on GitHub.
    "gh repo sync --force", "gh repo sync owner/fork --branch main --force"]) {
    assert.ok(denied(cmd), `${cmd} should be denied`);
  }
  for (const cmd of ["git push --force-with-lease origin x", "git push origin x --force-with-lease", "git push origin feature/x",
    "git push -u origin feature/x", "git push --follow-tags origin x",
    "git remote add upstream https://x/y", "git remote -v", "git fetch origin", "git pull origin main"]) {
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
  // The page's stack-command chips must not offer `git push`: Phase 5 would render it as `git push:*`.
  for (const page of ["index.html", "redesign/data.jsx"]) {
    const catalog = readFileSync(join(repo, page), "utf8").match(/"Git · GitHub":\s*\[([^\]]*)\]/)[1];
    assert.ok(!/"git push/.test(catalog), `${page} must not offer a git push chip`);
  }
  // The page's built-in fallback copy of SETUP.md must carry the same skip rule.
  for (const page of ["index.html", "redesign/bind.jsx"]) {
    assert.match(readFileSync(join(repo, page), "utf8"), /stack command that is \\`git push\\` or starts with it/,
      `${page} fallback setup must skip git push stack commands`);
  }
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
  // A "git push" stack-command chip must not come back as a project-level `git push:*`.
  const stackStep = setup.slice(setup.indexOf("5. **Render `{{STACK_COMMANDS_ALLOWLIST}}`**"), setup.indexOf("6.", setup.indexOf("5. **Render `{{STACK_COMMANDS_ALLOWLIST}}`**")));
  assert.match(stackStep, /Never widen `git push` here\.\*\* Skip any entry that is `git push`/);
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
    "/usr/bin/git push -f", "git push --force=true origin x", "git push -qf origin main # note", "git push --mirror origin", "git push --mirr origin",
    "git push --m origin", "git --config-env core.x=HOME push -f origin main", "git --attr-source HEAD push -qf origin main",
    "(git push -qf origin main)", "if x; then git push -qf origin main; fi",
    "for r in a; do git push -qf origin main; done", "GIT.EXE push -f origin main",
    // Wrappers with their own options cannot hide the push.
    "sudo -u me git push -qf origin main", "timeout 5 git push -f origin main", "nice -n 5 git push -qf origin main",
    "command -p git push -qf origin main", "env -i git push -qf origin main", "time -p git push -qf origin main",
  ];
  const bashOnly = [
    "git commit -m \"fix \\\"x\" && git push -qf origin main", "a & git push -qf origin main",
    // Line continuations are joined first, and quotes or escapes inside `push` are read as the shell reads them.
    "git push origin main \\\n-qf", "cd repo && \\\ngit push -qf origin main",
    "git pu''sh -qf origin main", "git \"pu\"sh -qf origin main", "git pu\\sh -qf origin main",
    // A redirect glued to the program name, and git's own dashed push program.
    "git>/dev/null push -qf origin main", "git</dev/null push -qf origin main", "git&>/dev/null push -qf origin main",
    "/usr/lib/git-core/git-push -qf origin main",
    "case x in a) git push -qf origin main;; esac", "if git push -qf origin main; then echo ok; fi",
    "while git push -qf origin main; do break; done",
    // Bash on Linux reads backslash + CR as an escaped CR, so the LF still ends the
    // command; Git Bash drops the CR and joins the lines. Both readings are checked.
    "echo x \\\r\ngit push -qf origin main", "git commit -m wip \\\r\ngit push -qf origin main",
    "git push origin main \\\r\n  --force", "git push \\\r\n  -f origin main",
    "# C:\\work\\repo\\\r\ngit push origin main \\\r\n  --force",
    // Read whole, a force word glued to a separator is still a word.
    "cd /c/work/repo  # C:\\work\\repo\\\ngit push origin main \\\n  -f; git log --oneline -1",
    "# deploy notes\\\ngit push origin main \\\n  -qf|tail -1",
    "# output lands in C:\\work\\repo\\\r\ngit push origin main \\\r\n  --force; echo done",
    // A backtick ending a line closes a substitution; it is no line continuation in Bash.
    "VERSION=`cat VERSION`\ngit push -f origin main", "REV=`git rev-parse HEAD`\r\ngit push -f origin main",
    // Bash does not continue a comment, so a `\` ending one leaves the next line its own command.
    "echo start # logs land in C:\\temp\\\ngit push -f origin main", "# Build output lands in dist\\\ngit push origin main --force",
    // A comment's `\` ends its line while a later continuation still joins.
    "# Build output lands in C:\\out\\\ngit push \\\n  --force origin main", "echo x  # C:\\x\\\ngit push origin \\\n  +main",
    "# C:\\x\\\ngit \\\n  push -f origin main", "cd /c/work/repo  # C:\\work\\repo\\\ngit push origin main \\\n  -f",
    "git push \\\n#x\ngit push -f origin main",
    // A `#` after `)` begins a word, so it starts a comment too.
    "(cd build && make)# output lands in C:\\out\\\ngit push -f origin main", "((n++))# C:\\x\\\ngit push -f origin main",
    "case $B in main)# C:\\x\\\ngit push -f origin main;; esac",
    // A backtick pair closes on its own line, so a stray backtick in a comment
    // or heredoc body does not swallow the push's substitution.
    "# strip the ` from names\ngit push origin `git branch --show-current` --force",
    "cat > notes.md <<'EOT'\nWrap commands in ``` fences.\nEOT\ngit push origin `git branch --show-current` --force",
    // After a heredoc body pairs quotes wrongly, the plain reading still joins the push.
    "cat <<'EOF'\ndon't\nEOF\n# C:\\x\\\ngit push \\\n -f origin main",
    "echo \"a \\\nb\" ; git push \\\n -f origin main",
    // A `)` closing a substitution ends no word, and no comment starts inside `${...}`.
    "git push origin feature-$(date +%s)#1 \\\n -f", "git push origin $(echo main)#x \\\n  --force",
    "git push origin ${B%% #*} \\\n  --force", "git push origin <(true)#x \\\n  --force",
    // A quote in a heredoc body shifts no later line.
    "git commit -F - <<'EOF'\nDon't retry the upload\nEOF\necho \"built\" # it's in C:\\temp\\\ngit push -f origin main",
    "git commit -F - <<'EOF'\nFix the header on 13\" screens\nEOF\nnpm run build \\\n  # output in C:\\temp\\\ngit push -f origin main",
    "git commit -F - <<'EOF'\nDon't retry the upload\nEOF\ncd \"$REPO\" # it's in C:\\work\\\ngit push origin main \\\n  --force",
    // A comment inside backticks ends at the closing backtick; a `"$(...)"` is read as a command.
    "B=`git branch --show-current # current`; git push origin \"$B\" \\\n  --force", "git push origin `echo main #x` \\\n  --force",
    "git tag -a v1.2 -m \"$(printf \"Release #%s\" 12)\" && git push origin main \\\n  --force",
    "git commit -m \"$(echo \"it's done\")\" && git push origin main \\\n  -f",
    "git commit -m \"$(cat <<'EOF'\nfix: the 13\" screens, don't\nEOF\n)\"\ngit push origin main \\\n  --force",
    // Input is UTF-8 on every platform; a Windows code-page decode would fail on the curly quote.
    "git commit -m \"fix “x”\" && git push -qf origin main",
  ];
  const powershellOnly = ["& \"C:\\Program Files\\Git\\cmd\\git.exe\" push -qf origin main", "git -C \"C:\\repo\\\" push -f",
    "git push origin main `\n-qf", "git push origin main `\r-qf", "git push origin main `\r\n-qf",
    ". git push -qf origin main",
    // The first word of a block is a command.
    "try { iex 'git push -qf origin main' } catch {}", "if ($a) { x } else { iex 'git push -qf origin main' }",
    "$x | ForEach-Object { iex 'git push -qf origin main' }", "if ($a) {iex 'git push -qf origin main'}",
    // A statement complete before a here-string still runs.
    "git push -qf origin main; Write-Output @\"\nx\n\"@",
    // A script block bound to a pipeline parameter runs once per piped object.
    "Get-Item x | Select-String -LiteralPath { git push -qf origin main } -Pattern a",
    // An unquoted comma passes array elements as separate arguments, and a
    // backtick inside double quotes before a plain character is dropped.
    "git push origin main,-qf", "git push origin main,+main", "git push origin main ,-qf",
    "git push origin main \"`-qf\"", "git push origin main \"`--force\"", "git push origin \"`+main\"",
    // The call operator glued to git, around a parenthesized name, or a command lookup.
    "&git push -qf origin main", "&'git' push -qf origin main", "& (\"git\") push -qf origin main",
    "&git.exe push -qf origin main", "&(Get-Command git) push -qf origin main",
    "& (gcm git) push -qf origin main", "git>out.txt push -qf origin main",
    // PowerShell runs a parenthesized argument as a command, so these push for certain.
    "Write-Output (git push -qf origin main)", "echo (git push -qf origin main)",
    "git commit -m (git push -qf origin main)",
    // In PowerShell 7 a mid-line `&` starts a background job and ends the statement; so does a lone CR.
    "git commit -m wip & git push -qf origin main", "echo x & git push -qf origin main",
    "Write-Output x & git push -qf origin main", "git commit -m wip\rgit push -qf origin main",
    // The comment after a backtick continuation hides its quote, so the push is read.
    "Write-Output x`\n# \"\ngit push -qf origin main",
    // A `` `u{...} `` escape decodes inside double quotes.
    "git push origin main \"-`u{66}\""];
  // Silent passes: pushes on the allow-list, commands that never push, and text that only mentions one.
  const allowed = [
    "git push", "git push -u origin feature/fix-bug", "git push --force-with-lease origin x",
    // A `)` in quoted text, a top-level `case` pattern and a heredoc list item keep statements apart.
    "git push origin main && echo \"done :)\" && tail -f log.txt",
    "case \"$b\" in main) git push origin main;; *) rm -f tmp.txt;; esac",
    "git push -u origin feat && gh pr create --base develop --body \"$(cat <<'EOF'\n1) adds +2 tests\nEOF\n)\"",
    // An arithmetic `+`, and mirror values git reads as false.
    "git push origin v$((n + 1))", "git push origin v$(( (n + 1) ))", "git -c remote.origin.mirror=false push origin",
    "git -c remote.origin.mirror=0 push origin",
    // A substitution inside a case arm reads like any other.
    "case \"$1\" in tag) git push origin \"v$(date +%Y.%m.%d)\";; esac",
    "case \"$1\" in go) git push origin \"$(git rev-parse --abbrev-ref HEAD | cut -d/ -f2)\";; esac",
    "printf $'\\e[1mdone\\e[0m\\n'; git push origin main",
    // A `$'` ending a single-quoted pattern starts no ANSI-C string.
    "git branch --merged | grep -v 'main$' | xargs -r git branch -d; git push origin main; rm -rf dist; echo 'cleaned up'",
    "grep -c '^$' CHANGELOG.md; git push -u origin feature/x && rm -rf .cache && echo 'ok'",
    "git tag | grep -E '^v[0-9]+$'\ngit push origin main\nrm -rf build\necho 'done'",
    // A `$'` string ends on its own line, so an apostrophe before it pairs no lines together.
    "git commit -m \"$(cat <<'EOF'\nfix: don't treat 'v1.0$' tags as releases\n\nDetails.\nEOF\n)\" && git push origin feature/x && rm -rf build && echo 'done'",
    "# Keep only lines that don't match '^$'\ngrep -v '^$' in.txt > out.txt\ngit push origin main\nrm -rf tmp\necho 'ok'",
    // A Bash command with a `\` ending a line and no force word after its push.
    "git push origin main \\\n#--force", "echo 'a\\\n' ; git push origin main",
    "git push -u origin feature/x \\\n  && echo pushed", "git commit -m \"fix: handle the lock \\\nit's stale now\" && git push origin main",
    "git commit -m \"$(cat <<'EOT'\nfix: don't split names on a stray ` char\nEOT\n)\" && git push origin feature/x && rm -rf build && echo \"built at `date`\"",
    // Bash has no `` `u{...} `` escape.
    "git push origin main \"-`u{66}\"",
    // A quote that opens or closes a word is its edge, so a quoted variable
    // before a suffix is a branch name, not a flag.
    "git push -u origin \"${TICKET}-fix\"", "git push -u origin \"${TICKET}\"-fix",
    "git push -u origin \"$(whoami)-hotfix\"", "git push origin \"${TAG}+build\"",
    // The word "case" in a message, an apostrophe in a heredoc body or a comment.
    "git commit -m \"$(cat <<'EOF'\nfix: handle the upper case branch names\nEOF\n)\" && git push origin HEAD && rm -rf .cache",
    "cat <<'EOF' > x.md\ndon't\nEOF\ngit push origin x\nrm -f tmp", "# it's done\ngit push origin x && rm -rf .cache",
    "git commit -m \"just in case\" && git push origin $(git branch --show-current) && rm -rf x",
    // Everyday chains: commit then push, trim the output, delete one branch and push another.
    "git add -A && git commit -q -m \"fix(x): y\" && git push -q origin feature/x 2>&1 | tail -1; git log --oneline -1",
    "git push origin --delete hotfix/x 2>&1 | tail -1; git checkout -q -b chore/c origin/develop; git push -q -u origin chore/c 2>&1 | tail -1",
    // Redirected output, and a mirror setting that is off.
    "git push origin main > /tmp/log 2>&1", "git push -u origin feature/x 2> err.txt",
    "git -c remote.origin.mirror=false push origin", "git -c remote.origin.mirror=0 push origin",
    // Flags of a command inside a substitution belong to that command, not the push.
    "git push origin $(git rev-parse --abbrev-ref HEAD | cut -d/ -f2)", "git push -u origin \"$(git branch --show-current)\"",
    "git push origin `git config -f x.cfg branch.name`",
    "git commit -m \"$(cat <<'EOF'\nfix: handle the edge case\nEOF\n)\" && git push origin feature/x",
    "echo showcase; git push origin x",
    // A delete on one remote and a push to another; a substitution in a commit message.
    "git push upstream --delete x && git push origin x", "git commit -m \"$(date): push\" && git push origin x",
    "git push origin x --force-with-lease=x:abc", "git push --force-if-includes --force-with-lease origin x",
    "git push --follow-tags origin x", "git push --tags",
    // Trimming a push's output with a filter that only reads and prints.
    "git push origin feature/x 2>&1 | tail -1", "git push origin x 2>&1 | grep -v remote | head -3",
    "cd /c/repo; git push -q -u origin feature/a 2>&1 | tail -2; git push -q -u origin feature/b 2>&1 | tail -2; echo pushed",
    "cd /c/repo; git push origin feature/a 2>&1 | tail -2; git rev-parse --short HEAD",
    "git push origin HEAD:refs/heads/x", "cd repo && git push -u origin feature/x", "git push origin x 2>&1",
    "git log -f", "git commit -m \"push -f later\"",
    "cat <<-EOF > notes.md\n\tnotes\n\tEOF", "(( n = 1 << 2 ))\necho done", "git remote add origin https://example.com/a.git",
    // Pushes that are not git's, and a push next to segments known to leave git alone.
    "git stash push -m wip", "gh run list --event push", "docker push img:1",
    "git add . && git commit -m \"x\" && git push origin x", "git fetch origin && git push -u origin x",
    "printf 'fix push retries' | git commit -F -",
    "gh pr create --title \"fix push retries\" --body \"Pushes now retry.\"", "cat hooks/push-guard.py", "git add _core/global-template/hooks/push-guard.py", "git log --grep=push",
  ];
  // Force pushes hidden in forms the guard can still read for certain.
  const hidden = [
    "eval \"git push -qf origin main\"", "echo $(git push -qf origin main)", "out=$(git push -qf origin main 2>&1)",
    "x=`git push -qf origin main`", "diff <(git push -qf origin main) x", "{ git push -qf origin main; }",
    // `$'...'` and `$"..."` inside the subcommand name, decoded as Bash does.
    "git pu$'sh' -qf origin main", "git pu$\"sh\" -qf origin main", "git $'\\x70ush' -qf origin main",
    "git $'\\160ush' -qf origin main", "git send$'-'pack --force https://x/y main",
    // A `case` pattern named like a print or search command is still a pattern.
    "case grep in\ngrep ) git push -qf origin main;;\nesac", "case x in x) :;; echo ) git push -qf origin main;; esac",
    // A shell string or `eval` in command position, also after a wrapper or keyword.
    "sudo -E bash -c 'git push -qf origin main'", "env -i A=1 sh -c 'git push -qf origin main'",
    "timeout -s KILL 5 sh -c 'git push -qf origin main'", "xargs -0 sh -c 'git push -qf origin main'",
    "if sh -c 'git push -qf origin main'; then :; fi", "case x in x) eval 'git push -qf origin main';; esac",
    "f() { eval 'git push -qf origin main'; }; f", "f() ( sh -c 'git push -qf origin main' )",
    "coproc eval 'git push -qf origin main'", "sudo -iu me sh -c 'git push -qf origin main'",
    // Statements complete before an unreadable point still run.
    "git push -qf origin main\ncat <<EOF", "git push -qf origin main; echo \"x", "git push -qf origin main; x=$(echo",
    // A `<name>` in a message is no redirect; a digit in a short bundle; a path ending in a
    // subcommand name; a quoted separator in an option value.
    "git commit -m \"docs: explain <name>\" && git push -f origin main && echo \"done\"",
    "git push -4f origin main", "git push -6qf origin main",
    "git -C ../notes push -f origin main", "git -C /work/clone push -f origin main",
    "git -C \"C:/Work/R&D/repo\" push -f origin main",
    // An option value with a space, or a substitution, between `git` and `push`.
    "git -C \"/c/My Repo\" push -f origin main", "git --git-dir \"/c/My Repo/.git\" push -f",
    "git -c \"user.name=A B\" push -f origin main", "git -c core.sshCommand=\"ssh -i ~/.ssh/k\" push --force origin main",
    "git -C \"$(pwd)/My Repo\" push -f", "git $(true) push -f", "bash -c 'git \"$@\"' _ push -qf origin main",
    // Text the guard cannot fully place is still read: an unclosed heredoc or
    // quote, deep nesting, a comment, text piped into a shell.
    "cat <<EOF\ngit push -qf origin main", "echo \"x; git push -qf origin main", "x=$(echo; git push -qf origin main",
    "echo " + "$(echo ".repeat(9) + "git push -qf origin main" + ")".repeat(9),
    "git push -- +main", "git push origin {-qf,x}", "echo hi # && git push -qf origin main",
    "cat <<EOF\nnever closed\ngit push -qf origin main", "echo git push -qf origin main | sh",
    "echo '; git push -qf origin main' | git commit --allow-empty -F - | sh",
    // A redirect glued to `push` ends the word, as in the shell.
    "git push>/dev/null -qf origin main", "git push<in -qf origin main", "git push&>/dev/null -qf origin main",
    // A redirect glued to a flag ends the word there, so the flag still reaches git.
    "git push origin main -qf>/dev/null", "git push origin main --force>/dev/null", "git push origin main -f&>/dev/null",
    "git push origin main -qf> /dev/null", "git push origin main --mirror>log",
    // Bash's clobber redirect `>|` is no pipe.
    "git push >| /dev/null -qf origin main", "git push origin main -qf 2>| err",
    // Bash on Linux reads a carriage return as part of a word, so `\r#` starts no
    // comment and `\r` is a word; the guard blocks on that reading too.
    "git push origin main >out\r# -qf", "git push -o\r -qf origin main",
    // A separator inside a substitution does not end the statement around it.
    "git push $(true;) -qf origin main", "git push `:;` -qf origin main", "git push origin main ${X//;/} -qf",
    "git push origin main ${X:-|} -qf", "git push $(\n) -qf origin main", "echo \"$(git push -qf origin main)\"",
    // Bash's `$'...'` and `$"..."` quoting, with escapes decoded.
    "git push origin main $'-qf'", "git push origin $'+main'", "git push origin main $\"-qf\"",
    "git push origin main $'\\x2dqf'", "git push origin main $'\\055qf'",
    // A heredoc body is text; the statements after it are read.
    "cat > notes.md <<'EOF'\nnotes\nEOF\ngit push -qf origin main", "cat <<EOF\n$(git push -qf origin main)\nEOF",
    "git commit -q -F - <<'EOF'\nmsg\nEOF\ngit push -qf origin main", "cat <<-EOF\n\tnotes\n\tEOF\ngit push -qf origin main",
    "git commit -m \"$(cat <<'EOF'\nfix: push retries\nEOF\n)\" && git push -qf origin main",
    "wc -c <<< hello\ngit push -qf origin main",
    // An arithmetic shift is no heredoc, and a heredoc apostrophe does not hide a later `$'...'`.
    "(( n = 1 << 2 ))\ngit push -qf origin main", "echo $((x << y))\ngit push -qf origin main",
    "cat <<'EOF'\ndon't\nEOF\ngit push origin main $'-qf'",
    // An apostrophe in a heredoc body or a comment does not stop line continuations.
    "cat > CHANGELOG.md <<'EOF'\nIt's fixed.\nEOF\ngit -C repo \\\n  push --force origin main",
    "cat > x.md <<'EOF'\nIt's fixed.\nEOF\ngit push origin main \\\n-qf",
    "# don't push yet\ncd repo && \\\ngit push -qf origin main",
    // `#` right after `(` starts a comment.
    "(#'\ngit push -qf origin main #'\n)",
    // Inside `$'...'` a backslash escapes the quote.
    "echo $'it\\'s done'\ngit push -qf origin main", "git commit -m $'don\\'t' && git push -qf origin main",
    // A `case` pattern's `)` does not close the substitution; the word "case" in text changes nothing.
    "git push $(case x in x) echo;; esac) -qf origin main",
    "x=$(case $y in a) echo a;; b) echo b;; esac); git push -qf origin main",
    "x=$(" + "echo a; ".repeat(10) + "case $y in a) echo a;; esac); git push -qf origin main",
    "x=$(grep -in case f); git push -qf origin main",
    "x=$(echo just in case); git push -qf origin main", "x=$(echo do case); git push -qf origin main",
    // A line continuation joins before words are split: `x=1\<LF>#` is the word `x=1#`.
    "x=1\\\n#; git push -qf origin main", "x=1\\\n\\\n#; git push -qf origin main",
    // A `case` after `{`, `!` or another reserved word is counted too.
    "x=\"$({ case a in a) echo \"it's\";; esac; })\"; git push -qf origin main",
    "x=$(if case a in a) true;; esac; then echo \"it's\"; fi); git push -qf origin main",
    "git commit -m \"$(cat <<'EOF'\nfix: handle the edge case where the lock is stale\nEOF\n)\" && git push -f origin main",
    // In an unquoted heredoc body, quotes and `#` are text and `$(...)` still runs.
    "cat <<EOF\ndon't\n$(git push -qf origin main)\nEOF", "cat <<EOF\n# $(git push -qf origin main)\nEOF",
    // An escaped space before `#`, a `#` inside `${...}` and a quoted `>` start no comment or redirect.
    "A=\\ # git push -qf origin main", "X=main; git push origin ${X:-;#} -qf", "git push --repo=\">\" -qf origin main",
    // Forcing settings and one-off aliases on the push itself.
    "git -c remote.origin.push=+main:main push origin", "git -c remote.origin.mirror=true push origin",
    "git -c alias.p='push -f' p origin main", "git -c alias.p=push p -f origin main",
    "git -c alias.p='!git push -f' p origin main",
    // Config keys ignore case, and an alias can name another alias.
    "git -c alias.P='push -f' p origin main", "git -c alias.q='push -f' -c alias.p=q p origin main",
    "git -c alias.p='push -f' P origin main", "git -c alias.b='push -f' -c alias.a=b a origin main",
    "git -c \"alias.p=push origin '+main'\" p", "git -c alias.p='!sh -c \"git push -qf origin main\"' p",
    "git -c remote.origin.mirror push origin", "git -c remote.origin.mirror=Yes push origin",
    // git's push plumbing has its own --force.
    "git send-pack --force https://x/y main", "git http-push --force https://x/y main",
    // Literal command strings run by another shell, read after its quotes and escapes are removed.
    "sh -c 'git pu\"\"sh -qf origin main'", "sh -c 'git pu\\sh -qf origin main'", "sh -c 'g\\it push -qf origin main'",
    "bundle exec sh -c 'git pu\"\"sh -qf origin main'", "sh -c 'git\tpush -qf origin main'",
    "uv run sh -c 'git pu\"\"sh -qf origin main'", "sh -c \"git pu''sh -qf origin main\"",
    "bash -lc 'git push -qf origin main'", "pwsh -Command 'git push -qf origin main'",
    // Shell options before `-c`, `c` inside a bundle, and `--` before the string.
    "bash -l -c 'git push -qf origin main'", "sh -e -c 'git push -qf origin main'",
    "bash --login -c 'git push -qf origin main'", "bash -cx 'git push -qf origin main'",
    "bash -c -- 'git push -qf origin main'", "bash -euo pipefail -c 'git push -qf origin main'",
    // A `+` glued to a substitution, a mirror value git reads as true, a here-string.
    "git push origin \"+${BRANCH}\"", "git push origin +$(git branch --show-current)",
    "git push origin +`git branch --show-current`",
    "git -c remote.origin.mirror=2 push origin", "git -c remote.origin.mirror=-1 push origin",
    "git -c remote.origin.mirror=1k push origin",
    "bash <<< \"git push -qf origin main\"", "sh <<< '/usr/bin/git push -qf origin main'",
    // A substitution inside a force word, escaped or decoded separators, a `!` alias
    // running the dashed program, a quoted mirror value, a `+` ref after a quoted `>`.
    "git push -q$(true)f origin main", "git push --for$(:)ce origin main", "git push -`true`f origin main",
    "git push origin +\"\"\"$(git branch --show-current)\"",
    "git -c a.b=\\; push -f origin main", "git -c a.b=$';' push -f origin main", "git -c a.b=$'\\n' push -f origin main",
    "git -c c.d=\\\" -c a.b=\"x;y\" push -f origin main", "git push origin main $'-\\u66'",
    "echo case; git -c a.b=$(:;) push -f origin main; echo esac",
    "case $b in main) git push origin $(git branch --show-current | tr a b) --force;; esac",
    "git -c alias.p='!git-push -f' p origin main", "git -c alias.p='!/usr/lib/git-core/git-push' p -f origin main",
    "git -c \"remote.origin.mirror= 1\" push origin", "git push origin -o \"x>\" +main",
    // A quoted substitution as a git option's value, and `case` as an argument.
    "git -C \"${REPO}\" push --force origin main", "git -C \"$(git rev-parse --show-toplevel)\" push -f origin main",
    "git -C \"`pwd`\" push -f origin main", "git --git-dir \"${GIT_DIR}\" push -f origin main",
    "git push $(git config --get x --ignore-case | head -1) -f origin main",
    // A variable standing for git, bare or with a default.
    "$GIT push -f origin main", "${GIT:-git} push -f origin main",
  ];
  // Text that only mentions a force push is blocked too: the guard reads text, not
  // shell grammar. The block message says to pass such text in a file.
  const mentions = [
    "rg -t sh -c 'git push -f'", "grep -rn -e eval -e 'git push -f' scripts/",
    "git grep -n -e eval -e 'git push -f'", "git log -S eval -S 'git push --force'",
    "python - <<'EOF'\nrows = ['git push -qf origin main']\nEOF",
    "cat > notes.md <<'EOF'\n## Force pushes\ngit push -f origin main\nEOF",
    // A quoted string spanning lines: its closing quote pairs with the next one on
    // its last line, so a later statement's flag reads as the push's.
    "git commit -m \"Fix the lock\n\nDetails here\" && git push origin main && rm -rf .cache && echo \"ok\"",
    // A Bash command with a `\` ending a line is read whole, so a force word
    // anywhere after its push blocks, even one of another command.
    "git push origin main \\\n  && rm -rf build", "echo a#b\\\ngit push -f origin main",
    "git commit -m \"fix #12: handle the lock \\\nit's stale now\" && git push origin main && rm -rf .cache && echo 'ok'",
    "# don't let git touch C:\\temp\\\ngit push origin main && rm -rf build && echo 'done'",
    "git push origin \"$BRANCH\"  # mirrors C:\\work\\repo\\\nrm -rf build",
    "git commit -m \"$(cat <<'EOF'\nfix: handle the lock\nEOF\n)\"\ngit push origin main  # mirrors C:\\work\\repo\\\nrm -rf build",
    "git commit -m \"$(cat <<'EOF'\nfix: push retries\n\ngit push -f was wrong\nEOF\n)\" && git push origin feature/x",
    "echo \"git push -f\"", "echo git push -f", "git commit -m \"Never run \\\"cd repo && git push -f\\\" here\"",
    "echo a \\\n# git push -f\ngit push origin x", "git push origin x # never -f here",
    "git commit -m \"unbalanced && git push -f",
  ];
  // The guard never asks: what it cannot see in the text runs as it would without it.
  // Project deny rules cover some of these by text.
  const unguarded = [
    "git push origin --delete old-branch", "git push -d origin old-branch",
    "git push origin --delete main && git push -u origin HEAD",
    // A branch deleted and then pushed again.
    "git push origin --delete main && git push origin main", "git push origin :main; git push origin main",
    "git push origin x 2>&1 | tail -1 | sh", "git push origin x | tee .git/config",
    "git push -o ci.skip origin x", "git push origin main:+notes",
    "git push --repo=origin", "git push $FLAGS origin main",
    "git remote add --mirror=push b https://example.com/b.git", "git config remote.b.mirror true",
    "git config alias.p 'push -f'", "git config --global alias.p 'push -f'",
    "hash -p /usr/bin/git g; g push -qf origin main", "alias g=git\ng push -qf origin main",
    "sh -c '/usr/bin/gi[t] push -qf origin main'",
    "gh alias set --shell p 'git \"$@\"'; gh p push -qf origin main", "gh extension exec pusher push -qf origin main",
    "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.push GIT_CONFIG_VALUE_0=+main:main git push origin",
    "echo -qf | xargs git push origin main",
    "git --config-env=remote.origin.mirror=HOME push origin", "export HOME=/tmp/e; git push origin",
    "git fetch --upload-pack='git pu\"\"sh -qf origin main; git-upload-pack' .",
    "G=git; $G push -qf origin main",
    // One probe per remaining out-of-reach item: a flag built at run time, another
    // program, a spaced option value with a subcommand name in it, quotes paired
    // differently from the shell.
    "git push $(echo -qf) origin main", "git push -{q,f} origin main", "make force-push",
    "git -C \"My notes dir\" push -f origin main", "echo '$('; git push origin main ')' -f",
  ];
  for (const cmd of both) {
    assert.equal(verdict("Bash", cmd), "deny", `Bash should block: ${cmd}`);
    assert.equal(verdict("PowerShell", cmd), "deny", `PowerShell should block: ${cmd}`);
  }
  for (const cmd of bashOnly) assert.equal(verdict("Bash", cmd), "deny", `Bash should block: ${cmd}`);
  for (const cmd of powershellOnly) assert.equal(verdict("PowerShell", cmd), "deny", `PowerShell should block: ${cmd}`);
  for (const cmd of allowed) assert.equal(verdict("Bash", cmd), "allow", `should allow: ${cmd}`);
  for (const cmd of hidden) assert.equal(verdict("Bash", cmd), "deny", `Bash should block: ${cmd}`);
  for (const cmd of mentions) assert.equal(verdict("Bash", cmd), "deny", `text mentions block: ${cmd}`);
  for (const cmd of unguarded) assert.equal(verdict("Bash", cmd), "allow", `passes by design: ${cmd}`);
  for (const cmd of ["git push origin feature/x 2>&1 | Select-Object -Last 1", "git push origin x 2>&1 | tail -1",
    // A carriage return ends a PowerShell line, so the `#` after it starts a comment.
    "git push origin main\r# -qf",
    // A parenthesized argument is one value; its words are not the push's.
    "git push origin (\"release/{0}\" -f $version)", "git push origin $(git branch --show-current)",
    "git push -u origin feature/x 2>&1 | Select-String -NotMatch remote",
    // A brace ends a statement, and a capitalized parameter is not a git flag.
    "if ($LASTEXITCODE -eq 0) { git push -u origin feature } else { Write-Host 'push skipped' -f Yellow }",
    "git push -u origin (Split-Path -Leaf (Get-Location))", "git push -u origin \"$($ticket)-fix\"",
    "git push -u origin (\"${TICKET}-fix\")", "git push -u origin @(\"$($t)-feature\")",
    "git push -u origin (\"$(git branch --show-current)-fix\")"]) {
    assert.equal(verdict("PowerShell", cmd), "allow", `PowerShell should allow: ${cmd}`);
  }
  // PowerShell text the guard reads although PowerShell would parse it differently:
  // a here-string, curly quotes, a Unicode space, text piped into `iex`.
  for (const cmd of ["$s = @'\ngit push -qf origin main\n'@",
    "git push origin main \u201c-qf\u201d", "git push origin \"x\u201c -qf \u201cy\"", "git push origin main\u00a0-qf",
    "echo 'git push -qf origin main' | iex", "Write-Output '; git push -qf origin main' | git commit --allow-empty -F - | iex",
    "echo 'git push -qf origin main'\n| iex", "Write-Output 'git push -qf origin main'\r\n| iex",
    "echo 'git push -qf origin main'\r  | iex", "Write-Output a`\n#; git push -qf origin main",
    // Quoted literals in a group are the command's arguments; a `+` glued to a substitution.
    "Start-Process git -ArgumentList @('push', '--force', 'origin', 'main') -NoNewWindow -Wait",
    "& git @('push','-qf','origin','main')", "git push ('-qf') origin main",
    "git push origin \"+$($b)\"", "git push origin \"+${b}\"", "& { git push -f origin main }",
    // A brace inside quotes, and an escaped separator.
    "git push origin 'main@{1}:main' --force", "git push origin \"@{u}\" -f", "git -c a.b=`; push -f origin main",
    "git -C \"$(Get-Location)\" push -f origin main", "git -C \"${env:REPO}\" push -f origin main",
    // A `\` ending a PowerShell path is no continuation; a backtick continuation is a space.
    "Set-Location C:\\work\\repo\\\ngit push -f origin main", "git push`\n-f origin main", "git push`\r\n-f origin main"]) {
    assert.equal(verdict("PowerShell", cmd), "deny", `PowerShell should block: ${cmd}`);
  }
  // PowerShell forms whose force flag is not in the text.
  for (const cmd of ["git push @args", "git push $flags origin main",
    // PowerShell evaluates a parenthesized argument; Set-Item changes the environment next to a push.
    "git push origin main ('-q'+'f')", "git push origin (\"+{0}\" -f $b)", "Set-Item Env:HOME C:/e; git push origin",
    // After `--%` PowerShell passes separators through as words.
    "git push origin main -o --% ; -qf",
    // A program name built at run time, and a PowerShell alias for git.
    "&('gi'+'t') push -qf origin main",
    "sal -Value git g; g push -qf origin main", "Set-Alias -Value git -Name g; g push -qf origin main"]) {
    assert.equal(verdict("PowerShell", cmd), "allow", `PowerShell passes by design: ${cmd}`);
  }
  // Hooks run in the project directory; a repo's own json.py must not replace the hook's imports.
  const shadowed = mkdtempSync(join(tmpdir(), "push-guard-cwd-"));
  writeFileSync(join(shadowed, "json.py"), "raise SystemExit(1)\n");
  const inShadow = spawnSync(entry.command, entry.args, { cwd: shadowed, encoding: "utf8",
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push -qf origin main" } }) });
  assert.equal(decide(inShadow), "deny", "a project json.py must not disable the guard");
  assert.equal(verdict("Read", "git push -f"), "allow", "other tools pass");
  // An allowed push prints nothing at all, and no call relies on a positional
  // `maxsplit`, which Python 3.13 warns about on stderr.
  const lease = runHook(home, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push --force-with-lease origin x" } }));
  assert.equal(`${lease.stdout}${lease.stderr}`, "", "an allowed push prints nothing");
  const escapes = runHook(home, JSON.stringify({ tool_name: "Bash", tool_input: { command: "printf $'\\e[1mdone\\q\\n'; git push origin x" } }));
  assert.equal(`${escapes.stdout}${escapes.stderr}`, "", "escapes Python does not know print nothing");
  assert.doesNotMatch(readFileSync(join(repo, "_core/global-template/hooks/push-guard.py"), "utf8"),
    /re\.split\([^)]*,\s*\d+\)/, "maxsplit is passed by keyword");
  assert.equal(decide(runHook(home, "not json")), "allow", "bad input fails open");
  // Over MAX_COMMAND characters the guard passes without reading; at the cap it still reads.
  const atCap = "git log " + "x ".repeat(49983) + "; git push -qf origin main";
  assert.equal(atCap.length, 100000, "the cap probe is exactly MAX_COMMAND characters");
  assert.equal(verdict("Bash", atCap), "deny", "a force push at the length cap blocks");
  assert.equal(verdict("Bash", "git log x " + atCap.slice(8)), "allow", "a force push over the length cap passes unread");
  // A timed-out hook lets the call through, so long commands must answer well inside the timeout.
  for (const repeat of [4900, 50000]) {
    const long = "git log " + "git ".repeat(repeat) + "; echo -qf | xargs git push origin main";
    const started = Date.now();
    assert.equal(verdict("Bash", long), "allow", `a ${long.length}-character command passes`);
    assert.ok(Date.now() - started < 3000, `a ${long.length}-character command answers quickly`);
  }
  // A statement near the length cap, inside nested shell strings, answers well inside the timeout.
  const wide = "sh -c \"sh -c 'git log " + "x ".repeat(9000) + "'\"; git push -qf origin main";
  const wideStart = Date.now();
  assert.equal(verdict("Bash", wide), "deny", `a ${wide.length}-character nested command blocks`);
  assert.ok(Date.now() - wideStart < 3000, "a long nested command answers quickly");
  // Many `eval` words stay linear: one check covers the rest of the statement.
  const evals = "eval ".repeat(30) + "echo push; git push -qf origin main";
  const evalStart = Date.now();
  assert.equal(verdict("Bash", evals), "deny", "a push after many eval words blocks");
  assert.ok(Date.now() - evalStart < 3000, "many eval words answer quickly");
  assert.equal(verdict("PowerShell", "# it's\ngit push origin main `\n-qf"), "deny", "PowerShell continuation after a comment");
  // Deeply nested substitutions stay linear: only the outermost groups are checked again.
  // Chained heredocs inside substitutions stay linear, with the push in a later group.
  let chain = "echo push";
  for (let j = 29; j >= 0; j--) chain = `$(cat <<E${j}\n${chain}\nE${j}\n)`;
  chain = `: ${chain} $(git push -qf origin main)`;
  const chainStart = Date.now();
  assert.equal(verdict("Bash", chain), "deny", "a push after chained heredocs blocks");
  assert.ok(Date.now() - chainStart < 3000, "chained heredocs answer quickly");
  // Every step is linear: long runs that would make a backtracking pattern retry
  // from each character answer quickly, and a push next to them still blocks.
  for (const [label, cmd, want, tool] of [
    ["digit run", "git push -f " + "1".repeat(99000), "deny"],
    ["flag letters", "git push -" + "f".repeat(99000) + ". origin main", "allow"],
    ["remote setting", "git -c remote." + "a.".repeat(49000) + " push", "allow"],
    ["case words", "case ".repeat(19000) + "; git push -qf origin main", "deny"],
    ["openers", "$( ".repeat(30000) + "; git push -qf origin main", "deny"],
    ["quotes", "\"'".repeat(49000) + "\ngit push -qf origin main", "deny"],
    ["redirects", "> ".repeat(49000) + "; git push -qf origin main", "deny"],
    ["escaped quotes", "git push -qf origin main # " + "\"\\".repeat(49980), "deny"],
    ["PowerShell escaped quotes", "git push -qf origin main # " + "\"`".repeat(49980), "deny", "PowerShell"],
    ["nested literal groups", ("(".repeat(64) + "'>>>>',".repeat(14100) + "'a'" + ")".repeat(64) +
      "; git push -qf origin main").slice(-99999), "deny", "PowerShell"]]) {
    const start = Date.now();
    assert.equal(verdict(tool || "Bash", cmd), want, `${label}: ${want}`);
    assert.ok(Date.now() - start < 3000, `${label} answers quickly`);
  }
  // PowerShell argument groups and `&` look back only to the last word, so a long command stays linear.
  const psLong = "Write-Output " + "x (y) ".repeat(3000) + "; git push -qf origin main";
  const psStart = Date.now();
  assert.equal(verdict("PowerShell", psLong), "deny", "a push after many PowerShell groups blocks");
  assert.ok(Date.now() - psStart < 3000, "many PowerShell groups answer quickly");
  // A long git option run is read once, not again from each `git` value in it.
  const optionRun = "git -c ".repeat(2800) + "xpush; git push -qf origin main";
  const optionStart = Date.now();
  assert.equal(verdict("Bash", optionRun), "deny", "a push after a long git option run blocks");
  assert.ok(Date.now() - optionStart < 3000, "a long git option run answers quickly");
  // Strings and `!` aliases that hold every later word are checked once, not once per word.
  for (const [label, unit] of [["pwsh -Command", "pwsh -c "], ["! alias", "git -c alias.a=!: a "]]) {
    const repeated = ": " + unit.repeat(30) + "push; git push -qf origin main";
    const start = Date.now();
    assert.equal(verdict("Bash", repeated), "deny", `a push after repeated ${label} words blocks`);
    assert.ok(Date.now() - start < 3000, `repeated ${label} words answer quickly`);
  }
  // The block message says how to pass text that only mentions a force push.
  const mention = runHook(home, JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo git push -f" } }));
  assert.match(mention.stderr, /put that text in a file/, "the block message covers text mentions");
  // It also says how to pass a continued command whose force word is another command's.
  const continued = runHook(home, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin main \\\n  && rm -rf build" } }));
  assert.equal(continued.status, 2, "a continued push with a later force word blocks");
  assert.match(continued.stderr, /put it on one line or run the push as its own command/, "the block message covers continued commands");
  const nested = "x=" + "$(echo ".repeat(2400) + ")".repeat(2400) + "; git push -qf origin main";
  const nestedStart = Date.now();
  assert.equal(verdict("Bash", nested), "deny", `a ${nested.length}-character nested command blocks`);
  assert.ok(Date.now() - nestedStart < 3000, "a deeply nested command answers quickly");
});

test("bad answers are rejected", async () => {
  const a = defaults();
  a.project.name = "../escape";
  await assert.rejects(run(a), /project name/);
});
