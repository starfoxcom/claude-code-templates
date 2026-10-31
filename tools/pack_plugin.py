"""Assembles the installable Bindwright plugin.

The repo keeps one copy of everything: `plugin/` holds only the plugin's own
files (manifest and skills), and this script adds the engine's runtime files
and the templates the engine reads, so a user downloads only what setup needs.

    python tools/pack_plugin.py                 -> dist/bindwright/
    python tools/pack_plugin.py --out DIR       -> DIR (replaced if it holds an earlier pack)
    python tools/pack_plugin.py --zip FILE      -> the release zip, built from git at HEAD
    ... --zip FILE --ref REF                    -> the same, from REF
    python tools/pack_plugin.py --marketplace   -> .claude-plugin/marketplace.json for HEAD's zip

The zip is read from git, not from the working tree, so every machine builds
the same bytes whatever its line endings; the release workflow rebuilds it
and refuses to publish one whose SHA-256 differs from the marketplace file.
Try a pack with `claude --plugin-dir dist/bindwright`. Standard library only.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# What setup runs: both engine twins, their command entry points, and
# package.json, which tells Node the .js files are ES modules.
ENGINE_FILES = [
    "package.json", "core-files.json", "cli.js",
    "bind.js", "model.js", "render.js", "setupcode.js", "apply.js", "keep.js", "update.js", "layers.js", "share.js",
    "bind.py", "model.py", "render.py", "setupcode.py", "apply.py", "keep.py", "update.py", "layers.py", "share.py",
    "home.py",
]
# The ~/.claude templates bind.js and bind.py read (globalFiles).
GLOBAL_FILES = [
    "CLAUDE.md.additions", "memory-template/MEMORY.md",
    "hooks/push-guard.py", "hooks/no-ai-attribution.py",
    "hooks/code-research-profiles.json", "hooks/code-research-first.py.template",
]
# Marks a folder as a pack, so --out never replaces anything else.
MARKER = ".bindwright-pack"

# Where releases are published, and the marketplace file that lists them.
REPO = "starfoxcom/claude-code-templates"
MARKETPLACE = ".claude-plugin/marketplace.json"
DESCRIPTION = "The Bindwright plugin, from its GitHub releases."
# A fixed date for every zip entry, the earliest a zip can hold.
ZIP_DATE = (1980, 1, 1, 0, 0, 0)


def _skipped(parent, name):
    # Caches, tests, and the editor typings the CLI writes beside a loaded mod.
    if name in ("__pycache__", "node_modules", "tests", "test-helper"):
        return True
    return name == "types" and parent == ".claude-plugin"


class WorkTree:
    """The files as they are in the repo folder."""

    def files_under(self, rel):
        base = os.path.join(ROOT, *rel.split("/"))
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if not _skipped(os.path.basename(dirpath), d))
            for name in sorted(filenames):
                yield os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, "/")

    def read(self, rel):
        with open(os.path.join(ROOT, *rel.split("/")), "rb") as fh:
            return fh.read()


class GitTree:
    """The files as git stores them at `ref`: the bytes are the same on every machine."""

    def __init__(self, ref):
        out = _git("ls-tree", "-r", "-z", "--full-tree", ref)
        self.blobs = {}
        for line in out.split(b"\0"):
            if not line:
                continue
            meta, path = line.split(b"\t", 1)
            mode, kind, sha = meta.decode("ascii").split(" ")
            # A link or a submodule has no file to pack; neither may reach the plugin.
            self.blobs[path.decode("utf-8")] = sha if kind == "blob" and mode in ("100644", "100755") else None

    def files_under(self, rel):
        for path in sorted(p for p in self.blobs if p.startswith(rel + "/")):
            parts = path.split("/")
            if not any(_skipped(parts[i - 1] if i else "", parts[i]) for i in range(len(parts) - 1)):
                yield path

    def read(self, rel):
        sha = self.blobs.get(rel)
        if sha is None:
            raise SystemExit("%s is not a plain file in git" % rel)
        return _git("cat-file", "blob", sha)


def _git(*args):
    result = subprocess.run(["git", "-C", ROOT] + list(args), capture_output=True)
    if result.returncode != 0:
        raise SystemExit("git %s failed: %s" % (" ".join(args), result.stderr.decode("utf-8", "replace").strip()))
    return result.stdout


def version_of(source):
    return source.read("VERSION").decode("utf-8").strip().lstrip("v")


def contents(source):
    """Every file of the plugin as {path in the plugin: bytes}."""
    out = {}
    for rel in source.files_under("plugin"):
        out[rel[len("plugin/"):]] = source.read(rel)
    for name in ENGINE_FILES:
        out["engine/" + name] = source.read("engine/" + name)
    core = ["_core/project-template/" + p for p in json.loads(source.read("engine/core-files.json"))]
    licenses = list(source.files_under("_core/licenses"))
    global_files = ["_core/global-template/" + p for p in GLOBAL_FILES]
    # Mods are copied whole into ~/.claude/mods/, so the pack carries them as they ship.
    global_files += list(source.files_under("_core/global-template/mods"))
    # VERSION too: the engine records it in the pristine render it writes.
    for rel in core + licenses + global_files + ["VERSION"]:
        out[rel] = source.read(rel)
    manifest = json.loads(out[".claude-plugin/plugin.json"])
    manifest["version"] = version_of(source)
    out[".claude-plugin/plugin.json"] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    return out


def _clear(out):
    if not os.path.exists(out):
        return
    if not os.path.isfile(os.path.join(out, MARKER)):
        raise SystemExit("Refusing to replace %s: it is not an earlier pack" % out)
    shutil.rmtree(out)


def pack(out, source=None):
    """Writes the plugin to the folder `out` and returns the number of files."""
    _clear(out)
    files = contents(source or WorkTree())
    for rel, data in files.items():
        dest = os.path.join(out, *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(data)
    with open(os.path.join(out, MARKER), "w", encoding="utf-8") as fh:
        fh.write("Built by tools/pack_plugin.py; safe to delete.\n")
    return len(files) + 1


def pack_zip(path, ref="HEAD"):
    """Writes the release zip for `ref` to `path` and returns (its manifest, SHA-256)."""
    source = GitTree(ref)
    files = contents(source)
    # Stored, not deflated: zlib builds differ between machines, and the bytes must not.
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as zf:
        for rel in sorted(files):
            info = zipfile.ZipInfo(rel, ZIP_DATE)
            info.create_system = 3
            info.external_attr = 0o644 << 16
            zf.writestr(info, files[rel])
    with open(path, "rb") as fh:
        return json.loads(files[".claude-plugin/plugin.json"]), hashlib.sha256(fh.read()).hexdigest()


def marketplace(manifest, sha256):
    """The marketplace file that lists the release zip of the plugin `manifest` describes."""
    version = manifest["version"]
    url = "https://github.com/%s/releases/download/v%s/bindwright-%s.zip" % (REPO, version, version)
    entry = {
        "name": "bindwright",
        "description": manifest["description"],
        "version": version,
        "source": {"source": "archive", "url": url, "sha256": sha256},
    }
    owner = {"name": REPO.split("/")[0], "url": "https://github.com/" + REPO.split("/")[0]}
    data = {"name": "bindwright", "description": DESCRIPTION, "owner": owner, "plugins": [entry]}
    return json.dumps(data, indent=2) + "\n"


def _value(argv, flag):
    if flag not in argv:
        return None
    i = argv.index(flag) + 1
    if i == len(argv) or argv[i].startswith("--"):
        raise SystemExit("%s needs a value" % flag)
    return argv[i]


def main(argv):
    ref = _value(argv, "--ref") or "HEAD"
    if "--marketplace" in argv:
        tmp = os.path.join(ROOT, "dist", "marketplace-check.zip")
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        manifest, sha = pack_zip(tmp, ref)
        os.remove(tmp)
        # An optional path after the flag, for tests; the repo's own file otherwise.
        i = argv.index("--marketplace") + 1
        target = os.path.join(ROOT, *MARKETPLACE.split("/"))
        if i < len(argv) and not argv[i].startswith("--"):
            target = argv[i]
        os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
        with open(target, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(marketplace(manifest, sha))
        print("Wrote %s for %s (sha256 %s)" % (MARKETPLACE, manifest["version"], sha))
        return
    zip_path = _value(argv, "--zip")
    if zip_path is not None:
        manifest, sha = pack_zip(os.path.abspath(zip_path), ref)
        print("Zipped %s %s (sha256 %s)" % (zip_path, manifest["version"], sha))
        return
    out = os.path.abspath(_value(argv, "--out") or os.path.join(ROOT, "dist", "bindwright"))
    count = pack(out)
    print("Packed %d files into %s" % (count, out))


if __name__ == "__main__":
    main(sys.argv[1:])
