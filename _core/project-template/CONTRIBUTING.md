# Contributing to {{PROJECT_NAME}}

Thanks for your interest. This document is the **public-facing** contributor guide. Internal team rules live in `.claude/rules/` and `CLAUDE.md`.

---

## Quick start

1. Fork the repo (or clone if you have push access).
2. Create a branch off `{{DEV_BRANCH}}` following the Gitflow naming:
   - Feature work → `feature/<short-kebab-case-name>`
   - Bug fix → `feature/fix-<short-name>` (or `hotfix/<n>` if it must skip to main)
3. Set up the dev environment per `README.md`.
4. Make your change. **Atomic commits** — one logical change per commit.
5. Open a PR against `{{DEV_BRANCH}}`.

---

## Commit format

```
<type>(<scope>): <imperative description>
```

- Max 72 chars on the subject line.
- `type` ∈ {`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `style`}.
- `scope` = the system or module touched.
- No `Co-Authored-By: Claude` lines.

Examples:

- `feat(auth): add OAuth2 PKCE flow`
- `fix(cart): handle empty line items in checkout`
- `refactor(db): extract connection pool to its own module`

---

## PR expectations

Use the PR template (auto-filled by GitHub). At minimum:

- **What** — 1-3 bullets describing the change
- **Why** — 1-2 lines explaining the motivation
- **Notes** (optional) — non-obvious decisions, performance implications, manual steps

Keep PRs **scoped to one logical concern**. Cross-cutting changes (touching multiple modules) need to be split.

---

## Review process

Every PR gets:

1. **Automated routine review** (Claude Sonnet) — runs on every PR, posts a binary 🔴/🟢 verdict comment. The review is a merge gate — PRs with 🔴 cannot merge.
2. **Human review** — at least one maintainer.
3. **On-demand deep review** (Claude Opus) — auto-fires when the diff touches architecturally-sensitive areas (parsers, threading, public API, auth, migrations). Same 🔴/🟢 verdict.

Reviews follow the **binary verdict rule**: 🟢 only when fully clean; 🔴 when any real finding exists. We don't ship "non-blocking minor" verdicts because they rot.

---

## Definition of done

A change is done when it can be **exercised end-to-end** in a running build — not when the code compiles. CI green is necessary but not sufficient.

For features with a visible surface (UI, API, CLI):
- Include a manual smoke-test checklist in the PR description.
- Wait for at least one human reviewer to run it locally before merging.

---

## Getting help

(Replace the channels below with your project's actuals — GitHub Discussions, Discord, mailing list, etc.)

- Open a GitHub issue with the `question` label for design questions.
- Open an issue with the `bug` label for reproducible defects.
- For security issues, see `SECURITY.md` (or email a maintainer directly — don't open a public issue).

---

## License

By contributing, you agree your contributions are licensed under the project's license (see `LICENSE`).
