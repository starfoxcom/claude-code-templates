# Python twin of keep.js. The parts of a set-up repo that belong to the
# project, which /bindwright:update never changes: whole files listed in
# .bindwright/owned, and sections of shared files between keep markers.
# Standard library only.

import re

from model import JS_WHITESPACE

OWNED = ".bindwright/owned"


def owned_patterns(text):
    """One pattern per line, a repo path from the root; blank lines and lines
    starting with # are skipped. `*` matches within one path segment, `**`
    across segments, `?` one character other than "/", and a pattern ending
    in "/" covers everything under that folder."""
    lines = (line.strip(JS_WHITESPACE) for line in text.split("\n"))
    return [line.lstrip("/") for line in lines if line and not line.startswith("#")]


_SPECIAL = set(".+^${}()|[]\\")


def _pattern_regex(pattern):
    p = pattern + "**" if pattern.endswith("/") else pattern
    out = []
    i = 0
    while i < len(p):
        c = p[i]
        if p.startswith("**", i):
            # "**/" also matches no folder at all, so "a/**/b" covers "a/b".
            slash = p.startswith("/", i + 2)
            out.append("(?:.*/)?" if slash else ".*")
            i += 3 if slash else 2
            continue
        if c == "*":
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        else:
            out.append("\\" + c if c in _SPECIAL else c)
        i += 1
    return re.compile("".join(out), re.DOTALL)


def is_owned(path, patterns):
    """True when the repo path matches any pattern from owned_patterns."""
    return any(_pattern_regex(p).fullmatch(path) for p in patterns)


_OPEN = "bindwright:keep"
_CLOSE = "bindwright:end-keep"


class KeepError(ValueError):
    pass


def kept_sections(text, file):
    """A line holding `bindwright:keep` opens a kept section and a line holding
    `bindwright:end-keep` closes it, inside whatever comment the file's
    language uses. Returns [first, last] line numbers (1-based, marker lines
    included). Nested, unopened or unclosed markers fail, naming the line."""
    sections = []
    opened = 0
    for n, line in enumerate(text.split("\n"), 1):
        if _CLOSE in line:
            if not opened:
                raise KeepError("%s line %d: %s without a %s before it" % (file, n, _CLOSE, _OPEN))
            sections.append([opened, n])
            opened = 0
        elif _OPEN in line:
            if opened:
                raise KeepError("%s line %d: %s inside the section opened on line %d" % (file, n, _OPEN, opened))
            opened = n
    if opened:
        raise KeepError("%s line %d: %s is never closed" % (file, opened, _OPEN))
    return sections
