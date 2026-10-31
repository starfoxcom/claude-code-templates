# Session steps

This project's own steps for `/session-start` and `/session-close`, run at fixed points in each: a board check, a sweep of failed scheduled runs, an analyzer, a visual gate. Write each step as one bullet that says what to run and what to do with the result. Setup writes this file once and never overwrites it.

## Extra start steps

Run after the git checks, before the report.

## Extra close steps

Run just before the commit.
