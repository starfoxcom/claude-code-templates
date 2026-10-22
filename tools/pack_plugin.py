"""Assembles the installable Bindwright plugin.

The repo keeps one copy of everything: `plugin/` holds only the plugin's own
files (manifest and skills), and this script adds the engine's runtime files
and the templates the engine reads, so a user downloads only what setup needs.

    python tools/pack_plugin.py                 -> dist/bindwright/
    python tools/pack_plugin.py --out DIR       -> DIR (replaced if it holds an earlier pack)

Try it with `claude --plugin-dir dist/bindwright`. Standard library only.
"""

import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# What setup runs: both engine twins, their command entry points, and
# package.json, which tells Node the .js files are ES modules.
ENGINE_FILES = [
    "package.json", "core-files.json", "cli.js",
    "bind.js", "model.js", "render.js", "setupcode.js", "apply.js",
    "bind.py", "model.py", "render.py", "setupcode.py", "apply.py", "home.py",
]
# The ~/.claude templates bind.js and bind.py read (globalFiles).
GLOBAL_FILES = [
    "CLAUDE.md.additions", "memory-template/MEMORY.md",
    "hooks/push-guard.py", "hooks/no-ai-attribution.py",
    "hooks/code-research-profiles.json", "hooks/code-research-first.py.template",
]
# Marks a folder as a pack, so --out never replaces anything else.
MARKER = ".bindwright-pack"


def _copy(src_rel, dest_root, dest_rel=None):
    dest = os.path.join(dest_root, *(dest_rel or src_rel).split("/"))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copyfile(os.path.join(ROOT, *src_rel.split("/")), dest)


def _skipped(dirpath, name):
    # Caches, tests, and the editor typings the CLI writes beside a loaded mod.
    if name in ("__pycache__", "node_modules", "tests", "test-helper"):
        return True
    return name == "types" and os.path.basename(dirpath) == ".claude-plugin"


def _files_under(rel):
    base = os.path.join(ROOT, *rel.split("/"))
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if not _skipped(dirpath, d))
        for name in sorted(filenames):
            yield os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, "/")


def _clear(out):
    if not os.path.exists(out):
        return
    if not os.path.isfile(os.path.join(out, MARKER)):
        raise SystemExit("Refusing to replace %s: it is not an earlier pack" % out)
    shutil.rmtree(out)


def pack(out):
    """Writes the plugin to `out` and returns the number of files."""
    _clear(out)
    files = list(_files_under("plugin"))
    for rel in files:
        _copy(rel, out, rel[len("plugin/"):])
    for name in ENGINE_FILES:
        _copy("engine/" + name, out, "engine/" + name)
    with open(os.path.join(ROOT, "engine", "core-files.json"), encoding="utf-8") as fh:
        core = ["_core/project-template/" + p for p in json.load(fh)]
    licenses = list(_files_under("_core/licenses"))
    global_files = ["_core/global-template/" + p for p in GLOBAL_FILES]
    # Mods are copied whole into ~/.claude/mods/, so the pack carries them as they ship.
    mods = list(_files_under("_core/global-template/mods"))
    global_files += mods
    # VERSION too: the engine records it in the pristine render it writes.
    for rel in core + licenses + global_files + ["VERSION"]:
        _copy(rel, out)
    _stamp_version(out)
    with open(os.path.join(out, MARKER), "w", encoding="utf-8") as fh:
        fh.write("Built by tools/pack_plugin.py; safe to delete.\n")
    return len(files) + len(ENGINE_FILES) + len(core) + len(licenses) + len(global_files) + 2


def _stamp_version(out):
    with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as fh:
        version = fh.read().strip().lstrip("v")
    path = os.path.join(out, ".claude-plugin", "plugin.json")
    with open(path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    manifest["version"] = version
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


def main(argv):
    out = os.path.join(ROOT, "dist", "bindwright")
    if "--out" in argv:
        i = argv.index("--out") + 1
        if i == len(argv):
            raise SystemExit("--out needs a folder")
        out = os.path.abspath(argv[i])
    count = pack(out)
    print("Packed %d files into %s" % (count, out))


if __name__ == "__main__":
    main(sys.argv[1:])
