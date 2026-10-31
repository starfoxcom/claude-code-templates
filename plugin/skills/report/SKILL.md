---
name: report
description: Report a bug in Bindwright itself. Drafts the report from what failed and the doctor's findings, takes out paths, names, emails and tokens, shows it in full, and files it only on a yes.
---

# /bindwright:report

Files a bug against Bindwright, the way the CLI's own feedback command does: nothing leaves the machine until the user has read the whole report and said yes.

## 1. Gather

- From this conversation, take what failed: the command or skill step, its exact error text, and what the user expected instead. Ask only for what is missing, in one question. When nothing failed in this conversation, ask the user to describe the problem in a sentence or two.
- Find the repo root with `git rev-parse --show-toplevel` (outside a repo, use the current folder).

## 2. Draft

Pick the engine as setup does (`node "${CLAUDE_PLUGIN_ROOT}/engine/cli.js"`, else Python 3.8+ with `"${CLAUDE_PLUGIN_ROOT}/engine/bind.py"`). Pass `{"title": "<one line>", "command": "...", "error": "...", "expected": "..."}` on standard input to `--report <repo root>`. It prints `{"title", "body", "url"}`: the body adds the doctor's findings and the versions, and the engine has already replaced the repo path, the home folder, the user name, email addresses and tokens with placeholders.

Read the draft yourself before showing it: if anything personal is still there (a company name, a private repo name, file contents), replace it with a placeholder and tell the user what you changed.

## 3. Show, then file on a yes

Show the title and the whole body exactly as they would be filed, and ask: "File this as a public issue on the Bindwright repo?"

- **Yes, and `gh auth status` works:** write the body to a temporary file and run `gh issue create --repo starfoxcom/claude-code-templates --title '<title>' --body-file <file>`. The title comes from error text, which can hold backticks or `$(...)`, so it goes in single quotes, never double ones, with each `'` in it written as `'\''`; the shell then runs nothing inside it. Give the user the issue link.
- **Yes, without `gh`:** give the user the draft's `url`, which opens GitHub's new-issue page with the report filled in; they file it from there.
- **No:** file nothing. Offer the body as text they can keep.

Never file without the yes, never add anything to the report after the user has seen it, and never attach files from the repo.
