# Python twin of setupcode.js: decodes the setup code the page hands to
# /bindwright:setup ("bw1-" + base64url of the answers as UTF-8 JSON, no
# padding) with the same checks and messages. Standard library only.

import base64
import json
import re

PREFIX = "bw1-"
# Real answers encode to about 1 KB and nest three levels deep. The caps keep
# a huge code from reaching the JSON reader, and a deep one from Python's,
# which gives up near 1000 levels where JSON.parse keeps going.
MAX_BODY = 20000
MAX_DEPTH = 64


class SetupCodeError(ValueError):
    pass


def _fail(msg):
    raise SetupCodeError("Invalid setup code: " + msg)


def _not_json(name):
    raise ValueError(name + " is not JSON")


def _depth(text):
    """The deepest bracket nesting outside JSON strings."""
    depth = deepest = 0
    in_string = escaped = False
    for c in text:
        if in_string:
            if escaped:
                escaped = False
            elif c == "\\":
                escaped = True
            elif c == '"':
                in_string = False
        elif c == '"':
            in_string = True
        elif c in "[{":
            depth += 1
            deepest = max(deepest, depth)
        elif c in "]}":
            depth -= 1
    return deepest


def decode_setup_code(code):
    if not isinstance(code, str) or not code.startswith(PREFIX):
        _fail("it must start with " + PREFIX)
    body = code[len(PREFIX):]
    if len(body) > MAX_BODY:
        _fail("it is too long")
    if re.fullmatch(r"[A-Za-z0-9_-]+", body) is None or len(body) % 4 == 1:
        _fail("the part after the prefix is not base64url")
    raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
    try:
        # utf-8-sig drops one leading byte-order mark, as TextDecoder does.
        text = raw.decode("utf-8-sig")
    except ValueError:
        _fail("it does not hold UTF-8 JSON")
    if _depth(text) > MAX_DEPTH:
        _fail("it nests too deeply")
    try:
        # NaN and Infinity are not JSON, and JSON.parse refuses them.
        answers = json.loads(text, parse_constant=_not_json)
    except ValueError:
        _fail("it does not hold UTF-8 JSON")
    if not isinstance(answers, dict):
        _fail("the answers must be an object")
    return answers
