# Review tiers — binary verdict + auto-escalation

## The two tiers

| Tier | Trigger | Cost | What it does |
|---|---|---|---|
| **Routine** | Auto on every PR via `claude-code-review.yml` | Subscription (Fable 5.1 low, backup Opus 5.5 high) | Pre-screen + architectural review + **binary 🔴/🟢 verdict comment**. Verdict feeds the `Evaluate review outcome` check. |
| **On-demand deep** | `@claude review this PR` comment (fires `claude.yml`) | Subscription (Fable 5.1 low, backup Opus 5.5 high) | Depth pass on the focus the routine review escalated to. **Same binary 🔴/🟢 rule.** Verdict feeds the `Claude On-Demand` check via the Checks API — independently required by branch protection. |

## The gate model — two independent required status checks

Branch protection requires **two** status checks, both attached to the PR HEAD SHA via the Checks API, both ANDed together for merge:

1. **`Evaluate review outcome`** — the routine gate (in `claude-code-review.yml`). Logic:
   - Triage classified the diff as non-reviewable → auto-pass (also PATCHes `Claude On-Demand` to skipped so it doesn't block on docs-only PRs).
   - Routine review job didn't reach success (action errored, OIDC tripped, workflow-validation skip, runner crash) → fail.
   - Routine verdict comment missing or 🔴 → fail.
   - Routine 🟢 → pass.
2. **`Claude On-Demand`** — the deep-tier check, walked through a state machine by the Checks API:
   - PR opens → `init-deep-check` creates at `status=in_progress` ("Waiting for routine review to evaluate").
   - Triage non-reviewable → `evaluate-review-outcome` PATCHes to `conclusion=skipped`.
   - Routine done, no escalation → `claude-review`'s Resolve step PATCHes to `conclusion=skipped`.
   - Routine escalated → Resolve step PATCHes to `status=in_progress` titled "Deep review in progress".
   - Deep review completes → `claude.yml`'s Evaluate step PATCHes to `conclusion=success` (🟢) or `conclusion=failure` (🔴).
   - Every deep attempt errored (no completion comment) → PATCHes to `conclusion=failure` (FAIL-CLOSED).

`success`, `skipped`, and `neutral` all pass branch protection; `in_progress` blocks merge with a visible spinner; `failure` blocks merge with a red X.

**When the deep tier is broken or its finding does not apply:** re-trigger it, or explain in a PR comment why the finding does not apply and re-trigger. If it keeps failing, report it to the maintainer. There is no bypass. Removing the `needs-deep-review` label does NOT auto-reset the check in the two-check architecture (no event fires to PATCH on unlabeled).

Both `Evaluate review outcome` AND `Claude On-Demand` are configured as required status checks on `main` and `develop`. Omitting either from required checks would leave one tier advisory; this repo dogfoods the full strict model.

## Workflow-only PRs skip the review

The Anthropic Claude Code GitHub App validates that the workflow file on a PR's head ref is byte-identical to the version on the default branch before granting an OIDC-exchanged token, so the review action cannot run on a PR that edits `.github/workflows/claude-code-review.yml`. Triage therefore never counts `.github/workflows/` files as reviewable: a PR that touches only workflow files passes both checks like a docs PR. Keep workflow edits in a PR of their own, with no reviewable files. A reviewable file in the same PR starts the review, which then fails validation and leaves no verdict.

No AI reviews a workflow-only PR in CI, so it is reviewed before merge, one of two ways:

- **Every commit in it was written in our own sessions:** two local subagent reviews run on the exact head commit that will merge. One follows the routine-review prompt taken from the base branch's copy of `claude-code-review.yml`, never the PR's own copy; the other reviews as the deep tier. The PR merges once both give 🟢. Any new commit re-runs both.
- **Anything else,** including a PR we opened that carries someone else's commits: it merges only after the maintainer has read its whole diff.

(Edits to `claude.yml` alone do not trip this: claude.yml runs from the default branch's version on `issue_comment` events, so the running workflow file always matches the default branch. The OIDC check passes.)

Confirm the failure mode by inspecting the `Claude review` job log for `Workflow validation failed. The workflow file must exist and have identical content to the version on the repository's default branch`. For every other failure mode (the reviewer posted 🔴, missing verdict line, etc.), fix the underlying issue.

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

**Auto-escalation enabled** — the routine review's Step 2.5 applies the `needs-deep-review` label AND posts a structured `@claude review this PR` comment automatically when the diff touches any of the items below.

This list is canonical here AND in the workflow's Step 2.5 prompt — **keep them in sync when extending.**

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
