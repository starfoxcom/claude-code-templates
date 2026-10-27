# Hand-off — 2026-10-27 12:36

Every task of the session is done. `develop` and `main` are clean; no PR is open other than this hand-off.

## Shipped this session
- #452 (main): the routine review has one writer. Attempts (credits run, main review, stable-CLI backup) post nothing; each returns `{review, deep_request}` as structured output, a check step runs the gate's reader on the exact body (hidden per-run mark after the gate's heading match), and "Post the review" posts it as the review bot with marked retries, then applies the label and request when a deep review is owed. 22 local rounds; the redesign at round 17 replaced late-post detection.
- #457 (main): the deep tier counts each attempt by the verdict the gate reads, not its exit; a clean exit without a verdict hands over to the retry, then the fallback.
- #455 (develop): `review-tiers.md` § "What a finding blocks on" — a finding blocks only when the PR causes it; shared gaps become follow-up issues. The global `~/.claude/CLAUDE.md` copy is now a pointer.
- #459 (cascade to develop): both PRs, templates synced (only the `branches:` placeholder line differs), SETUP.md backup wording, CHANGELOG [Unreleased].
- Verified live: #459's routine run posted one review through the new post step; deep run 40565288376 ran 2.1.311, first attempt pass, no retry. Emberholm ported 80d2d3c and its run 40568099231 was clean.

## Decisions
- Late-post detection (stop steps, start stamps, kill steps) is a dead end; one writer is the design. Do not return to it for the deep tier: #458 tracks the deep tier's one-writer port.
- Gaps the base or the pinned action share are filed, not fixed in the PR that finds them: #456 (reviewers see the job token), #458 (deep one writer), #460 (four gaps from Emberholm's port review).
- The auto-mode classifier refused `gh pr merge` on a workflow-only PR that merges on local reviews; the maintainer said to merge it directly.

## First steps next session
1. Code-research count was 20% (1 tokensave, 4 plain): plain greps of workflow YAML, CHANGELOG and SETUP.md. Check whether those greps count wrongly (Markdown and YAML are not code symbols) or should go through tokensave.
2. Continue board 6 "Bindwright" in order (#340's split, #417 onward; #419 waits on the maintainer's sign-off on `docs/v2/HANDOFF.md`).
3. On hold from before: #337 and #338 close once the downstream ports merge; name purge backups wait on GitHub Support; #339 rotate the API key in December; #433, #434 on the board.
