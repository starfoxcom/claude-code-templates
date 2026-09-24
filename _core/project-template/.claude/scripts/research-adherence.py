"""Count this session's code-research calls: {{TOOLS_CODE_RESEARCH_NAME}} versus Grep/Glob.

Reads the newest transcript for the current directory under
~/.claude/projects/. Run from the repo root at session close.
"""
import glob
import json
import os
import re
import sys

TOOL = re.compile(r"{{TOOLS_CODE_RESEARCH_MATCH}}")
BYPASS = "{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}"
RAW_SEARCH = re.compile(r"(^|[\s|;&(])(grep|rg|ag|ack)\s")


def transcript():
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
    research = fallback = bypassed = 0
    for name, args in tool_calls(transcript()):
        if TOOL.search(name):
            research += 1
        elif name in ("Grep", "Glob"):
            fallback += 1
        elif name in ("Bash", "PowerShell") and RAW_SEARCH.search(args.get("command", "")):
            if BYPASS in args.get("command", ""):
                bypassed += 1
            else:
                fallback += 1
    total = research + fallback
    ratio = f"{100 * research // total}%" if total else "n/a"
    print(f"{{TOOLS_CODE_RESEARCH_NAME}}: {research} calls, Grep/Glob: {fallback} (plus {bypassed} marked bypasses) -> {ratio}")


if __name__ == "__main__":
    main()
