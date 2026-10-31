# Python twin of share.js: the project's `setup` object and one person's
# choices, checked and written the same way. Standard library only.

import os

from layers import LOCAL, PERSONAL, SCHEMA, SETTINGS, _read_layer_file, resolve_layers
from update import ANSWERS, _code_units


def _put(path, file, text, exclusive=False):
    if os.path.islink(path):
        raise ValueError("Refusing to write through a symbolic link: " + file)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "x" if exclusive else "w", encoding="utf-8", newline="") as f:
        f.write(text)


def _refuse(what, problems):
    if problems:
        raise ValueError("Cannot %s: %s" % (what, ", ".join(problems)))


def _unknown_keys(obj, allowed):
    return [k for k in sorted(obj, key=_code_units) if k not in allowed]


def export_setup(root, choices, state_json):
    """See exportSetup in share.js."""
    if not isinstance(choices, dict):
        raise ValueError("Cannot export: the choices must be a JSON object")
    _refuse("export", _unknown_keys(choices, ["extras", "required"]))
    extras = choices.get("extras", {})
    required = choices.get("required", [])
    path = os.path.join(root, *ANSWERS.split("/"))
    answers = _read_layer_file(path, ANSWERS, keep_ints=True)
    if answers is None:
        raise ValueError("%s is missing: this repo was not set up with /bindwright:setup" % ANSWERS)
    setup = {"schema": SCHEMA, "extras": extras, "required": required}
    _refuse("export", resolve_layers(project=dict(answers, setup=setup))["ignored"])
    out = {k: v for k, v in answers.items() if k != "setup"}
    empty = isinstance(extras, dict) and not extras and not required
    if not empty:
        out["setup"] = setup
    _put(path, ANSWERS, state_json(out))
    return None if empty else setup


def _layer_file(name, root, config):
    if name == "personal":
        return os.path.join(config, *PERSONAL.split("/")), PERSONAL
    if name == "local":
        return os.path.join(root, *LOCAL.split("/")), LOCAL
    raise ValueError('Unknown layer "%s": use personal or local' % name)


def _sorted_dict(d):
    return {k: d[k] for k in sorted(d, key=_code_units)}


def remember_choices(root, config, name, choices, state_json):
    """See rememberChoices in share.js."""
    path, file = _layer_file(name, root, config)
    if not isinstance(choices, dict):
        raise ValueError("Cannot remember: the choices must be a JSON object")
    _refuse("remember", _unknown_keys(choices, list(SETTINGS) + ["extras"]))
    if "extras" in choices and not isinstance(choices["extras"], dict):
        _refuse("remember", ["extras"])
    current = _read_layer_file(path, file)
    current = {} if current is None else current
    resolve_layers(**{name: current})  # refuses a file it cannot read
    chosen = {k: v for k, v in choices.items() if k != "extras" and v is not None}
    extras = {k: v for k, v in choices.get("extras", {}).items() if v is not None}
    _refuse("remember", resolve_layers(**{name: dict(chosen, extras=extras)})["ignored"])
    nxt = dict(current, schema=SCHEMA)
    for key, value in choices.items():
        if key != "extras":
            if value is None:
                nxt.pop(key, None)
            else:
                nxt[key] = value
    if "extras" in choices:
        merged = dict(current["extras"]) if isinstance(current.get("extras"), dict) else {}
        for extra, value in choices["extras"].items():
            if value is None:
                merged.pop(extra, None)
            else:
                merged[extra] = value
        nxt["extras"] = _sorted_dict(merged)
    _put(path, file, state_json(_sorted_dict(nxt)))
    if name == "local":
        ignore = os.path.join(root, ".bindwright", ".gitignore")
        if not os.path.lexists(ignore):
            _put(ignore, ".bindwright/.gitignore", "local.json\n", exclusive=True)
    return file
