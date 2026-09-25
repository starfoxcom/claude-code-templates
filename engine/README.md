# engine

Turns a user's answers into the finished files for their repo. The page runs it in the browser; tests run it in Node. No dependencies and no build step.

| File | Job |
|---|---|
| `model.js` | The answer model: two questions (`team`, `client`), advanced choices, and every flag, choice and value derived from them. |
| `render.js` | Resolves one template: toggle blocks, then placeholders, then blank-line cleanup. |
| `bind.js` | Picks which templates ship, where each lands, and renders them all. |
| `core-files.json` | List of every file under `_core/project-template/`, because the browser cannot list folders. |
| `list-core.js` | Regenerates `core-files.json`. |

## Rules

- Every toggle name in a template must be defined in `flagsFor` or `choicesFor`. An unknown name fails the bind instead of shipping a broken file.
- Every placeholder must get a value in `valuesFor`, or be listed in `DEFERRED` for the tailoring step that reads the user's repo.
- Files a repo usually already has (`CLAUDE.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `.gitattributes`, `.claude/settings.json`) land in `.bindwright/incoming/` so they are merged, never overwritten.
- Guard hooks under `.claude/hooks/` are copied byte for byte, never rendered. `hookLocation` (`repo` or `home`) decides whether they ship; `attributionGuard` (on by default) adds the attribution guard, the `attribution` settings, the git rule and the review's attribution scan.

## Commands

```bash
cd engine
node list-core.js   # after adding, moving or deleting a template
node --test test/   # must pass before any template or engine change merges
```
