# Global template — merge into `~/.claude/`

These files live OUTSIDE your project repo, in your home Claude config. They apply to **every** Claude Code session on your machine, not just this project.

## Files in this folder

```
global-template/
├── README.md                              # (this file)
├── CLAUDE.md.additions                    # Append to ~/.claude/CLAUDE.md
├── memory-template/
│   ├── README.md                          # How the memory system works
│   └── MEMORY.md                          # Empty index — copy to the per-project memory dir
└── hooks/
    ├── code-research-first.py.template    # Generic PreToolUse hook (rendered at bind time)
    ├── code-research-profiles.json        # Per-tool profiles consumed by the renderer
    └── time-injection.snippet.md          # Optional UserPromptSubmit hook — injects [time] ... per prompt
```

---

## 1. Merge `CLAUDE.md.additions` into `~/.claude/CLAUDE.md`

`~/.claude/CLAUDE.md` is your private global instruction file. Claude Code loads it into every session as system context. If you don't have one yet, just `cp CLAUDE.md.additions ~/.claude/CLAUDE.md`.

If you DO have one, append the contents of `CLAUDE.md.additions` (or have Claude do it during SETUP — it checks for conflicts and asks before overwriting).

The additions include:

- **No-Explore-agents-for-code-research rule** — overrides any skill recommendation to use `Agent(subagent_type=Explore)` for code research when the project's chosen code-research tool (`tools.code_research` — tokensave / ast-grep / Sourcegraph / ctags / Semgrep / Other) is available. Hard rule, no exceptions; per-tool guidance lives in the relevant `:code_research:<tool>` blocks within `CLAUDE.md.additions`.
- **Memory system instructions** — the four memory types, when to save each, when to access, how MEMORY.md works as an index.

These are project-agnostic — they're useful for any project, which is why they live in the global config.

---

## 2. Set up the memory system

The per-project memory home is:

```
~/.claude/projects/<project-slug>/memory/
```

where `<project-slug>` is what Claude Code auto-derives from your project's working-directory path (you can find it via `~/.claude/projects/`).

After SETUP determines the slug:

1. Copy `memory-template/MEMORY.md` to `~/.claude/projects/<project-slug>/memory/MEMORY.md` (if it doesn't already exist).
2. Read `memory-template/README.md` for the four memory types + when to save each + the body structure for feedback / project memories (the `**Why:**` + `**How to apply:**` lines).

Claude will start populating memory entries during your normal sessions — you don't need to pre-fill anything beyond the empty MEMORY.md index.

---

## 3. Install the code-research-first hook (optional, recommended)

When the `code_research_first` toggle is ON and `tools.code_research` is not `none`, SETUP.md § Phase 7a renders `hooks/code-research-first.py.template` against the profile in `hooks/code-research-profiles.json` matching your chosen tool and writes the result to `~/.claude/hooks/<tool>-first.py`. The hook is then registered in `~/.claude/settings.json` under `hooks.PreToolUse` so it intercepts `Grep`/`Glob`/`Bash` calls and routes Claude through your chosen tool first.

**Supported `tools.code_research` keys** (must match a key in `code-research-profiles.json`):

| Key | Display name | Detection | Hook file written to |
|---|---|---|---|
| `tokensave` | tokensave | walks-up `.tokensave/tokensave.db` | `~/.claude/hooks/tokensave-first.py` |
| `ast-grep` | ast-grep | `ast-grep` CLI on PATH | `~/.claude/hooks/ast-grep-first.py` |
| `sourcegraph` | Sourcegraph | `src` CLI on PATH | `~/.claude/hooks/sourcegraph-first.py` |
| `ctags` | ctags | walks-up `tags` file | `~/.claude/hooks/ctags-first.py` |
| `semgrep` | Semgrep | `semgrep` CLI on PATH | `~/.claude/hooks/semgrep-first.py` |
| `none` | (no hook) | — | not installed |
| `custom` | (user-supplied) | user-specified CLI on PATH | `~/.claude/hooks/<name-kebab>-first.py` |

**Manual install** (if you're not running SETUP.md): substitute the six placeholders in `hooks/code-research-first.py.template` against your tool's profile, save to the destination path above, register in `~/.claude/settings.json`. **Worked example for tokensave:**

1. Read `hooks/code-research-profiles.json` and copy the FULL `tokensave` entry verbatim — you'll need its `sequence_bullets` (a long multi-line string with embedded `\n`s) for step 3. Do not hand-shorten the bullets; the rendered hook prints them to stderr on every block.

2. Copy `hooks/code-research-first.py.template` to `~/.claude/hooks/tokensave-first.py` (expand `~` to your real home path — Windows: `C:/Users/<name>/.claude/hooks/...`, POSIX: `/home/<name>/.claude/hooks/...`).

3. Substitute these SIX placeholders (every occurrence; case-sensitive):
   - `{{TOOLS_CODE_RESEARCH_NAME}}` → `tokensave` (the DISPLAY_NAME line wraps it as `"tokensave"` — Python string literal)
   - `{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}` → `tokensave`
   - `{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}` → `TOKENSAVE_BYPASS:`
   - `{{TOOLS_CODE_RESEARCH_DETECTION_MODE}}` → `walk_up`
   - `{{TOOLS_CODE_RESEARCH_DETECTION_TARGET}}` → `.tokensave/tokensave.db`
   - `{{TOOLS_CODE_RESEARCH_SEQUENCE_BULLETS}}` → the multi-line bullets from the profile JSON's `sequence_bullets` field (the JSON-decoded form — `\n` characters become actual newlines inside the rendered `SEQUENCE_BULLETS = """..."""` triple-quoted block)

4. Verify the substituted file is valid Python. Use the rendered absolute path (not `~`, which `open()` does not expand):
   - macOS/Linux: `python3 -c "import ast, os; ast.parse(open(os.path.expanduser('~/.claude/hooks/tokensave-first.py')).read())"`
   - Windows: `py -c "import ast, os; ast.parse(open(os.path.expanduser('~/.claude/hooks/tokensave-first.py')).read())"`
   - If the file parses successfully, the command exits silently. A `SyntaxError` means a placeholder substitution failed; re-check step 3.

5. Add this entry to `~/.claude/settings.json` under `hooks.PreToolUse[]`. **If the array already has entries, APPEND yours; do NOT replace the array** (you'll wipe out memory + other hooks).

   The new entry you're appending is just the inner object:

   ```json
   {
     "matcher": "Grep|Glob|Bash",
     "hooks": [
       { "type": "command", "command": "py \"C:/Users/<name>/.claude/hooks/tokensave-first.py\"" }
     ]
   }
   ```

   The full file should look like this AFTER your edit (illustrative — your file probably has more entries):

   ```json
   {
     "hooks": {
       "PreToolUse": [
         { "matcher": "...", "hooks": [{ "type": "command", "command": "your existing entries stay here, unchanged" }] },
         {
           "matcher": "Grep|Glob|Bash",
           "hooks": [
             { "type": "command", "command": "py \"C:/Users/<name>/.claude/hooks/tokensave-first.py\"" }
           ]
         }
       ]
     }
   }
   ```

   (No JSON comments — JSON doesn't support them. If you need a marker in your file, use a dummy key like `"_note": "..."`.)

   - Replace `py` with `python3` on macOS/Linux.
   - Replace `<name>` with your username (Windows) or expand to your full home path (POSIX) — Claude Code does NOT auto-expand `~` in hook command strings.
   - Trailing commas in JSON are invalid — re-check after editing.

6. Reload Claude Code (`/exit` + reopen). Test by running a `Grep` in a directory with `.tokensave/` — hook should block.

**For other tools**, swap the profile values from `hooks/code-research-profiles.json` keyed on `ast-grep` / `sourcegraph` / `ctags` / `semgrep` / `custom`. The substitution list is identical.

**⚠️ Advisory enforcement, not a security boundary** — the hook fails open on malformed input and unknown profile fields. Treat it as a Claude-discipline nudge, not as a sandbox.

**Why globally not project-local:** project-local hooks can trigger tool-specific template-inheritance bugs that corrupt `settings.local.json` on every Stop event. The global install sidesteps that. Re-binding a project with a different `tools.code_research` value replaces the registered hook + deletes the orphan file after confirmation.

---

## 4. Install the time-injection hook (optional, recommended)

Claude Code has no built-in time-of-day awareness across turns — every prompt looks the same to the model regardless of whether ten minutes or ten hours passed since the last one. The `UserPromptSubmit` hook documented in `hooks/time-injection.snippet.md` fixes this by prepending a `[time] YYYY-MM-DD HH:MM:SS <zone>` line to every prompt (zone resolved from the OS at call time — IANA via the Node command, OS-localized abbreviation via the Python fallback; see the snippet file for the trade-off).

It's project-agnostic, parameter-free (the zone comes from the OS at call time — no per-project bind substitution), costs ~50 ms per prompt, and has no side effects. Recommended for any non-trivial project; load-bearing for multi-day sessions, polling loops, and any reasoning that depends on wall-clock truth.

To install, follow the worked example in `hooks/time-injection.snippet.md` — it documents the Node command (with a Python fallback), the JSON entry to append to `~/.claude/settings.json` under `hooks.UserPromptSubmit`, and the verification step. The hook composes cleanly with the code-research-first hook from § 3; they register under different slots and never conflict.

The AI-side counterpart — instructions that tell the model to attend to the `[time]` lines rather than ignore them — lives in `CLAUDE.md.additions` under the "Time-of-day awareness" section, so step 1 above already covered it.

---

## 5. Verify

After merging, start a fresh Claude Code session in any project and ask:

> "What's the no-Explore-agents-for-code-research rule, and where is per-project memory stored?"

Claude should answer from the global `~/.claude/CLAUDE.md`, not by reading files. If it answers correctly, the global setup is good.
