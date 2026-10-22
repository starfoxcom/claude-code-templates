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
