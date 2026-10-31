// The settings layers (layers.js, layers.py): the order they resolve in, what
// the project can require, that unknown or bad values are listed and never
// applied, and that both twins give the same report for the same files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTRAS, resolveLayers, runSettings } from "../layers.js";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const answers = (advanced = {}, setup) =>
  ({ team: false, client: false, project: {}, advanced, ...(setup && { setup }) });

test("a later layer wins: local over project over personal", () => {
  const { settings } = resolveLayers({
    personal: { schema: 1, codeResearch: "serena", tracker: "file" },
    project: answers({ codeResearch: "tokensave", tracker: "github" }),
    local: { tracker: "file" },
  });
  assert.deepEqual(settings, {
    codeResearch: { value: "tokensave", from: "project", required: false },
    tracker: { value: "file", from: "local", required: false },
  });
});

test("a value the project requires holds, and the overridden ones are noted", () => {
  const { settings, ignored } = resolveLayers({
    personal: { codeResearch: "serena" },
    project: answers({ codeResearch: "tokensave" }, { schema: 1, required: ["codeResearch"] }),
    local: { codeResearch: "codegraph" },
  });
  assert.deepEqual(settings.codeResearch, { value: "tokensave", from: "project", required: true });
  const note = "codeResearch (the project requires it)";
  assert.deepEqual(ignored, [`personal: ${note}`, `local: ${note}`]);
});

test("extras: required beats a no, a no beats recommended, and undecided stays null", () => {
  const { extras, ignored } = resolveLayers({
    personal: { extras: { "session-facts": false, tasks: false, "push-guard": true } },
    project: answers({}, { extras: { "session-facts": "required", tasks: "recommended", "ci-watch": "recommended" } }),
    local: { extras: { "push-guard": false } },
  });
  assert.deepEqual(extras, {
    "ci-watch": { project: "recommended", want: null, from: null },
    "push-guard": { project: null, want: false, from: "local" },
    "session-facts": { project: "required", want: true, from: "project" },
    tasks: { project: "recommended", want: false, from: "personal" },
  });
  assert.deepEqual(ignored, ["personal: extras.session-facts (the project requires it)"]);
});

test("unknown keys and bad values are listed, never applied", () => {
  const { settings, extras, ignored } = resolveLayers({
    personal: { tracker: "jira", run: "rm -rf ~", extras: { nope: true, tasks: "yes" } },
    project: answers({}, { required: ["tracker", 5], hooks: [] }),
    local: { extras: [] },
  });
  assert.deepEqual(settings, {});
  assert.deepEqual(extras, {});
  assert.deepEqual(ignored, [
    "personal: extras.nope", "personal: extras.tasks", "personal: run", "personal: tracker",
    "project: setup.hooks", "project: required.tracker", "project: required", "local: extras",
  ]);
});

test("a file from a newer Bindwright, or with a broken schema, is refused", () => {
  assert.throws(() => resolveLayers({ local: { schema: 2 } }), /local\.json was written by a newer Bindwright/);
  for (const schema of [0, 1.5, "1", null, true]) {
    const broken = () => resolveLayers({ personal: { schema } });
    assert.throws(broken, /settings\.json has no valid schema number/, String(schema));
  }
  const newer = () => resolveLayers({ project: answers({}, { schema: 9 }) });
  assert.throws(newer, /project\.json \(setup\) was written by a newer/);
  assert.doesNotThrow(() => resolveLayers({ personal: { schema: 1 }, local: {} }));
});

test("the extras list matches the mods setup ships, plus the two guards", () => {
  const mods = readdirSync(join(engine, "..", "_core", "global-template", "mods"), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepEqual(EXTRAS, [...mods, "attribution-guard", "push-guard"].sort());
});

// A repo and a config folder with the given files; missing ones are left out.
function scene({ personal, project, local, installed = [] }) {
  const root = mkdtempSync(join(tmpdir(), "bw-layers-"));
  const repo = join(root, "repo");
  const config = join(root, "config");
  const put = (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof text === "string" || Buffer.isBuffer(text) ? text : JSON.stringify(text));
  };
  mkdirSync(join(repo, ".bindwright"), { recursive: true });
  if (personal !== undefined) put(join(config, "bindwright", "settings.json"), personal);
  if (project !== undefined) put(join(repo, ".bindwright", "project.json"), project);
  if (local !== undefined) put(join(repo, ".bindwright", "local.json"), local);
  for (const path of installed) mkdirSync(join(config, ...path.split("/")), { recursive: true });
  return { root, repo, config };
}

test("drift: extras the project rates that this machine lacks and nobody declined", () => {
  const s = scene({
    personal: { extras: { tasks: false } },
    project: answers({}, { extras: { "session-facts": "recommended", tasks: "recommended", "ci-watch": "required" } }),
    installed: ["mods/session-facts"],
  });
  try {
    const out = runSettings(s.repo, s.config);
    assert.deepEqual(out.drift, ["ci-watch"]);
    assert.equal(out.installed["session-facts"], true);
    assert.equal(out.installed["push-guard"], false);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

// Both engines' --settings on the same scene; returns the JS report.
function both(files) {
  const s = scene(files);
  try {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: s.config };
    const run = (cmd, args) => spawnSync(cmd, [...args, "--settings", s.repo], { env, encoding: "utf8" });
    const js = run(process.execPath, [join(engine, "cli.js")]);
    const py = run(python, ["-I", join(engine, "bind.py")]);
    assert.equal(py.stdout, js.stdout, JSON.stringify(files));
    assert.equal(py.status, js.status);
    return JSON.parse(js.stdout);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
}

const needsPython = { skip: !python && "needs Python 3.8+" };

test("a personal layer cannot pick the custom tool, which only the project can define", needsPython, () => {
  const out = both({
    personal: { codeResearch: "custom" }, local: { codeResearch: "custom" },
    project: answers({ codeResearch: "tokensave" }),
  });
  assert.deepEqual(out.settings.codeResearch, { value: "tokensave", from: "project", required: false });
  assert.deepEqual(out.ignored, ["personal: codeResearch", "local: codeResearch"]);
});

test("broken files fail alike in both engines", needsPython, () => {
  assert.equal(both({ local: "{not json" }).error, ".bindwright/local.json is not valid JSON");
  assert.equal(both({ personal: '{"schema": NaN}' }).error, "bindwright/settings.json is not valid JSON");
  assert.equal(both({ local: Buffer.from([0x7b, 0xff, 0x7d]) }).error, ".bindwright/local.json is not UTF-8 text");
  assert.equal(both({ local: `${"[".repeat(70)}${"]".repeat(70)}` }).error, ".bindwright/local.json nests too deeply");
  assert.equal(both({ local: "[]" }).error, ".bindwright/local.json must hold a JSON object");
  // Whole numbers past the double range: infinite in both engines, however many digits.
  const huge = both({ personal: `{"schema": 1${"0".repeat(400)}}` });
  assert.equal(huge.error, "bindwright/settings.json has no valid schema number");
  assert.deepEqual(both({ local: `{"tracker": ${"1".repeat(5000)}}` }).ignored, ["local: tracker"]);
  assert.deepEqual(both({}).settings, {});
});

// Seeded, so a failure names a case that replays.
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const VALUES = [
  true, false, null, 0, 1, 1.0, 1.5, 2, -1, 1e300, "", "1", "github", "file", "jira", "tokensave", "custom",
  "required", "recommended", "yes", [], ["codeResearch"], ["tracker", "x"], {}, { a: 1 }, "é", "\u{1f600}",
];
const KEYS = ["schema", "codeResearch", "tracker", "extras", "required", "setup", "0", "10", "z", "é"];

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function randomLayer(rand, depth = 0) {
  const out = {};
  const n = Math.floor(rand() * 5);
  for (let i = 0; i < n; i++) {
    const key = pick(rand, KEYS);
    if (key === "extras") {
      const extras = {};
      const names = [...EXTRAS, "nope", "0"];
      for (let j = Math.floor(rand() * 4); j > 0; j--) extras[pick(rand, names)] = pick(rand, VALUES);
      out.extras = extras;
    } else if (key === "setup" && depth === 0) {
      out.setup = randomLayer(rand, 1);
    } else {
      out[key] = pick(rand, VALUES);
    }
  }
  // Mostly valid schemas, so most cases get past the schema check.
  if (rand() < 0.7) out.schema = 1;
  return out;
}

test("a __proto__ key is an unknown key like any other, in both engines", needsPython, () => {
  const personal = '{"__proto__": {"tracker": "file"}, "schema": 1}';
  const out = both({ personal, local: '{"extras": {"__proto__": true}}' });
  assert.deepEqual(out.ignored, ["personal: __proto__", "local: extras.__proto__"]);
  assert.deepEqual(out.settings, {});
});

test("both engines resolve a seeded sweep of odd layers alike", needsPython, () => {
  let resolved = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const rand = random(seed);
    const project = answers({ codeResearch: pick(rand, VALUES), tracker: pick(rand, VALUES) }, randomLayer(rand));
    const out = both({ personal: randomLayer(rand), project, local: randomLayer(rand) });
    if (!out.error) resolved += 1;
  }
  assert.ok(resolved >= 15, `only ${resolved} of 30 cases resolved`);
});
