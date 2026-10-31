# engine

Turns a user's answers into the finished files for their repo. The page runs it in the browser; tests run it in Node. No dependencies and no build step.

A Python twin (`model.py`, `render.py`, `bind.py`, standard library only, Python 3.8+) produces the same files byte for byte, so setup runs wherever Node or Python exists. `python engine/bind.py < answers.json` prints `{"files": [[path, text], ...]}`, or `{"error": message}` with exit status 1. `node engine/cli.js` takes the same flags and prints the same bytes:

- `--code bw1-...` reads the answers from a setup code instead of stdin.
- `--write DIR` writes the files into `DIR` and prints `{"written", "staged", "skipped"}` instead. `/bindwright:setup` runs this.
- `--adopt` (with `--write`) is adopt mode, for a repo with its own setup: every file outside `.bindwright/` is staged, new or not, so setup offers each one before it lands.
- `--year N` sets the copyright year. `bind.py --batch` (Python only) binds a list of `{"answers", "year", "version"}` jobs for the golden test.

| File | Job |
|---|---|
| `model.js`, `model.py` | The answer model: two questions (`team`, `client`), advanced choices, and every flag, choice and value derived from them. |
| `render.js`, `render.py` | Resolves one template: toggle blocks, then placeholders, then blank-line cleanup. |
| `bind.js`, `bind.py` | Picks which templates ship, where each lands, and renders them all. |
| `setupcode.js`, `setupcode.py` | The setup code the page hands to `/bindwright:setup`: `bw1-` plus the answers as UTF-8 JSON in base64url without padding. JS encodes and decodes; Python decodes. Both refuse a bad code with the same message. |
| `apply.js`, `apply.py` | Writes a bind into a repo (Node and Python only). Never overwrites: a file the repo already has gets the new text at `.bindwright/incoming/<path>` instead, and a path that would leave the repo fails the whole write. |
| `keep.js`, `keep.py` | The project-owned parts of a set-up repo, which `/bindwright:update` never changes: whole files matching a pattern in `.bindwright/owned` (one per line, from the repo root; `*` within a folder, `**` across folders, `?` one character, a trailing `/` for a whole folder; `#` comments), and sections of shared files between a line holding `bindwright:keep` and one holding `bindwright:end-keep`, in any comment style. Nested, unopened or unclosed markers fail, naming the line. |
| `cli.js` | The engine as a command for machines with Node and no Python, matching `bind.py`'s command. |
| `home.py` | Installs the extras setup offers into `~/.claude`, one consented step at a time: finds a system Python, registers hooks in the launcher form, adds and removes allow rules, turns off the CLI's credit lines, installs mods. Python only, since every extra is a Python hook or a mod. Each change backs up `settings.json` and writes through a temporary file. |
| `core-files.json` | List of every file under `_core/project-template/`, because the browser cannot list folders. |
| `list-core.js` | Regenerates `core-files.json`. |

## Rules

- Every engine change lands in both twins in the same PR. `test/golden.test.js` binds about 200 answer sets (each choice and switch from every preset, plus seeded mixes) with both engines and fails on any byte of difference, and on bad answers whose error messages differ. File order is plain character order, never `localeCompare`, which depends on the browser's locale. `test/setup.test.js` does the same for setup codes, the writers and the two commands.
- Answers from a setup code come from outside the page, so `validate` checks their shape before anything else, and a decoder refuses a code over 20000 characters or nested deeper than 64 levels (Python's JSON reader stops near 1000 levels where `JSON.parse` keeps going).
- `tools/pack_plugin.py` builds the installable plugin from `plugin/`, the runtime files listed in its `ENGINE_FILES`, the templates in `core-files.json`, the global files in its `GLOBAL_FILES` and the mods without their tests. A new runtime file joins that list; `test/pack.test.js` binds from a fresh pack and fails when the pack is missing anything.
- Every toggle name in a template must be defined in `flagsFor` or `choicesFor`. An unknown name fails the bind instead of shipping a broken file.
- Every placeholder must get a value in `valuesFor`, or be listed in `DEFERRED` for the tailoring step that reads the user's repo.
- `CODE_RESEARCH_TOOLS` owns each code-research tool's name, homepage, bypass marker and adherence pattern. How setup installs each one (commands, MCP entry, index, hook) lives in `_core/global-template/hooks/code-research-profiles.json`, keyed the same; `test/profiles.test.js` fails when the two lists differ. `custom` takes its name and URL from `codeResearchCustom` and derives the rest.
- Files a repo usually already has (`CLAUDE.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`, `.gitattributes`, `.claude/settings.json`) land in `.bindwright/incoming/` so they are merged, never overwritten.
- Every bind adds setup's state, which the repo keeps for `/bindwright:update`: `.bindwright/project.json`, the answers exactly as given, and `.bindwright/pristine.json`, `{"version", "year", "files"}` with every repo file as rendered, under the path it belongs at (staged files without the `.bindwright/incoming/` prefix; the `~/.claude` files left out). An update merges three ways against it, so hand edits are never overwritten silently. Nothing else under `.bindwright/` is recorded: `session-steps.md` is the project's own from the first bind. The commands record the `VERSION` file beside the engine folder without its `v` (the pack carries a copy); `bind()` takes it as `version`, `null` when not given. Both files are JSON with a two-space indent and a final newline, the same bytes from both twins. One file each, never a folder of copies: a copy of `.claude/` or `CLAUDE.md` inside the repo would load as rules and skills.
- Files for the user's `~/.claude` land in `.bindwright/global/` under their path there: the global `CLAUDE.md` additions, the memory index, the push guard, the attribution guard when `hookLocation` is `home`, and the research hook for a tool whose profile says `"source": "bindwright"`. Setup offers each one; `test/global.test.js` checks which choices ship which files.
- Guard hooks under `.claude/hooks/` are copied byte for byte, never rendered. `hookLocation` (`repo` or `home`) decides whether they ship; `attributionGuard` (on by default) adds the attribution guard, the `attribution` settings, the git rule and the review's attribution scan.
- The deny list ships in the committed `.claude/settings.json`, never in `settings.local.json`. `denyProfile` picks it: `standard` (the default) blocks force pushes (`--force-with-lease` stays allowed), direct pushes to the main and development branches, interactive rebase and admin merges; `strict` also blocks `git reset --hard`, `git clean -f`, deleting the main or development branch, `gh repo delete` and `gh api` DELETE calls.
- The writing rule (`shipped-text.md`, on with `plainWriting`) keeps its default file globs in its own `paths:` frontmatter. `shippedTextPaths` replaces them with a project's list, for projects whose shipped text lives elsewhere (game scripts, scenes, manifests) or whose `docs/` folder is internal. `null`, the default, keeps the rule's list. The engine swaps the list in after rendering, so the template carries no placeholder for it.
- `codeSizeCheck` (off by default) is the code-size add-on: `.github/scripts/size_check.py`, copied byte for byte, its workflow and an empty exceptions list. The script reads its limits from the bound `code-size.md`, so setup's trimming of that table reaches the check too. Setup writes the first baseline; `test/size-check.test.js` runs the script on throwaway repos with a stand-in lizard.
- `tracker` decides where the work state lives between sessions. `github`, the default, ships `.claude/rules/tracker.md` and the work-item issue template, and the session skills read and write issue bodies and project status updates. `trackerProject` names the board as `"<owner>/<number>"`, or `null` for issues with a pinned status issue; the skills read it from `.bindwright/project.json`. The owner lands in `gh` command lines, so it must follow GitHub's name rule. `file` keeps the hand-off file at the repo root and `ROADMAP.md`. Both ship `.bindwright/session-steps.md`, the project's own extra session steps.

## Commands

```bash
cd engine
node list-core.js   # after adding, moving or deleting a template
node --test         # must pass before any template or engine change merges; the golden test needs Python 3.8+
```
