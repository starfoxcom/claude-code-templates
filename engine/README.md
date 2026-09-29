# engine

Turns a user's answers into the finished files for their repo. The page runs it in the browser; tests run it in Node. No dependencies and no build step.

A Python twin (`model.py`, `render.py`, `bind.py`, standard library only, Python 3.8+) produces the same files byte for byte, so setup runs wherever Node or Python exists. `python engine/bind.py < answers.json` prints `{"files": [[path, text], ...]}`, or `{"error": message}` with exit status 1.

| File | Job |
|---|---|
| `model.js`, `model.py` | The answer model: two questions (`team`, `client`), advanced choices, and every flag, choice and value derived from them. |
| `render.js`, `render.py` | Resolves one template: toggle blocks, then placeholders, then blank-line cleanup. |
| `bind.js`, `bind.py` | Picks which templates ship, where each lands, and renders them all. |
| `core-files.json` | List of every file under `_core/project-template/`, because the browser cannot list folders. |
| `list-core.js` | Regenerates `core-files.json`. |

## Rules

- Every engine change lands in both twins in the same PR. `test/golden.test.js` binds about 200 answer sets (each choice and switch from every preset, plus seeded mixes) with both engines and fails on any byte of difference, and on bad answers whose error messages differ. File order is plain character order, never `localeCompare`, which depends on the browser's locale.
- Every toggle name in a template must be defined in `flagsFor` or `choicesFor`. An unknown name fails the bind instead of shipping a broken file.
- Every placeholder must get a value in `valuesFor`, or be listed in `DEFERRED` for the tailoring step that reads the user's repo.
- Files a repo usually already has (`CLAUDE.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `.gitattributes`, `.claude/settings.json`) land in `.bindwright/incoming/` so they are merged, never overwritten.
- Guard hooks under `.claude/hooks/` are copied byte for byte, never rendered. `hookLocation` (`repo` or `home`) decides whether they ship; `attributionGuard` (on by default) adds the attribution guard, the `attribution` settings, the git rule and the review's attribution scan.
- The deny list ships in the committed `.claude/settings.json`, never in `settings.local.json`. `denyProfile` picks it: `standard` (the default) blocks force pushes (`--force-with-lease` stays allowed), direct pushes to the main and development branches, interactive rebase and admin merges; `strict` also blocks `git reset --hard`, `git clean -f`, deleting the main or development branch, `gh repo delete` and `gh api` DELETE calls.
- The writing rule (`shipped-text.md`, on with `plainWriting`) keeps its default file globs in its own `paths:` frontmatter. `shippedTextPaths` replaces them with a project's list, for projects whose shipped text lives elsewhere (game scripts, scenes, manifests) or whose `docs/` folder is internal. `null`, the default, keeps the rule's list. The engine swaps the list in after rendering, so the template carries no placeholder for it.

## Commands

```bash
cd engine
node list-core.js   # after adding, moving or deleting a template
node --test         # must pass before any template or engine change merges; the golden test needs Python 3.8+
```
