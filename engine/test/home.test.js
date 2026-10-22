// engine/home.py installs setup's extras into ~/.claude. Every case runs on a
// throwaway home folder, never the real one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = !python && "needs Python 3.8+";

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "bw-home-"));
  try {
    return fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function home(dir, ...args) {
  const r = spawnSync(python, [join(engine, "home.py"), ...args, "--home", dir], { encoding: "utf8" });
  return { status: r.status, out: JSON.parse(r.stdout), stderr: r.stderr };
}

const settingsPath = (dir) => join(dir, ".claude", "settings.json");
const settings = (dir) => JSON.parse(readFileSync(settingsPath(dir), "utf8"));
const writeSettings = (dir, data) => {
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(settingsPath(dir), typeof data === "string" ? data : JSON.stringify(data));
};

function hookFile(dir, name, body = "print('hi')\n") {
  const file = join(dir, "src", name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  return file;
}

test("a hook installs once, in the launcher form, beside the user's own entries", { skip }, () => {
  withHome((dir) => {
    const mine = { matcher: "Bash", hooks: [{ type: "command", command: "my-check" }] };
    writeSettings(dir, { model: "x", hooks: { PreToolUse: [mine] } });
    const file = hookFile(dir, "push-guard.py");
    for (let i = 0; i < 2; i++) {
      const r = home(dir, "install-hook", file, "--python", "/usr/bin/python3", "--matcher", "Bash|PowerShell");
      assert.equal(r.status, 0, r.stderr);
    }
    const data = settings(dir);
    assert.equal(data.model, "x");
    assert.equal(data.hooks.PreToolUse.length, 2);
    assert.deepEqual(data.hooks.PreToolUse[0], mine);
    const hook = data.hooks.PreToolUse[1].hooks[0];
    assert.equal(hook.command, "/usr/bin/python3");
    assert.deepEqual(hook.args.slice(0, 2), ["-I", "-c"]);
    assert.ok(hook.args[3].endsWith("/.claude/hooks/push-guard.py"));
    assert.equal(readFileSync(join(dir, ".claude", "hooks", "push-guard.py"), "utf8"), "print('hi')\n");
    assert.ok(existsSync(settingsPath(dir) + ".bak"));
  });
});

test("the installed push guard runs through its launcher and blocks a force push", { skip }, () => {
  withHome((dir) => {
    const guard = join(engine, "..", "_core", "global-template", "hooks", "push-guard.py");
    assert.equal(home(dir, "install-hook", guard, "--python", python, "--matcher", "Bash|PowerShell").status, 0);
    const { command, args } = settings(dir).hooks.PreToolUse[0].hooks[0];
    const call = (cmd) => spawnSync(command, args, {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } }), encoding: "utf8",
    });
    assert.equal(call("git push -qf origin main").status, 2);
    const lease = call("git push --force-with-lease origin main");
    assert.equal(lease.status, 0, lease.stderr);
    assert.equal(lease.stdout, "");
  });
});

test("only the named hook leaves an entry it shares with other hooks", { skip }, () => {
  withHome((dir) => {
    const mine = { type: "command", command: "my-check" };
    const guard = (name) => ({ type: "command", command: `python "C:\\Users\\me\\.claude\\hooks\\${name}"` });
    writeSettings(dir, { hooks: { PreToolUse: [
      { matcher: "Bash|PowerShell", hooks: [mine, guard("push-guard.py"), guard("no-ai-attribution.py")] },
    ] } });
    const file = hookFile(dir, "push-guard.py");
    assert.equal(home(dir, "install-hook", file, "--python", "/usr/bin/python3", "--matcher", "Bash").status, 0);
    let entries = settings(dir).hooks.PreToolUse;
    assert.deepEqual(entries[0].hooks, [mine, guard("no-ai-attribution.py")]);
    assert.equal(entries.length, 2);
    assert.deepEqual(home(dir, "remove-hook", "no-ai-attribution.py").out, { removed_hooks: 1, deleted_file: false });
    entries = settings(dir).hooks.PreToolUse;
    assert.deepEqual(entries[0].hooks, [mine]);
    assert.deepEqual(home(dir, "remove-hook", "push-guard.py").out, { removed_hooks: 1, deleted_file: true });
    assert.deepEqual(settings(dir).hooks.PreToolUse, [{ matcher: "Bash|PowerShell", hooks: [mine] }]);
  });
});

test("an old research hook is listed and removed with its file", { skip }, () => {
  withHome((dir) => {
    const command = `py "${dir}/.claude/hooks/ctags-first.py"`;
    const old = { matcher: "Grep|Glob|Bash", hooks: [{ type: "command", command }] };
    writeSettings(dir, { hooks: { PreToolUse: [old] } });
    mkdirSync(join(dir, ".claude", "hooks"));
    writeFileSync(join(dir, ".claude", "hooks", "ctags-first.py"), "x");
    assert.deepEqual(home(dir, "list-hooks").out, { hooks: ["ctags-first.py"] });
    assert.deepEqual(home(dir, "remove-hook", "ctags-first.py").out, { removed_hooks: 1, deleted_file: true });
    assert.deepEqual(settings(dir).hooks.PreToolUse, []);
    assert.ok(!existsSync(join(dir, ".claude", "hooks", "ctags-first.py")));
  });
});

test("allow rules and the attribution settings change only what they name", { skip }, () => {
  withHome((dir) => {
    writeSettings(dir, { permissions: { allow: ["Read"], deny: ["Bash(rm -rf:*)"] } });
    assert.equal(home(dir, "allow", "Bash(git push:*)").out.changed, true);
    assert.equal(home(dir, "allow", "Bash(git push:*)").out.changed, false);
    assert.deepEqual(settings(dir).permissions, { allow: ["Read", "Bash(git push:*)"], deny: ["Bash(rm -rf:*)"] });
    assert.equal(home(dir, "disallow", "Bash(git push:*)").out.changed, true);
    assert.deepEqual(settings(dir).permissions.allow, ["Read"]);
    home(dir, "attribution-off");
    assert.deepEqual(settings(dir).attribution, { commit: "", pr: "", sessionUrl: false });
  });
});

test("a mod is copied once, listed once, and an installed copy keeps its edits", { skip }, () => {
  withHome((dir) => {
    const mod = join(dir, "pack", "session-facts");
    mkdirSync(join(mod, ".claude-plugin"), { recursive: true });
    writeFileSync(join(mod, ".claude-plugin", "plugin.json"), "{}");
    writeSettings(dir, { env: { CLAUDE_CODE_PLUGIN_DIRS: "/other/mod" } });
    const first = home(dir, "add-mod", mod);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.out.kept_existing, false);
    const target = first.out.installed;
    writeFileSync(join(target, "rules.ts"), "mine");
    assert.equal(home(dir, "add-mod", mod).out.kept_existing, true);
    assert.equal(readFileSync(join(target, "rules.ts"), "utf8"), "mine");
    assert.equal(settings(dir).env.CLAUDE_CODE_PLUGIN_DIRS, ["/other/mod", target].join(delimiter));
    assert.equal(home(dir, "add-mod", join(dir, "pack")).status, 1);
  });
});

test("a settings file that is not valid JSON is never written", { skip }, () => {
  withHome((dir) => {
    writeSettings(dir, "{ broken");
    for (const args of [["allow", "Read"], ["attribution-off"], ["remove-hook", "x.py"]]) {
      const r = home(dir, ...args);
      assert.equal(r.status, 1, args.join(" "));
      assert.match(r.out.error, /not valid JSON/);
    }
    assert.equal(readFileSync(settingsPath(dir), "utf8"), "{ broken");
    writeSettings(dir, { hooks: { PreToolUse: {} } });
    assert.match(home(dir, "list-hooks").out.error, /PreToolUse is not a list/);
  });
});

test("a missing settings file starts empty, and bad usage is refused", { skip }, () => {
  withHome((dir) => {
    assert.deepEqual(home(dir, "list-hooks").out, { hooks: [] });
    assert.equal(home(dir, "install-hook", hookFile(dir, "x.py"), "--matcher", "Bash").status, 1);
    assert.equal(home(dir, "nonsense").status, 1);
  });
});

test("find-python names a system interpreter", { skip }, () => {
  const r = spawnSync(python, [join(engine, "home.py"), "find-python"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.ok(out.python || out.error, r.stdout);
  if (out.python) assert.ok(existsSync(out.python), out.python);
});
