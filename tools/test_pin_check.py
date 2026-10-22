"""Tests for .github/scripts/pin_check.py, the weekly pin check's report."""

import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, ".github", "scripts"))
import pin_check  # noqa: E402

OLD_SHA = "7ada98c10deffc4c13fe5079693edf312888ff3b"
NEW_SHA = "1234567890abcdef1234567890abcdef12345678"
WORKFLOW = f"""\
jobs:
  review:
    env:
      CLI_VERSION: "2.1.300"
    steps:
      - uses: anthropics/claude-code-action@{OLD_SHA}  # v1 (v1.0.213)
      - name: backup
        env:
          CLI_VERSION: "2.1.280"
        uses: anthropics/claude-code-action@{OLD_SHA}  # v1 (v1.0.213)
"""


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = pin_check.main(list(argv))
    return code, out.getvalue(), err.getvalue()


class Pins(unittest.TestCase):
    def test_every_pin_is_found_with_its_place(self):
        got = pin_check.pins("w.yml", WORKFLOW)
        self.assertEqual(got, [("cli", "2.1.300", "2.1.300", "w.yml:4"),
                               ("action", OLD_SHA, "v1 (v1.0.213)", "w.yml:6"),
                               ("cli", "2.1.280", "2.1.280", "w.yml:9"),
                               ("action", OLD_SHA, "v1 (v1.0.213)", "w.yml:10")])

    def test_other_lines_are_not_pins(self):
        for line in ('  CLI_VERSION: "${{ env.X }}"', "  # CLI_VERSION: 2.1.1", 'NOT_CLI_VERSION: "2.1.1"',
                     "  uses: anthropics/claude-code-action@v1", "  uses: other/claude-code-action@" + OLD_SHA,
                     '  echo "uses: anthropics/claude-code-action@' + OLD_SHA + '"'):
            with self.subTest(line=line):
                self.assertEqual(pin_check.pins("w", line), [])

    def test_a_pin_without_a_comment_is_named_by_its_sha(self):
        got = pin_check.pins("w", "uses: anthropics/claude-code-action@" + OLD_SHA)
        self.assertEqual(got[0][2], OLD_SHA[:12])

    def test_quotes_and_a_trailing_comment_are_optional(self):
        for line in ("  PINNED_VERSION: 2.1.299", '  PINNED_VERSION: "2.1.299"  # mods'):
            with self.subTest(line=line):
                self.assertEqual(pin_check.pins("w", line)[0][1], "2.1.299")


class Behind(unittest.TestCase):
    FOUND = pin_check.pins("w.yml", WORKFLOW)

    def test_versions_compare_as_numbers(self):
        # 2.1.300 is newer than 2.1.31, though not as text.
        for newest, stale in (("2.1.300", ["2.1.280"]), ("2.1.299", ["2.1.280"]), ("2.1.301", ["2.1.300", "2.1.280"]),
                              ("2.1.280", []), ("2.2.0", ["2.1.300", "2.1.280"]), ("2.1.31", [])):
            with self.subTest(newest=newest):
                got = pin_check.behind(self.FOUND, newest, OLD_SHA)
                self.assertEqual([label for kind, label, _ in got if kind == "cli"], stale)

    def test_an_action_pin_off_the_newest_commit_is_behind_once_with_every_place(self):
        got = pin_check.behind(self.FOUND, "2.1.280", NEW_SHA)
        self.assertEqual(got, [("action", "v1 (v1.0.213)", ["w.yml:6", "w.yml:10"])])
        self.assertEqual(pin_check.behind(self.FOUND, "2.1.280", OLD_SHA), [])


class Main(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".yml")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(WORKFLOW)
        self.addCleanup(os.remove, self.path)

    def test_the_report_lists_each_stale_value_once(self):
        code, out, _ = run("--cli", "2.1.300", "--action-sha", NEW_SHA, "--action-version", "v1.0.220", self.path)
        self.assertEqual(code, 0)
        lines = out.splitlines()
        self.assertEqual(len(lines), 2, out)
        self.assertIn("- CLI `2.1.280` is behind the newest CLI 2.1.300: `%s:9`" % self.path, lines)
        self.assertIn("- Review action `v1 (v1.0.213)` is behind the newest action v1.0.220: `%s:6`, `%s:10`"
                      % (self.path, self.path), lines)

    def test_nothing_is_printed_when_every_pin_is_current(self):
        self.assertEqual(run("--cli", "2.1.280", "--action-sha", OLD_SHA, "--action-version", "v1.0.213", self.path),
                         (0, "", ""))

    def test_bad_arguments_and_missing_files_fail(self):
        for argv in ([], ["--cli", "2.1.300", "--action-sha", OLD_SHA, "--action-version", "v1"],
                     ["--cli", "latest", "--action-sha", OLD_SHA, "--action-version", "v1", self.path],
                     ["--cli", "2.1.300", "--action-sha", "v1", "--action-version", "v1", self.path],
                     ["--cli", "2.1.300", "--action-sha", OLD_SHA, "--action-version", "v1", self.path + ".gone"],
                     ["--cli"]):
            with self.subTest(argv=argv):
                code, out, err = run(*argv)
                self.assertEqual((code, out), (1, ""))
                self.assertTrue(err.startswith("pin_check: "), err)


if __name__ == "__main__":
    unittest.main()
