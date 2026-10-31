// /bindwright:report's draft (report.js, report.py): planted personal data
// never survives, and both engines draft the same report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scrub } from "../report.js";
import { python } from "./python.js";

const engine = join(dirname(fileURLToPath(import.meta.url)), "..");
const needsPython = { skip: !python && "needs Python 3.8+" };

const who = { repo: "C:\\Users\\jdoe\\code\\app", home: "C:\\Users\\jdoe", user: "jdoe" };
const planted = [
  "failed in C:\\Users\\jdoe\\code\\app\\src and c:/users/jdoe/code/app/x.js",
  "home C:\\\\Users\\\\jdoe\\\\.claude, user jdoe, not jdoester",
  "mail jane.doe@example.com token ghp_abcdefghijklmnopqrstuvwxyz0123",
  "key sk-ant-api03-abcdefghijklmnopqrstu and AKIAABCDEFGHIJKLMNOP",
].join("\n");

test("tokens, emails, paths and the user name are taken out", () => {
  const out = scrub(planted, who);
  const rest = out.replace("jdoester", "");
  for (const gone of ["jdoe", "example.com", "ghp_", "sk-ant", "AKIA", "Users", "users"]) {
    assert.ok(!rest.includes(gone), `${gone} left in: ${out}`);
  }
  assert.match(out, /failed in <repo>\\src and <repo>\/x\.js/);
  assert.match(out, /user <user>, not jdoester/);
  assert.match(out, /mail <email> token <token>/);
});

// A long path is one long run of token characters: the paths must go before
// the token pattern can swallow part of one.
const dotted = { repo: "/home/jane.doe/src/acme.internal-billing", home: "/home/jane.doe", user: "jane.doe" };
const longPath = "boom at /home/jane.doe/work/some-really-long-project-name/src/x"
  + " and /home/jane.doe/src/acme.internal-billing/y";

test("a dotted home folder and user name are taken out before tokens, in both engines", needsPython, () => {
  const script = "import json,sys; sys.path.insert(0, sys.argv[1]); from report import scrub; "
    + "a = json.loads(sys.stdin.read()); print(scrub(a['text'], **a['who']), end='')";
  const py = spawnSync(python, ["-I", "-c", script, engine], {
    input: JSON.stringify({ text: longPath, who: dotted }), encoding: "utf8",
  });
  const js = scrub(longPath, dotted);
  assert.equal(py.stdout, js, py.stderr);
  // The rest of the long path still reads as a token: hiding too much is the safe side.
  assert.equal(js, "boom at ~<token> and <repo>/y");
});

test("a path or name in another letter case is taken out too", () => {
  const out = scrub("at c:\\USERS\\JDoe\\Code\\App\\x and C:/Users/JDOE/y, user JDoe", who);
  assert.equal(out, "at <repo>\\x and ~/y, user <user>");
});

test("shell path forms and non-ASCII names in any case come out the same in both engines", needsPython, () => {
  const win = { repo: "C:\\Users\\Jürgen\\code\\app", home: "C:\\Users\\Jürgen", user: "Jürgen" };
  const text = "pwd /c/Users/JÜRGEN/code/app/x, wsl /mnt/c/users/jürgen/y, by JÜRGEN";
  const script = "import json,sys; sys.path.insert(0, sys.argv[1]); from report import scrub; "
    + "a = json.loads(sys.stdin.buffer.read().decode('utf-8')); "
    + "sys.stdout.write(json.dumps(scrub(a['text'], **a['who'])))";
  const input = JSON.stringify({ text, who: win });
  const py = spawnSync(python, ["-I", "-c", script, engine], { input, encoding: "utf8" });
  const js = scrub(text, win);
  assert.equal(JSON.parse(py.stdout), js, py.stderr);
  assert.equal(js, "pwd <repo>/x, wsl ~/y, by <user>");
});

const jurgen = { repo: "C:\\Users\\Jürgen\\code\\app", home: "C:\\Users\\Jürgen", user: "Jürgen" };

test("pinned letters, escaped names and a bare root home come out the same in both engines", needsPython, () => {
  const script = "import json,sys; sys.path.insert(0, sys.argv[1]); from report import scrub; "
    + "a = json.loads(sys.stdin.buffer.read().decode('utf-8')); "
    + "sys.stdout.write(json.dumps([scrub(t, **w) for t, w in a]))";
  const cases = [
    ["by İsmail, ismail, ISMAIL and ısmaıl", { user: "İsmail" }],
    ["by ılker, Ilker and İLKER, not Straße", { user: "ılker" }],
    ["by Straße and STRASSE", { user: "Straße" }],
    // The engines' own JSON output writes non-ASCII letters as \u escapes.
    [String.raw`open C:\\Users\\J\u00fcrgen\\code\\app\\x by J\u00FCrgen`, jurgen],
    ["at c:\\users\\νικος\\x by νικος", { home: "C:\\Users\\ΝΙΚΟΣ", user: "ΝΙΚΟΣ" }],
    ["at /srv/app/x and C:\\y", { repo: "/srv/app", home: "/" }],
    ["at C:\\x and \\\\host\\share", { home: "C:\\" }],
  ];
  const py = spawnSync(python, ["-I", "-c", script, engine], { input: JSON.stringify(cases), encoding: "utf8" });
  const js = cases.map(([t, w]) => scrub(t, w));
  assert.deepEqual(JSON.parse(py.stdout), js, py.stderr);
  // Every I matches every other; ß, whose capital is two letters, only as written; a root home matches nothing.
  assert.deepEqual(js, [
    "by <user>, <user>, <user> and <user>",
    "by <user>, <user> and <user>, not Straße",
    "by <user> and STRASSE",
    String.raw`open <repo>\\x by <user>`,
    "at ~\\x by <user>",
    "at <repo>/x and C:\\y",
    "at C:\\x and \\\\host\\share",
  ]);
});

test("both engines draft the same scrubbed report, and file nothing", needsPython, () => {
  const root = mkdtempSync(join(tmpdir(), "bw-report-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo);
    const error = `boom at ${join(homedir(), "x")} ghp_abcdefghijklmnopqrstuvwxyz0123`;
    const what = { command: `node cli.js --update ${repo}`, error };
    const config = join(root, "config");
    const env = { ...process.env, CLAUDE_CONFIG_DIR: config, AI_AGENT: "claude-code_2-1-316_agent" };
    const options = { env, input: JSON.stringify(what), encoding: "utf8" };
    const run = (cmd, args) => spawnSync(cmd, [...args, "--report", repo], options);
    const js = JSON.parse(run(process.execPath, [join(engine, "cli.js")]).stdout);
    const py = JSON.parse(run(python, ["-I", join(engine, "bind.py")]).stdout);
    const same = (r) => ({
      ...r, body: r.body.replace(/- Engine: \w+/, ""), url: r.url.replace(/Engine%3A%20\w+/, ""),
    });
    assert.deepEqual(same(py), same(js));
    assert.ok(!js.body.includes(repo) && !js.body.includes(homedir()) && !js.body.includes("ghp_"), js.body);
    assert.match(js.body, /This repo is not set up with Bindwright\. \(state\)/);
    assert.match(js.url, /^https:\/\/github\.com\/starfoxcom\/claude-code-templates\/issues\/new\?title=bug%3A%20/);

    // A home path across the title's 100-character cut is taken out whole first.
    const long = { title: `${"word ".repeat(17)}at ${join(homedir(), "x")}` };
    const titled = (cmd, args) => JSON.parse(spawnSync(cmd, [...args, "--report", repo],
      { ...options, input: JSON.stringify(long) }).stdout).title;
    const title = titled(process.execPath, [join(engine, "cli.js")]);
    assert.equal(titled(python, ["-I", join(engine, "bind.py")]), title);
    assert.equal(title, `bug: ${"word ".repeat(17)}at ${join("~", "x")}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
