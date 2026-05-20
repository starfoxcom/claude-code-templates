# Review tiers — binary verdict + auto-escalation

## The two tiers

| Tier | Trigger | Cost | What it does |
|---|---|---|---|
| **Routine** | Auto on every PR via `claude-code-review.yml` | Subscription (Sonnet) | Pre-screen + architectural review + **binary 🔴/🟢 verdict comment**. Verdict gates the required check. |
| **On-demand deep** | `@claude review this PR` comment (fires `claude.yml`) | Subscription (Opus) | Depth pass on the focus the routine review escalated to. **Same binary 🔴/🟢 rule.** Verdict is advisory. |

## The gate model

There is **one** required status check: `Evaluate review outcome` (from `claude-code-review.yml`). It covers the routine tier only:

- Fires on `pull_request`. Reads the latest `## Code Review — <project>` comment posted within the last 25 minutes. Verdict is 🔴 → exits 1 (merge blocked). 🟢 → exits 0 (merge allowed). Non-reviewable diff (triage output `run_review=false`) → job skipped, gate auto-passes.

The deep tier's `Evaluate deep-tier verdict` step (in `claude.yml`) exits 1 on Opus 🔴, failing the `Claude On-Demand` check run — visible in the PR status panel. **That check is advisory, not required.** A deep-tier 🔴 is a hard stop for the maintainer: read the finding before any admin-bypass.

Configure the `develop-protection` / `main-protection` rulesets to require ONLY `Evaluate review outcome`. Never list `Evaluate deep-tier verdict` as a required check — it would hang on every PR that never triggers deep review.

## Workflow-touching PRs require admin-bypass

The Anthropic Claude Code GitHub App validates that the workflow file on a PR's head ref is byte-identical to the version on the default branch before granting an OIDC-exchanged token. Any PR that edits `.github/workflows/claude*.yml` therefore fails the token exchange and the routine review action cannot post a verdict. The gate has no comment to read, exits 1, and the only path forward is `gh pr merge --admin`.

Confirm the failure mode by inspecting the `Claude review` job log for `Workflow validation failed. The workflow file must exist and have identical content to the version on the repository's default branch`. For every other failure mode (Sonnet posted 🔴, missing verdict line, etc.), fix the underlying issue — do not bypass.

---

## The binary verdict rule (BOTH tiers)

This is the single most load-bearing rule for review quality.

- **🟢 LGTM ONLY when fully clean** — zero caveats, zero minors, zero nits, zero "with caveats" headings, zero non-blocking-but-real findings.
- **🔴 Blocking when ANY real finding exists**, regardless of how the reviewer frames it. "Minor wording nit" that suggests a real correctness improvement is 🔴. "All clear with caveats" is a contradiction in terms — the caveats make it 🔴. "Non-blocking but worth landing" is 🔴.
- **The only legitimate omission** is style preferences, micro-optimizations, future-proofing for hypothetical changes, or "consider extracting" suggestions — those should be **DROPPED** entirely, not labeled as 🟡 or non-blocking.
- **"All clear on X" is allowed AS A SECTION HEADING** when that section genuinely has nothing to flag. It is NEVER allowed as the verdict line when other sections have findings.

**Why:** a deep tier that returns 🟢 LGTM with three "minor non-blocking" findings tucked in the body becomes useless — the merge proceeds, the findings rot, and they re-surface as the same review weeks later. Binary verdict forces the reviewer to either drop genuinely-trivial observations or flag them as blockers worth fixing now.

---

## Deep-review trigger list

<!-- TOGGLE:github_actions_deep_review_auto_fire START -->
**Auto-escalation enabled** — the routine review's Step 2.5 applies the `needs-deep-review` label AND posts a structured `@claude review this PR` comment automatically when the diff touches any of the items below.

This list is canonical here AND in the workflow's Step 2.5 prompt — **keep them in sync when extending.**
<!-- TOGGLE:github_actions_deep_review_auto_fire END -->

<!-- TOGGLE:github_actions_deep_review_auto_fire:off START -->
**Auto-escalation disabled** — you fire the deep review manually by commenting `@claude review this PR` on the PR. The trigger list below is your mental checklist for when to do that.
<!-- TOGGLE:github_actions_deep_review_auto_fire:off END -->

The trigger surface — when a PR's diff touches any of these, the deep review is warranted. Edit this list to match your project's risk surface; the categories below are starting points.

- New parsing / codec / serialization logic, especially with bit-level or byte-level operations
- Threading, locking, or async/sync coordination, lock-free data structures
- Cellular automata, scheduler, or DAG / graph algorithms
- New public API surface (interface, exported function, route handler)
- Save / load format changes, schema migrations
- Anything that ships a new system contract
- Authentication, authorization, secret handling, cryptography
- Anything that crosses a trust boundary (user input → server, server → DB, plugin → host)

The criterion is **risk surface**, not size. A 30-line bit-pack tweak triggers; a 600-line mechanical refactor does not.

### Skip the auto-escalation for

- Pure docs PRs (`docs(*)`, ROADMAP edits, milestone checklist updates)
- Pure CI / workflow / `.gitignore` / settings tweaks
- Manifest-only changes (`package.json` version bump, etc.)
- Mechanical refactors with no behavioral change (rename, extract, mass file moves)
- Test-only PRs (adding coverage to existing logic without changing the logic)
- Trivial fixes (typo, one-line bug, dependency-version pin)

---

## Local Claude's role (this harness)

Local-session Claude does NOT auto-fire either review tier. The workflows do. Local responsibilities:

- Push the branch + open the PR.
- Run the CI polling loop (`token-efficiency.md`) and report PR state — including label state at completion.
- If `needs-deep-review` was applied but no `@claude review this PR` follow-up lands within reasonable time (workflow outage), surface that anomaly to me. Do not silently take over the workflow's job.
- On my explicit ask, post a deeper-context `@claude` comment manually. Default is "let the workflow do it."

`@claude` mentions are environment-agnostic — the workflow is triggered by the comment text alone, regardless of which actor posted it.
