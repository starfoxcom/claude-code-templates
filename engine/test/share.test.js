// What /bindwright:export and /bindwright:join write (share.js, share.py):
// a setup round-trips from the exporting machine to a teammate's, bad choices
// stop the write, and both engines write the same bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const needsPython = { skip: !python && "needs Python 3.8+" };
const ANSWERS = { team: true, client: false, project: { name: "x" }, advanced: { codeResearch: "tokensave", tracker: "github" } };

// A set-up repo and two machines' config folders, one per engine run.
function scene() {
  const root = mkdtempSync(join(tmpdir(), "bw-share-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, ".bindwright"), { recursive: true });
  writeFileSync(join(repo, ".bindwright", "project.json"), `${JSON.stringify(ANSWERS, null, 2)}\n`);
  return { root, repo, read: (p) => readFileSync(join(repo, ...p.split("/")), "utf8") };
}

const engines = [[process.execPath, [join(engine, "cli.js")]], [python, ["-I", join(engine, "bind.py")]]];

// Runs one command in a fresh scene per engine and requires the same output
// and the same files; `steps(run, s)` drives the scene.
function both(steps) {
  const results = [];
  for (const [cmd, args] of engines) {
    const s = scene();
    try {
      const run = (flags, input, config = join(s.root, "teammate")) => {
        const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
        const out = spawnSync(cmd, [...args, ...flags], { env, input: input === undefined ? "" : input, encoding: "utf8" });
        return { ...JSON.parse(out.stdout), status: out.status };
      };
      const seen = steps(run, s);
      const files = [".bindwright/project.json", ".bindwright/local.json", ".bindwright/.gitignore"]
        .map((p) => (existsSync(join(s.repo, ...p.split("/"))) ? s.read(p) : null));
      const personal = join(s.root, "teammate", "bindwright", "settings.json");
      results.push({ seen, files, personal: existsSync(personal) ? readFileSync(personal, "utf8") : null });
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  }
  assert.deepEqual(results[1], results[0], "both engines alike");
  return results[0];
}

test("a setup round-trips: export, then a teammate's settings, choices and drift", needsPython, () => {
  const { seen, files, personal } = both((run, s) => {
    const choices = { extras: { "session-facts": "required", tasks: "recommended" }, required: ["codeResearch"] };
    const exported = run(["--export", s.repo], JSON.stringify(choices));
    const before = run(["--settings", s.repo]);
    const declined = run(["--remember", s.repo, "--layer", "personal"], JSON.stringify({ extras: { tasks: false } }));
    const local = run(["--remember", s.repo, "--layer", "local"], JSON.stringify({ codeResearch: "serena", tracker: "file" }));
    const after = run(["--settings", s.repo]);
    return { exported, before, declined, local, after };
  });
  assert.equal(seen.exported.status, 0);
  assert.deepEqual(seen.exported.setup, { schema: 1, extras: { "session-facts": "required", tasks: "recommended" }, required: ["codeResearch"] });
  assert.deepEqual(seen.before.drift, ["session-facts", "tasks"]);
  assert.deepEqual(seen.after.drift, ["session-facts"]);
  assert.deepEqual(seen.after.settings, {
    codeResearch: { value: "tokensave", from: "project", required: true },
    tracker: { value: "file", from: "local", required: false },
  });
  assert.deepEqual(seen.after.ignored, ["local: codeResearch (the project requires it)"]);
  assert.deepEqual(JSON.parse(files[0]), { ...ANSWERS, setup: seen.exported.setup });
  assert.equal(files[2], "local.json\n");
  assert.equal(personal, '{\n  "extras": {\n    "tasks": false\n  },\n  "schema": 1\n}\n');
});

test("bad choices stop the write and leave the files as they were", needsPython, () => {
  const { seen, files } = both((run, s) => [
    run(["--export", s.repo], JSON.stringify({ extras: { nope: "required" }, required: ["tracker", "x"] })),
    run(["--export", s.repo], JSON.stringify({ hooks: ["rm -rf ~"] })),
    run(["--export", s.repo], "{oops"),
    run(["--remember", s.repo, "--layer", "local"], JSON.stringify({ extras: { tasks: "maybe" } })),
    run(["--remember", s.repo], "{}"),
    run(["--remember", s.repo, "--layer", "team"], "{}"),
  ]);
  assert.deepEqual(seen.map((r) => r.error), [
    "Cannot export: project: extras.nope, project: required.x",
    "Cannot export: hooks",
    "the choices on standard input are not valid JSON",
    "Cannot remember: local: extras.tasks",
    "--remember needs --layer personal or local",
    'Unknown layer "team": use personal or local',
  ]);
  assert.ok(seen.every((r) => r.status === 1));
  assert.deepEqual(JSON.parse(files[0]), ANSWERS);
  assert.equal(files[1], null);
});

test("null removes a choice, and an empty export removes the setup object", needsPython, () => {
  const { seen, files, personal } = both((run, s) => [
    run(["--export", s.repo], JSON.stringify({ extras: { tasks: "recommended" } })),
    run(["--export", s.repo], JSON.stringify({})),
    run(["--remember", s.repo, "--layer", "personal"], JSON.stringify({ tracker: "file", extras: { tasks: true } })),
    run(["--remember", s.repo, "--layer", "personal"], JSON.stringify({ tracker: null, extras: { tasks: null } })),
  ]);
  assert.equal(seen[1].setup, null);
  assert.deepEqual(JSON.parse(files[0]), ANSWERS);
  assert.equal(personal, '{\n  "extras": {},\n  "schema": 1\n}\n');
});

const linksWork = (() => {
  const dir = mkdtempSync(join(tmpdir(), "bw-link-"));
  try {
    symlinkSync(join(dir, "nowhere"), join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

test("a linked local.json is refused, not written through", { skip: !(python && linksWork) && "needs Python and links" }, () => {
  const { seen } = both((run, s) => {
    const outside = join(s.root, "outside.txt");
    writeFileSync(outside, "{}\n");
    symlinkSync(outside, join(s.repo, ".bindwright", "local.json"));
    const out = run(["--remember", s.repo, "--layer", "local"], JSON.stringify({ tracker: "file" }));
    return { out, outside: readFileSync(outside, "utf8") };
  });
  assert.equal(seen.out.error, "Refusing to write through a symbolic link: .bindwright/local.json");
  assert.equal(seen.outside, "{}\n");
});
