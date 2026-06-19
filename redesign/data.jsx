// Shared data: bundles, toggle catalog, tool slots, receipts payload.
// Pure data; no JSX. Exposed on window for cross-script access.
// Toggle list mirrors starfoxcom/claude-code-templates@main · index.html
// (36 toggles across 7 groups).

const BUNDLES = [
  {
    id: "1-solo-personal",
    n: "01",
    key: "Solo · personal",
    who: "Single-author, single-machine.",
    blurb: "Aggressive auto-merge, lean PR ritual, full personal memory.",
    posture: "Loose",
  },
  {
    id: "2-multi-dev-oss",
    n: "02",
    key: "Multi-dev · OSS",
    who: "Public or community-collaborative.",
    blurb: "Conservative PR rituals, CODEOWNERS, contributor surface.",
    posture: "Strict",
  },
  {
    id: "3-client-solo",
    n: "03",
    key: "Client · solo consultant",
    who: "One contractor, one client.",
    blurb: "NDA-aware memory, audit-trail commits, billable handoff.",
    posture: "Per-client",
  },
  {
    id: "4-client-team",
    n: "04",
    key: "Client · team",
    who: "Multiple devs under a client engagement.",
    blurb: "Mandatory deep review, team-handoff notes, role-scoped isolation.",
    posture: "Strict+",
  },
];

const TOOL_SLOTS = [
  {
    id: "code_research",
    label: "code research",
    hint: "How Claude answers \"where is X / what calls Y\" before reading files.",
    options: [
      { key: "tokensave",   name: "tokensave",        desc: "Open-source code-graph MCP — indexes your codebase as a graph so Claude can ask \"where is X / what calls Y\" without reading whole files. Best fit: walks-up marker file (`.tokensave/tokensave.db`); hook blocks Grep/Glob when present.", url: "https://github.com/aovestdipaperino/tokensave" },
      { key: "ast-grep",    name: "ast-grep",         desc: "Structural search across ASTs — pattern-based code search that understands syntax, not text. Best fit: CLI on PATH; hook blocks Grep/Glob when the binary is available.", url: "https://ast-grep.github.io" },
      { key: "sourcegraph", name: "Sourcegraph",      desc: "Hosted code search across repositories with semantic understanding + references. Best fit: `src` CLI on PATH; hook blocks Grep/Glob when the binary is available. Requires a configured Sourcegraph instance.", url: "https://sourcegraph.com" },
      { key: "ctags",       name: "ctags",            desc: "Decades-old indexer producing tag files for jump-to-definition. Universal Ctags is the maintained fork. Best fit: walks-up `tags` file; hook blocks Grep/Glob when the file is present in the project tree.", url: "https://ctags.io" },
      { key: "semgrep",     name: "Semgrep",          desc: "Lightweight static analysis with rule patterns; doubles as AST-aware grep. Best fit: CLI on PATH; hook blocks Grep/Glob when the binary is available.", url: "https://semgrep.dev" },
      { key: "none",        name: "none",             desc: "Plain grep / glob / Read. Cheapest setup; most tokens spent on file reads. The `/find` skill still ships with a canonical Grep→Glob→Read sequence; no enforcement hook is installed.", url: null },
      { key: "custom",      name: "Other (specify)",  desc: "Roll-your-own code-research tool. You supply a name + URL; the bind step renders a stub hook + skill block keyed off your CLI name. Refine the rendered hook's SEQUENCE_BULLETS by hand after binding.", url: null },
    ],
    default: "tokensave",
  },
  {
    id: "precommit",
    label: "pre-commit",
    hint: "Local hook runner for lint / typecheck / test on commit.",
    options: [
      { name: "lefthook", desc: "Fast, polyglot Git hooks manager. YAML config; parallel hook execution.", url: "https://lefthook.dev" },
      { name: "husky", desc: "Classic JS-ecosystem hooks manager. Lives in package.json scripts.", url: "https://typicode.github.io/husky" },
      { name: "pre-commit", desc: "Python framework with a huge plugin catalog; manages hook environments per repo.", url: "https://pre-commit.com" },
      { name: "simple-git-hooks", desc: "Minimal hooks manager. No frills, no dependencies.", url: "https://github.com/toplenboren/simple-git-hooks" },
      { name: "none", desc: "Run lint/format/test manually or only via CI.", url: null },
    ],
    default: "lefthook",
  },
  {
    id: "ci",
    label: "CI",
    hint: "Where review + build workflows run. Shapes which workflow YAMLs ship.",
    options: [
      { name: "GitHub Actions", desc: "Workflows in .github/workflows/. Tight integration with PRs and issues.", url: "https://docs.github.com/actions" },
      { name: "GitLab CI", desc: "Native to GitLab; .gitlab-ci.yml defines pipelines and stages.", url: "https://docs.gitlab.com/ee/ci" },
      { name: "CircleCI", desc: "Configuration-as-code with matrix builds and resource classes.", url: "https://circleci.com/docs" },
      { name: "Jenkins", desc: "Self-hosted classic. Plugin-heavy and infinitely customisable.", url: "https://www.jenkins.io" },
      { name: "Buildkite", desc: "Self-hosted agents + hosted control plane. Strong for monorepo pipelines.", url: "https://buildkite.com" },
      { name: "none", desc: "No CI. Local checks only.", url: null },
    ],
    default: "GitHub Actions",
  },
  {
    id: "ai_reviewer",
    label: "AI reviewer",
    hint: "What runs the routine + deep PR review.",
    options: [
      { name: "Claude", desc: "Claude Sonnet/Opus via .github/workflows/claude.yml — binary verdict + on-demand deep review.", url: "https://claude.com/claude-code" },
      { name: "CodeRabbit", desc: "AI PR reviewer with line-level comments and auto-summaries.", url: "https://coderabbit.ai" },
      { name: "Bito", desc: "AI code review with team-tuned suggestions.", url: "https://bito.ai" },
      { name: "Sourcery", desc: "Refactoring-focused AI reviewer; suggests cleaner code patterns.", url: "https://sourcery.ai" },
      { name: "Codium", desc: "AI test generation + PR review (Qodo).", url: "https://www.qodo.ai" },
      { name: "none", desc: "Human review only.", url: null },
    ],
    default: "Claude",
  },
  {
    id: "issue_tracker",
    label: "issue tracker",
    hint: "Where issues live. Referenced from rules + audit-trail commits.",
    options: [
      { name: "GitHub", desc: "Issues + Projects integrated with PRs and milestones.", url: "https://docs.github.com/issues" },
      { name: "Linear", desc: "Fast, opinionated issue tracker for product teams. Slack/GitHub sync.", url: "https://linear.app" },
      { name: "Jira", desc: "Heavyweight enterprise tracker tightly tied to Atlassian suite.", url: "https://www.atlassian.com/software/jira" },
      { name: "Notion", desc: "Pages-as-databases approach to tasks. Flexible but unstructured.", url: "https://www.notion.so" },
      { name: "Shortcut", desc: "Mid-weight tracker for product teams. Story/iteration-focused.", url: "https://www.shortcut.com" },
      { name: "none", desc: "No formal tracker.", url: null },
    ],
    default: "GitHub",
  },
];

// state codes: 1 = ON, 0 = OFF, 2 = ASK
// defaults order: [solo, oss, cli-solo, cli-team]
const TG = (a) => ({ "1-solo-personal": a[0], "2-multi-dev-oss": a[1], "3-client-solo": a[2], "4-client-team": a[3] });
const ON = 1, OFF = 0, ASK = 2;

const TOGGLE_GROUPS = [
  {
    id: "ci",
    title: "CI / Reviews",
    blurb: "Routine + deep review workflows; verdict rule; auto-fire; branch protection posture.",
    toggles: [
      { id: "github_actions_routine_review", short: "Routine PR review (Sonnet, binary verdict)", controls: ".github/workflows/claude-code-review.yml", blurb: "Auto-fires on every PR. Posts a 🔴/🟢 comment. Merge gate is real.", d: TG([ON, ON, ASK, ON]) },
      { id: "github_actions_deep_review", short: "On-demand deep review (Opus)", controls: ".github/workflows/claude.yml", blurb: "Fires when any @claude comment lands on a PR.", d: TG([ON, ON, ASK, ON]) },
      { id: "github_actions_deep_review_auto_fire", short: "Auto-fire deep review on trigger surface", controls: "review-tiers.md", blurb: "Routine reviewer applies needs-deep-review label + posts @claude for risky diffs.", d: TG([OFF, ON, OFF, ON]) },
      { id: "github_actions_paths_ignore_auto_merge", short: "Auto-merge on paths-ignore PRs", controls: "token-efficiency.md + git.md", blurb: "Docs / rules / non-source PRs auto-merge after 90s grace via the gate's auto-pass.", d: TG([ON, OFF, OFF, OFF]) },
      { id: "binary_verdict_rule", short: "Binary 🔴/🟢 verdict rule", controls: "review-tiers.md + git.md", blurb: "🟢 only when fully clean. 🔴 when any finding. Stops 'minor non-blocking' rot.", d: TG([ON, ON, ON, ON]) },
      { id: "mandatory_deep_review_before_merge", short: "Mandatory deep review before merge", controls: "review-tiers.md + git.md", blurb: "On the trigger surface, merge blocked until Opus 🟢 lands.", d: TG([OFF, ON, OFF, ON]) },
      { id: "branch_protection_loose", short: "Loose branch protection (self-approval)", controls: "git.md section", blurb: "For solo devs.", d: TG([ON, OFF, ASK, OFF]) },
      { id: "branch_protection_strict", short: "Strict branch protection (review required)", controls: "git.md section", blurb: "For multi-human repos. Mutually exclusive with loose.", d: TG([OFF, ON, ASK, ON]) },
    ],
  },
  {
    id: "hygiene",
    title: "Project hygiene",
    blurb: "Definition of Done, context refresh, tokensave, memory, lazy rules, code-style + architecture scaffolds.",
    toggles: [
      { id: "definition_of_done_verification", short: "Definition-of-done verification", controls: "CLAUDE.md + session-close.md", blurb: "Session-close runs per-bullet DoD check.", d: TG([ON, ON, ON, ON]) },
      { id: "context_refresh_files", short: "Session-context refresh files", controls: "CLAUDE.md + session-close.md", blurb: "Regenerates PROJECT-CONTEXT_YYYY-MM-DD.md at session close.", d: TG([ON, ON, ON, ON]) },
      { id: "code_research_first", short: "Code-research-first hook (enforces tools.code_research)", controls: "CLAUDE.md + ~/.claude/hooks/<tools.code_research>-first.py + /find skill", blurb: "Routes code research through the code_research tool you picked above (tokensave / ast-grep / Sourcegraph / ctags / Semgrep / Other). Installs a GLOBAL PreToolUse hook rendered from `_core/global-template/hooks/code-research-first.py.template` against the matching profile in `code-research-profiles.json`, plus the /find skill + CLAUDE.md callout + session-close adherence metric. Set to OFF if you want the /find skill and CLAUDE.md guidance without the Grep/Glob-blocking hook.", d: TG([ASK, ASK, ASK, ASK]) },
      { id: "lazy_rules_folder", short: "Lazy-loaded rules folder", controls: "docs/lazy/ + CLAUDE.md", blurb: "docs/lazy/ for rules that only matter at specific milestones.", d: TG([ON, ON, ON, ON]) },
      { id: "memory_system", short: "Per-project memory system", controls: "global-template + CLAUDE.md", blurb: "~/.claude/projects/<slug>/memory/ with 4 memory types.", d: TG([ON, ON, ON, ON]) },
      { id: "language_specific_rules_scaffold", short: "Scaffold language code-style rule", controls: ".claude/rules/code-style.md", blurb: "Audit codebase, write .claude/rules/code-style.md.", d: TG([ON, ON, ON, ON]) },
      { id: "architecture_rules_scaffold", short: "Scaffold architecture rule", controls: ".claude/rules/architecture.md", blurb: "If clear layer boundaries exist, scaffold .claude/rules/architecture.md.", d: TG([ASK, ASK, ASK, ASK]) },
    ],
  },
  {
    id: "skills",
    title: "Skills",
    blurb: "Session-start / session-close rituals; permissions allowlist.",
    toggles: [
      { id: "skill_session_start", short: "/session-start skill", controls: ".claude/skills/session-start/SKILL.md", blurb: "Project status + git status + plan ritual.", d: TG([ON, ON, ON, ON]) },
      { id: "skill_session_close", short: "/session-close skill", controls: ".claude/skills/session-close/SKILL.md", blurb: "DoD + commit + PR + poll + merge + cleanup.", d: TG([ON, ON, ON, ON]) },
      { id: "permissions_file_template", short: "Pre-approved permissions allowlist", controls: ".claude/settings.local.json", blurb: ".claude/settings.local.json with safe commands pre-approved.", d: TG([ON, ON, ON, ON]) },
    ],
  },
  {
    id: "optional",
    title: "Optional files",
    blurb: "Contributing, PR template, CODEOWNERS, collaboration rule.",
    toggles: [
      { id: "contributing_md", short: "CONTRIBUTING.md", controls: "CONTRIBUTING.md", blurb: "Public-facing contributor guide.", d: TG([OFF, ON, OFF, ON]) },
      { id: "pr_template", short: "PR template", controls: ".github/PULL_REQUEST_TEMPLATE.md", blurb: ".github/PULL_REQUEST_TEMPLATE.md.", d: TG([OFF, ON, ON, ON]) },
      { id: "codeowners", short: "CODEOWNERS", controls: ".github/CODEOWNERS", blurb: "Auto-request reviewers for matching paths.", d: TG([OFF, ASK, OFF, ON]) },
      { id: "collaboration_rule", short: ".claude/rules/collaboration.md", controls: ".claude/rules/collaboration.md", blurb: "PR etiquette + multi-human branch hygiene.", d: TG([OFF, ON, OFF, ON]) },
    ],
  },
  {
    id: "confidentiality",
    title: "Confidentiality / Audit",
    blurb: "NDA-aware memory, audit-trail commits, billable handoff, team handoff, on-call awareness.",
    toggles: [
      { id: "confidentiality_rule", short: ".claude/rules/confidentiality.md", controls: ".claude/rules/confidentiality.md", blurb: "NDA-aware memory + on-machine isolation.", d: TG([OFF, OFF, ON, ON]) },
      { id: "audit_trail_commits", short: "Audit-trail commit / PR fields", controls: "git.md + PR template", blurb: "Per-PR ticket / reviewer / rollback fields.", d: TG([OFF, OFF, ON, ON]) },
      { id: "billable_handoff_summary", short: "Billable handoff summary at session-close", controls: "session-close.md", blurb: "Session-close emits scope + time + deliverables.", d: TG([OFF, OFF, ON, OFF]) },
      { id: "team_handoff_notes", short: "Team handoff notes", controls: "session-start + session-close", blurb: "Next team member reads at session-start.", d: TG([OFF, OFF, OFF, ON]) },
      { id: "oncall_awareness", short: "On-call awareness section", controls: "collaboration.md section", blurb: "Friday-merge discipline, on-call handoff.", d: TG([OFF, ASK, OFF, ASK]) },
    ],
  },
  {
    id: "project",
    title: "Project files",
    blurb: "LICENSE, README, CHANGELOG seed, issue templates, pre-commit scaffold.",
    toggles: [
      { id: "license_file", short: "LICENSE file", controls: "LICENSE", blurb: "Generate a LICENSE from the selected license type (MIT / Apache-2.0 / BSD-3 / Proprietary).", d: TG([ON, ON, ASK, ASK]) },
      { id: "readme_scaffold", short: "README.md scaffold", controls: "README.md", blurb: "Stub README with sections for quick-start, dev, testing, contributing, license.", d: TG([ON, ON, ASK, ASK]) },
      { id: "changelog_seed", short: "CHANGELOG.md seed", controls: "CHANGELOG.md", blurb: "Keep-a-Changelog format with an empty [Unreleased] block.", d: TG([OFF, ON, OFF, ON]) },
      { id: "github_issue_templates", short: "GitHub issue templates", controls: ".github/ISSUE_TEMPLATE/", blurb: ".github/ISSUE_TEMPLATE/{bug,feature,config}.yml — guided issue forms.", d: TG([OFF, ON, OFF, ON]) },
      { id: "precommit_hooks_scaffold", short: "Pre-commit hooks (lefthook)", controls: "lefthook.yml", blurb: "lefthook.yml template with lint/typecheck/conventional-commit-msg/test hooks.", d: TG([OFF, ON, OFF, ON]) },
    ],
  },
  {
    id: "specialized",
    title: "Specialized",
    blurb: "Niche rules: clean-room, visual discipline, devlog drafts, architecture-graph skill.",
    toggles: [
      { id: "clean_room_rule", short: ".claude/rules/clean-room.md", controls: ".claude/rules/clean-room.md", blurb: "For spiritual-successor / derived-from-prior-art projects.", d: TG([OFF, OFF, OFF, OFF]) },
      { id: "visual_test_discipline", short: ".claude/rules/visual.md", controls: ".claude/rules/visual.md", blurb: "Small visual slices + smoke-test gate. For any project with a UI surface.", d: TG([ASK, ASK, ASK, ASK]) },
      { id: "dod_devlog_step", short: "Devlog draft on milestone close", controls: "session-close.md", blurb: "Session-close generates devlog post draft when milestone flips ✅.", d: TG([OFF, OFF, OFF, OFF]) },
      { id: "architecture_diagram_skill", short: "/architecture-graph skill", controls: ".claude/skills/architecture-graph/SKILL.md", blurb: "Generates a clickable architecture map Claude reads in future sessions instead of grepping.", d: TG([OFF, OFF, OFF, OFF]) },
    ],
  },
];

// Receipts data — Folio V.
// Real telemetry from 36-day window 2026-04-06 → 2026-05-12 across 2 private
// projects, spanning the Pro → Max x5 plan transition (2026-04-25).
const RECEIPTS_STATS = [
  { k: "Total sessions", v: "143", sub: "2026-04-06 → 2026-05-12 (36 days)" },
  { k: "Output tokens lifetime", v: "18.7M", sub: "~130K avg per session" },
  { k: "Rules in place", v: "32", sub: "across both projects" },
  { k: "Memory entries", v: "117", sub: "user / feedback / project / reference" },
  { k: "Invokable skills", v: "11", sub: "session-start, session-close + topical" },
  { k: "Tool errors / session", v: "−18.4%", sub: "before / after stack-specific rules" },
  { k: "Largest session burn", v: "1.12M", sub: "446 min · 27 files · 2026-05-08" },
  { k: "Sessions on Max x5", v: "131", sub: "2026-04-25 → 2026-05-12" },
];

const RECEIPTS_CARDS = [
  {
    id: "R-001",
    date: "2026-05-08",
    title: "Two consecutive PRs on a visual feature, both abandoned.",
    cost: "~3.1M tokens",
    cause: "4 sessions in a single day, two PRs attempted to land a complex visual subsystem as a single-PR MVP dump. Both abandoned after burning ~3.1M output tokens chasing visual iteration that never settled. The entire design was eventually scrapped and replaced.",
    rule: "Ship one verifiable slice at a time, with a debug toggle in place from line 1, with a pause before the next slice. Landed 4 days later as a direct retrospective.",
    toggle: "visual_test_discipline",
  },
  {
    id: "R-002",
    date: "2026-05-08",
    title: "Largest single-session output burn.",
    cost: "1.12M tokens · 446 min · 27 files",
    cause: "Marathon session producing 1.12M output tokens, 4,128 lines added across 27 files. Context saturated; tool calls slowed; reads of the same file repeated.",
    rule: "Long-session signals — when context is saturated, tool calls slow, and reads repeat, cut and start fresh.",
    toggle: "definition_of_done_verification",
  },
  {
    id: "R-003",
    date: "2026-05-08",
    title: "Highest tool-error session (friction signal).",
    cost: "17 tool errors · 887K tokens",
    cause: "17 tool errors in one session. Each error is a wasted round-trip and a small context burn. Root causes: && -chained Bash commands stalling on a partial permission deny, repeated reads of just-edited files, hitting denied destructive commands without a fallback.",
    rule: "One Bash call per logical step, never && -chain post-merge cleanup; permission rules match the full command string and chained calls stall on partial deny.",
    toggle: "binary_verdict_rule",
  },
];

const RECEIPTS_TIMELINE = [
  { d: "2026-03-26", t: "git.md + CLAUDE.md + code-review.md (project A) — atomic commits + Gitflow + binary 🔴/🟢 verdict made the merge gate real." },
  { d: "2026-03-29", t: "token-efficiency.md (project A) — polling loops + read-before-write + paths-ignore auto-merge cut CI cost and wasted re-reads." },
  { d: "2026-04-07", t: "review-process.md (project A) — path-triggered review rules, review depth scales to the diff shape." },
  { d: "2026-04-25", t: "stack-specific perf + API-doc rules (project B) — performance rules baked in from milestone 1, no retrofit cost. Followed by −18.4% drop in tool-errors-per-session." },
  { d: "2026-05-03", t: "threading.md (project B) — threading wrapper + 2-stage pipeline canonical pattern; no more raw-thread regressions." },
  { d: "2026-05-07", t: "clean_room.md (project B) — operational checklist for derived-from-prior-art legal stance: verdicts, not copies." },
  { d: "2026-05-12", t: "visual.md (project B) — ship one verifiable visual slice at a time, written as the direct retro of the abandoned-PR receipt." },
];

const RECEIPTS_TOOL_SHIFTS = [
  { from: "Read",            to: "16.6% → 12.7%",  saved: "−3.9 pp",  earned: "fewer whole-file reads" },
  { from: "Grep",            to: "2.0% → 3.3%",    saved: "+1.3 pp",  earned: "targeted lookups" },
  { from: "Glob",            to: "3.9% → 3.7%",    saved: "−0.2 pp",  earned: "flat" },
  { from: "Bash",            to: "42.5% → 45.6%",  saved: "+3.1 pp",  earned: "shell-heavy setup" },
  { from: "tokensave_* MCP", to: "2.5% → 0.9%",    saved: "−1.6 pp",  earned: "adoption gap — surface better" },
  { from: "Edit",            to: "15.2% → 15.4%",  saved: "+0.2 pp",  earned: "flat" },
  { from: "Write",           to: "6.5% → 4.5%",    saved: "−2.0 pp",  earned: "fewer scratch files" },
];

// Bar chart: weekly session volume by week of the dataset.
// v is avg output tokens per session that week, normalized for display.
// label is the week-start date; meta describes the session count + plan.
const RECEIPTS_BARS = [
  { l: "Apr 06", v: 53,  sessions: 7,   note: "Pro" },
  { l: "Apr 13", v: 150, sessions: 1,   note: "Pro ceiling hit" },
  { l: "Apr 20", v: 181, sessions: 9,   note: "last Pro week" },
  { l: "Apr 27", v: 93,  sessions: 71,  note: "MAX x5 starts" },
  { l: "May 04", v: 175, sessions: 52,  note: "steady state" },
  { l: "May 11", v: 272, sessions: 3,   note: "highest intensity" },
];

// ── Architecture pattern catalog (used in the Advanced disclosure) ────
const ARCH_PATTERNS = [
  { key: "clean",          label: "Clean Architecture",     desc: "Concentric layers + dependency inversion. Domain at the centre, infrastructure on the outside. Strong for projects with rich business rules and long lifespans." },
  { key: "hexagonal",      label: "Hexagonal · Ports & Adapters", desc: "Application core surrounded by ports; adapters plug in from outside. Strong when you have multiple driving inputs (HTTP, CLI, queue) or want swappable infrastructure." },
  { key: "layered",        label: "Layered · 3-tier",       desc: "Classic presentation / business / data layering. Simplest fit for CRUD-heavy services where the domain isn't complex enough to justify Clean or DDD." },
  { key: "feature-based",  label: "Feature-based · Vertical Slice", desc: "Group by feature rather than by technical layer. Each feature owns its own UI / service / persistence. Strong for product apps with clear feature boundaries." },
  { key: "mvc",            label: "MVC",                     desc: "Model / View / Controller. Tightly coupled to server-rendered frameworks (Rails, Django, Laravel, ASP.NET). Picks the framework's defaults." },
  { key: "ddd",            label: "Domain-Driven Design",   desc: "Bounded contexts, aggregates, ubiquitous language. Heavyweight; pays off for genuinely complex business domains where the rules are the product." },
  { key: "ecs",            label: "Entity Component System", desc: "Composition over inheritance for games + simulations. Entities are IDs; components hold data; systems iterate over components. Strong for performance-sensitive interactive software." },
];

// ── Tech-stack catalog · grouped by ecosystem ────────────────────────
const TECH_STACK_CATALOG = {
  "Languages":        ["JavaScript", "TypeScript", "Python", "Go", "Rust", "Java", "Kotlin", "Swift", "C#", "C++", "C", "PHP", "Ruby", "Dart", "Elixir", "Zig", "Lua", "GDScript", "Scala", "Clojure", "Haskell", "R", "Julia"],
  "Frontend":         ["React", "Next.js", "Vue", "Nuxt", "Svelte", "SvelteKit", "Angular", "Solid", "Astro", "Remix", "Qwik", "HTMX", "Alpine.js", "Lit", "Preact"],
  "Backend":          ["Node.js", "Bun", "Deno", "Express", "Hono", "Fastify", "NestJS", "Django", "FastAPI", "Flask", "Rails", "Laravel", "Spring Boot", "ASP.NET Core", "Gin", "Echo", "Axum", "Actix", "Phoenix", "Elysia"],
  "Mobile":           ["React Native", "Expo", "Flutter", "SwiftUI", "Jetpack Compose", "Kotlin Multiplatform", "Ionic", "Capacitor"],
  "Desktop":          ["Electron", "Tauri", "Qt", ".NET MAUI", "WPF", "Flutter Desktop", "wxWidgets", "GTK"],
  "Game engines":     ["Unity", "Unreal", "Godot", "Bevy", "GameMaker", "LÖVE", "Phaser", "PixiJS", "Three.js", "Babylon.js", "Cocos Creator", "MonoGame"],
  "Databases":        ["PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "MariaDB", "Neon", "Turso", "PlanetScale", "Supabase Postgres", "DynamoDB", "Cassandra", "Firestore", "DuckDB", "ClickHouse", "BigQuery", "Snowflake", "Pinecone", "Qdrant", "Weaviate", "pgvector", "Chroma", "Elasticsearch", "Meilisearch", "Typesense"],
  "BaaS / Auth":      ["Supabase", "Firebase", "Appwrite", "PocketBase", "Clerk", "Auth0", "WorkOS", "Convex", "Nhost", "Better Auth"],
  "Cloud / Hosting":  ["AWS", "Google Cloud", "Azure", "Vercel", "Netlify", "Cloudflare", "Cloudflare Workers", "Fly.io", "Railway", "Render", "DigitalOcean", "Hetzner", "Heroku"],
  "DevOps / Infra":   ["Docker", "Kubernetes", "Terraform", "Pulumi", "Ansible", "GitHub Actions", "GitLab CI", "CircleCI", "Nginx", "Caddy", "Traefik", "Datadog", "Sentry", "Grafana", "Prometheus", "OpenTelemetry"],
  "Build / Monorepo": ["Vite", "Webpack", "esbuild", "Turbopack", "Rollup", "SWC", "Babel", "Turborepo", "Nx", "pnpm", "Bun (pkg)", "Yarn", "uv", "Poetry", "Cargo", "Bazel"],
  "Testing":          ["Vitest", "Jest", "Playwright", "Cypress", "Testing Library", "Storybook", "pytest", "JUnit", "RSpec", "Go test", "k6"],
  "API / Protocol":   ["REST", "GraphQL", "tRPC", "gRPC", "WebSockets", "Server-Sent Events", "OpenAPI", "WebRTC", "MQTT", "Protobuf", "JSON Schema"],
  "AI / ML / LLM":    ["OpenAI SDK", "Anthropic SDK", "LangChain", "LlamaIndex", "Vercel AI SDK", "Hugging Face", "Ollama", "llama.cpp", "PyTorch", "TensorFlow", "JAX", "scikit-learn", "Pandas", "NumPy", "Polars", "Transformers", "LangGraph", "Modal", "Replicate"],
  "Styling / CSS":    ["Tailwind CSS", "shadcn/ui", "CSS Modules", "Sass", "styled-components", "Emotion", "Radix UI", "Material UI", "Chakra UI", "Mantine", "Bootstrap", "PostCSS", "UnoCSS"],
  "Data / ORM":       ["Prisma", "Drizzle", "TypeORM", "Kysely", "SQLAlchemy", "Mongoose", "Zod", "TanStack Query", "Zustand", "Redux Toolkit", "Jotai"],
};

// ── Stack-command catalog · pre-approved Bash entries ─────────────────
const STACK_CMD_CATALOG = {
  "JS / TS · npm · pnpm · bun":  ["npm install", "npm run", "npm test", "npm run build", "npm run dev", "npm run lint", "npm run typecheck", "npx", "pnpm", "yarn", "bun", "tsc", "vite", "next", "turbo"],
  "Python · pip · uv · poetry":  ["python", "python -m", "pip install", "pip", "uv", "poetry", "pytest", "ruff check", "ruff format", "mypy", "black", "isort"],
  "Rust · cargo":                ["cargo build", "cargo test", "cargo check", "cargo run", "cargo clippy", "cargo fmt", "cargo doc", "cargo install"],
  "Go":                          ["go build", "go test", "go run", "go vet", "go mod", "go fmt", "gofmt", "gopls"],
  "Flutter · Dart":              ["flutter", "flutter test", "flutter run", "flutter build", "flutter pub", "dart", "dart analyze", "dart format", "melos"],
  "Java · Kotlin · JVM":         ["mvn", "gradle", "./gradlew", "java", "kotlin", "kotlinc"],
  ".NET · C#":                   ["dotnet", "dotnet build", "dotnet test", "dotnet run", "dotnet restore"],
  "Ruby":                        ["bundle", "bundle exec", "rake", "rails", "rspec", "rubocop"],
  "PHP":                         ["composer", "php", "php artisan", "phpunit"],
  "Docker · containers":         ["docker", "docker build", "docker run", "docker compose", "docker compose up", "kubectl", "helm"],
  "Git · GitHub":                ["git push", "git fetch", "git pull", "git merge", "git branch", "git tag", "gh pr", "gh issue", "gh run", "gh repo", "gh api"],
  "Build · CMake · Make":        ["make", "cmake", "ninja", "msbuild", "bazel"],
  "Database · migrations":       ["psql", "sqlite3", "redis-cli", "mongo", "npx prisma", "npx drizzle-kit", "alembic", "rails db"],
  "Network · utility":           ["curl", "wget", "jq", "rg", "fd", "httpie"],
  "Process · system":            ["ps", "ls", "find", "wc", "sort", "uniq", "head", "tail", "cat", "diff"],
};

Object.assign(window, {
  BUNDLES, TOOL_SLOTS, TOGGLE_GROUPS,
  RECEIPTS_STATS, RECEIPTS_CARDS, RECEIPTS_TIMELINE, RECEIPTS_TOOL_SHIFTS, RECEIPTS_BARS,
  ARCH_PATTERNS, STACK_CMD_CATALOG, TECH_STACK_CATALOG,
});
