# Emberholm -> templates learnings (received 2026-09-23 22:22 from emberholm-8d)
Key port candidates:
- CI models: routine + deep = Fable 5.1 low, fallback Opus 5.5 medium (best-of-3 A/B, 2026-09-23). Sonnet retired.
- Reviewers run with --disallowedTools Agent (subagent delegation => "success" with no verdict).
- Verdict extraction 3 fallback tiers, Blocking first, fail closed. Action pin must accept new model ids.
- Usage-limit fallback catches plan-cap reply text.
- Monitor-based PR watching (gh pr checks --json name,bucket, gh --jq, ALL SETTLED line, 1h timeout). Streaming run-watch banned.
- git.md: --body-file only; "Resolves owner/repo#N" + post-merge addCloseIssueReferences; labels trimmed; dead code does not ship.
- New rules: code-size.md (soft/hard limits + checker + allowlist), task-tracking.md, clean_room "no Gen-AI tells" voice.
- Hooks (global): no-ai-attribution, pr-body-contract, issue-body-contract, block-run-watch, block-claude-workflow-off-main, tokensave-first.
- Lessons: A/B design forks, retire dev toggles, atomic shell cmds (no &&), context file carries pending work, chat sign-off, state line, rules HOT/WARM/COLD audit, no planning vocab in code comments.
- Generalizable: project board SSOT + board_check, schedule-alarm issues, cron checks out develop.
- Cloud-session trap: no ~/.claude global hooks -> repo .claude/settings.json must turn attribution off.
