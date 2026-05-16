# Bundle comparison matrix

Use this when you can't decide between two bundles. Everything in **bold** is a bundle-specific add or strictness delta on top of the universal core.

---

## Feature matrix

| Feature | 1. solo-personal | 2. multi-dev-oss | 3. client-solo | 4. client-team |
|---|---|---|---|---|
| **Project CLAUDE.md** | Standard | + Contributor section | **+ Confidentiality section** | **+ Confidentiality + Team handoff** |
| **`.claude/rules/git.md`** | Gitflow + atomic + **auto-merge on paths-ignore** | Gitflow + atomic + **NO auto-merge** | Gitflow + **audit-trail commits** | + **CODEOWNERS guide** |
| **`.claude/rules/token-efficiency.md`** | Aggressive (auto-merge fast path) | Conservative (always wait for human) | Aggressive on consultant's own work | Conservative |
| **`.claude/rules/review-tiers.md`** | Binary verdict, opt-in deep review | Binary verdict + **mandatory deep on architectural surface** | Binary verdict, **deep review recommended** | **Mandatory deep review** |
| **`.claude/rules/confidentiality.md`** | — | — | ✅ **NDA-aware** | ✅ **NDA-aware + role-aware** |
| **`.claude/rules/collaboration.md`** | — | ✅ **PR etiquette + CONTRIBUTING reference** | — | ✅ **Team handoff + on-call** |
| **Session-start ritual** | Standard | + Pull collaborator activity (last 24h) | + Reload client context isolation | + Pull team handoff notes |
| **Session-close ritual** | Standard + DoD | + Push branch, no auto-merge | + **Billable handoff summary** | + **Team handoff notes** |
| **Memory system** | Rich, personal | Personal per dev (not in repo) | **NDA-aware** (no client secrets) | **NDA-aware + role-scoped** |
| **Global ~/.claude additions** | Tokensave-first | Tokensave-first | + **Per-client isolation namespace** | + Per-client isolation |
| **GitHub workflow: routine review** | ✅ Sonnet, binary verdict | ✅ Sonnet, **stricter labels** | ✅ Sonnet | ✅ Sonnet, **CODEOWNERS-routed** |
| **GitHub workflow: deep review** | Opt-in via `@claude` | **Auto-fire on trigger list** | Opt-in via `@claude` | **Auto-fire + mandatory before merge** |
| **Auto-merge on paths-ignore PRs** | ✅ | ❌ | Per-client | ❌ |
| **`CONTRIBUTING.md`** | — | ✅ **public-facing** | — | ✅ **internal team** |
| **`.github/PULL_REQUEST_TEMPLATE.md`** | Minimal | ✅ Full (test plan, screenshots) | + Audit-trail fields | + Audit-trail + reviewer checklist |
| **`CODEOWNERS` template** | — | ✅ optional | — | ✅ required |
| **Branch protection guidance** | Loose (1 reviewer = you) | Strict (require deep review) | Per-client | Strict + CODEOWNERS-required |
| **Lazy-loaded rules folder** | ✅ | ✅ | ✅ | ✅ |
| **Bootstrap SETUP.md prompt** | ✅ | ✅ | ✅ | ✅ |

---

## Solidity tiers

If you're trying to gauge how "set up" your project is:

| Tier | What you have | Bundles at this tier |
|---|---|---|
| **Bronze** | CLAUDE.md only | (any bundle without applying it) |
| **Silver** | + git.md + token-efficiency.md | Bare-minimum baseline of any bundle |
| **Gold** | + skills + memory + lazy rules + review-tiers.md | Universal core of every bundle |
| **Platinum** | Gold + GitHub workflows + DoD verification | `1-solo-personal` baseline |
| **Diamond** | Platinum + confidentiality + audit + team | `4-client-team` baseline |

**Solo-personal** targets **Platinum**. **Client-team** targets **Diamond**. The two intermediate bundles slot between.

---

## Decision tree

```
Are you the only one pushing to this repo?
├── Yes → Is the repo public?
│        ├── Yes → 1-solo-personal (public, but it's your project)
│        └── No  → 1-solo-personal
└── No → Is this for a paying client / under NDA?
         ├── Yes → Are there other devs on it besides you?
         │        ├── Yes → 4-client-team
         │        └── No  → 3-client-solo
         └── No → 2-multi-dev-oss
```

---

## Mixing bundles

If your project is between two bundles (e.g., personal project that *might* have collaborators later), pick the looser one — you can always promote later by copying overlays from a stricter bundle. Demotion (from stricter to looser) is harder because human collaborators will have already started reading your rules.

**Promotion path:**
- `1` → `2`: add `CONTRIBUTING.md`, `PULL_REQUEST_TEMPLATE.md`, disable auto-merge in `token-efficiency.md`.
- `2` → `4`: add `confidentiality.md`, swap to `client-team` review tier requirements, add `CODEOWNERS`.
- `3` → `4`: add team handoff section to session-close, add `CODEOWNERS`.

---

## What's *not* in any bundle (intentionally)

- **Language-specific rules** (e.g., "use `var` not `final` in Dart") — these are project-specific. The `SETUP.md` prompt asks Claude to scaffold a `.claude/rules/code-style.md` from the project's actual conventions after auditing the codebase.
- **Architecture rules** — same reason. Scaffolded after audit.
- **Test framework specifics** — same.
- **Linter/formatter config** — outside Claude Code's scope; use your language's idiomatic tools.
- **Pre-commit hooks** — recommended (Husky / pre-commit / lefthook) but not bundled because they vary by ecosystem.

The bundles deliberately ship the **process discipline**, not the **language opinions**. The bootstrap prompt fills in the language-specific layer after seeing your actual codebase.
