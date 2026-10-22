"""Pre-screen check: every toggle block in a changed template closes.

Every `<!-- TOGGLE:name START -->` (and `name:off`) needs a matching
`<!-- TOGGLE:name END -->` in the same file; a missing END swallows the rest
of the file when a bind resolves it. Only files under _core/project-template/,
where the markers live: prose elsewhere quotes the syntax in code spans.

Run by the gate's Project pre-screen job from the base branch:
    template_markers.py FILES DIFF   (FILES: one changed path per line)
Prints each unbalanced block and exits 1; exits 0 when all balance.
"""

import re
import sys
from collections import Counter

MARKER = re.compile(r"<!--\s*TOGGLE:([\w:_\-]+)\s+(START|END)\s*-->")
SUFFIXES = (".md", ".template", ".yml", ".yaml", ".html")


def main(files_path):
    with open(files_path, encoding="utf-8") as fh:
        changed = [p for p in fh.read().split("\n") if p]
    found = []
    for name in changed:
        if not name.startswith("_core/project-template/") or not name.endswith(SUFFIXES):
            continue
        try:
            with open(name, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        starts = Counter(m.group(1) for m in MARKER.finditer(text) if m.group(2) == "START")
        ends = Counter(m.group(1) for m in MARKER.finditer(text) if m.group(2) == "END")
        for toggle in sorted(starts | ends):
            if starts[toggle] != ends[toggle]:
                found.append("TOGGLE_UNBALANCED: %s: name=%s START=%d END=%d"
                             % (name, toggle, starts[toggle], ends[toggle]))
    print("\n".join(found) if found else "All toggle blocks in changed templates balance.")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
