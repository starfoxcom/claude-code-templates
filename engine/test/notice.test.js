// The plugin's SessionStart notice (plugin/hooks/notice.mjs): what it says,
// that it says it at most once a day per repo, asks the network at most once
// a day, and stays quiet offline. The last case runs the hook's own command
// from a fresh pack.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { notice, older, findRepo } from "../../plugin/hooks/notice.mjs";
import { python } from "./python.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// A temp folder with a set-up repo at its `repo/` (files from `version`), a
// cache path, and `ask`, the notice for plugin 1.4.0 on a given day.
function scene(version) {
  const root = mkdtempSync(join(tmpdir(), "bw-notice-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, ".bindwright"));
  writeFileSync(join(repo, ".bindwright", "pristine.json"), JSON.stringify({ version, year: 2026, files: {} }));
  const cacheFile = join(root, "config", "bindwright", "notice.json");
  const ask = (today, fetchLatest, cwd = repo) =>
    notice({ cwd, today, cacheFile, pluginVersion: "1.4.0", fetchLatest });
  return { root, repo, cacheFile, ask };
}

// A fetch stand-in that counts its calls.
function latest(version) {
  const f = async () => {
    f.calls += 1;
    if (version instanceof Error) throw version;
    return version;
  };
  f.calls = 0;
  return f;
}

test("versions compare by number, and unreadable ones never count as older", () => {
  assert.equal(older("1.4.0", "1.10.0"), true);
  assert.equal(older("v1.4.0", "1.4.1"), true);
  assert.equal(older("1.4.0", "1.4.0"), false);
  assert.equal(older("2.0.0", "1.9.9"), false);
  for (const bad of [null, undefined, "", "1.4", "next"]) {
    assert.equal(older(bad, "1.0.0"), false);
    assert.equal(older("1.0.0", bad), false);
  }
});

test("the repo is found from a subfolder, and the search stops at a git root", () => {
  const s = scene("1.0.0");
  try {
    mkdirSync(join(s.repo, "src", "deep"), { recursive: true });
    assert.equal(findRepo(join(s.repo, "src", "deep")), s.repo);
    const plain = join(s.repo, "vendor", "lib");
    mkdirSync(join(plain, ".git"), { recursive: true });
    assert.equal(findRepo(plain), null);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("a repo behind the plugin hears about /bindwright:update once a day", async () => {
  const s = scene("1.3.0");
  try {
    const same = latest("1.4.0");
    assert.match(await s.ask("2026-10-31", same), /from 1\.3\.0 and the plugin is 1\.4\.0: \/bindwright:update/);
    assert.equal(await s.ask("2026-10-31", same), null);
    assert.match(await s.ask("2026-11-01", same), /\/bindwright:update/);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("a newer plugin is announced outside any repo too", async () => {
  const s = scene("1.4.0");
  try {
    const text = await s.ask("2026-10-31", latest("1.5.0"), s.root);
    assert.equal(text, "Bindwright 1.5.0 is out; this machine has 1.4.0. Update the plugin with /plugin.");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("the network is asked at most once a day, and nothing up to date says anything", async () => {
  const s = scene("1.4.0");
  try {
    const fetchLatest = latest("1.4.0");
    assert.equal(await s.ask("2026-10-31", fetchLatest), null);
    assert.equal(await s.ask("2026-10-31", fetchLatest), null);
    assert.equal(fetchLatest.calls, 1);
    await s.ask("2026-11-01", fetchLatest);
    assert.equal(fetchLatest.calls, 2);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("offline is quiet, and keeps what the last check found", async () => {
  const s = scene("1.4.0");
  try {
    const offline = latest(new Error("ENOTFOUND"));
    assert.equal(await s.ask("2026-10-31", offline), null);
    assert.equal(offline.calls, 1);
    // Online yesterday found 1.5.0: an offline day still knows it.
    writeFileSync(s.cacheFile, JSON.stringify({ checked: "2026-11-01", latest: "1.5.0", shown: {} }));
    assert.match(await s.ask("2026-11-02", offline), /1\.5\.0 is out/);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("a damaged cache is replaced instead of breaking the notice", async () => {
  const s = scene("1.3.0");
  try {
    mkdirSync(dirname(s.cacheFile), { recursive: true });
    for (const damaged of ["not json", JSON.stringify({ shown: 5 }), "null"]) {
      writeFileSync(s.cacheFile, damaged);
      assert.match(await s.ask("2026-10-31", latest(null)), /\/bindwright:update/, damaged);
      assert.equal(JSON.parse(readFileSync(s.cacheFile, "utf8")).shown[s.repo], "2026-10-31");
    }
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

const bash = spawnSync("bash", ["-c", "true"]).status === 0;

const needs = { skip: !(python && bash) && "needs Python 3.8+ and bash" };

test("the hook's own command, run from a pack, tells the user and then stays quiet", needs, () => {
  const s = scene("0.1.0");
  try {
    const plugin = join(s.root, "bindwright");
    const pack = [join(repoRoot, "tools", "pack_plugin.py"), "--out", plugin];
    const packed = spawnSync(python, pack, { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    const hooks = JSON.parse(readFileSync(join(plugin, "hooks", "hooks.json"), "utf8")).hooks;
    const { command } = hooks.SessionStart[0].hooks[0];
    const env = {
      ...process.env, CLAUDE_PLUGIN_ROOT: plugin, CLAUDE_CONFIG_DIR: join(s.root, "config"),
      BINDWRIGHT_LATEST_URL: "http://127.0.0.1:9/VERSION", // nothing listens there: offline
    };
    const input = JSON.stringify({ cwd: s.repo });
    const run = () => spawnSync("bash", ["-c", command], { env, input, encoding: "utf8" });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const out = JSON.parse(first.stdout);
    assert.match(out.systemMessage, /from 0\.1\.0 .*\/bindwright:update/);
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    assert.equal(out.hookSpecificOutput.additionalContext, out.systemMessage);
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, "");
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
