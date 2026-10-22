"""Pre-screen check: a redesign/*.jsx change comes with index.html.

The redesign/ JSX source and the built page in index.html are kept in sync
by hand, so a JSX edit without an index.html edit may leave the page behind.
A warning for the reviewer to judge, so it always exits 0.

Run by the gate's Project pre-screen job from the base branch:
    page_parity.py FILES DIFF   (FILES: one changed path per line)
"""

import sys


def main(files_path):
    with open(files_path, encoding="utf-8") as fh:
        changed = [p for p in fh.read().split("\n") if p]
    jsx = [p for p in changed if p.startswith("redesign/") and p.endswith(".jsx")]
    if jsx and "index.html" not in changed:
        print("WARNING JSX_HTML_PARITY: %s touched but index.html is not in the diff;"
              " the page may be out of sync" % ", ".join(jsx))
    else:
        print("No redesign/ JSX change without index.html.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
