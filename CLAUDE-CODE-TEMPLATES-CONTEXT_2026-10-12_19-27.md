# Hand-off — 2026-10-12 19:27

Closed at the maintainer's request. No PR is open and `develop` is clean.

## Shipped this session
- #291: the `No AI attribution` check. English only: it refuses non-ASCII letter look-alikes and checks the raw text, the HTML-unescaped text and what GitHub renders. Required on `main` and `develop`.
- #299: the attribution check runs on pushes only (`opened`, `synchronize`, `reopened`). Title or body edits re-ran it alone, which left the `Claude On-Demand` check on a stale suite and blocked the merge. Closing and reopening a PR on the same commit can still do this; a new push clears it.
- #298, #300 and #301: the review workflow no longer passes PRs over 300 files unreviewed. Triage lists files through the paginated files API, reviews any PR whose listing fails or reaches 3,000 files, the gate fails closed when triage fails, and the reviewer reads the diff with local git. Fixed in the live workflow and in the canonical template.

## On hold
- Usage-guard card that offers a closed session's saved pause work to the next session (take it, keep it on the old session, or drop it). Committed locally on `feature/adopt-saved-pause-work`, not pushed, 183/183 tests. Waits on the maintainer's visual check, then push and PR to `develop`.
- API credits: the maintainer creates an org API key at the Console; then test `claude -p` billing and move the CI reviews.
- Guards: after one shadow day on the rewrite, show the false-block count so the maintainer can decide on enforcing.
- Delete the purge backups once GitHub Support replies.
- Confirm the session-facts fallback fires in a fresh session.

## First steps next session
1. Ask the maintainer about the usage-guard card's visual check.
2. Check the guards' shadow log and report the false-block count.
