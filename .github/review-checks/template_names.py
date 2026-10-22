"""Pre-screen check: no template file has a name the other checks cannot read.

The changed-file list the checks get keeps one name per line: a carriage
return or newline in a name becomes a space, and bytes that are not UTF-8
become \\xNN escapes, so a check cannot open such a file and would skip it.
This check walks _core/project-template/ itself, by bytes, and fails on any
name with a control character or bytes that are not UTF-8. No template needs
one, and every name it shows has to be one the other checks can read.

Run by the gate's Project pre-screen job from the base branch:
    template_names.py FILES DIFF
Prints each odd name and exits 1; exits 0 when every name is plain.
"""

import os
import sys

ROOT = b"_core/project-template"


def odd(name):
    if any(c < 0x20 or c == 0x7F for c in name):
        return True
    try:
        name.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


def main():
    found = []
    for folder, dirs, files in os.walk(ROOT):
        for name in dirs + files:
            if odd(name):
                found.append("ODD_TEMPLATE_NAME: %r" % os.path.join(folder, name).decode("utf-8", "backslashreplace"))
    print("\n".join(sorted(found)) if found else "Every name under _core/project-template/ is plain.")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
