# Delegation ladder (all projects)

Founder direction 2026-09-09. The main session model (Fable 5.1 @ low) is the
orchestrator, planner and reviewer. Work that a cheaper model does as well goes to a
pinned subagent. No Haiku. Measured rungs live in `~/.claude/agents/`:

| rung | agent | model @ effort | for |
|---|---|---|---|
| builder | `builder` | `claude-sonnet-5` @ `medium` | a code change that has a written spec |
| scribe | `scribe` | `claude-sonnet-5` @ `medium` | context files, issue bodies, status updates, memory, doc refreshes from supplied facts |
| runner | `runner` | `claude-sonnet-5` @ `low` | commands, builds, probes, measurements - numbers only |

Evidence: `docs/research/effort-model-ab-sonnet-2026-09-09.md` (Emberholm). Sonnet 5
low is never a build tier; Sonnet 4.6 is 200k-only on the subscription and is not used.
`CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5` in global settings covers unpinned
subagents and workflow agents; hard-reasoning workflow stages still pin the session
model or `claude-opus-4-6` @ `high` explicitly.

## The loop

1. **Spec (main session).** Goal, files in scope, done-when, tests that must pass,
   applicable rules, report format. One paragraph to one screen; a spec that needs more
   is two tasks.
2. **Build (builder, own context).** Never reads other branches. Reports diff summary,
   test results, gaps.
3. **Review (main session).** Reads the DIFF only, binary verdict like CI: clean or a
   named list of findings.
4. **Fix rounds** go back to the SAME builder by `SendMessage` (keeps its context).
   Maximum two. After the second, the main session finishes the last mile itself.
5. Tests and CI are the truth; a builder claim without a test run is a finding.

## What stays with the main session

- Visual slices iterated live with the founder.
- Founder-decision moments, design verdicts, judge panels, adversarial verification.
- Anything where the spec would be longer than the change.

## Session close

Report the delegation ratio: main-model output tokens vs subagent output tokens this
session (sum `usage.output_tokens` from the session transcript vs the
`subagents/**/agent-*.jsonl` files under the session directory). A session with zero
delegated tokens and any chore-shaped work is a miss to name, not a failure to hide.
