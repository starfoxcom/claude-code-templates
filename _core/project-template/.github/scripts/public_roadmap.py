#!/usr/bin/env python3
"""Mirrors this repo's roadmap into a public repo, one item per issue.

An issue goes public only when its body has a `### Public summary` section:
that section becomes the body of the public issue under the same number, so
`#N` reads the same on both sides. Nothing else crosses: no history, comments
or pull requests. An issue that loses its summary is blanked and closed on the
public side. Public items are never edited by hand; this tool writes them.

    python3 .github/scripts/public_roadmap.py check   # what still blocks a push
    python3 .github/scripts/public_roadmap.py push    # bring the public side in line

The public repo is `advanced.publicRoadmap` and the private board
`advanced.trackerProject`, both in `.bindwright/project.json`; the rest of the
settings live in `.github/public-roadmap.json`. `push` refuses while `check`
reports anything. Numbers the public side skips (pull requests, private issues)
get a placeholder that is deleted at once. Exit 0 clean, 1 otherwise.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ANSWERS = Path(".bindwright/project.json")
SETTINGS = Path(".github/public-roadmap.json")
SUMMARY = "### Public summary"
RATE_LIMIT_WORDS = ("rate limit", "too quickly", "abuse")

UNITS = r"\s*(%|ms\b|s\b|fps\b|[KMGT]B\b|x\b|×|seconds?\b|minutes?\b|hours?\b|days?\b|times\b)"
EXTENSIONS = r"(py|js|mjs|ts|tsx|jsx|md|json|ya?ml|toml|sh|ps1|go|rs|java|kt|cs|cpp|h|rb|php|sql)"
# How the work is done (AI models, code review, its plumbing) never goes public.
AI_PROCESS = (r"\b(Claude|Fable|Opus|Sonnet|Haiku|Anthropic|OpenAI|GPT|Copilot|Gemini|LLMs?"
              r"|language models?|AI[- ](models?|reviews?|reviewers?|tools?|assistants?|agents?"
              r"|written|generated)|code reviews?|deep[- ]reviews?|review (tiers?|gates?|bots?"
              r"|rounds?)|reviewers?)\b")
# What the public side never carries, by the name `check` reports.
CONTRACT = [
    ("history", re.compile(r"<details|Full history", re.I)),
    ("code", re.compile(r"`")),
    ("path", re.compile(r"\.(github|claude)/|\b[\w-]+/[\w.-]+/|\b[\w-]+/[\w-]+\.\w+"
                        r"|\b[\w-]+\." + EXTENSIONS + r"\b")),
    ("pull request", re.compile(r"\bPRs?\s*#?\d|\bpull requests?\b", re.I)),
    ("branch", re.compile(r"\b(feature|hotfix|release|fix|chore)/")),
    ("identifier", re.compile(r"\b[a-z0-9]+_[a-z0-9_]+\b|\b[a-z]+[A-Z]\w*\b|\w+\(\)")),
    ("constant", re.compile(r"(?<![\w.])(?<!v)\d+\.\d+(?![\d.])(?!" + UNITS + r")|\b0x[0-9a-f]+",
                            re.I)),
    ("AI or review wording", re.compile(AI_PROCESS, re.I)),
]

ISSUES = """query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) { issues(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id number title body state stateReason parent { number } } } } }"""
ITEMS = """query($owner: String!, $number: Int!, $cursor: String) {
  repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) {
    id items(first: 100, after: $cursor) { pageInfo { hasNextPage endCursor }
      nodes { id content { ... on Issue { number repository { nameWithOwner } } }
        fieldValues(first: 20) { nodes {
          ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
          ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
          ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
        } } } } } } } }"""
FIELDS = """query($id: ID!) { node(id: $id) { ... on ProjectV2 { fields(first: 50) { nodes {
  ... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name } } } } } } }"""


def run_gh(args: list[str]) -> str:
    """Runs gh, waiting out GitHub's rate limits; any other failure stops the run."""
    for attempt in range(6):
        done = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8")
        output = done.stdout + done.stderr
        if done.returncode == 0 and '"errors"' not in done.stdout:
            return done.stdout
        if not any(word in output.lower() for word in RATE_LIMIT_WORDS):
            raise SystemExit(f"gh {' '.join(args[:3])} failed: {output[:400]}")
        time.sleep(60 * (attempt + 1))
    raise SystemExit("gave up after repeated rate limits")


def gql(query: str, **variables) -> dict:
    args = ["api", "graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        args += ["-F" if isinstance(value, int) else "-f", f"{key}={value}"]
    return json.loads(run_gh(args))["data"]


def paginate(query: str, path: tuple[str, ...], **variables) -> tuple[list[dict], dict]:
    """Every node of a paged connection, plus the object that holds it."""
    nodes, cursor = [], None
    while True:
        page = gql(query, **variables, **({"cursor": cursor} if cursor else {}))
        for key in path:
            holder, page = page, page[key]
        nodes += page["nodes"]
        if not page["pageInfo"]["hasNextPage"]:
            return nodes, holder
        cursor = page["pageInfo"]["endCursor"]


def fetch_issues(repo: str) -> dict[int, dict]:
    owner, name = repo.split("/")
    nodes, _ = paginate(ISSUES, ("repository", "issues"), owner=owner, name=name)
    return {node["number"]: node for node in nodes}


def fetch_items(owner: str, number: int, repo: str) -> tuple[str, dict[int, dict]]:
    """A board's id and its items for `repo`'s issues: item id plus every set field value."""
    nodes, board = paginate(ITEMS, ("repositoryOwner", "projectV2", "items"),
                            owner=owner, number=number)
    items = {}
    for node in nodes:
        content = node.get("content") or {}
        if (content.get("repository") or {}).get("nameWithOwner") != repo:
            continue
        values = {}
        for value in node["fieldValues"]["nodes"]:
            if value and "field" in value:
                values[value["field"]["name"]] = next(
                    value[kind] for kind in ("name", "text", "number", "date") if kind in value)
        items[content["number"]] = {"id": node["id"], "values": values}
    return board["id"], items


def with_body_file(body: str, args: list[str]) -> str:
    with tempfile.NamedTemporaryFile("w", suffix=".md", encoding="utf-8", delete=False) as file:
        file.write(body)
    try:
        return run_gh([*args, "--body-file", file.name])
    finally:
        Path(file.name).unlink()


def summary_of(body: str) -> str | None:
    """The text under `### Public summary`, up to the next heading; None when absent or empty."""
    lines = (body or "").replace("\r\n", "\n").split("\n")
    if SUMMARY not in (line.strip() for line in lines):
        return None
    start = [line.strip() for line in lines].index(SUMMARY) + 1
    taken = []
    for line in lines[start:]:
        if re.match(r"#{1,6} |<details", line.strip()):
            break
        taken.append(line)
    text = "\n".join(taken).strip()
    return text or None


def same_text(stored: str, wanted: str) -> bool:
    """GitHub hands bodies back with CRLF line ends; only the words count."""
    return (stored or "").replace("\r\n", "\n").strip() == wanted.replace("\r\n", "\n").strip()


class Settings:
    """The answers and `.github/public-roadmap.json`, read once."""

    def __init__(self, root: Path):
        answers = json.loads((root / ANSWERS).read_text(encoding="utf-8"))["advanced"]
        raw = json.loads((root / SETTINGS).read_text(encoding="utf-8"))
        self.public_repo = answers.get("publicRoadmap")
        if not self.public_repo:
            raise SystemExit(f"advanced.publicRoadmap in {ANSWERS} names no public repo")
        board = answers.get("trackerProject")
        self.private_board = (board.split("/")[0], int(board.split("/")[1])) if board else None
        self.rename = dict(raw.get("rename", {}))
        hidden = [re.escape(word) for word in raw.get("hidden", []) if word]
        self.hidden = re.compile(r"\b(" + "|".join(hidden) + r")\b", re.I) if hidden else None
        self.public_board = raw.get("project")
        self.fields = list(raw.get("fields", []))

    def public_text(self, text: str) -> str:
        for real, public in self.rename.items():
            text = re.sub(r"\b" + re.escape(real) + r"\b", public, text)
        return text


def contract_breaks(text: str, settings: Settings, public: set[int]) -> list[str]:
    """Why `text` cannot go public; empty when it can."""
    problems = [f"{name} ('{rule.search(text).group(0)}')" for name, rule in CONTRACT
                if rule.search(text)]
    if settings.hidden and settings.hidden.search(text):
        problems.append(f"private name ('{settings.hidden.search(text).group(0)}')")
    private = sorted({int(n) for n in re.findall(r"(?<![\w&])#(\d+)\b", text)} - public)
    problems += [f"points at #{number}, which stays private" for number in private]
    return problems


WITHDRAWN = ("Withdrawn", "This item is no longer on the public roadmap.\n")


class PublicSync:
    """One run: reads both repos once, then brings the public side in line."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.repo = run_gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).strip()
        self.private = fetch_issues(self.repo)
        self.public: dict[int, dict] = {}
        self.wanted: dict[int, tuple[str, str]] = {}
        for number, issue in sorted(self.private.items()):
            summary = summary_of(issue["body"])
            if summary is not None:
                text = settings.public_text
                self.wanted[number] = (text(issue["title"]), text(summary) + "\n")

    def problems(self) -> list[str]:
        lines = []
        public = set(self.wanted)
        for number, (title, body) in self.wanted.items():
            lines += [f"#{number} title: {p}" for p in contract_breaks(title, self.settings, public)]
            lines += [f"#{number} summary: {p}" for p in contract_breaks(body, self.settings, public)]
        return lines

    def push(self) -> None:
        self.create_missing()
        self.public = fetch_issues(self.settings.public_repo)
        self.withdraw()
        self.update_texts()
        self.sync_parents()
        self.sync_states()
        if self.settings.public_board and self.settings.private_board and self.settings.fields:
            self.sync_fields()

    def create_missing(self) -> None:
        """Creates public items in number order; a number with no public item gets a placeholder.

        GitHub never reuses a deleted number, so a run stops at the newest wanted item: a
        placeholder is only made when a real item follows it, and the newest surviving public
        issue always marks how far the numbers have gone.
        """
        repo = self.settings.public_repo
        highest = max([*fetch_issues(repo), 0])
        for number in range(highest + 1, max([*self.wanted, 0]) + 1):
            title, body = self.wanted.get(number, ("placeholder", "placeholder\n"))
            url = with_body_file(body, ["issue", "create", "--repo", repo, "--title", title])
            created = int(url.strip().rsplit("/", 1)[1])
            if created != number:
                raise SystemExit(f"public numbers drifted: wanted #{number}, GitHub made #{created}."
                                 " The public repo must hold only items this tool made.")
            if number not in self.wanted:
                issue_id = fetch_issues(repo)[number]["id"]
                gql("mutation($id: ID!) { deleteIssue(input: {issueId: $id}) { clientMutationId } }",
                    id=issue_id)
            print(f"created #{number}")

    def withdraw(self) -> None:
        """Blanks and closes the public items whose private issue lost its summary."""
        for number, current in sorted(self.public.items()):
            if number in self.wanted or current["title"] == WITHDRAWN[0]:
                continue
            title, body = WITHDRAWN
            with_body_file(body, ["issue", "edit", str(number), "--repo", self.settings.public_repo,
                                  "--title", title])
            if current["state"] == "OPEN":
                gql("mutation($id: ID!) { closeIssue(input: {issueId: $id, stateReason: NOT_PLANNED})"
                    " { clientMutationId } }", id=current["id"])
            print(f"withdrew #{number}")

    def update_texts(self) -> None:
        for number, (title, body) in sorted(self.wanted.items()):
            current = self.public[number]
            if current["title"] == title and same_text(current["body"], body):
                continue
            with_body_file(body, ["issue", "edit", str(number), "--repo", self.settings.public_repo,
                                  "--title", title])
            print(f"updated #{number}")

    def sync_parents(self) -> None:
        for number in sorted(self.wanted):
            parent = (self.private[number].get("parent") or {}).get("number")
            current = (self.public[number].get("parent") or {}).get("number")
            if parent == current or parent not in self.wanted:
                continue
            gql("mutation($p: ID!, $c: ID!) { addSubIssue(input: {issueId: $p, subIssueId: $c,"
                " replaceParent: true}) { clientMutationId } }",
                p=self.public[parent]["id"], c=self.public[number]["id"])
            print(f"linked #{number} under #{parent}")

    def sync_states(self) -> None:
        for number in sorted(self.wanted):
            private, public = self.private[number], self.public[number]
            if (private["state"], private["stateReason"]) == (public["state"], public["stateReason"]):
                continue
            if private["state"] == "OPEN":
                gql("mutation($id: ID!) { reopenIssue(input: {issueId: $id}) { clientMutationId } }",
                    id=public["id"])
            else:
                reason = "NOT_PLANNED" if private["stateReason"] == "NOT_PLANNED" else "COMPLETED"
                gql("mutation($id: ID!) { closeIssue(input: {issueId: $id, stateReason: %s})"
                    " { clientMutationId } }" % reason, id=public["id"])
            print(f"state #{number} -> {private['state'].lower()}")

    def sync_fields(self) -> None:
        settings = self.settings
        _, private_items = fetch_items(*settings.private_board, self.repo)
        owner = settings.public_repo.split("/")[0]
        board, public_items = fetch_items(owner, int(settings.public_board), settings.public_repo)
        fields = {f["name"]: f for f in gql(FIELDS, id=board)["node"]["fields"]["nodes"] if f}
        unknown = [name for name in settings.fields if name not in fields]
        if unknown:
            raise SystemExit(f"the public board has no field named {', '.join(unknown)}")
        for number in sorted(self.wanted):
            if number not in public_items:
                data = gql("mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: {projectId: $p,"
                           " contentId: $c}) { item { id } } }", p=board, c=self.public[number]["id"])
                public_items[number] = {"id": data["addProjectV2ItemById"]["item"]["id"], "values": {}}
            wanted = private_items.get(number, {"values": {}})["values"]
            self.write_fields(board, fields, public_items[number], wanted)

    def write_fields(self, board: str, fields: dict, item: dict, wanted: dict) -> None:
        writes = []
        for name in self.settings.fields:
            target = wanted.get(name)
            if item["values"].get(name) == target:
                continue
            ids = f'projectId: "{board}", itemId: "{item["id"]}", fieldId: "{fields[name]["id"]}"'
            if target in (None, ""):
                writes.append(f"clearProjectV2ItemFieldValue(input: {{{ids}}}) {{ clientMutationId }}")
            else:
                value = field_value(fields[name], target)
                writes.append(f"updateProjectV2ItemFieldValue(input: {{{ids}, value: {value}}})"
                              " { clientMutationId }")
        if writes:
            gql("mutation { " + " ".join(f"w{i}: {write}" for i, write in enumerate(writes)) + " }")


def field_value(field: dict, target) -> str:
    if field["dataType"] == "SINGLE_SELECT":
        option = next((o["id"] for o in field["options"] if o["name"] == target), None)
        if option is None:
            raise SystemExit(f"public field {field['name']} has no option '{target}'")
        return f'{{singleSelectOptionId: "{option}"}}'
    if field["dataType"] == "NUMBER":
        return f"{{number: {float(target)}}}"
    if field["dataType"] == "DATE":
        return f'{{date: "{target}"}}'
    return "{text: %s}" % json.dumps(str(target))


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1 or argv[0] not in ("check", "push"):
        print(__doc__)
        return 1
    sync = PublicSync(Settings(Path.cwd()))
    problems = sync.problems()
    for line in problems:
        print(line)
    if problems:
        print(f"{len(problems)} problem(s): fix the public summaries in the private issues, then run"
              " this again")
        return 1
    if argv[0] == "push":
        sync.push()
    print("the public roadmap is in step" if argv[0] == "push" else "nothing blocks a push")
    return 0


if __name__ == "__main__":
    sys.exit(main())
