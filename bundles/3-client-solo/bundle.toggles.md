# 3-client-solo — toggle defaults

Bundle for a solo consultant working on a client codebase under NDA. Confidentiality discipline, audit-trail commits, billable session-close handoff.

## JSON defaults

```json
{
  "bundle": "3-client-solo",
  "toggles": {
    "github_actions_routine_review": null,
    "github_actions_deep_review": null,
    "github_actions_deep_review_auto_fire": false,
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
    "contributing_md": false,
    "pr_template": true,
    "codeowners": false,
    "collaboration_rule": false,
    "confidentiality_rule": true,
    "audit_trail_commits": true,
    "billable_handoff_summary": true,
    "team_handoff_notes": false,
    "oncall_awareness": false,
    "branch_protection_loose": null,
    "branch_protection_strict": null,
    "mandatory_deep_review_before_merge": false,
    "dod_devlog_step": false,
    "language_specific_rules_scaffold": true,
    "architecture_rules_scaffold": null,
    "precommit_hooks_scaffold": false,
    "clean_room_rule": false,
    "visual_test_discipline": null
  }
}
```

`null` toggles in this bundle: GitHub workflows + branch protection ask the user, because consultant projects often run on the **client's** CI/CD posture (they may have their own review setup, or none at all). Don't override the client's process.

## Why these defaults

| Toggle | Why for client-solo |
|---|---|
| `github_actions_*: null` | Client's CI policy decides. Some clients have their own review; some forbid Claude on their CI; some don't have CI at all. Ask first. |
| `confidentiality_rule: true` | NDA-aware memory — what stays out, what gets logged. |
| `audit_trail_commits: true` | Per-PR audit trail section in the PR template. |
| `billable_handoff_summary: true` | Session-close emits a handoff summary (time spent, scope, deliverables) you can paste into your invoice / status email. |
| `pr_template: true` | Includes the audit-trail fields (toggle-gated within the template). |
| `branch_protection_*: null` | Client decides. |
| `team_handoff_notes: false` | Solo on the engagement — flip ON via bundle 4 if a colleague joins. |
| `precommit_hooks_scaffold: false` | Don't impose a hook manager on the client's toolchain — enable per their preference. |
