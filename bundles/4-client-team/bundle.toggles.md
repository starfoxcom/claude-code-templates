# 4-client-team — toggle defaults

Bundle for a team working on a client codebase. All of `client-solo` + team coordination (CODEOWNERS, team handoff, mandatory deep review on architectural surface).

## JSON defaults

```json
{
  "bundle": "4-client-team",
  "toggles": {
    "github_actions_routine_review": true,
    "github_actions_deep_review": true,
    "github_actions_deep_review_auto_fire": true,
    "github_actions_paths_ignore_auto_merge": false,
    "binary_verdict_rule": true,
    "definition_of_done_verification": true,
    "context_refresh_files": true,
    "code_research_first": null,
    "lazy_rules_folder": true,
    "memory_system": true,
    "skill_session_start": true,
    "skill_session_close": true,
    "permissions_file_template": true,
    "contributing_md": true,
    "pr_template": true,
    "codeowners": true,
    "collaboration_rule": true,
    "confidentiality_rule": true,
    "audit_trail_commits": true,
    "billable_handoff_summary": false,
    "team_handoff_notes": true,
    "oncall_awareness": null,
    "branch_protection_loose": false,
    "branch_protection_strict": true,
    "mandatory_deep_review_before_merge": true,
    "dod_devlog_step": false,
    "language_specific_rules_scaffold": true,
    "architecture_rules_scaffold": null,
    "clean_room_rule": false,
    "visual_test_discipline": null
  }
}
```

## Why these defaults

| Toggle | Why for client-team |
|---|---|
| `codeowners: true` | Required for distributed review responsibility. |
| `collaboration_rule: true` | PR etiquette + team coordination encoded as a rule. |
| `confidentiality_rule: true` | Per-member NDA discipline. |
| `team_handoff_notes: true` | Session-close emits handoff notes the next team member reads at session-start. |
| `billable_handoff_summary: false` | Team work usually isn't billed per-session (consultant solo work is). Flip ON if your engagement is. |
| `mandatory_deep_review_before_merge: true` | Architectural changes touch shared surfaces — deep review required. |
| `oncall_awareness: null` | Depends on whether the team has an on-call rotation — ask during setup. |
| `contributing_md: true` | Internal team contributor guide (not public-facing, but useful for onboarding). |
