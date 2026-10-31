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
        if repo["next"] + 1 in state.get("fail_create", []):
            state["fail_create"].remove(repo["next"] + 1)
            raise SystemExit("gh issue create failed: network down")
        repo["next"] = max(repo["next"], newest(args[args.index("--repo") + 1])) + 1
        n = repo["next"]
        repo["issues"][str(n)] = {"id": "pub-%d" % n, "number": n, "title": title, "body": body,
                                  "state": "OPEN", "stateReason": None, "parent": None,
                                  "labels": {"nodes": [{"name": l} for i, l in enumerate(args)
                                                       if i and args[i - 1] == "--label"]}}
        writes.append("create %d" % n)
        return "https://github.com/x/y/issues/%d" % n
    issue = repo["issues"][args[2]]
    issue["title"], issue["body"] = title, body
    writes.append("edit " + args[2])
    return ""

def graphql(args):
    v = dict(args[i + 1].split("=", 1) for i in range(2, len(args), 2))
    q = v["query"]
    if "discussions(" in q:
        nodes = [{"number": n} for n in state["repos"][v["owner"] + "/" + v["name"]].get("discussions", [])]
        return json.dumps({"data": {"repository": {"discussions": {"nodes": nodes[-1:]}}}})
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
        issue["state"], issue["stateReason"] = "OPEN", "REOPENED"  # as GitHub marks it
        writes.append("reopen %d" % issue["number"])
    elif "addSubIssue" in q:
        child, parent = find(v["c"]), find(v["p"])
        child["parent"] = {"number": parent["number"], "repository": {"nameWithOwner": "me/public"}}
        writes.append("link %d %d" % (child["number"], parent["number"]))
    elif "removeSubIssue" in q:
        child = find(v["c"])
        child["parent"] = None
        writes.append("unlink %d" % child["number"])
    else:
        raise SystemExit("unexpected query: " + q[:60])
    return json.dumps({"data": {}})

def newest(name):
    repo = state["repos"][name]
    return max([int(k) for k in repo["issues"]] + repo.get("prs", []) + repo.get("discussions", []) + [0])

def fake_gh(args):
    if args[:2] == ["label", "create"]:
        return ""
    if args[:2] == ["repo", "view"]:
        return "me/private\\n"
    if args[:2] == ["api", "user"]:
        return "me\\n"
    if args[0] == "api" and args[1].startswith("repos/"):
        return "%d\\n" % newest(args[1].split("/issues")[0][len("repos/"):])
    return issue_command(args) if args[0] == "issue" else graphql(args)

tool.run_gh = fake_gh
try:
    code = tool.main(sys.argv[3:])
except SystemExit as stop:
    print(stop)
    code = 1
with open(path, "w", encoding="utf-8") as f:
    json.dump(state, f)
print("WRITES " + json.dumps(writes))
sys.exit(code)
`;

const issue = (number, title, body, extra = {}) => ({ id: `priv-${number}`, number, title, body,
  state: "OPEN", stateReason: null, parent: null, labels: { nodes: [] }, ...extra });
const under = (number, repo = "me/private") => ({ number, repository: { nameWithOwner: repo } });
// A public body without the tool's own closing mark.
const words = (body) => body.split("\n\n<!-- public-roadmap -->")[0].trim();
const summary = (text) => `## What\nInternal notes.\n\n### Public summary\n${text}\n\n### Current state\nWorking.\n`;

function scene(privateIssues, settings = {}, publicRepo = "me/public") {
  const root = mkdtempSync(join(tmpdir(), "bw-public-"));
  mkdirSync(join(root, ".bindwright"));
  mkdirSync(join(root, ".github"));
  const answers = { advanced: { tracker: "github", trackerProject: null, publicRoadmap: publicRepo } };
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
  const edit = (change, failCreate = []) => {
    const repos = read();
    change(repos["me/private"].issues, repos["me/public"]);
    writeFileSync(join(root, "state.json"), JSON.stringify({ repos, fail_create: failCreate }));
  };
  return { run, read, edit };
}

test("check names every contract break and leaves summary-less issues private", { skip }, () => {
  const s = scene([
    issue(1, "Faster checkout", summary("Checkout takes one step instead of three.")),
    issue(2, "Refactor the cart store", "## What\nInternal only.\n"),
    issue(3, "Falcon sync", summary(
      "Uses `syncAll` from docs/sync/plan.md, see PR #12 and #2.\nTuned to 3.14 by Claude.")),
    issue(4, "Retries",
      summary("Raised MAX_RETRIES in 3f9a2c1, see https://intra.example/x and acme/app#12, ask @dana.")),
    issue(5, "Drafts", summary("Drafted with ChatGPT, then moved into player.gd.")),
    issue(6, "Wiki", summary("The FalconDB notes at www.intra.example, run <code>deploy</code>.")),
    issue(7, "Ops", summary("Ask ops@corp.example.\n\n    deploy --force")),
    issue(8, "Wiki two", summary("See [the wiki](//intra.example/wiki).\n\n        deploy --force")),
    issue(9, "Wiki three", summary("Read <a href=\"//intra.example\">this</a>.")),
    issue(10, "Wiki four", summary("See [the wiki][1] for details.\n\n[1]: //intra.example/wiki")),
  ], { hidden: ["Falcon"] });
  const out = s.run("check");
  assert.equal(out.status, 1, out.stderr);
  assert.deepEqual(out.writes, []);
  const text = out.lines.join("\n");
  for (const want of ["#3 title: private name ('Falcon')", "#3 summary: code ('`')", "#3 summary: path",
    "#3 summary: pull request ('PR #1", "#3 summary: identifier ('syncAll')", "#3 summary: constant ('3.14')",
    "#3 summary: AI or review wording ('Claude')", "#3 summary: points at #2, which stays private",
    "#3 summary: points at #12, which stays private", "#4 summary: link ('https://')",
    "#4 summary: commit ('3f9a2c1')", "#4 summary: identifier ('MAX_RETRIES')",
    "#4 summary: reference ('acme/app#12')", "#4 summary: mention ('@dana')",
    "#5 summary: AI or review wording ('ChatGPT')", "#5 summary: path ('player.gd')",
    "#6 summary: private name ('Falcon')", "#6 summary: link ('www.')", "#6 summary: code ('<code')",
    "#7 summary: link ('ops@corp.example')", "#7 summary: code ('    ')",
    "#8 summary: link ('](')", "#8 summary: code ('        ')", "#9 summary: link ('<a')",
    "#10 summary: link ('[1]:')"]) {
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
      { state: "CLOSED", stateReason: "COMPLETED", parent: under(1) }),
    issue(6, "Wish lists", summary("Save items for later, part of #1.")),
  ], { rename: { Falcon: "the shop" } });
  const out = s.run("push");
  assert.equal(out.status, 0, out.stderr);
  const pub = s.read()["me/public"].issues;
  assert.deepEqual(Object.keys(pub).sort(), ["1", "4", "6"]);
  assert.equal(pub["1"].title, "the shop checkout");
  assert.equal(words(pub["1"].body), "One-step checkout for the shop.");
  assert.equal(pub["4"].state, "CLOSED");
  assert.equal(pub["4"].stateReason, "COMPLETED");
  assert.deepEqual(pub["4"].parent, under(1, "me/public"));
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
  assert.equal(words(s.read()["me/public"].issues["1"].body), "Find products by name or tag.");
});

test("a summary added to an issue whose number was skipped is refused, not a crash", { skip }, () => {
  const s = scene([issue(1, "A", summary("First.")), issue(2, "B", "## What\nPrivate.\n"),
    issue(3, "C", summary("Third."))]);
  assert.equal(s.run("push").status, 0);
  s.edit((issues) => { issues["2"].body = summary("Second, now public."); });
  const out = s.run("push");
  assert.equal(out.status, 1, out.stderr);
  assert.deepEqual(out.writes, []);
  assert.match(out.lines.join("\n"), /#2 cannot go public: its public number is already used/);
});

test("a push that stops halfway leaves its placeholders, and the next one carries on", { skip }, () => {
  const s = scene([issue(4, "D", summary("Fourth.")), issue(5, "E", summary("Fifth."))]);
  s.edit(() => {}, [4]);
  const stopped = s.run("push");
  assert.equal(stopped.status, 1);
  assert.deepEqual(stopped.writes, ["create 1", "create 2", "create 3"]);
  // #2 gains a summary meanwhile: its leftover placeholder becomes its public item.
  s.edit((issues) => { issues["2"] = issue(2, "B", summary("Second.")); });
  const out = s.run("push");
  assert.equal(out.status, 0, out.stderr);
  const pub = s.read()["me/public"].issues;
  assert.deepEqual(Object.keys(pub).sort(), ["2", "4", "5"]);
  assert.equal(pub["2"].title, "B");
  assert.deepEqual(s.run("push").writes, []);
});

test("reopened and duplicate issues settle, and an unlinked child leaves its public parent", { skip }, () => {
  const s = scene([
    issue(1, "Parent", summary("The parent.")),
    issue(2, "Child", summary("The child."), { parent: under(1) }),
    issue(3, "Again", summary("Reopened once."), { stateReason: "REOPENED" }),
    issue(4, "Twin", summary("A duplicate."), { state: "CLOSED", stateReason: "DUPLICATE" }),
  ]);
  assert.equal(s.run("push").status, 0);
  assert.deepEqual(s.run("push").writes, []);
  s.edit((issues) => { issues["2"].parent = null; });
  assert.deepEqual(s.run("push").writes, ["unlink 2"]);
  assert.equal(s.read()["me/public"].issues["2"].parent, null);
  // Withdrawn, then back: the public reopen leaves REOPENED behind, which still reads as open.
  s.edit((issues) => { issues["4"].body = "Private now."; });
  s.run("push");
  s.edit((issues) => {
    Object.assign(issues["4"], { body: summary("A duplicate."), state: "OPEN", stateReason: null });
  });
  assert.equal(s.run("push").status, 0);
  assert.deepEqual(s.run("push").writes, []);
});

test("outside issues and pull requests on the public side are never touched, only counted", { skip }, () => {
  const s = scene([issue(1, "A", summary("First.")), issue(3, "C", "## What\nPrivate.\n"),
    issue(4, "D", summary("Fourth."), { parent: under(1, "acme/epics") })]);
  assert.equal(s.run("push").status, 0);
  // An outsider opens #5 (an issue) and #6 (a pull request) on the public repo.
  s.edit((issues, pub) => {
    // It even copies the tool's mark: without the label the tool adds, the issue is not the tool's.
    pub.issues["5"] = { ...issue(5, "placeholder", "placeholder\n\n<!-- public-roadmap -->\n"), id: "out-5" };
    pub.prs = [6];
    pub.discussions = [7];
    issues["8"] = issue(8, "H", summary("Eighth."));
    issues["6"] = issue(6, "F", summary("Sixth."));
    issues["7"] = issue(7, "G", summary("Seventh."));
  });
  const blocked = s.run("push");
  assert.equal(blocked.status, 1);
  assert.match(blocked.lines.join("\n"), /#6 cannot go public: its public number is already used/);
  assert.match(blocked.lines.join("\n"), /#7 cannot go public: its public number is already used/);
  s.edit((issues) => { delete issues["6"]; delete issues["7"]; });
  const out = s.run("push");
  assert.equal(out.status, 0, out.stderr);
  const pub = s.read()["me/public"].issues;
  assert.deepEqual(pub["5"].labels.nodes, []);
  assert.equal(pub["5"].title, "placeholder");
  assert.equal(pub["8"].title, "H");
  // A parent in another repo is no parent here.
  assert.equal(pub["4"].parent, null);
});

test("a public roadmap that names the private repo itself is refused", { skip }, () => {
  const s = scene([issue(1, "A", summary("First."))], {}, "me/private");
  const out = s.run("check");
  assert.equal(out.status, 1);
  assert.match(out.lines.join("\n"), /names this repo itself/);
  assert.deepEqual(out.writes, []);
});
