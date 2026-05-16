# Contributing

Thanks for considering a contribution. This project is solo-maintained on a best-effort basis — open issues and PRs are read but may not be answered immediately.

## Before opening a PR

- **Open an issue first** for anything bigger than a typo or one-file fix. Five minutes of "is this in scope?" saves both of us an afternoon.
- **Atomic commits.** One logical change per commit. Format: `<type>(<scope>): <imperative description>` — same convention the templates themselves teach.
- **No AI-attribution markers** in commit messages, PR titles, or PR bodies. No `Co-Authored-By: Claude`, no `Generated with Claude Code` footer, no links to `claude.com`/`claude.ai`/`anthropic.com` in commit metadata. The discipline is the work; the tool is a detail.
- **One bundle's defaults are not another's.** When adjusting toggle defaults, change them in `bundles/<n>/bundle.toggles.md` AND in `index.html`'s `TOGGLES` array AND in `FALLBACK_MANIFEST` if file-routing changes. Keep them in lockstep.

## What's in scope

- Bug fixes in the binder (`index.html` JS / CSS), the toggle-marker filter, the manifest fallback.
- Typos, broken links, factual corrections in any of the `.md` files.
- New toggles that codify a discipline the maintainer has already adopted in their own projects. Speculative discipline additions get pushed back; *receipts*-backed proposals get serious consideration.
- New bundles for genuinely distinct shapes (e.g. "research scientist running their own infra" vs the four shipped bundles). Open an issue first.
- Documentation improvements — especially in `SETUP.md`, which Claude reads verbatim.

## What's out of scope

- Renaming existing bundles or toggles. The naming surface is stable; downstream Setup commands reference them by key.
- Reformatting / restyling the HTML page beyond bug fixes — the design is a deliberate aesthetic commit. Discuss in an issue if you have a strong opinion.
- Adding telemetry / analytics. The page runs entirely in the browser; it stays that way.

## Local development

The page is a single-file HTML — open `index.html` in any modern browser. Some notes:

- **From `file://`**, the bind-volume button will fail because `fetch()` of the template files is CORS-blocked. Serve locally with `python -m http.server 8080` and open `http://localhost:8080/` instead.
- **Toggle filter test**: the JS includes a `<!-- TOGGLE:key START/END -->` filter. To verify it works, edit a template `.md`, wrap a section in markers, bind a volume with the toggle on and again with it off, and diff the outputs.
- **JSZip is loaded on demand from a CDN.** If you want to vendor it for offline development, drop `jszip.min.js` next to `index.html` and update the `<script src>` accordingly.

## Releasing a new version

Maintainer-only.

1. Bump `VERSION` (single line, e.g. `v19`).
2. Add a section to `CHANGELOG.md` under `[Unreleased]`, then promote it to a dated entry.
3. Commit + tag: `git tag v19 && git push origin v19`.
4. The Pages workflow rebuilds automatically on push to `main`. The Release workflow attaches the zip artifact to the GitHub Release.

## Code of conduct

Be kind, be specific, assume the other person has a good reason. Mean comments are deleted without notice.
