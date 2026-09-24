// Shared mock data: real bundles and real output files from _core/project-template.
window.BW = {
  bundles: [
    { id: "solo", name: "Solo", who: "One person, one machine", note: "Auto-merge on green, light PR ritual, full personal memory.", files: 16, hue: 150 },
    { id: "oss", name: "Open source", who: "Public repo, outside contributors", note: "Strict review on every PR, CODEOWNERS, contributor docs.", files: 24, hue: 200 },
    { id: "client", name: "Client, solo", who: "One contractor, one client", note: "NDA-aware memory, audit-trail commits, billable handoff notes.", files: 19, hue: 70 },
    { id: "team", name: "Client team", who: "Several devs on a client project", note: "Mandatory deep review, team handoff, role-scoped access.", files: 27, hue: 340 },
  ],
  tree: [
    { d: ".claude/rules", f: ["git.md", "review-tiers.md", "token-efficiency.md", "collaboration.md", "clean-room.md", "visual.md"] },
    { d: ".claude/skills", f: ["session-start/SKILL.md", "session-close/SKILL.md", "find/SKILL.md", "architecture-graph/SKILL.md"] },
    { d: ".github/workflows", f: ["claude-code-review.yml", "claude.yml"] },
    { d: ".github", f: ["CODEOWNERS", "PULL_REQUEST_TEMPLATE.md", "ISSUE_TEMPLATE/bug_report.yml"] },
    { d: "", f: ["CLAUDE.md", "CONTRIBUTING.md", "CHANGELOG.md", "LICENSE", "README.md"] },
  ],
  claudeMd: [
    ["h", "# CLAUDE.md"],
    ["", ""],
    ["c", "Guidance for Claude Code in cubit, a public repo with outside contributors."],
    ["", ""],
    ["h", "## Git workflow"],
    ["", "- Atomic commits: <type>(<scope>): <description>, 72 chars max."],
    ["+", "- Gitflow: feature/* from develop, release/* to main."],
    ["", "- Always a merge commit. Never squash or rebase."],
    ["", ""],
    ["h", "## Review"],
    ["+", "- Every PR gets a routine review with a pass or block verdict."],
    ["+", "- Parsers, auth and save formats also get a deep review."],
    ["-", "- Auto-merge when checks pass."],
  ],
};
