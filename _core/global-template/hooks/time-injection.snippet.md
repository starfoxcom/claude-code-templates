# Time-injection hook — inject `[time] ...` on every `UserPromptSubmit`

A one-line `UserPromptSubmit` hook that prepends a wall-clock timestamp to every prompt the model sees:

```
[time] 2026-05-27 13:25:43 America/Mazatlan
```

The format is `[time] YYYY-MM-DD HH:MM:SS <zone>`. The zone comes from the OS at call time — no hardcoded value, no per-project bind substitution. **Format fidelity depends on which command you register:** the Node command produces an IANA identifier (`America/Mazatlan`, `Europe/Madrid`); the Python fallback produces whatever the OS exposes via `datetime.tzinfo` — typically an abbreviation on POSIX (`MST`, `PDT`), a localized full name on Windows (`Mountain Standard Time` — note the embedded spaces), or a numeric offset (`UTC-07:00`) when no name is available. Prefer Node where it's on PATH; IANA is unambiguous and free of whitespace.

## Why install it

Claude Code has no built-in time-of-day awareness across turns. Without this hook, a model can't tell whether ten minutes or ten hours passed between two prompts — every prompt looks the same. That matters for:

- **Multi-day sessions** — noticing "the user slept" vs "the user is mid-thought" changes how you respond.
- **Polling loops** — knowing how long a `gh run list` background loop has actually been running.
- **Timing reasoning** — "did the deploy finish?", "has the cache expired?", "is this conversation stale?" — all need wall-clock truth.
- **Telemetry accuracy** — session-close summaries that report elapsed time, not just a guess.

Cost: ~50 ms per prompt on a warm Node runtime. No side effects.

## The hook command

Node (recommended — ships with most dev environments):

```
node -e "var d=new Date();console.log('[time] '+d.toLocaleString('sv-SE').replace(',',' ')+' '+Intl.DateTimeFormat().resolvedOptions().timeZone)"
```

Python fallback (use if Node isn't on PATH — emits an OS-localized name, not IANA; see the format-fidelity note above):

```
python -c "import datetime; n=datetime.datetime.now().astimezone(); print('[time] '+n.strftime('%Y-%m-%d %H:%M:%S')+' '+str(n.tzinfo))"
```

Both produce a `[time] YYYY-MM-DD HH:MM:SS <zone>` line with the zone resolved from the OS at call time. The two differ in **what string the zone resolves to** (Node: IANA; Python: OS-localized abbreviation or full name). Pick one — don't register both.

## Register in `~/.claude/settings.json`

The hook goes under `hooks.UserPromptSubmit` (note: **not** `PreToolUse` — that's the code-research-first hook's slot, see README § 3). The two hook slots compose cleanly; the `UserPromptSubmit` array is independent.

**If `hooks.UserPromptSubmit` already has entries, APPEND yours; do NOT replace the array** (you'll wipe out memory-related hooks, anti-prompt-injection hooks, or any other UserPromptSubmit work already registered).

The new entry you're appending is just the inner object:

```json
{
  "hooks": [
    { "type": "command", "command": "node -e \"var d=new Date();console.log('[time] '+d.toLocaleString('sv-SE').replace(',',' ')+' '+Intl.DateTimeFormat().resolvedOptions().timeZone)\"" }
  ]
}
```

The full file should look like this AFTER your edit (illustrative — your file likely has a `PreToolUse` array already, plus possibly other slots):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "...", "hooks": [{ "type": "command", "command": "your existing entries stay here, unchanged" }] }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node -e \"var d=new Date();console.log('[time] '+d.toLocaleString('sv-SE').replace(',',' ')+' '+Intl.DateTimeFormat().resolvedOptions().timeZone)\"" }
        ]
      }
    ]
  }
}
```

Notes:

- JSON doesn't support comments. Use a dummy key like `"_note": "..."` if you need a marker.
- Trailing commas in JSON are invalid — re-check after editing.
- No path resolution gotcha here — the command is inline `node -e` / `python -c`, not a file path. Skip the Windows `<name>` substitution that the code-research-first hook needs.
- Replace `node` with `python` if you're using the Python fallback. Use `python3` on POSIX systems where `python` resolves to Python 2.

## Verify

After saving, reload Claude Code (`/exit` + reopen). The first prompt of the next session should produce a system-reminder-block in the conversation containing the `[time] ...` line. If it doesn't appear, check:

1. **JSON validity** — `python -c "import json; json.load(open('<path-to-settings.json>'))"` should exit 0.
2. **Command runs standalone** — paste the `node -e ...` (or `python -c ...`) command into a terminal directly; it should print one line in the expected format.
3. **Slot name** — `UserPromptSubmit`, not `userPromptSubmit` / `user-prompt-submit` / `OnPromptSubmit`. Case matters.

## Compose with other hooks

This hook is independent of the code-research-first hook documented in README § 3. They register under different slots (`UserPromptSubmit` vs `PreToolUse`) and never conflict. If you've already installed the code-research-first hook, just add this one alongside; no migration needed.

For the AI side of this — making sure the model attends to the `[time]` lines rather than ignoring them — see the "Time-of-day awareness" section that `CLAUDE.md.additions` appends to your global `~/.claude/CLAUDE.md`.

## Advisory enforcement, not a security boundary

The hook fails open: if Node and Python are both missing, the prompt still reaches the model — just without the timestamp prefix. Treat it as a Claude-discipline nudge, not as a sandbox.
