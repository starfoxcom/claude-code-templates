# claude-code-templates

> **Live: [starfoxcom.github.io/claude-code-templates](https://starfoxcom.github.io/claude-code-templates/)**
>
> Four opinionated, toggle-driven bundles for setting up [Claude Code](https://claude.com/claude-code) in any project. Distilled from real session telemetry across two private projects; each rule shipped here was earned from a measurable receipt.

---

## What this is

A configurator (live at the URL above) that lets you compose a custom edition of Claude Code rules, skills, memory patterns, and CI workflows for your project. Pick a bundle, set toggles, click **Bind volume**, get a zip you unpack at your project root.

The point is **discipline, not boilerplate**. The bundles encode patterns that came out of receipts — moments where the absence of a rule produced a measurable cost. The most expensive of those receipts are printed verbatim in Folio V of the live page.

## The four bundles

| # | Bundle | Who it's for |
|---|---|---|
| 1 | **Solo · personal** | Single-author, single-machine. Aggressive auto-merge, lean PR ritual, full personal memory. |
| 2 | **Multi-dev · OSS** | Public or community-collaborative. Conservative PR rituals, CODEOWNERS, contributing surface. |
| 3 | **Client · solo consultant** | One contractor, one client. NDA-aware memory, audit-trail commits, billable handoff at session-close. |
| 4 | **Client · team** | Strictest. Mandatory deep review, team-handoff notes, role-scoped isolation, full audit surface. |

A decision tree on the live page resolves which one fits.

## Using it

### Fast path — in-browser bind (recommended)

1. Go to [the live page](https://starfoxcom.github.io/claude-code-templates/).
2. Pick a bundle, fill the project specification, set toggles.
3. Click **Bind volume & download**.
4. Unzip at your project root.
5. Commit the result: `chore: install claude-code-templates v1.1.0 (<bundle>)`.

The page runs entirely in your browser. No JSON, configuration, or telemetry is transmitted anywhere — the binder fetches template files from this domain and assembles the zip client-side.

### Careful path — paste to Claude

If you want a planning step before files land:

1. Go to the live page, configure as above.
2. Click **Copy config & paste to Claude**.
3. Open Claude Code in your project root, paste the config as your first message.
4. Claude reads `SETUP.md`, runs a short interview if anything's missing, proposes a file list, lands files atomically with a commit.

The careful path is best when you want to inspect what'll be written *before* it lands, or when an existing project already has partial Claude Code setup you don't want to overwrite.

## Repo layout

```
claude-code-templates/
├── index.html              ← the live page (also the GitHub Pages root)
├── index.legacy.html       ← previous edition (v1.0.0), retained as fallback
├── redesign/               ← dev source for the React UI (9 .jsx modules)
├── README.md               ← this file
├── CHANGELOG.md            ← version history
├── CONTRIBUTING.md         ← how to PR / what's in scope
├── LICENSE                 ← MIT
├── VERSION                 ← current edition (v1.1.0)
├── COMPARISON.md           ← bundle feature matrix (mirrored in Folio II)
├── TOGGLES.md              ← full toggle reference (mirrored in Folio III)
├── SETUP.md                ← orchestration prompt Claude follows
├── _core/                  ← canonical templates (source of truth)
│   ├── project-template/   ← lands in your project root
│   ├── global-template/    ← lands in ~/.claude
│   └── licenses/           ← LICENSE template variants
└── bundles/
    ├── 1-solo-personal/
    ├── 2-multi-dev-oss/
    ├── 3-client-solo/
    └── 4-client-team/
```

The `.md` files mirror what the live page renders — readable as git-diff fodder if you want to inspect changes between versions.

## Versioning

[SemVer](https://semver.org/) from v1.0.0 onward.

- **Major** (`v1 → v2`): breaking change to the toggle catalog, the bundle keys, the manifest schema, or the SETUP.md contract that a previously-rendered project depends on.
- **Minor** (`v1.0 → v1.1`): new bundle, new toggle, new tool slot, new UI capability — additive, fully backward-compatible.
- **Patch** (`v1.0.0 → v1.0.1`): bug fixes, copy edits, design polish without behavior change.

Earlier conversational `v17` and `v18` mentions never shipped as standalone artifacts — they're consolidated into the v1.0.0 release. See [CHANGELOG.md](CHANGELOG.md) for what shipped when.

## Privacy

This page is static HTML + JavaScript hosted on GitHub Pages. There are no cookies, no analytics, no tracking pixels, and no server endpoints. The bind-volume button fetches template files from the same origin and assembles a zip in your browser. Your toggle selections and project metadata never leave the tab.

## Maintenance & contributing

Solo-maintained as an open-source side project. Issues and pull requests welcome on a best-effort basis. See [CONTRIBUTING.md](CONTRIBUTING.md) for what's in scope and what's not.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

The templates draw on patterns from production Claude Code work across two private projects (one consumer-software, one solo voxel-game build). The receipt-based methodology — earning each rule from a specific measurable cost — is what makes the bundles opinionated rather than aspirational.
