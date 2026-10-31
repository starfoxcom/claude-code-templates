// /bindwright:doctor on throwaway repos: a healthy repo passes every check,
// and each broken part gets its own plain finding with a fix. Both engines
// run each case and must report the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bind } from "../bind.js";
import { defaults } from "../model.js";
import { applyFiles } from "../apply.js";
import { cliVersionFrom } from "../doctor.js";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreFiles = JSON.parse(readFileSync(join(engine, "core-files.json"), "utf8"));
const readFile = async (p) => readFileSync(join(engine, "..", p), "utf8");
const VERSION = readFileSync(join(engine, "..", "VERSION"), "utf8").trim().replace(/^v+/, "");
const STAGING = ".bindwright/incoming/";

// A repo bound and set up as of today's VERSION; `change(at)` breaks it.
async function scene(change) {
  const root = mkdtempSync(join(tmpdir(), "bw-doctor-"));
  const repo = join(root, "repo");
  const config = join(root, "config");
  const files = await bind(defaults(), { readFile, coreFiles, year: 2026, version: VERSION });
  applyFiles([...files.entries()], repo);
  const at = (p) => join(repo, ...p.split("/"));
  for (const [dest, text] of files) {
    if (dest.startsWith(STAGING)) writeFileSync(at(dest.slice(STAGING.length)), text);
  }
  rmSync(at(STAGING), { recursive: true, force: true });
  change({ at, config });
  return { root, repo, config };
}

const engines = [[process.execPath, [join(engine, "cli.js")]], [python, ["-I", join(engine, "bind.py")]]];

// Both engines' --doctor on identical scenes; returns the shared report.
async function doctor(change = () => {}, agent = "claude-code_2-1-316_agent") {
  const outs = [];
  for (const [cmd, args] of python ? engines : engines.slice(0, 1)) {
    const s = await scene(change);
    try {
      const env = { ...process.env, CLAUDE_CONFIG_DIR: s.config, AI_AGENT: agent };
      const out = spawnSync(cmd, [...args, "--doctor", s.repo], { env, encoding: "utf8" });
      outs.push(out.stdout.replaceAll(JSON.stringify(s.repo).slice(1, -1), "<repo>"));
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  }
  if (outs.length === 2) assert.equal(outs[1], outs[0], "both engines alike");
  return JSON.parse(outs[0]);
}

const needsPython = { skip: !python && "needs Python 3.8+" };
const failing = (report) => report.checks.filter((c) => !c.ok).map((c) => c.id);

test("the CLI version is read from the session's own agent name", () => {
  assert.deepEqual(cliVersionFrom("claude-code_2-1-286_agent"), [2, 1, 286]);
  for (const bad of [undefined, "", "claude-code", "other_2-1-286_agent"]) assert.equal(cliVersionFrom(bad), null);
});

test("a healthy repo passes every check", needsPython, async () => {
  const report = await doctor();
  assert.equal(report.problems, 0, JSON.stringify(failing(report)));
  const ids = ["state", "version", "guards", "staged", "settings", "extras", "cli"];
  assert.deepEqual(report.checks.map((c) => c.id), ids);
});

test("broken or missing state files stop at the first check, with the fix", needsPython, async () => {
  const broken = await doctor(({ at }) => writeFileSync(at(".bindwright/project.json"), "{"));
  assert.deepEqual(broken.checks.map((c) => c.id), ["state"]);
  assert.match(broken.checks[0].say, /project\.json is not valid JSON/);
  assert.match(broken.checks[0].fix, /git checkout -- \.bindwright\//);
  const invalid = await doctor(({ at }) => writeFileSync(at(".bindwright/project.json"), '{"team": 1}'));
  assert.match(invalid.checks[0].say, /saved answers .* are broken: Invalid answers/);
  const none = await doctor(({ at }) => rmSync(at(".bindwright/pristine.json")));
  assert.equal(none.checks[0].fix, "Run /bindwright:setup.");
});

test("a missing guard, an old repo and waiting staged files are each named", needsPython, async () => {
  const report = await doctor(({ at }) => {
    rmSync(at(".claude/hooks/push-guard.py"));
    const pristine = JSON.parse(readFileSync(at(".bindwright/pristine.json"), "utf8"));
    writeFileSync(at(".bindwright/pristine.json"), JSON.stringify({ ...pristine, version: "0.0.1" }));
    mkdirSync(dirname(at(`${STAGING}docs/x.md`)), { recursive: true });
    writeFileSync(at(`${STAGING}docs/x.md`), "x\n");
  });
  assert.deepEqual(failing(report), ["version", "guards", "staged"]);
  const say = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  assert.match(say.version.fix, /\/bindwright:update/);
  assert.match(say.guards.say, /push-guard\.py\. Force pushes are not blocked here/);
  assert.match(say.staged.say, /1 staged file\(s\) .*: docs\/x\.md\./);
});

test("a plugin older than the repo, or no readable version, is named with its own fix", needsPython, async () => {
  const withVersion = (version) => doctor(({ at }) => {
    const pristine = JSON.parse(readFileSync(at(".bindwright/pristine.json"), "utf8"));
    writeFileSync(at(".bindwright/pristine.json"), JSON.stringify({ ...pristine, version }));
  });
  const newer = (await withVersion("999.0.0")).checks.find((c) => c.id === "version");
  assert.equal(newer.ok, false);
  assert.match(newer.fix, /Update the Bindwright plugin .* do not run \/bindwright:update/);
  for (const version of [undefined, "2.0"]) {
    const unread = (await withVersion(version)).checks.find((c) => c.id === "version");
    assert.equal(unread.ok, false);
    assert.match(unread.say, /names no version/);
  }
});

test("a staging folder that is a file is named, not a crash", needsPython, async () => {
  const report = await doctor(({ at }) => writeFileSync(at(STAGING.slice(0, -1)), "not a folder\n"));
  assert.deepEqual(failing(report), ["staged"]);
  assert.match(report.checks.find((c) => c.id === "staged").say, /cannot be read as a folder/);
});

test("an old CLI is named only with mods installed and the session's version known", needsPython, async () => {
  const withMods = ({ config }) => mkdirSync(join(config, "mods", "session-facts"), { recursive: true });
  const old = await doctor(withMods, "claude-code_2-1-286_agent");
  assert.deepEqual(failing(old), ["cli"]);
  assert.match(old.checks.at(-1).say, /runs CLI 2\.1\.286, older than the 2\.1\.287/);
  assert.match(old.checks.at(-1).fix, /Claude Desktop, update the app/);
  assert.equal((await doctor(withMods, "")).problems, 0, "unknown version");
  assert.equal((await doctor(() => {}, "claude-code_2-1-286_agent")).problems, 0, "no mods");
  // A mod whose name ends like a guard's is still a mod; a guard hook alone needs no newer CLI.
  const guardNamedMod = ({ config }) => mkdirSync(join(config, "mods", "usage-guard"), { recursive: true });
  assert.deepEqual(failing(await doctor(guardNamedMod, "claude-code_2-1-286_agent")), ["cli"]);
  const guardHook = ({ config }) => {
    mkdirSync(join(config, "hooks"), { recursive: true });
    writeFileSync(join(config, "hooks", "push-guard.py"), "");
  };
  assert.equal((await doctor(guardHook, "claude-code_2-1-286_agent")).problems, 0, "a guard hook only");
});
