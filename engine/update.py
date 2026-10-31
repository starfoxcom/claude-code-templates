# Python twin of update.js: /bindwright:update's three-way merge of each repo
# file against the last bind's render. Standard library only, Python 3.8+.

import json
import os
import shutil
import subprocess
import tempfile

from apply import _safe
from keep import OWNED, is_owned, kept_sections, owned_patterns

STAGING = ".bindwright/incoming/"
ANSWERS = ".bindwright/project.json"
PRISTINE = ".bindwright/pristine.json"

# What can happen to a file; update.js explains each one.
OUTCOMES = [
    "updated", "merged", "added", "staged", "unchanged", "conflict", "owned", "deleted", "removed", "removed_edited",
]


def _code_units(s):
    return s.encode("utf-16-le", "surrogatepass")


def repo_files(rendered):
    out = {}
    for dest, text in rendered.items():
        if dest.startswith(STAGING):
            out[dest[len(STAGING):]] = text
        elif not dest.startswith(".bindwright/"):
            out[dest] = text
    return out


def _keeps_sections(ours, merged, path):
    lines = ours.split("\n")
    return all("\n".join(lines[first - 1:last]) in merged for first, last in kept_sections(ours, path))


def _decide(path, ours, base, theirs, merge):
    if theirs is None:
        return ("removed",) if ours == base else ("removed_edited",)
    if base is None:
        if ours is None:
            return ("added", theirs)
        return ("unchanged",) if ours == theirs else ("staged", theirs)
    if ours is None:
        return ("deleted",)
    if ours == theirs or base == theirs:
        return ("unchanged",)
    if ours == base:
        return ("updated", theirs)
    text, conflicts = merge(ours, base, theirs)
    if conflicts or not _keeps_sections(ours, text, path):
        return ("conflict", text)
    return ("merged", text)


def plan_update(rendered, pristine, read_repo, owned, merge, version):
    theirs_all = repo_files(rendered)
    paths = sorted(set(pristine["files"]) | set(theirs_all), key=_code_units)
    result = {o: [] for o in OUTCOMES}
    result.update({"write": [], "stage": []})
    files = {}
    for path in paths:
        base, theirs = pristine["files"].get(path), theirs_all.get(path)
        if is_owned(path, owned):
            result["owned"].append(path)
            if theirs is not None:
                files[path] = theirs
            continue
        decided = _decide(path, read_repo(path), base, theirs, merge)
        outcome = decided[0]
        result[outcome].append(path)
        if outcome in ("updated", "merged", "added"):
            result["write"].append((path, decided[1]))
        if outcome in ("staged", "conflict"):
            result["stage"].append((STAGING + path, decided[1]))
        if theirs is not None:
            files[path] = theirs
    result["pristine"] = {"version": version, "year": pristine["year"], "files": files}
    return result


MERGE_LABELS = ["this repo", "last setup or update", "today's templates"]


def git_merge(ours, base, theirs):
    """A three-way merge by git: its exit status is the number of conflicts."""
    folder = tempfile.mkdtemp(prefix="bindwright-merge-")
    try:
        names = []
        for name, text in (("ours", ours), ("base", base), ("theirs", theirs)):
            names.append(os.path.join(folder, name))
            with open(names[-1], "w", encoding="utf-8", newline="") as f:
                f.write(text)
        labels = [arg for label in MERGE_LABELS for arg in ("-L", label)]
        done = subprocess.run(["git", "merge-file", "-p", "--diff3"] + labels + names, capture_output=True)
        if done.returncode < 0 or done.returncode >= 128:
            raise RuntimeError("git merge-file failed: " + done.stderr.decode("utf-8", "replace").strip())
        return done.stdout.decode("utf-8"), done.returncode
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def _reader(root):
    def read(path):
        try:
            # newline=None turns \r\n into \n, as update.js does.
            with open(os.path.join(root, *path.split("/")), encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            return None
    return read


def _put(root, path, text, exclusive=False):
    target = os.path.join(root, *path.split("/"))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "x" if exclusive else "w", encoding="utf-8", newline="") as f:
        f.write(text)


def run_update(root, bind_with, version, state_json):
    """See runUpdate in update.js. `bind_with(answers, year)` returns a bind."""
    read = _reader(root)
    answers, saved = read(ANSWERS), read(PRISTINE)
    if answers is None or saved is None:
        raise ValueError("%s or %s is missing: this repo was not set up with /bindwright:setup" % (ANSWERS, PRISTINE))
    pristine = json.loads(saved)
    bad = [p for p in pristine["files"] if not _safe(p)]
    if bad:
        raise ValueError("Refusing paths outside the repo in %s: %s" % (PRISTINE, ", ".join(bad)))
    rendered = bind_with(json.loads(answers), pristine["year"])
    owned = owned_patterns(read(OWNED) or "")
    plan = plan_update(rendered, pristine, read, owned, git_merge, version)
    for path, text in plan["write"]:
        _put(root, path, text)
    skipped = []
    for path, text in plan["stage"]:
        if os.path.lexists(os.path.join(root, *path.split("/"))):
            skipped.append(path[len(STAGING):])
        else:
            _put(root, path, text, exclusive=True)
    _put(root, PRISTINE, state_json(plan["pristine"]))
    out = {o: plan[o] for o in OUTCOMES}
    out["skipped"] = skipped
    return out
