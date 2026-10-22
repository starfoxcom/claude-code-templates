"""Lists the pinned versions in the workflows that are behind the newest releases.

Pins keep a PR's result stable; this says when they fall behind. The weekly
pin-check workflow looks up the newest releases and passes them in:

    pin_check.py --cli 2.1.310 --action-sha <40 hex> --action-version v1.0.220 FILE...

Prints a Markdown list of the pins that are behind, one line per pinned value
with every place it is pinned, or nothing when every pin is current. Exits 1 on
bad arguments or a file it cannot read.

Pins it reads:
- the CLI version a workflow installs: `CLI_VERSION: "2.1.300"` or
  `PINNED_VERSION: "2.1.299"`;
- the review action's commit: `uses: anthropics/claude-code-action@<sha>`, with
  the version it names in the comment after it.
"""

import re
import sys

CLI = re.compile(r'^\s*(?:CLI_VERSION|PINNED_VERSION):\s*"?(\d+(?:\.\d+)*)"?\s*(?:#.*)?$')
ACTION = re.compile(r"^\s*(?:-\s+)?uses:\s*anthropics/claude-code-action@([0-9a-f]{40})\b(?:\s*#\s*(.*))?$")
VERSION = re.compile(r"\d+(?:\.\d+)*")
SHA = re.compile(r"[0-9a-f]{40}")


def _tuple(version):
    return tuple(int(p) for p in version.split("."))


def pins(name, text):
    """[(kind, value, label, "file:line")] for every pin in one file."""
    found = []
    for n, line in enumerate(text.splitlines(), 1):
        m = CLI.match(line)
        if m:
            found.append(("cli", m.group(1), m.group(1), "%s:%d" % (name, n)))
            continue
        m = ACTION.match(line)
        if m:
            label = (m.group(2) or "").strip() or m.group(1)[:12]
            found.append(("action", m.group(1), label, "%s:%d" % (name, n)))
    return found


def behind(found, cli, action_sha):
    """The pins older than the newest CLI or not on the newest action commit,
    grouped by pinned value: [(kind, label, [places])] in first-seen order."""
    groups = {}
    for kind, value, label, place in found:
        old = _tuple(value) < _tuple(cli) if kind == "cli" else value != action_sha
        if old:
            groups.setdefault((kind, value), [label, []])[1].append(place)
    return [(kind, label, places) for (kind, _), (label, places) in groups.items()]


def report(stale, cli, action_version):
    newest = {"cli": "CLI " + cli, "action": "action " + action_version}
    what = {"cli": "CLI", "action": "Review action"}
    return "".join("- %s `%s` is behind the newest %s: %s\n"
                   % (what[kind], label, newest[kind], ", ".join("`%s`" % p for p in places))
                   for kind, label, places in stale)


def _option(args, name):
    if name not in args or args.index(name) + 1 == len(args):
        raise ValueError("%s needs a value" % name)
    i = args.index(name)
    value = args[i + 1]
    del args[i:i + 2]
    return value


def main(argv):
    args = list(argv)
    try:
        cli = _option(args, "--cli")
        sha = _option(args, "--action-sha")
        version = _option(args, "--action-version")
        if not VERSION.fullmatch(cli) or not SHA.fullmatch(sha) or not args:
            raise ValueError("usage: pin_check.py --cli X.Y.Z --action-sha SHA --action-version V FILE...")
        found = []
        for name in args:
            with open(name, encoding="utf-8") as fh:
                found += pins(name, fh.read())
    except (ValueError, OSError) as e:
        print("pin_check: %s" % e, file=sys.stderr)
        return 1
    sys.stdout.write(report(behind(found, cli, sha), cli, version))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
