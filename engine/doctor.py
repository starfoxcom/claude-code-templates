# Python twin of doctor.js: the same checks, in the same order and words.
# Standard library only.

import os
import re

from model import validate
from layers import MODS, _read_layer_file, run_settings
from update import ANSWERS, PRISTINE, STAGING, _code_units

# What to do about each finding, in plain words.
FIX = {
    "restore": "Restore it from git with `git checkout -- .bindwright/`, or set the repo up again.",
    "update": "Run /bindwright:update: it keeps the repo's own edits.",
    "guards": "Restore them from git with `git checkout -- .claude/hooks/`; "
              "an update does not bring back deleted files.",
    "settings": "Fix or remove those values in the files named.",
    "join": "Run /bindwright:join: it installs each one on a yes and remembers a no.",
    "cli": "Update the CLI. In Claude Desktop, update the app: it ships its own copy of the CLI.",
    "staged": "Run /bindwright:update, which walks through each one, or delete the ones you do not want.",
    "unreadable": "Fix or remove the file it names.",
}


MODS_SINCE = [2, 1, 287]


def cli_version_from(agent):
    m = re.match(r"claude-code_(\d+)-(\d+)-(\d+)_", agent if isinstance(agent, str) else "")
    return [int(n) for n in m.groups()] if m else None


def _before(a, b):
    for x, y in zip(a, b):
        if x != y:
            return x < y
    return False


def _parts(v):
    return [int(n) for n in v.split(".")] if isinstance(v, str) and re.fullmatch(r"\d+\.\d+\.\d+", v) else None


def _staged(root):
    base = os.path.join(root, *STAGING.strip("/").split("/"))
    out = []

    def walk(folder, prefix):
        for name in sorted(os.listdir(folder), key=_code_units):
            path = os.path.join(folder, name)
            # A linked folder counts as one file, as Node's directory entries see it.
            if os.path.isdir(path) and not os.path.islink(path):
                walk(path, prefix + name + "/")
            else:
                out.append(prefix + name)
    if os.path.lexists(base):
        walk(base, "")
    return out


def _check(id_, ok, say, fix=None):
    return {"id": id_, "ok": ok, "say": say, "fix": fix}


def _staged_check(root):
    try:
        files = _staged(root)
    except OSError:
        return _check("staged", False, "%s cannot be read as a folder." % STAGING, FIX["unreadable"])
    if files:
        return _check("staged", False, "%d staged file(s) wait under %s: %s." % (len(files), STAGING, ", ".join(files)),
                      FIX["staged"])
    return _check("staged", True, "No staged files are waiting.")


def _state_checks(root):
    def at(path):
        return os.path.join(root, *path.split("/"))
    try:
        answers = _read_layer_file(at(ANSWERS), ANSWERS)
        pristine = _read_layer_file(at(PRISTINE), PRISTINE)
    except Exception as e:
        return {"checks": [_check("state", False, "A Bindwright state file cannot be read: %s." % e,
                                  FIX["restore"])]}
    if answers is None or pristine is None:
        say = "This repo is not set up with Bindwright."
        return {"checks": [_check("state", False, say, "Run /bindwright:setup.")]}
    try:
        validate(answers)
    except Exception as e:
        return {"checks": [_check("state", False, "The saved answers in %s are broken: %s." % (ANSWERS, e),
                                  "Restore the file from git with `git checkout -- %s`." % ANSWERS)]}
    if not isinstance(pristine, dict) or not isinstance(pristine.get("files"), dict):
        return {"checks": [_check("state", False, "%s does not hold the files setup wrote." % PRISTINE,
                                  "Restore the file from git with `git checkout -- %s`." % PRISTINE)]}
    return {"checks": [_check("state", True, "The setup files are present and readable.")],
            "answers": answers, "pristine": pristine}


def _version_check(pristine, plugin_version):
    repo, plugin = _parts(pristine.get("version")), _parts(plugin_version)
    if repo and plugin and _before(repo, plugin):
        return _check("version", False,
                      "The repo's Bindwright files come from %s; the plugin is %s."
                      % (pristine["version"], plugin_version),
                      FIX["update"])
    return _check("version", True, "The repo's files match the plugin's version.")


def _guard_check(root, answers, pristine):
    guards = [".claude/hooks/push-guard.py", ".claude/hooks/run-hook.sh"]
    missing = []
    if answers["advanced"]["hookLocation"] == "repo":
        missing = [p for p in guards
                   if p in pristine["files"] and not os.path.exists(os.path.join(root, *p.split("/")))]
    if missing:
        return _check("guards", False,
                      "The repo's guard hooks are missing: %s. Force pushes are not blocked here." % ", ".join(missing),
                      FIX["guards"])
    return _check("guards", True, "The guard hooks are in place.")


def _settings_checks(root, config):
    try:
        settings = run_settings(root, config)
    except Exception as e:
        return {"checks": [_check("settings", False, "The settings cannot be read: %s." % e, FIX["unreadable"])],
                "installed": {}}
    if settings["ignored"]:
        first = _check("settings", False, "Some settings are not used: %s." % "; ".join(settings["ignored"]),
                       FIX["settings"])
    else:
        first = _check("settings", True, "Every setting is in use.")
    if settings["drift"]:
        lacks = "The project expects extras this machine lacks: %s." % ", ".join(settings["drift"])
        second = _check("extras", False, lacks,
                        FIX["join"])
    else:
        second = _check("extras", True, "This machine has the extras the project expects.")
    return {"checks": [first, second], "installed": settings["installed"]}


def _cli_check(installed, cli_version):
    # Only mods need the newer CLI; the guards are plain hooks.
    mods = any(has and name in MODS for name, has in installed.items())
    if not mods or not cli_version or not _before(cli_version, MODS_SINCE):
        return _check("cli", True, "The CLI runs the installed mods.")
    running, needed = ".".join(map(str, cli_version)), ".".join(map(str, MODS_SINCE))
    return _check("cli", False,
                  "This session runs CLI %s, older than the %s the mods need, so none of them load."
                  % (running, needed),
                  FIX["cli"])


def run_doctor(root, config, plugin_version, cli_version):
    """See runDoctor in doctor.js."""
    state = _state_checks(root)
    checks = list(state["checks"])
    if "answers" in state:
        checks += [_version_check(state["pristine"], plugin_version),
                   _guard_check(root, state["answers"], state["pristine"])]
        checks.append(_staged_check(root))
        settings = _settings_checks(root, config)
        checks += settings["checks"] + [_cli_check(settings["installed"], cli_version)]
    return {"problems": sum(1 for c in checks if not c["ok"]), "checks": checks}
