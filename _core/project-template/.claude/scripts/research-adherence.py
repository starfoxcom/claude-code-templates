"""Count this session's code-research calls: {{TOOLS_CODE_RESEARCH_NAME}} versus plain text search.

Reads the newest transcript for the current directory under
~/.claude/projects/, or the transcript given as the first argument.
Run from the repo root at session close.

A plain search counts only when it looks for code: a Grep or Glob call,
or a shell command that starts with a recursive search (grep -r, rg,
git grep, or a recursive listing piped into Select-String). Searches of
docs, logs or data files, and filters on another command's output
(`... | grep x`), are not code research and are not counted.
"""
import glob
import json
import os
import re
import sys

TOOL = re.compile(r"{{TOOLS_CODE_RESEARCH_MATCH}}")
BYPASS = "{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}"
NON_CODE = re.compile(r"\.(md|mdx|txt|log|json|jsonl|ya?ml|csv)\b|\b(md|json|yaml|txt)$", re.I)
SHELL_SEARCH = re.compile(r"^\s*(rg|ag|ack|git\s+grep)\s|^\s*grep\s(.*\s)?(-[a-zA-Z]*[rR]|--recursive)")
PS_LISTING = re.compile(r"^\s*(Get-ChildItem|gci|dir|ls)\s.*-Recurse", re.I)
PS_SEARCH = re.compile(r"^\s*(sls|Select-String)\s", re.I)


def unquote_separators(command):
    """Blank out | ; & and newlines inside quotes, so a search pattern like "a|b" does not split the command."""
    out, quote = [], None
    for ch in command:
        if quote:
            quote = None if ch == quote else quote
            ch = " " if ch in "|;&\n" else ch
        elif ch in "'\"":
            quote = ch
        out.append(ch)
    return "".join(out)


def shell_search(command):
    """True when a command line runs a code search of its own."""
    for part in re.split(r"&&|\|\||;|\n", unquote_separators(command)):
        stages = part.split("|")
        head = stages[0]
        if NON_CODE.search(head):
            continue
        if SHELL_SEARCH.search(head):
            return True
        if PS_LISTING.search(head) and any(PS_SEARCH.search(s) for s in stages[1:]):
            return True
    return False


def classify(name, args):
    """'research', 'fallback', 'bypass', or None for a call that is not a search."""
    if TOOL.search(name):
        return "research"
    if name in ("Grep", "Glob"):
        # Grep's pattern is the search text, Glob's is the file pattern.
        keys = ("pattern", "path") if name == "Glob" else ("path", "glob", "type")
        target = " ".join(str(args.get(k, "")) for k in keys)
        return None if NON_CODE.search(target) else "fallback"
    if name in ("Bash", "PowerShell"):
        command = args.get("command", "")
        if shell_search(command):
            return "bypass" if BYPASS in command else "fallback"
    return None


def transcript():
    if len(sys.argv) > 1:
        return sys.argv[1]
    slug = re.sub(r"[^A-Za-z0-9]", "-", os.getcwd())
    files = glob.glob(os.path.join(os.path.expanduser("~"), ".claude", "projects", slug, "*.jsonl"))
    if not files:
        sys.exit(f"No transcript found for {os.getcwd()}; run this from the repo root.")
    return max(files, key=os.path.getmtime)


def tool_calls(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            content = (entry.get("message") or {}).get("content")
            if entry.get("type") != "assistant" or not isinstance(content, list):
                continue
            for part in content:
                if isinstance(part, dict) and part.get("type") == "tool_use":
                    yield part.get("name", ""), part.get("input") or {}


def main():
    counts = {"research": 0, "fallback": 0, "bypass": 0}
    for name, args in tool_calls(transcript()):
        kind = classify(name, args)
        if kind:
            counts[kind] += 1
    total = counts["research"] + counts["fallback"]
    ratio = f"{100 * counts['research'] // total}%" if total else "n/a"
    print(f"{{TOOLS_CODE_RESEARCH_NAME}}: {counts['research']} calls, plain code searches: {counts['fallback']} "
          f"(plus {counts['bypass']} marked bypasses) -> {ratio}")


if __name__ == "__main__":
    main()
