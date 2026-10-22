"""Installs the extras /bindwright:setup offers into the user's ~/.claude, one
consented step at a time. Python only: every extra it installs is a Python
hook or a mod folder, so a machine without Python has nothing for it to do.
Standard library, Python 3.8+.

    python engine/home.py find-python
    python engine/home.py install-hook FILE --python PATH --matcher "Bash|PowerShell"
    python engine/home.py remove-hook NAME.py
    python engine/home.py list-hooks
    python engine/home.py allow RULE          /  disallow RULE
    python engine/home.py attribution-off
    python engine/home.py add-mod DIR

Each prints one line of JSON, {"error": message} with exit status 1 on
failure. `--home DIR` stands in for the home folder (tests). Every edit of
~/.claude/settings.json keeps the previous file as settings.json.bak, refuses
a file that is not valid JSON, and writes through a temporary file, so a
failed write never leaves half a settings file.
"""

import json
import os
import shutil
import subprocess
import sys

# Runs the hook file by path. A missing file then fails with exit 1, which the
# CLI reports and moves past; a plain `python FILE` exits 2, which blocks
# every command. -I keeps the project folder off the import path.
LAUNCHER = "import runpy, sys; runpy.run_path(sys.argv[1], run_name='__main__')"

# Prints the interpreter only when it is 3.8+ and not inside a virtual or a
# conda environment: the hooks serve every project, so they must not depend
# on one project's environment.
PROBE = (
    "import os, sys; assert sys.version_info >= (3, 8) and sys.prefix == sys.base_prefix; "
    "up = os.path.dirname(sys.prefix); "
    "assert not (os.path.basename(up) == 'envs' and os.path.isdir(os.path.join(os.path.dirname(up), 'conda-meta'))); "
    "print(sys.executable)"
)
CANDIDATES = (
    [["python"], ["python3"], ["py", "-3"]]
    + [["python3.%d" % n] for n in range(13, 7, -1)]
    + [["/usr/bin/python3"], ["/usr/local/bin/python3"], ["/opt/homebrew/bin/python3"]]
)


class HomeError(Exception):
    pass


def _run(cmd, code):
    try:
        r = subprocess.run(cmd + ["-c", code], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    out = r.stdout.strip()
    return out if r.returncode == 0 and out else None


def find_python():
    """The first system Python 3.8+, or why there is none."""
    env_only = False
    for cmd in CANDIDATES:
        found = _run(cmd, PROBE)
        if found:
            return {"python": found}
        base = _run(cmd, "import sys; print(sys.base_prefix)")
        if base:
            # Inside an environment: try the interpreter it was made from.
            env_only = True
            for exe in ("bin/python3", "python.exe"):
                found = _run([os.path.join(base, exe)], PROBE)
                if found:
                    return {"python": found}
    reason = "only Python inside a virtual or conda environment" if env_only else "no Python 3.8+"
    raise HomeError("No system Python found: " + reason)


def _claude(home):
    return os.path.join(home, ".claude")


def _load(home):
    path = os.path.join(_claude(home), "settings.json")
    if not os.path.exists(path):
        return path, {}
    with open(path, encoding="utf-8-sig") as fh:
        try:
            data = json.load(fh)
        except ValueError:
            raise HomeError("%s is not valid JSON; fix it before running setup again" % path)
    if not isinstance(data, dict):
        raise HomeError("%s does not hold a JSON object" % path)
    return path, data


def _section(data, key, kind, path):
    """data[key] as a dict or list, created when missing or null."""
    if data.get(key) is None:
        data[key] = kind()
    if not isinstance(data[key], kind):
        raise HomeError("%s: %s is not a %s; fix it by hand first" % (path, key, kind.__name__))
    return data[key]


def _atomic_write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except OSError:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _save(path, data):
    if os.path.exists(path):
        shutil.copy2(path, path + ".bak")
    _atomic_write(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def _mentions(entry, name):
    """True when a PreToolUse entry runs a file called `name`."""
    for hook in entry.get("hooks") or [] if isinstance(entry, dict) else []:
        if not isinstance(hook, dict):
            continue
        words = [hook.get("command") or ""] + [a for a in hook.get("args") or [] if isinstance(a, str)]
        if any(w.replace("\\", "/").rstrip("\"'").endswith("/" + name) for w in words):
            return True
    return False


def _pre_tool_use(data, path):
    return _section(_section(data, "hooks", dict, path), "PreToolUse", list, path)


def install_hook(home, file, python, matcher):
    name = os.path.basename(file)
    if not name.endswith(".py"):
        raise HomeError("A hook is a .py file: " + file)
    path, data = _load(home)
    entries = _pre_tool_use(data, path)
    target = os.path.join(_claude(home), "hooks", name)
    with open(file, encoding="utf-8") as fh:
        _atomic_write(target, fh.read())
    entries[:] = [e for e in entries if not _mentions(e, name)]
    entries.append({"matcher": matcher, "hooks": [{
        "type": "command", "command": python,
        "args": ["-I", "-c", LAUNCHER, target.replace("\\", "/")], "timeout": 10,
    }]})
    _save(path, data)
    return {"installed": target, "settings": path}


def remove_hook(home, name):
    path, data = _load(home)
    entries = _pre_tool_use(data, path)
    kept = [e for e in entries if not _mentions(e, name)]
    removed = len(entries) - len(kept)
    if removed:
        entries[:] = kept
        _save(path, data)
    target = os.path.join(_claude(home), "hooks", name)
    deleted = os.path.isfile(target)
    if deleted:
        os.remove(target)
    return {"removed_entries": removed, "deleted_file": deleted}


def list_hooks(home):
    path, data = _load(home)
    names = []
    for entry in _pre_tool_use(data, path):
        for hook in entry.get("hooks") or [] if isinstance(entry, dict) else []:
            words = [hook.get("command") or ""] + list(hook.get("args") or []) if isinstance(hook, dict) else []
            names += [os.path.basename(w.replace("\\", "/").strip("\"'")) for w in words
                      if isinstance(w, str) and w.strip("\"'").endswith(".py")]
    return {"hooks": names}


def set_allow(home, rule, on):
    path, data = _load(home)
    allow = _section(_section(data, "permissions", dict, path), "allow", list, path)
    present = rule in allow
    if on and not present:
        allow.append(rule)
    elif not on and present:
        allow[:] = [r for r in allow if r != rule]
    if on != present:
        _save(path, data)
    return {"rule": rule, "allowed": on, "changed": on != present}


def attribution_off(home):
    path, data = _load(home)
    data["attribution"] = {"commit": "", "pr": "", "sessionUrl": False}
    _save(path, data)
    return {"settings": path}


def add_mod(home, folder):
    name = os.path.basename(os.path.normpath(folder))
    if not os.path.isfile(os.path.join(folder, ".claude-plugin", "plugin.json")):
        raise HomeError("Not a mod folder (no .claude-plugin/plugin.json): " + folder)
    path, data = _load(home)
    env = _section(data, "env", dict, path)
    target = os.path.normpath(os.path.join(_claude(home), "mods", name))
    # An installed copy may carry the user's own edits (rules.ts lists), so it stays.
    kept = os.path.exists(target)
    if not kept:
        shutil.copytree(folder, target)
    listed = [d for d in str(env.get("CLAUDE_CODE_PLUGIN_DIRS") or "").split(os.pathsep) if d]
    same = lambda d: os.path.normcase(os.path.normpath(os.path.expanduser(d))) == os.path.normcase(target)
    if not any(same(d) for d in listed):
        env["CLAUDE_CODE_PLUGIN_DIRS"] = os.pathsep.join(listed + [target])
        _save(path, data)
    return {"installed": target, "kept_existing": kept}


def _option(argv, name):
    if name not in argv:
        return None
    i = argv.index(name) + 1
    if i == len(argv) or argv[i].startswith("--"):
        raise HomeError(name + " needs a value")
    value = argv[i]
    del argv[i - 1:i + 1]
    return value


def run(argv):
    argv = list(argv)
    home = _option(argv, "--home") or os.path.expanduser("~")
    python, matcher = _option(argv, "--python"), _option(argv, "--matcher")
    cmd, args = (argv[0], argv[1:]) if argv else (None, [])
    one = args[0] if len(args) == 1 else None
    if cmd == "find-python" and not args:
        return find_python()
    if cmd == "install-hook" and one and python and matcher:
        return install_hook(home, one, python, matcher)
    if cmd == "remove-hook" and one:
        return remove_hook(home, one)
    if cmd == "list-hooks" and not args:
        return list_hooks(home)
    if cmd in ("allow", "disallow") and one:
        return set_allow(home, one, cmd == "allow")
    if cmd == "attribution-off" and not args:
        return attribution_off(home)
    if cmd == "add-mod" and one:
        return add_mod(home, one)
    raise HomeError("Usage: see the top of engine/home.py")


def main(argv):
    try:
        result = run(argv)
    except (HomeError, OSError) as e:
        result = {"error": str(e)}
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 1 if "error" in result else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
