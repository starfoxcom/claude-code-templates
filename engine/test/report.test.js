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

test("both engines draft the same scrubbed report, and file nothing", needsPython, () => {
  const root = mkdtempSync(join(tmpdir(), "bw-report-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo);
    const what = { command: `node cli.js --update ${repo}`, error: `boom at ${join(homedir(), "x")} ghp_abcdefghijklmnopqrstuvwxyz0123` };
    const env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, "config"), AI_AGENT: "claude-code_2-1-316_agent" };
    const run = (cmd, args) => spawnSync(cmd, [...args, "--report", repo], { env, input: JSON.stringify(what), encoding: "utf8" });
    const js = JSON.parse(run(process.execPath, [join(engine, "cli.js")]).stdout);
    const py = JSON.parse(run(python, ["-I", join(engine, "bind.py")]).stdout);
    const same = (r) => ({ ...r, body: r.body.replace(/- Engine: \w+/, ""), url: r.url.replace(/Engine%3A%20\w+/, "") });
    assert.deepEqual(same(py), same(js));
    assert.ok(!js.body.includes(repo) && !js.body.includes(homedir()) && !js.body.includes("ghp_"), js.body);
    assert.match(js.body, /This repo is not set up with Bindwright\. \(state\)/);
    assert.match(js.url, /^https:\/\/github\.com\/starfoxcom\/claude-code-templates\/issues\/new\?title=bug%3A%20/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
