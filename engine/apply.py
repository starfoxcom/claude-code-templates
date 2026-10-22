# Python twin of apply.js. Writes a bind's files into a repo, never over an
# existing file. When the repo already has a file, the new text goes to
# STAGING under the same path instead, for setup to merge; when that copy
# exists too, the file is skipped. Standard library only.

import os
import re

# The folder bind.py stages merge targets in; a test keeps the two in step.
STAGING = ".bindwright/incoming/"

# Relative paths of plain segments only: no drive, root, backslash, "." or "..".
_SEGMENT = re.compile(r"[^/\\:\x00-\x1f]+")


class ApplyError(ValueError):
    pass


def _safe(path):
    parts = path.split("/")
    return all(_SEGMENT.fullmatch(p) is not None and p not in (".", "..") for p in parts)


def _write(target, text):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "x", encoding="utf-8", newline="") as fh:
        fh.write(text)


def apply_files(files, root):
    """files: [[path, text], ...]. Returns {"written", "staged", "skipped"}, each a
    list of the given paths; a staged file sits at STAGING + path."""
    bad = [path for path, _ in files if not _safe(path)]
    if bad:
        raise ApplyError("Refusing to write outside the repo: " + ", ".join(bad))
    result = {"written": [], "staged": [], "skipped": []}

    def at(path):
        return os.path.join(root, *path.split("/"))

    for path, text in files:
        if not os.path.lexists(at(path)):
            _write(at(path), text)
            result["written"].append(path)
        elif not path.startswith(STAGING) and not os.path.lexists(at(STAGING + path)):
            _write(at(STAGING + path), text)
            result["staged"].append(path)
        else:
            result["skipped"].append(path)
    return result
