# Comment audit

How to bring the comments of existing code in line with `.claude/rules/clean-code.md` without changing what the code does. Run it once after adopting the rule, then whenever an area's comments have drifted.

## Method

1. Pick one area (a folder or a module), not the whole repo.
2. In each file, cut what the rule rules out: history, planning codes, dates, dated measurements, comments that restate the line below, and blocks that could be one line. Keep units, invariants, formats, ownership and the reason a value is what it is.
3. Rewrite a comment that no longer matches its code so it says what the code does now. If the fix is a rename, that belongs in a separate change; this pass touches comments only.
4. Run the guard below, then the full test suite.
5. One area per PR, so each review stays small.

## The guard: the code stays byte-identical

A comment pass must not change one character of code. Check it mechanically before committing:

- Strip the comments from each changed file, before and after, with the language's own tokenizer or compiler (a JavaScript minifier with comments off, `gcc -fpreprocessed -dD -E -P` for C and C++, which keeps `#define` lines), and compare the two results. They must match exactly.
- Doc comments count as comments here, even where the language stores them as strings. For Python, compare `ast.dump(ast.parse(source))` before and after, with the docstring removed from the module and from every class and function first: `ast` drops `#` comments by itself.
- Where no tokenizer is handy, check that every line `git diff -U0` adds or removes is a comment line, a docstring line or blank. A short script that fails on any other line is enough; keep it out of the repo.

A diff that fails the guard goes back to step 3: whatever changed in the code moves to its own PR.

## What stays

- Doc comments on public surface, updated rather than removed.
- Pointers to real files (`docs/<topic>.md`) where the full story lives.
- Lint or tool directives that look like comments (`# noqa`, `// eslint-disable-next-line`, `#pragma`). They are code to the tools that read them.
