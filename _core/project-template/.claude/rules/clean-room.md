# Clean-room rule

Enable only when the project is a **spiritual successor / derived from prior art** where there's legal risk of being found to have copied a reference title. Discipline below defines what stays clean and what doesn't.

---

## What "shipped artifact" means

Anything that ends up on a user's machine via the released product, OR anything visible to a user browsing the project:

- Source files compiled into binaries
- Config files bundled into the shipped package
- Public README, marketing materials, store-page text
- The public repo's commit messages and PR descriptions
- Any asset packaged with the build (icons, audio, models, textures)

Research notes (under `docs/research/`, `docs/devlog/` drafts before publication, this file, memory files, internal CLAUDE.md instructions) are NOT shipped artifacts — they can reference reference titles freely.

---

## The rules

### 1. No reference-title names in shipped artifacts

In any shipped artifact, do not write reference-title names, their studios, their assets' filenames, or their tech-stack identifiers.

If a comment needs to explain a design choice, use **neutral framing**:
- ✅ "Standard pattern for this kind of system"
- ✅ "Common implementation of <generic concept>"
- ❌ "Ported from <reference-title>'s <filename>"
- ❌ "Same approach as <reference-title> for <feature>"

### 2. No byte-identical copies of reference-title data

Numerical config files (constants, timing tables, curves, weights), data files (JSON / YAML / Lua), asset files (images, audio, models, textures) shipped with the reference title must NOT appear byte-identical in our shipped artifacts. **Pattern + structure are NOT copyrightable; specific values are.**

Acceptable: the same general shape of data (array of timed events, two-axis decomposition, named-key map, etc. — universal conventions).

NOT acceptable: copying specific values verbatim — RGB tuples, magic numbers, name strings, any media sample.

When inspecting a reference title produces a verdict of "port the data shape", **always reauthor specific values**. Pick your own numbers that achieve the same general outcome.

### 3. Reference-title source inspection produces VERDICTS, not COPIES

Inspecting reference titles is allowed (and often necessary). The output of inspection is a written **verdict**: PORT (mechanism), IMPROVE (where the reference is broken), REDESIGN (where we want different feel). Verdicts are recorded in design docs / memory / commit messages.

Verdicts NEVER contain literal data values from the reference title.

When prototyping locally to understand reference-title behavior, the prototype is **disposable**. Specific values from the prototype get replaced with reauthored values before the implementation is committed.

### 4. Asset pipeline boundary

Reference-title assets are NEVER imported into our `assets/` directory under any extension or repackaging. If a reference-title asset is opened locally for *measurement* (e.g., counting bone-attachment points on a character rig to gauge our budget), the open file is read-only and never copied into our tree.

---

## Pre-commit checklist

For every commit that touches shipped artifacts:

- [ ] No reference-title names in code comments, doc comments, XML doc class entries, JSON `_comment` fields, or any string literal. Run `grep -i '<reference-title-name>\|<studio-name>' <staged files>` — must return empty.
- [ ] Numerical data (RGB tuples, angles, timing values, named constants) is reauthored — never byte-identical to a reference-title source file.
- [ ] No reference-title asset files in the shipped tree.
- [ ] Commit message and PR description do not name reference titles in shipped-artifact context.

For research / design docs: the rules don't apply (these aren't shipped). Speak freely about reference-title patterns there.

---

## See

- `docs/legal/clean_room.md` (if your project has one) — the legal stance + public-positioning language.
