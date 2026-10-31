// The public roadmap tool a bind ships (.github/scripts/public_roadmap.py),
// run against a stand-in for gh that keeps both repos' issues in a JSON file.
// Only the GitHub calls are replaced; the tool's own code runs as shipped.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { python } from "./python.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS = join(repo, "_core", "project-template", ".github", "scripts");
const skip = !python && "needs Python 3.8+";

// Imports the tool, swaps its one gh entry point for a fake over the state
// file, runs main() and prints the writes it made.
const HARNESS = `import json, sys
sys.dont_write_bytecode = True  # no __pycache__ inside the shipped template
sys.path.insert(0, sys.argv[1])
import public_roadmap as tool
path = sys.argv[2]
with open(path, encoding="utf-8") as f:
    state = json.load(f)
writes = []

def find(issue_id):
    for repo in state["repos"].values():
        for issue in repo["issues"].values():
            if issue["id"] == issue_id:
                return issue

def issue_command(args):
    repo = state["repos"][args[args.index("--repo") + 1]]
    title = args[args.index("--title") + 1]
    with open(args[args.index("--body-file") + 1], encoding="utf-8") as f:
        body = f.read()
    if args[1] == "create":
        repo["next"] += 1
        n = repo["next"]
        repo["issues"][str(n)] = {"id": "pub-%d" % n, "number": n, "title": title, "body": body,
                                  "state": "OPEN", "stateReason": None, "parent": None}
        writes.append("create %d" % n)
        return "https://github.com/x/y/issues/%d" % n
    issue = repo["issues"][args[2]]
    issue["title"], issue["body"] = title, body
    writes.append("edit " + args[2])
    return ""

def graphql(args):
    v = dict(args[i + 1].split("=", 1) for i in range(2, len(args), 2))
    q = v["query"]
    if "repository(owner" in q:
        nodes = sorted(state["repos"][v["owner"] + "/" + v["name"]]["issues"].values(),
                       key=lambda i: i["number"])
        page = {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": nodes}
        return json.dumps({"data": {"repository": {"issues": page}}})
    if "deleteIssue" in q:
        for repo in state["repos"].values():
            repo["issues"] = {k: i for k, i in repo["issues"].items() if i["id"] != v["id"]}
        writes.append("delete " + v["id"])
    elif "closeIssue" in q:
        issue = find(v["id"])
        issue["state"] = "CLOSED"
        issue["stateReason"] = "NOT_PLANNED" if "NOT_PLANNED" in q else "COMPLETED"
        writes.append("close %d %s" % (issue["number"], issue["stateReason"]))
    elif "reopenIssue" in q:
        issue = find(v["id"])
        issue["state"], issue["stateReason"] = "OPEN", None
        writes.append("reopen %d" % issue["number"])
    elif "addSubIssue" in q:
        child, parent = find(v["c"]), find(v["p"])
        child["parent"] = {"number": parent["number"]}
        writes.append("link %d %d" % (child["number"], parent["number"]))
    else:
        raise SystemExit("unexpected query: " + q[:60])
    return json.dumps({"data": {}})

def fake_gh(args):
    if args[:2] == ["repo", "view"]:
        return "me/private\\n"
    return issue_command(args) if args[0] == "issue" else graphql(args)

tool.run_gh = fake_gh
code = tool.main(sys.argv[3:])
with open(path, "w", encoding="utf-8") as f:
    json.dump(state, f)
print("WRITES " + json.dumps(writes))
sys.exit(code)
`;

const issue = (number, title, body, extra = {}) =>
  ({ id: `priv-${number}`, number, title, body, state: "OPEN", stateReason: null, parent: null, ...extra });
const summary = (text) => `## What\nInternal notes.\n\n### Public summary\n${text}\n\n### Current state\nWorking.\n`;

function scene(privateIssues, settings = {}) {
  const root = mkdtempSync(join(tmpdir(), "bw-public-"));
  mkdirSync(join(root, ".bindwright"));
  mkdirSync(join(root, ".github"));
  const answers = { advanced: { tracker: "github", trackerProject: null, publicRoadmap: "me/public" } };
  writeFileSync(join(root, ".bindwright", "project.json"), JSON.stringify(answers));
  const config = { rename: {}, hidden: [], project: null, fields: ["Status"], ...settings };
  writeFileSync(join(root, ".github", "public-roadmap.json"), JSON.stringify(config));
  writeFileSync(join(root, "harness.py"), HARNESS);
  const issues = Object.fromEntries(privateIssues.map((i) => [String(i.number), i]));
  const state = { repos: { "me/private": { next: 0, issues }, "me/public": { next: 0, issues: {} } } };
  writeFileSync(join(root, "state.json"), JSON.stringify(state));
  const run = (command) => {
    const r = spawnSync(python, [join(root, "harness.py"), SCRIPTS, join(root, "state.json"), command],
      { cwd: root, encoding: "utf8" });
    const lines = r.stdout.trim().split(/\r?\n/);
    const writes = JSON.parse(lines.pop().slice("WRITES ".length));
    return { status: r.status, lines, writes, stderr: r.stderr };
  };
  const read = () => JSON.parse(readFileSync(join(root, "state.json"), "utf8")).repos;
  const edit = (change) => {
    const repos = read();
    change(repos["me/private"].issues);
    writeFileSync(join(root, "state.json"), JSON.stringify({ repos }));
  };
  return { run, read, edit };
}

test("check names every contract break and leaves summary-less issues private", { skip }, () => {
  const s = scene([
    issue(1, "Faster checkout", summary("Checkout takes one step instead of three.")),
    issue(2, "Refactor the cart store", "## What\nInternal only.\n"),
    issue(3, "Falcon sync", summary(
      "Uses `syncAll` from docs/sync/plan.md, see PR #12 and #2.\nTuned to 3.14 by Claude.")),
  ], { hidden: ["Falcon"] });
  const out = s.run("check");
  assert.equal(out.status, 1, out.stderr);
  assert.deepEqual(out.writes, []);
  const text = out.lines.join("\n");
  for (const want of ["#3 title: private name ('Falcon')", "#3 summary: code ('`')", "#3 summary: path",
    "#3 summary: pull request ('PR #1", "#3 summary: identifier ('syncAll')", "#3 summary: constant ('3.14')",
    "#3 summary: AI or review wording ('Claude')", "#3 summary: points at #2, which stays private",
    "#3 summary: points at #12, which stays private"]) {
    assert.ok(text.includes(want), `missing "${want}" in:\n${text}`);
  }
  assert.ok(!/#1 |#2 /.test(text.replace(/#12/g, "")), text);
});

test("push refuses while check reports anything", { skip }, () => {
  const s = scene([issue(1, "Ship it", summary("See `x`."))]);
  const out = s.run("push");
  assert.equal(out.status, 1);
  assert.deepEqual(out.writes, []);
  assert.deepEqual(s.read()["me/public"].issues, {});
});

test("push mirrors summaries under the same numbers, then has nothing left to do", { skip }, () => {
  // #2 is a pull request (not an issue), #3 stays private, #5 is not an issue either.
  const s = scene([
    issue(1, "Falcon checkout", summary("One-step checkout for Falcon.")),
    issue(3, "Internal cleanup", "## What\nPrivate.\n"),
    issue(4, "Gift cards", summary("Pay with a gift card."),
      { state: "CLOSED", stateReason: "COMPLETED", parent: { number: 1 } }),
    issue(6, "Wish lists", summary("Save items for later, part of #1.")),
  ], { rename: { Falcon: "the shop" } });
  const out = s.run("push");
  assert.equal(out.status, 0, out.stderr);
  const pub = s.read()["me/public"].issues;
  assert.deepEqual(Object.keys(pub).sort(), ["1", "4", "6"]);
  assert.equal(pub["1"].title, "the shop checkout");
  assert.equal(pub["1"].body.trim(), "One-step checkout for the shop.");
  assert.equal(pub["4"].state, "CLOSED");
  assert.equal(pub["4"].stateReason, "COMPLETED");
  assert.deepEqual(pub["4"].parent, { number: 1 });
  for (const n of [2, 3, 5]) assert.ok(out.writes.includes(`delete pub-${n}`), out.writes.join(", "));
  assert.ok(!JSON.stringify(pub).includes("Internal"));

  const again = s.run("push");
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(again.writes, []);
});

test("an issue that loses its summary is withdrawn from the public side", { skip }, () => {
  const s = scene([issue(1, "Loyalty points", summary("Earn points on every order."))]);
  assert.equal(s.run("push").status, 0);
  s.edit((issues) => { issues["1"].body = "## What\nPaused.\n"; });
  const out = s.run("push");
  assert.equal(out.status, 0, out.stderr);
  const pub = s.read()["me/public"].issues["1"];
  assert.equal(pub.title, "Withdrawn");
  assert.ok(!pub.body.includes("points"));
  assert.equal(pub.stateReason, "NOT_PLANNED");
  assert.deepEqual(s.run("push").writes, []);
});

test("an edited summary and a reopened issue reach the public side", { skip }, () => {
  const s = scene([issue(1, "Search", summary("Find products by name."),
    { state: "CLOSED", stateReason: "COMPLETED" })]);
  assert.equal(s.run("push").status, 0);
  s.edit((issues) => {
    issues["1"].body = summary("Find products by name or tag.");
    Object.assign(issues["1"], { state: "OPEN", stateReason: null });
  });
  const out = s.run("push");
  assert.deepEqual(out.writes, ["edit 1", "reopen 1"]);
  assert.equal(s.read()["me/public"].issues["1"].body.trim(), "Find products by name or tag.");
});
