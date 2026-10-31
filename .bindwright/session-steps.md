# Session steps

This project's own steps for `/session-start` and `/session-close`, run at fixed points in each: a board check, a sweep of failed scheduled runs, an analyzer, a visual gate. Write each step as one bullet that says what to run and what to do with the result. Setup writes this file once and never overwrites it.

## Extra start steps

Run after the git checks, before the report.

- Run `bash .github/scripts/setup-review-gate.sh --check`. It only reports. Every `MISSING` line it prints is a blocker in the report, with the fix it names; running it without `--check` sets the missing pieces up, but only once the maintainer agrees.

## Extra close steps

Run just before the commit.
