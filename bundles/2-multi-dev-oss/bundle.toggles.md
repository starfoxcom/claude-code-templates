# 2-multi-dev-oss — toggle defaults

Bundle for open-source libraries or shared personal projects with multiple human contributors. Human review gate (no auto-merge). Public-facing CONTRIBUTING + PR template.

## JSON defaults

```json
{
  "bundle": "2-multi-dev-oss",
  "toggles": {
    "github_actions_routine_review": true,
    "github_actions_deep_review": true,
    "github_actions_deep_review_auto_fire": true,
    "github_actions_paths_ignore_auto_merge": false,
    "binary_verdict_rule": true,
    "definition_of_done_verification": true,
    "context_refresh_files": true,
    "tokensave_entry_point": null,
    "lazy_rules_folder": true,
    "memory_system": true,
    "skill_session_start": true,
    "skill_session_close": true,
    "permissions_file_template": true,
    "contributing_md": true,
    "pr_template": true,
    "codeowners": null,
    "collaboration_rule": true,
    "confidentiality_rule": false,
    "audit_trail_commits": false,
    "billable_handoff_summary": false,
    "team_handoff_notes": false,
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

| Toggle | Why for multi-dev-oss |
|---|---|
| `github_actions_paths_ignore_auto_merge: false` | Multiple humans on the repo — even docs PRs warrant a quick human eye. |
| `github_actions_deep_review_auto_fire: true` | Workflow auto-applies the `needs-deep-review` label + `@claude` comment when the diff touches the trigger surface. |
| `branch_protection_strict: true` | Require routine + deep review 🟢 before merge. |
| `mandatory_deep_review_before_merge: true` | Architecturally-sensitive surface (parsers, threading, public API, auth) must clear deep review. |
| `contributing_md: true` | Public contributor guide. |
| `pr_template: true` | Standardizes what contributors include in PRs. |
| `collaboration_rule: true` | Encodes PR etiquette for multi-human collaboration. |
| `codeowners: null` | Depends on team structure — ask during setup. |
