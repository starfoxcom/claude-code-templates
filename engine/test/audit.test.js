// What /bindwright:audit measures (audit.js, audit.py): each check counts the
// calls its rule applies to and the ones that broke it, a call copied into a
// later session counts once, and both engines report the same numbers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commitMessage, logFolder } from "../audit.js";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const needsPython = { skip: !python && "needs Python 3.8+" };
const RULES = [".claude/rules/git.md", ".claude/rules/task-tracking.md", ".claude/rules/token-efficiency.md",
  ".claude/skills/find/SKILL.md"];

const use = (id, name, input, at = "2026-10-30T09:15:00.000Z") =>
  ({ type: "assistant", timestamp: at, message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id, content) =>
  ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
const bash = (id, command) => use(id, "Bash", { command });
const jsonl = (lines) => `${lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n")}\n`;

const NEWER = [
  bash("c1", 'git commit -m "feat(engine): add a thing"'),
  bash("c2", "git add x && git commit -qm 'Added stuff'"),
  bash("c3", "git commit -m \"$(cat <<'EOF'\nfix: a heredoc message\n\nbody\nEOF\n)\""),
  bash("c4", "grep -rn \"a|git commit -m 'not a commit'\" src"),
  bash("w1", "gh pr create --title x --body-file f"),
  result("w1", [{ type: "text", text: "PreToolUse:Bash hook error: BLOCKED (no AI attribution): marker found" }]),
  bash("w5", 'git -C repo commit -m "docs: c"'),
  result("w5", [{ type: "text", text: "PreToolUse:Bash hook error: BLOCKED (no AI attribution): marker found" }]),
  bash("ci1", "gh run watch 12"),
  bash("ci2", "gh pr checks 3 --json name,bucket"),
  // A heredoc body and an escaped quote are text, not commands; an escaped quote outside quotes is.
  bash("h1", "cat > body.md <<'EOF'\ngh run watch 12\ngit commit -m \"wip\"\nEOF"),
  bash("h2", "git commit -m \"$(cat <<'EOF'\ndocs: \"quote\" the thing\n\nEOF\n)\""),
  bash("b1", 'echo "a \\"; gh run watch 1"'),
  bash("b2", 'echo \\"; gh run watch 1'),
  bash("g1", 'git commit -F msg.txt && git tag -a v1 -m "v1"'),
  use("t2", "TaskCreate", { subject: "y" }), // copied from the older session by a fork
  use("r1", "mcp__tokensave__tokensave_search", { query: "x" }),
  use("r2", "Grep", { pattern: "foo", path: "src" }),
  use("r3", "Grep", { pattern: "x", glob: "*.md" }),
  ...["e1", "e2", "e3"].map((id) => use(id, "Edit", { file_path: id })),
];
const OLDER = [
  "not json",
  '{"message": {"content": "plain text"}}',
  bash("ci1", "gh run watch 12"), // copied from the newer session by a fork: counted there only
  use("t2", "TaskCreate", { subject: "y" }, "2026-10-28T08:00:00.000Z"),
  use("r9", "mcp__tokensave__tokensave_context", { task: "x" }, "2026-10-28T08:05:00.000Z"),
  // Lines Python's parser alone would refuse: nested too deep, or a number past 4,300 digits.
  `{"message": {"content": [{"type": "tool_use", "id": "deep", "name": "Grep", "input": {"pattern": "d"}}]}, `
    + `"x": ${"[".repeat(1100)}${"]".repeat(1100)}}`,
  `{"message": {"content": [{"type": "tool_use", "id": "big", "name": "Grep", "input": {"pattern": "big"}}]}, `
    + `"x": 1${"0".repeat(5000)}}`,
];
const OLDEST = ["o1", "o2", "o3"].map((id) => use(id, "Edit", { file_path: id }));
const AGENT = ["w2", "w3", "w4"].map((id) => use(id, "Write", { file_path: id }));

function scene({ rules = RULES, logs = true, answers = { codeResearch: "tokensave" } } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bw-audit-"));
  const repo = join(root, "repo");
  for (const rule of rules) {
    mkdirSync(dirname(join(repo, rule)), { recursive: true });
    writeFileSync(join(repo, rule), "# rule\n");
  }
  mkdirSync(join(repo, ".bindwright"), { recursive: true });
  writeFileSync(join(repo, ".bindwright", "project.json"), JSON.stringify({ advanced: answers }));
  const folder = join(root, "config", "projects", resolve(repo).replace(/[^A-Za-z0-9]/g, "-"));
  if (logs) {
    mkdirSync(join(folder, "older", "subagents"), { recursive: true });
    writeFileSync(join(folder, "newer.jsonl"), jsonl(NEWER));
    writeFileSync(join(folder, "older.jsonl"), jsonl(OLDER));
    writeFileSync(join(folder, "older", "subagents", "agent-1.jsonl"), jsonl(AGENT));
    writeFileSync(join(folder, "oldest.jsonl"), jsonl(OLDEST));
    utimesSync(join(folder, "oldest.jsonl"), new Date("2026-10-27"), new Date("2026-10-27"));
    utimesSync(join(folder, "older.jsonl"), new Date("2026-10-28"), new Date("2026-10-28"));
    utimesSync(join(folder, "newer.jsonl"), new Date("2026-10-30"), new Date("2026-10-30"));
  }
  return { root, repo };
}

// Runs --audit with each engine and requires the same output from both.
function audit(options) {
  const s = scene(options);
  try {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: join(s.root, "config") };
    const engines = [[process.execPath, [join(engine, "cli.js")]]];
    if (python) engines.push([python, ["-I", join(engine, "bind.py")]]);
    const outs = engines.map(([cmd, args]) => {
      const out = spawnSync(cmd, [...args, "--audit", s.repo], { env, encoding: "utf8" });
      return { ...JSON.parse(out.stdout), status: out.status };
    });
    if (outs.length === 2) assert.deepEqual(outs[1], outs[0], "both engines alike");
    return outs[0];
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
}

const byId = (out) => Object.fromEntries(out.checks.map((c) => [c.id, c]));
const counts = (c) => [c.seen, c.broken, c.examples.map((e) => e.text)];

test("each check counts where its rule applied and where it broke", needsPython, () => {
  const out = audit();
  assert.equal(out.status, 0);
  assert.equal(out.logs.sessions, 3);
  assert.equal(out.logs.from, "2026-10-28");
  assert.equal(out.logs.to, "2026-10-30");
  const c = byId(out);
  assert.deepEqual(counts(c["commit-format"]), [5, 1, ["Added stuff"]]);
  const blocked = ["gh pr create --title x --body-file f", 'git -C repo commit -m "docs: c"'];
  assert.deepEqual(counts(c.attribution), [7, 2, blocked]);
  assert.deepEqual(counts(c["ci-watch"]), [3, 2, ["gh run watch 12", 'echo \\"; gh run watch 1']]);
  assert.deepEqual(counts(c["code-research"]), [4, 2, ["Grep foo", "Grep big"]]);
  // Both sides of the fork made a task list; only the oldest session did not.
  assert.deepEqual(counts(c["task-tracking"]), [3, 1, ["3 edits, no task list"]]);
  assert.equal(c["task-tracking"].examples[0].session, "oldest");
  assert.deepEqual(c["commit-format"].examples[0], { session: "newer", when: "2026-10-30 09:15", text: "Added stuff" });
  assert.deepEqual(out.skipped, []);
});

test("a check whose rule the repo lacks is skipped, and no logs count nothing", needsPython, () => {
  const out = audit({ rules: [".claude/rules/git.md"], logs: false });
  assert.deepEqual(out.logs, { folder: null, sessions: 0, from: null, to: null });
  assert.deepEqual(out.checks.map(counts), [[0, 0, []], [0, 0, []]]);
  assert.deepEqual(out.skipped.map((s) => s.id), ["code-research", "task-tracking", "ci-watch"]);
});

test("the commit message comes from -m, a heredoc, or not at all", () => {
  const cases = [
    ['git commit -m "fix: a"', "fix: a"],
    ["git -C repo commit -am 'docs: b'", "docs: b"],
    ['git commit --message="style: c\n\nbody"', "style: c"],
    ['git commit -m "say \\"hi\\""', 'say "hi"'],
    ["git commit -F msg.txt", null],
    ["echo git commit -m 'x'", null],
    ["git commit -m 'unclosed", null],
    ['git commit -F msg.txt && git tag -a v1.3.0 -m "v1.3.0"', null],
    ["git commit -m \"$(cat <<'EOF'\ndocs: \"quote\" the thing\n\nEOF\n)\"", 'docs: "quote" the thing'],
    ['echo "x \\"; git commit -m y"', null],
  ];
  for (const [command, want] of cases) assert.equal(commitMessage(command), want, command);
  if (!python) return;
  const script = "import json, sys; sys.path.insert(0, sys.argv[1]); from audit import commit_message; "
    + "print(json.dumps([commit_message(c) for c in json.load(sys.stdin)]), end='')";
  const py = spawnSync(python, ["-I", "-c", script, engine], { input: JSON.stringify(cases.map(([c]) => c)),
    encoding: "utf8" });
  assert.deepEqual(JSON.parse(py.stdout), cases.map(([, want]) => want), py.stderr);
});

test("both engines spell a folder with a character past U+FFFF the way the CLI does", needsPython, () => {
  const root = mkdtempSync(join(tmpdir(), "bw-audit-"));
  try {
    const repo = join(root, "📦", "app");
    mkdirSync(repo, { recursive: true });
    // The CLI replaces each UTF-16 unit, so the emoji becomes two dashes.
    const name = resolve(repo).replace(/[^A-Za-z0-9]/g, "-");
    mkdirSync(join(root, "config", "projects", name), { recursive: true });
    assert.equal(logFolder(repo, join(root, "config")), name);
    const script = "import sys; sys.path.insert(0, sys.argv[1]); from audit import log_folder; "
      + "print(log_folder(sys.argv[2], sys.argv[3]), end='')";
    const py = spawnSync(python, ["-I", "-c", script, engine, repo, join(root, "config")], { encoding: "utf8" });
    assert.equal(py.stdout, name, py.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a log folder name past 200 characters is found by its first 200", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-audit-"));
  try {
    const repo = join(root, "r".repeat(220));
    const name = `${resolve(repo).replace(/[^A-Za-z0-9]/g, "-").slice(0, 200)}-1a2b3c`;
    mkdirSync(join(root, "config", "projects", name), { recursive: true });
    assert.equal(logFolder(repo, join(root, "config")), name);
    assert.equal(logFolder(join(root, "other"), join(root, "config")), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a custom code-research tool with no URL skips that check in both engines", needsPython, () => {
  for (const custom of [{ name: "foo" }, { name: "foo", url: 7 }]) {
    const out = audit({ answers: { codeResearch: "custom", codeResearchCustom: custom } });
    assert.equal(out.status, 0);
    assert.ok(out.skipped.some((s) => s.id === "code-research"), JSON.stringify(out.skipped));
  }
});
