# 1-solo-personal — toggle defaults

Bundle for solo devs on personal / portfolio projects. The default toggle set targets **Platinum** solidity (universal core + GitHub workflows + DoD verification + auto-merge fast path).

## JSON defaults (read by START-HERE.html and Claude during SETUP)

```json
{
  "bundle": "1-solo-personal",
  "toggles": {
    "github_actions_routine_review": true,
    "github_actions_deep_review": true,
    "github_actions_deep_review_auto_fire": false,
    "github_actions_paths_ignore_auto_merge": true,
    "binary_verdict_rule": true,
    "definition_of_done_verification": true,
    "context_refresh_files": true,
    "code_research_first": null,
    "lazy_rules_folder": true,
    "memory_system": true,
    "skill_session_start": true,
    "skill_session_close": true,
    "permissions_file_template": true,
    "contributing_md": false,
    "pr_template": false,
    "codeowners": false,
    "collaboration_rule": false,
    "confidentiality_rule": false,
    "audit_trail_commits": false,
    "billable_handoff_summary": false,
    "team_handoff_notes": false,
    "oncall_awareness": false,
    "branch_protection_loose": true,
    "branch_protection_strict": false,
    "mandatory_deep_review_before_merge": false,
    "dod_devlog_step": false,
    "language_specific_rules_scaffold": true,
    "architecture_rules_scaffold": null,
    "clean_room_rule": false,
    "visual_test_discipline": null
  }
}
```

`null` = "ask the user during setup" (depends on context Claude can't know in advance).

## Why these defaults

| Toggle | Why for solo-personal |
|---|---|
| `github_actions_paths_ignore_auto_merge: true` | Solo speed advantage — docs/rules PRs merge without a 7-min poll. |
| `github_actions_deep_review_auto_fire: false` | You're the only one merging — fire deep review manually when you suspect uncertainty. |
| `branch_protection_loose: true` | Self-approval allowed. Discipline lives in the binary verdict, not human gates. |
| `contributing_md: false` | You're the only contributor. |
| `confidentiality_rule: false` | Your project, your data. |
| `memory_system: true` | Highest-leverage feature for a solo workflow. |
| `dod_devlog_step: false` | Flip ON only if you publish a dev log. |
