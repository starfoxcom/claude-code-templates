#!/bin/sh
# Starts one of this repo's guard hooks: sh run-hook.sh <name>
# Claude Code pipes the tool call to stdin as JSON; the hook reads it there.
#
# The hook is skipped, and the tool call goes ahead, when:
# - ~/.claude/settings.json already registers hooks/<name>.py, so the user's
#   own copy runs and the check never runs twice;
# - no Python 3.8+ outside a virtual environment is on PATH.
#
# A committed file cannot name the interpreter by absolute path, so this
# looks for one. A virtual environment's interpreter is refused because it
# can belong to the project. Python runs with -I, so the project's own
# modules cannot replace the ones the hook imports, and through runpy, so a
# missing hook file is an ordinary error (the call goes ahead) instead of
# Python's exit 2, which would block every call.

name=$1
hook="${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/$name.py"

settings="$HOME/.claude/settings.json"
if [ -f "$settings" ] && grep -Eq "hooks[/\\\\]+$name\.py" "$settings"; then
  exit 0
fi

for py in python3 python py; do
  if "$py" -I -c 'import sys; sys.exit(sys.version_info < (3, 8) or sys.prefix != sys.base_prefix)' >/dev/null 2>&1; then
    exec "$py" -I -c 'import runpy, sys; runpy.run_path(sys.argv[1], run_name="__main__")' "$hook"
  fi
done

echo "Guard hook $name did not run: no Python 3.8+ found outside a virtual environment." >&2
exit 0
