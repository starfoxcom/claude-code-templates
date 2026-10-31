// The packed plugin (tools/pack_plugin.py) carries everything setup needs:
// its engine, run from the pack alone, binds what the repo's engine binds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defaults } from "../model.js";
import { encodeSetupCode } from "../setupcode.js";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(engine, "..");
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });

test("the packed plugin binds what the repo's engine binds", { skip: !python && "needs Python 3.8+" }, () => {
  const root = mkdtempSync(join(tmpdir(), "bw-pack-"));
  try {
    const out = join(root, "bindwright");
    const packed = run(python, [join(repo, "tools", "pack_plugin.py"), "--out", out]);
    assert.equal(packed.status, 0, packed.stderr);
    const manifest = JSON.parse(readFileSync(join(out, ".claude-plugin", "plugin.json"), "utf8"));
    assert.equal(manifest.version, readFileSync(join(repo, "VERSION"), "utf8").trim().replace(/^v/, ""));
    assert.ok(existsSync(join(out, "skills", "setup", "SKILL.md")));

    const team = defaults({ team: true, client: true });
    // Every template family: pre-commit, architecture, the research hook and the home guards.
    team.advanced = {
      ...team.advanced, precommit: "husky", architecture: "hexagonal", codeResearch: "codegraph", hookLocation: "home",
    };
    for (const answers of [defaults(), team]) {
      const args = ["--code", encodeSetupCode(answers), "--year", "2026"];
      const expected = run(process.execPath, [join(engine, "cli.js"), ...args]);
      assert.equal(expected.status, 0, expected.stderr);
      const js = run(process.execPath, [join(out, "engine", "cli.js"), ...args]);
      const py = run(python, ["-I", join(out, "engine", "bind.py"), ...args]);
      assert.equal(js.stdout, expected.stdout, js.stderr);
      assert.equal(py.stdout, expected.stdout, py.stderr);
    }

    // A second pack replaces the first; a folder that is not a pack is left alone.
    assert.equal(run(python, [join(repo, "tools", "pack_plugin.py"), "--out", out]).status, 0);
    const other = join(root, "other");
    mkdirSync(other);
    writeFileSync(join(other, "keep.txt"), "mine");
    const refused = run(python, [join(repo, "tools", "pack_plugin.py"), "--out", other]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Refusing to replace/);
    assert.equal(readFileSync(join(other, "keep.txt"), "utf8"), "mine");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Packed paths with edits git has not recorded: the zip (built from git) and
// the folder pack (from the working tree) would then differ on purpose.
const PACKED = ["plugin", "engine", "_core", "VERSION"];
const dirty = run("git", ["-C", repo, "status", "--porcelain", "--", ...PACKED]).stdout.trim() !== "";

test("the release zip has the same bytes on every build and the folder pack's files", {
  skip: (!python && "needs Python 3.8+") || (dirty && "packed files have uncommitted edits"),
}, () => {
  const root = mkdtempSync(join(tmpdir(), "bw-zip-"));
  try {
    const zip = (name) => {
      const out = run(python, [join(repo, "tools", "pack_plugin.py"), "--zip", join(root, name)]);
      assert.equal(out.status, 0, out.stderr);
      return readFileSync(join(root, name));
    };
    assert.ok(zip("a.zip").equals(zip("b.zip")), "two builds, one set of bytes");
    const list = "import sys, zipfile; print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))";
    const names = run(python, ["-c", list, join(root, "a.zip")]).stdout.trim().split(/\r?\n/);
    assert.equal(run(python, [join(repo, "tools", "pack_plugin.py"), "--out", join(root, "dir")]).status, 0);
    const walk = run(python, ["-c", "import os, sys; r = sys.argv[1]; print('\\n'.join(sorted("
      + "os.path.relpath(os.path.join(d, f), r).replace(os.sep, '/') for d, _, fs in os.walk(r) for f in fs)))",
    join(root, "dir")]).stdout.trim().split(/\r?\n/);
    assert.deepEqual(names, walk.filter((p) => p !== ".bindwright-pack"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the marketplace file lists the release zip by version and SHA-256", { skip: !python && "needs Python 3.8+" }, () => {
  const script = "import sys; sys.path.insert(0, sys.argv[1]); import pack_plugin as p; "
    + "print(p.marketplace({'version': '2.0.0', 'description': 'd'}, 'ab' * 32), end='')";
  const out = run(python, ["-I", "-c", script, join(repo, "tools")]);
  assert.equal(out.status, 0, out.stderr);
  const market = JSON.parse(out.stdout);
  assert.equal(market.name, "bindwright");
  assert.deepEqual(market.plugins, [{
    name: "bindwright",
    description: "d",
    version: "2.0.0",
    source: {
      source: "archive",
      url: "https://github.com/starfoxcom/claude-code-templates/releases/download/v2.0.0/bindwright-2.0.0.zip",
      sha256: "ab".repeat(32),
    },
  }]);
});
