// Folio I — Bind a volume. 6-step interactive configurator.
const { useState: bUseState, useEffect: bUseEffect, useMemo: bUseMemo, useRef: bUseRef } = React;

// ── Placeholder pools — picked once on mount via a time-derived seed ─────
const PLACEHOLDER_POOL = {
  names: ["voxel-engine", "tide-charts", "ledger-cli", "ember-deck", "halftone", "kiln-runner", "atlas-mirror", "marrow", "shrike", "cinder-store", "obol", "cubit", "warden", "trim-tab", "hush", "tablet-7", "fold-press", "kelp-graph", "ribbon-ui", "drift-watch"],
  stacks: [
    "Dart · Flutter · OpenGL",
    "TypeScript · Next.js · PostgreSQL",
    "Rust · Axum · Tokio",
    "Go · Fiber · SQLite",
    "Python · FastAPI · Redis",
    "Swift · SwiftUI · CoreData",
    "Kotlin · Ktor · MongoDB",
    "C++ · CMake · Vulkan",
    "TypeScript · SvelteKit · Turso",
    "Elixir · Phoenix · LiveView",
    "Ruby · Rails · Hotwire",
    "Node.js · Hono · Drizzle",
  ],
  descriptions: [
    "A static-site renderer built around a single content tree.",
    "Real-time ledger for indie game makers, opinionated about audit trails.",
    "Single-binary self-hosted backup planner.",
    "Markdown-first knowledge graph with edge-typed links.",
    "Composable shader pipeline for terrain rendering.",
    "Local-first journaling app with end-to-end sync.",
    "CLI for tracking small business invoicing across currencies.",
    "Per-session telemetry dashboard for solo developers.",
  ],
};

function makePlaceholders() {
  // Time-derived seed so the same minute returns the same picks, but a new
  // hour rotates the pool. Predictable enough to not feel random; varied
  // enough to not feel scripted.
  const seed = Math.floor(Date.now() / 60000); // changes every minute
  const pick = (arr, offset) => arr[(seed + offset * 7919) % arr.length];
  const name = pick(PLACEHOLDER_POOL.names, 0);
  return {
    name,
    repo_url: `github.com/me/${name}`,
    branch: ["main", "develop", "trunk"][seed % 3],
    stack: pick(PLACEHOLDER_POOL.stacks, 1),
    description: pick(PLACEHOLDER_POOL.descriptions, 2),
  };
}

function BindFolio() {
  // ── State ─────────────────────────────────────────────────────────────
  const placeholders = bUseMemo(() => makePlaceholders(), []);
  const [mode, setMode] = bUseState("manual"); // manual | discovery
  const [bundleId, setBundleId] = bUseState("1-solo-personal");
  const [project, setProject] = bUseState({
    name: "",
    repo_url: "",
    description: "",
    main_branch: "main",      // production / release branch — tagged versions live here
    dev_branch: "develop",    // dev integration branch; mirrors main_branch for trunk-based
    branching_model: "trunk",
    tech_stack: [],                // selected tech-stack chips
    license: "MIT",
    license_holder: "",
    conversation_language: "English",
    code_language: "English",
    timezone: "",
    architecture: [],              // selected architectural patterns
    stack_commands: [],            // pre-approved Bash commands
  });
  const [tools, setTools] = bUseState(() =>
    Object.fromEntries(window.TOOL_SLOTS.map(s => [s.id, s.default]))
  );
  const [otherTools, setOtherTools] = bUseState({}); // for "Other" specify: { slotId: customName }
  const [otherToolUrls, setOtherToolUrls] = bUseState({}); // optional canonical URL: { slotId: "https://..." }
  const [toggleState, setToggleState] = bUseState(() => bundleDefaults("1-solo-personal"));
  const [activeGroup, setActiveGroup] = bUseState(window.TOGGLE_GROUPS[0].id);
  const stepRefs = bUseRef({});
  const { toast } = window.useToast();

  // bundle defaults helper
  function bundleDefaults(bId) {
    const out = {};
    window.TOGGLE_GROUPS.forEach(g => g.toggles.forEach(t => { out[t.id] = t.d[bId] ?? 0; }));
    return out;
  }

  // when bundle changes, reset toggle defaults (only if user hasn't diverged?)
  // For simplicity: reset to defaults on bundle change.
  bUseEffect(() => { setToggleState(bundleDefaults(bundleId)); }, [bundleId]);

  // counts
  const changes = bUseMemo(() => {
    const d = bundleDefaults(bundleId);
    return Object.keys(toggleState).filter(k => toggleState[k] !== d[k]).length;
  }, [toggleState, bundleId]);

  const onCount = bUseMemo(() => Object.values(toggleState).filter(v => v === 1).length, [toggleState]);
  const askCount = bUseMemo(() => Object.values(toggleState).filter(v => v === 2).length, [toggleState]);

  // approximate file count: 43 universal + toggle-on file contributions
  // Baseline matches the canonical _core/ + bundles/ + root files tree
  // (~43 always-present); ON toggles add file-scoped contributions.
  const fileCount = bUseMemo(() => 43 + onCount + (mode === "discovery" ? 4 : 0), [onCount, mode]);
  const bundleSize = bUseMemo(() => Math.round(48 + fileCount * 0.45) + " kB", [fileCount]);

  const bundle = window.BUNDLES.find(b => b.id === bundleId);
  const showProject = mode !== "discovery";
  const showToggles = mode !== "discovery";

  // ── Step nav (top-of-folio scroll) ────────────────────────────────────
  function scrollTo(stepKey) {
    const el = stepRefs.current[stepKey];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Actions ────────────────────────────────────────────────────────────
  function setToggle(id, value) {
    setToggleState(s => ({ ...s, [id]: value }));
  }
  function resetGroup(gid) {
    const d = bundleDefaults(bundleId);
    const g = window.TOGGLE_GROUPS.find(x => x.id === gid);
    setToggleState(s => {
      const out = { ...s };
      g.toggles.forEach(t => { out[t.id] = d[t.id]; });
      return out;
    });
    toast(`Group "${g.title}" reset to ${bundle.key} defaults`);
  }

  function buildManifest() {
    // Resolve each tool slot to its `key` (lowercase, profile-lookup-safe form)
    // for built-in options, or `custom` for the "Other (specify)" case.
    // Also resolve the URL from the catalog for built-ins; user-supplied for Other.
    const resolvedTools = {};
    const resolvedToolUrls = {};
    const resolvedToolNames = {}; // human-readable display name (for UI / paste prompts)

    Object.entries(tools).forEach(([slotId, picked]) => {
      const slot = window.TOOL_SLOTS.find(s => s.id === slotId);
      const pick = slot && slot.options.find(o => (o.name === picked || o.key === picked));
      if (pick && pick.key !== "custom") {
        // Built-in option — emit its canonical key + URL
        resolvedTools[slotId] = pick.key || pick.name.toLowerCase();
        if (pick.url) resolvedToolUrls[slotId] = pick.url;
        resolvedToolNames[slotId] = pick.name;
      } else {
        // "Other (specify)" — emit user-supplied name + URL
        const userName = otherTools[slotId] || "unspecified";
        resolvedTools[slotId] = "custom";
        if (otherToolUrls[slotId]) resolvedToolUrls[slotId] = otherToolUrls[slotId];
        resolvedToolNames[slotId] = userName;
      }
    });

    return {
      version: "v1.3.0",
      generated_at: new Date().toISOString(),
      mode,
      bundle: bundleId,
      project: showProject ? {
        ...project,
        // For trunk-based projects, dev_branch mirrors main_branch (single-branch model).
        dev_branch: project.branching_model === "gitflow"
          ? (project.dev_branch || "develop")
          : project.main_branch,
      } : {
        discovery: true,
        conversation_language: project.conversation_language,
        timezone: project.timezone,
      },
      tools: resolvedTools,
      tool_names: resolvedToolNames,
      tool_urls: resolvedToolUrls,
      toggles: Object.fromEntries(
        Object.entries(toggleState).map(([k, v]) => {
          if (mode === "discovery") {
            const t = window.TOGGLE_GROUPS
              .flatMap(g => g.toggles).find(x => x.id === k);
            if (t && Object.values(t.d).every(d => d === 0)) return [k, "ask"];
          }
          return [k, ["off", "on", "ask"][v]];
        })
      ),
      change_count: changes,
    };
  }

  async function bindAndDownload() {
    const manifest = buildManifest();
    // Ensure JSZip is loaded
    if (!window.JSZip) {
      try {
        await loadScript(
          "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
          {
            integrity: "sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==",
            crossOrigin: "anonymous",
          }
        );
      } catch (e) {
        toast("Couldn't load JSZip — try again");
        return;
      }
    }
    const zip = new window.JSZip();
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("VERSION", `${manifest.version}\n`);

    // SETUP.md — the orchestration prompt Claude reads in step 2.
    // We TRY to fetch the canonical SETUP.md from the same origin (GitHub
    // Pages deployment), since it's the authoritative version. If fetch
    // fails (file:// protocol during local dev, offline, CORS), we fall
    // back to the inline stub which captures the v1.3 contract.
    let setupMdContent;
    try {
      const res = await fetch("./SETUP.md");
      if (res.ok) {
        setupMdContent = await res.text();
      } else {
        throw new Error(`fetch returned ${res.status}`);
      }
    } catch (e) {
      // Inline fallback — accurate to the v1.3 agnostified contract.
      setupMdContent = buildSetupMd(manifest, bundleId);
    }
    zip.file("SETUP.md", setupMdContent);

    // bundles/<bundleId>/bundle.toggles.md — per-bundle defaults Claude
    // walks during the interview.
    zip.file(`bundles/${bundleId}/bundle.toggles.md`,
      buildBundleTogglesMd(bundleId, bundleDefaults(bundleId)));

    zip.file("README.txt",
`claude-code-templates ${manifest.version} — bundle: ${bundleId}
Generated: ${manifest.generated_at}
Toggles ON: ${onCount}    Toggles ASK: ${askCount}    Diverged from default: ${changes}

NEXT STEP — paste the bootstrap brief in Claude Code:

  1. Unzip this archive at the root of your repo (next to .git).
  2. Open Claude Code in the same project root.
  3. Paste the contents of PASTE-TO-CLAUDE.md as your first message.
     Claude reads SETUP.md from this folder, runs a short interview if
     anything is missing, proposes a plan, and waits for your "apply".

The configurator preview ships a SETUP.md stub + your manifest.json + the
bundle defaults. In the production build, every canonical template file
(rules, skills, memory, workflows, license, etc.) is included so Claude
can copy them into your project root during step 2 apply.
`);

    zip.file("PASTE-TO-CLAUDE.md", buildPasteText(manifest, bundleId));

    const blob = await zip.generateAsync({ type: "blob" });
    triggerDownload(blob, `claude-code-templates-${bundleId}-${manifest.version}.zip`);
    toast("Bound. Volume downloaded.");
  }

  async function copyConfigToClipboard() {
    const text = buildPasteText(buildManifest(), bundleId);
    try {
      await navigator.clipboard.writeText(text);
      toast("Config copied. Paste in Claude Code.");
    } catch (e) {
      toast("Clipboard blocked — see DevTools.");
      console.log(text);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="folio-head">
        <div className="kicker">Folio I · Configurator</div>
        <h1>Bind&nbsp;a&nbsp;volume.</h1>
        <p className="lede">Compose an opinionated edition of Claude Code for your project — bundle, toggles, project metadata. Bind to a zip, or paste a brief and let Claude land it.</p>
        <div className="ledemeta">
          <span className="pip"></span>
          <span>6 steps · ~3 min · runs entirely in your browser</span>
        </div>
      </div>

      {/* Step strip */}
      <StepStrip
        steps={[
          { id: "mode", n: "01", title: "Mode" },
          { id: "bundle", n: "02", title: "Bundle" },
          ...(showProject ? [{ id: "project", n: "03", title: "Project" }] : []),
          { id: "tools", n: "04", title: "Tools" },
          ...(showToggles ? [{ id: "toggles", n: "05", title: "Toggles", badge: changes ? `${changes}∆` : null }] : []),
          { id: "bind", n: "06", title: "Bind" },
        ]}
        onClick={scrollTo}
      />

      {/* ── STEP 01 — MODE ─────────────────────────────────────────────── */}
      <section className="step" ref={el => stepRefs.current.mode = el}>
        <StepHead step="01" title="Mode" annot="A · DECISION GATE" />
        <div className="g2">
          <ModeCard
            tag="DEFAULT"
            label="Manual"
            sub="You answer the interview; we bind the zip."
            selected={mode === "manual"}
            onClick={() => setMode("manual")}
            bullets={[
              "All six steps visible.",
              "Predictable, reproducible output.",
              "Best for a fresh project root.",
            ]}
          />
          <ModeCard
            tag="EXPERIMENTAL"
            label="Discovery"
            sub="Claude inspects your repo and infers settings."
            selected={mode === "discovery"}
            onClick={() => setMode("discovery")}
            bullets={[
              "Project and toggle steps are skipped.",
              "Universal-off toggles become ASK.",
              "Best for retrofitting existing repos.",
            ]}
          />
        </div>
        <DimLine label="2 options · click to switch" />
      </section>

      {/* ── STEP 02 — BUNDLE ──────────────────────────────────────────── */}
      <section className="step" ref={el => stepRefs.current.bundle = el}>
        <StepHead step="02" title="Bundle" annot="B · CARDINAL CHOICE" />
        <div className="g4">
          {window.BUNDLES.map(b => (
            <BundleCard key={b.id} b={b} selected={bundleId === b.id} onClick={() => setBundleId(b.id)} />
          ))}
        </div>
        <div className="dim-line">
          <span className="dim mono" style={{ fontSize: 11 }}>You can override any default downstream — bundle is the baseline, not the ceiling.</span>
        </div>
      </section>

      {/* ── DISCOVERY SUMMARY ─ shown only in Discovery mode, after Bundle ── */}
      {mode === "discovery" && <DiscoverySummary />}

      {/* ── STEP 03 — PROJECT ─────────────────────────────────────────── */}
      {showProject && (
        <section className="step" ref={el => stepRefs.current.project = el}>
          <StepHead step="03" title="Project" annot="C · METADATA" />
          <div className="card pad" style={{ background: "var(--paper-card)" }}>
            <div className="proj-grid">
              <Field label="Name" hint="kebab-case is fine">
                <input className="input" placeholder={placeholders.name}
                  value={project.name}
                  onChange={e => setProject(p => ({ ...p, name: e.target.value }))} />
              </Field>
              <Field label="Repository URL">
                <input className="input" placeholder={placeholders.repo_url}
                  value={project.repo_url}
                  onChange={e => setProject(p => ({ ...p, repo_url: e.target.value }))} />
              </Field>
              <Field label="Branching model" hint="Gitflow = separate main + dev branches. Trunk-based = single branch.">
                <select className="select"
                  value={project.branching_model}
                  onChange={e => setProject(p => ({ ...p, branching_model: e.target.value }))}>
                  <option value="trunk">Trunk-based</option>
                  <option value="gitflow">Gitflow</option>
                </select>
              </Field>
              <Field label="License">
                <select className="select"
                  value={project.license}
                  onChange={e => setProject(p => ({ ...p, license: e.target.value }))}>
                  {["MIT", "Apache-2.0", "BSD-3-Clause", "GPL-3.0", "Proprietary", "None"].map(l => <option key={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="Main branch" hint="Production / release branch. Tagged versions live here, GitHub's UI 'default branch' usually points here too. Usually main.">
                <input className="input" placeholder="main"
                  value={project.main_branch}
                  onChange={e => setProject(p => ({ ...p, main_branch: e.target.value }))} />
              </Field>
              {project.branching_model === "gitflow" && (
                <Field label="Dev branch" hint="Where day-to-day work targets and PRs base from. Gitflow only — trunk-based mirrors the main branch.">
                  <input className="input" placeholder="develop"
                    value={project.dev_branch}
                    onChange={e => setProject(p => ({ ...p, dev_branch: e.target.value }))} />
                </Field>
              )}
              <div className="field-full">
                <CardCarousel
                  label="Tech stack"
                  hint="Pick the languages, frameworks, infrastructure your project actually uses. Each chip lands in the CLAUDE.md front-matter; Claude scaffolds language-specific rules from your picks."
                  catalog={window.TECH_STACK_CATALOG}
                  selected={project.tech_stack}
                  onToggle={(item) => setProject(p => ({
                    ...p,
                    tech_stack: p.tech_stack.includes(item)
                      ? p.tech_stack.filter(x => x !== item)
                      : [...p.tech_stack, item],
                  }))}
                  customPlaceholder="Add custom tech…"
                />
              </div>
            </div>

            {/* Advanced — everything Claude can also ask for in chat */}
            <details className="adv-details">
              <summary>
                <span className="adv-summary-text">Advanced · extra metadata, architecture, pre-approved commands</span>
                <span className="adv-summary-meta mono">{advancedFilledCount(project)}</span>
                <span className="adv-summary-caret" aria-hidden>▸</span>
              </summary>
              <div className="adv-body">
                <p className="adv-lede dim">Optional. Leave any blank — Claude will ask during setup if it actually needs the value.</p>

                <div className="proj-grid">
                  <Field label="One-line description" full
                    hint="One sentence describing what the project does. Goes into CLAUDE.md as orient-Claude-every-session context.">
                    <input className="input" placeholder={placeholders.description}
                      value={project.description}
                      onChange={e => setProject(p => ({ ...p, description: e.target.value }))} />
                  </Field>
                  <Field label="Conversation language"
                    hint="What language Claude talks back to you in.">
                    <input className="input" placeholder="English"
                      value={project.conversation_language}
                      onChange={e => setProject(p => ({ ...p, conversation_language: e.target.value }))} />
                  </Field>
                  <Field label="Code language"
                    hint="Used inside the code — variable names, comments. Usually English.">
                    <input className="input" placeholder="English"
                      value={project.code_language}
                      onChange={e => setProject(p => ({ ...p, code_language: e.target.value }))} />
                  </Field>
                  <Field label="License holder" full
                    hint="Substituted into the LICENSE file's copyright line.">
                    <input className="input" placeholder="Your name or your company"
                      value={project.license_holder}
                      onChange={e => setProject(p => ({ ...p, license_holder: e.target.value }))} />
                  </Field>
                  <Field label="Timezone (IANA name)" full
                    hint={<>For session-close timestamps. IANA is the canonical world-clock identifier list (e.g. <code className="mono">America/Mazatlan</code>, <code className="mono">Europe/Madrid</code>, <code className="mono">Asia/Tokyo</code>). Full list: <a href="https://en.wikipedia.org/wiki/List_of_tz_database_time_zones" target="_blank" rel="noreferrer" style={{color: "var(--accent)"}}>tz database time zones ↗</a>.</>}>
                    <input className="input" placeholder="America/Mazatlan"
                      value={project.timezone}
                      onChange={e => setProject(p => ({ ...p, timezone: e.target.value }))} />
                  </Field>
                </div>

                <PatternCarousel
                  label="Architectural patterns"
                  hint="One pattern at a time. Use the arrows to flip through; toggle Add this pattern to select. Combos welcome (Clean + DDD, Feature-based + Hexagonal). Each pattern generates its own H2 section in .claude/rules/architecture.md."
                  catalog={window.ARCH_PATTERNS}
                  selected={project.architecture}
                  onToggle={(item) => setProject(p => ({
                    ...p,
                    architecture: p.architecture.includes(item)
                      ? p.architecture.filter(x => x !== item)
                      : [...p.architecture, item],
                  }))}
                  customPlaceholder="Add custom pattern…"
                />

                <CardCarousel
                  label="Pre-approved stack commands"
                  hint={<>Each chip becomes <code className="mono inline-code">Bash(&lt;cmd&gt;:*)</code> in <code className="mono inline-code">.claude/settings.local.json</code>, so Claude doesn't bounce on permission prompts for things you run dozens of times a day.</>}
                  catalog={window.STACK_CMD_CATALOG}
                  selected={project.stack_commands}
                  onToggle={(item) => setProject(p => ({
                    ...p,
                    stack_commands: p.stack_commands.includes(item)
                      ? p.stack_commands.filter(x => x !== item)
                      : [...p.stack_commands, item],
                  }))}
                  customPlaceholder="Add custom command…"
                />
              </div>
            </details>
          </div>
          <style>{`
            .proj-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 20px; row-gap: 18px; }
            .proj-grid .field-full { grid-column: 1 / -1; min-width: 0; }
            .proj-grid > * { min-width: 0; }
            @media (max-width: 640px) { .proj-grid { grid-template-columns: 1fr; } }

            .adv-details {
              margin-top: 20px;
              padding-top: 18px;
              border-top: 1px dashed var(--rule);
            }
            .adv-details summary {
              list-style: none;
              cursor: pointer;
              display: flex; align-items: center; gap: 10px;
              padding: 8px 0;
              font-family: var(--f-ui);
              font-size: 13.5px;
              font-weight: 500;
              color: var(--ink);
              user-select: none;
            }
            .adv-details summary::-webkit-details-marker { display: none; }
            .adv-summary-caret {
              margin-left: auto;
              color: var(--accent);
              transition: transform var(--dur) var(--ease);
              font-size: 14px;
              font-family: var(--f-mono);
            }
            .adv-details[open] .adv-summary-caret { transform: rotate(90deg); }
            .adv-summary-meta { font-size: 10.5px; color: var(--ink-faint); letter-spacing: 0.4px; }
            .adv-body { padding-top: 14px; display: flex; flex-direction: column; gap: 24px; }
            .adv-lede { font-size: 12.5px; margin: 0 0 -4px; }
            @media (max-width: 640px) {
              .adv-details summary { flex-wrap: wrap; gap: 4px 10px; }
              .adv-summary-text { flex-basis: 100%; order: 1; }
              .adv-summary-meta { order: 2; }
              .adv-summary-caret { order: 3; margin-left: auto; }
            }
          `}</style>
        </section>
      )}

      {/* ── DISCOVERY PREFERENCES ─ visible only in Discovery mode ───── */}
      {mode === "discovery" && (
        <section className="step disc-prefs-step">
          <StepHead step="03" title="Discovery preferences" annot="2 THINGS CLAUDE CAN'T INFER FROM CODE" />
          <div className="card pad" style={{ background: "var(--paper-card)" }}>
            <div className="proj-grid">
              <Field label="Conversation language"
                hint="What language Claude speaks back to you in.">
                <input className="input" placeholder="English"
                  value={project.conversation_language}
                  onChange={e => setProject(p => ({ ...p, conversation_language: e.target.value }))} />
              </Field>
              <Field label="Timezone (IANA name)"
                hint={<>For session-close timestamps. IANA = canonical world-clock list (e.g. <code className="mono">America/Mazatlan</code>). Full list: <a href="https://en.wikipedia.org/wiki/List_of_tz_database_time_zones" target="_blank" rel="noreferrer" style={{color: "var(--accent)"}}>tz database time zones ↗</a>. Leave blank and Claude will ask during the audit.</>}>
                <input className="input" placeholder="America/Mazatlan"
                  value={project.timezone}
                  onChange={e => setProject(p => ({ ...p, timezone: e.target.value }))} />
              </Field>
            </div>
          </div>
          <style>{`
            .disc-prefs-step .proj-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 20px; row-gap: 18px; }
            @media (max-width: 640px) { .disc-prefs-step .proj-grid { grid-template-columns: 1fr; } }
          `}</style>
        </section>
      )}

      {/* ── STEP 04 — TOOLS ───────────────────────────────────────────── */}
      <section className="step" ref={el => stepRefs.current.tools = el}>
        <StepHead step="04" title="Tools" annot="D · 5 SLOTS · NO LOCK-IN" />
        <div className="card flush" style={{ overflow: "hidden" }}>
          {window.TOOL_SLOTS.map((slot, i) => {
            const optionNames = slot.options.map(o => o.name);
            const isCustom = tools[slot.id] === "Other" || !optionNames.includes(tools[slot.id]);
            const picked = isCustom ? null : slot.options.find(o => o.name === tools[slot.id]);
            return (
              <div key={slot.id} className="tool-row" style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule-soft)" }}>
                <div className="tool-meta">
                  <div className="mono tool-id">{slot.id}</div>
                  <div className="tool-hint">{slot.hint}</div>
                </div>
                <div className="tool-pick">
                  <select className="select"
                    value={isCustom ? "Other" : tools[slot.id]}
                    onChange={e => {
                      const v = e.target.value;
                      setTools(t => ({ ...t, [slot.id]: v }));
                    }}>
                    {slot.options.map(o => <option key={o.name}>{o.name}</option>)}
                    <option>Other</option>
                  </select>
                  {isCustom && (
                    <>
                      <input className="input" style={{ marginTop: 8 }} placeholder="name your tool"
                        value={otherTools[slot.id] || ""}
                        onChange={e => setOtherTools(o => ({ ...o, [slot.id]: e.target.value }))} />
                      <input className="input" style={{ marginTop: 6, fontSize: "12.5px" }}
                        type="url"
                        placeholder="canonical URL (optional)"
                        value={otherToolUrls[slot.id] || ""}
                        onChange={e => setOtherToolUrls(o => ({ ...o, [slot.id]: e.target.value }))} />
                    </>
                  )}
                </div>
                <div className="tool-info">
                  {picked ? (
                    <>
                      <div className="tool-desc">{picked.desc}</div>
                      {picked.url && (
                        <a className="tool-url mono" href={picked.url} target="_blank" rel="noreferrer">
                          {picked.url.replace(/^https?:\/\//, "")} <span aria-hidden>↗</span>
                        </a>
                      )}
                    </>
                  ) : (
                    <div className="tool-desc dim">
                      Custom tool — Claude will reference the name you provide in rules and skills.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <style>{`
          .tool-row {
            display: grid;
            grid-template-columns: 180px 240px 1fr;
            gap: 20px;
            padding: 16px 18px;
            align-items: start;
          }
          .tool-meta .tool-id {
            font-size: 12.5px;
            color: var(--ink);
            letter-spacing: 0.3px;
          }
          .tool-meta .tool-hint {
            font-size: 11.5px;
            color: var(--ink-soft);
            margin-top: 3px;
            line-height: 1.45;
          }
          .tool-info {
            padding: 10px 12px;
            background: var(--paper);
            border: 1px dashed var(--rule);
            border-radius: var(--r-md);
            font-size: 12.5px;
          }
          .tool-info .tool-desc {
            color: var(--ink);
            line-height: 1.5;
          }
          .tool-info .tool-url {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            margin-top: 6px;
            font-size: 11px;
            color: var(--accent);
            letter-spacing: 0.2px;
            border-bottom: 1px solid var(--accent-soft);
          }
          .tool-info .tool-url:hover {
            border-bottom-color: var(--accent);
            text-decoration: none;
          }
          @media (max-width: 900px) {
            .tool-row { grid-template-columns: 1fr 1fr; }
            .tool-info { grid-column: 1 / -1; }
          }
          @media (max-width: 560px) {
            .tool-row { grid-template-columns: 1fr; gap: 10px; }
          }
        `}</style>
      </section>

      {/* ── QUICK OPTIONS ─ surfaces the two most-touched toggles ─────── */}
      {showToggles && (
        <QuickOptions
          codeResearchTool={(() => {
            const slot = window.TOOL_SLOTS.find(s => s.id === "code_research");
            const pick = slot && slot.options.find(o => o.name === tools.code_research);
            if (pick) return pick;
            // Custom-named tool: synthesize a stub
            if (tools.code_research && tools.code_research !== "none") {
              return {
                name: otherTools.code_research || tools.code_research,
                desc: null,
                url: otherToolUrls.code_research || null,
              };
            }
            return null;
          })()}
          tokensave={toggleState.tokensave_entry_point}
          contextRefresh={toggleState.context_refresh_files}
          onTokensave={(v) => setToggle("tokensave_entry_point", v)}
          onContextRefresh={(v) => setToggle("context_refresh_files", v)}
        />
      )}

      {/* ── STEP 05 — TOGGLES ─────────────────────────────────────────── */}
      {showToggles ? (
        <section className="step" ref={el => stepRefs.current.toggles = el}>
          <StepHead step="05" title="Toggles" annot={`E · 36 SWITCHES · 7 GROUPS · TRI-STATE`} />

          <div className="tg-tabs">
            {window.TOGGLE_GROUPS.map(g => {
              const d = bundleDefaults(bundleId);
              const diverged = g.toggles.filter(t => toggleState[t.id] !== d[t.id]).length;
              return (
                <button key={g.id}
                  className={"tg-tab" + (activeGroup === g.id ? " on" : "")}
                  onClick={() => setActiveGroup(g.id)}>
                  <span className="tg-tab-title">{g.title}</span>
                  <span className="tg-tab-meta">
                    {g.toggles.length}
                    {diverged > 0 && <span className="tg-tab-delta">·{diverged}∆</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {window.TOGGLE_GROUPS.filter(g => g.id === activeGroup).map(g => (
            <div key={g.id} className="card flush" style={{ overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "16px 20px 12px", borderBottom: "1px solid var(--rule-soft)" }}>
                <div>
                  <div className="display" style={{ fontSize: 17, fontWeight: 500 }}>{g.title}</div>
                  <div className="dim" style={{ fontSize: 12.5, marginTop: 2 }}>{g.blurb}</div>
                </div>
                <button className="mono" onClick={() => resetGroup(g.id)}
                  style={{ background: "transparent", border: "1px dashed var(--rule)", color: "var(--ink-soft)", padding: "4px 10px", borderRadius: "var(--r-sm)", fontSize: 10.5, letterSpacing: 0.6 }}>
                  RESET GROUP
                </button>
              </div>
              {g.toggles.map((t, i) => {
                const s = toggleState[t.id];
                const d = bundleDefaults(bundleId)[t.id];
                const diverged = s !== d;
                return (
                  <div key={t.id} className="tg-row" style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule-soft)" }}>
                    <div className="tg-info">
                      <div className="tg-key-line">
                        <span className="mono tg-key">{t.id}</span>
                        {diverged && <span className="tg-divot" title={`bundle default: ${["OFF","ON","ASK"][d]}`}>∆</span>}
                      </div>
                      <div className="tg-blurb">{t.blurb}</div>
                      <div className="tg-controls mono">{t.controls}</div>
                    </div>
                    <TriToggle state={s} onSet={(v) => setToggle(t.id, v)} />
                  </div>
                );
              })}
            </div>
          ))}

          <div className="dim mono" style={{ fontSize: 11, marginTop: 12, textAlign: "right", letterSpacing: 0.4 }}>
            {onCount} ON · {askCount} ASK · {changes} diverged from {bundle.key} defaults
          </div>

          <style>{`
            .tg-tabs {
              display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px;
            }
            .tg-tab {
              background: var(--paper-card);
              border: 1px solid var(--rule);
              border-radius: var(--r-md);
              padding: 8px 12px;
              display: flex; align-items: center; gap: 10px;
              transition: all var(--dur) var(--ease);
            }
            .tg-tab:hover { border-color: var(--rule-strong); }
            .tg-tab.on {
              border-color: var(--accent);
              box-shadow: 0 0 0 4px var(--accent-soft), var(--shadow-card);
            }
            .tg-tab-title { font-family: var(--f-display); font-size: 13.5px; }
            .tg-tab-meta {
              font-family: var(--f-mono); font-size: 10.5px;
              color: var(--ink-faint); letter-spacing: 0.4px;
            }
            .tg-tab.on .tg-tab-meta { color: var(--ink-soft); }
            .tg-tab-delta { color: var(--accent); margin-left: 4px; }
            .tg-tab.on .tg-tab-delta { color: var(--accent); }

            .tg-row {
              display: grid; grid-template-columns: 1fr auto;
              align-items: center; gap: 18px;
              padding: 14px 20px;
              min-width: 0;
            }
            .tg-row > * { min-width: 0; }
            .tg-key-line { display: flex; align-items: center; gap: 8px; }
            .tg-key { font-size: 12.5px; color: var(--ink); }
            .tg-divot {
              font-family: var(--f-mono); font-size: 11px; color: var(--accent);
              padding: 1px 5px; background: var(--accent-soft);
              border-radius: var(--r-xs);
            }
            .tg-blurb { font-size: 13px; color: var(--ink-soft); margin-top: 2px; }
            .tg-controls { font-size: 10.5px; color: var(--ink-faint); margin-top: 4px; letter-spacing: 0.3px; }

            @media (max-width: 640px) {
              .tg-row { grid-template-columns: 1fr; padding: 12px 14px; }
            }
          `}</style>
        </section>
      ) : (
        <section className="step">
          <StepHead step="05" title="Toggles" annot="E · DISCOVERY MODE · DEFERRED" />
          <div className="card pad" style={{ background: "var(--paper-tint)", borderColor: "var(--accent-soft)" }}>
            <div className="display" style={{ fontSize: 20, fontWeight: 500 }}>Discovery defers the toggle step.</div>
            <p className="dim" style={{ marginTop: 8, fontSize: 14.5, lineHeight: 1.55 }}>
              When you paste the brief to Claude, it reads your repo first — language, structure,
              existing CI, NDA cues — and proposes a toggle override set you can accept or revise
              before any files land. Universally-off toggles (specialised rules like
              <code className="mono"> clean_room_rule</code>, <code className="mono"> dod_devlog_step</code>)
              are promoted to <strong>ASK</strong> so Claude evaluates them against your context.
            </p>
            <div className="mono dim" style={{ fontSize: 11.5, marginTop: 14, letterSpacing: 0.3 }}>
              5 universally-off toggles will be promoted to ASK in Discovery.
            </div>
          </div>
        </section>
      )}

      {/* ── STEP 06 — BIND ────────────────────────────────────────────── */}
      <section className="step" ref={el => stepRefs.current.bind = el}>
        <StepHead step="06" title="Bind" annot="F · OUTPUT · TWO MOVES" />

        <p className="bind-intro dim">
          Two sequential moves — both required. <strong>(A)</strong> download &amp; unzip the bundle at your project root so the templates folder exists. <strong>(B)</strong> paste the bootstrap command in Claude Code so it reads <code className="mono">SETUP.md</code>, runs the interview, and lands files atomically.
        </p>

        {/* Subtotal */}
        <div className="card pad" style={{ marginBottom: 16, background: "var(--paper-sunken)" }}>
          <div className="tag" style={{ marginBottom: 10 }}>Manifest summary</div>
          <div className="subtotal-grid">
            <SubRow k="Mode" v={mode} />
            <SubRow k="Bundle" v={bundle.key} />
            <SubRow k="Posture" v={bundle.posture} />
            <SubRow k="Toggles ON" v={onCount} />
            <SubRow k="Toggles ASK" v={askCount} />
            <SubRow k="Diverged from defaults" v={changes} accent={changes > 0} />
            <SubRow k="Files in bundle" v={fileCount} />
            <SubRow k="Bundle size" v={bundleSize} />
          </div>
          <style>{`
            .subtotal-grid {
              display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
            }
            @media (max-width: 720px) { .subtotal-grid { grid-template-columns: 1fr 1fr; } }
          `}</style>
        </div>

        <div className="bind-paths">
          {/* ── A · DOWNLOAD ─────────────────────────────────────────── */}
          <div className="bind-card fast">
            <div className="bind-card-head">
              <div className="bind-card-head-text">
                <div className="bind-tag">
                  <span className="bind-step-pip">A</span> STEP 1 · DOWNLOAD &amp; UNZIP
                </div>
                <div className="bind-title">Bind volume &amp; download.</div>
                <div className="bind-sub">
                  {fileCount} files · ~{bundleSize} · assembled by JSZip in this tab. Unzip at your project root so the folder lands as <code className="mono inline-code">claude-code-templates/</code> next to your <code className="mono inline-code">.git</code>.
                </div>
              </div>
              <button className="btn accent lg" onClick={bindAndDownload}>
                <span>Bind &amp; download</span>
                <span aria-hidden>↓</span>
              </button>
            </div>
            <div className="bind-filename mono">
              claude-code-templates-{bundleId}-{buildManifest().version}.zip
            </div>
            <div className="bind-preview-label tag">Archive contents</div>
            <pre className="bind-preview mono fast">{buildZipManifestPreview(buildManifest(), fileCount)}</pre>
          </div>

          {/* Sequential arrow connector */}
          <div className="bind-then" aria-hidden>
            <span className="bind-then-line"></span>
            <span className="bind-then-label mono">THEN</span>
            <span className="bind-then-line"></span>
          </div>

          {/* ── B · PASTE ────────────────────────────────────────────── */}
          <div className="bind-card careful">
            <div className="bind-card-head">
              <div className="bind-card-head-text">
                <div className="bind-tag dim">
                  <span className="bind-step-pip dim-pip">B</span> STEP 2 · PASTE IN CLAUDE
                </div>
                <div className="bind-title">Copy command, paste to Claude.</div>
                <div className="bind-sub dim">
                  Open Claude Code in your project root (where you unzipped in step&nbsp;1) and paste this as your first message. Claude reads <code className="mono inline-code">SETUP.md</code>, runs a short interview, proposes the plan, and waits for your <code className="mono inline-code">apply</code>.
                </div>
              </div>
              <button className="btn lg" onClick={copyConfigToClipboard}>
                <span>Copy to clipboard</span>
                <span aria-hidden>⧉</span>
              </button>
            </div>
            <div className="bind-preview-label tag">What gets pasted · ~{estimateTokens(buildPasteText(buildManifest(), bundleId))} tokens</div>
            <pre className="bind-preview mono careful">{buildPasteText(buildManifest(), bundleId)}</pre>
          </div>
        </div>
        <style>{`
          .bind-intro {
            font-size: 14px; line-height: 1.55;
            margin: 0 0 18px;
            max-width: 760px;
          }
          .bind-intro strong { color: var(--accent); }
          .bind-paths {
            display: flex; flex-direction: column; gap: 4px;
          }
          .bind-then {
            display: flex; align-items: center; gap: 12px;
            margin: 6px 0;
            padding: 4px 8px;
          }
          .bind-then-line {
            flex: 1; height: 1px;
            background: linear-gradient(to right, transparent, var(--rule), transparent);
          }
          .bind-then-label {
            font-size: 10px;
            letter-spacing: 1.5px;
            color: var(--ink-faint);
            padding: 2px 10px;
            border: 1px solid var(--rule);
            border-radius: 999px;
          }
          .bind-step-pip {
            display: inline-flex;
            align-items: center; justify-content: center;
            width: 20px; height: 20px;
            border-radius: 5px;
            font-family: var(--f-mono);
            font-size: 11px;
            font-weight: 600;
            margin-right: 8px;
            background: var(--accent);
            color: var(--accent-ink);
            vertical-align: middle;
          }
          .bind-step-pip.dim-pip {
            background: var(--paper-sunken);
            color: var(--ink-soft);
            border: 1px solid var(--rule);
          }
          .bind-paths { min-width: 0; }
          .bind-card {
            border-radius: var(--r-lg);
            padding: 22px 22px 22px;
            display: flex; flex-direction: column; gap: 12px;
            box-shadow: var(--shadow-card);
            min-width: 0;
          }
          .bind-card.fast {
            background: var(--paper-card); color: var(--ink);
            border: 1.5px solid var(--accent);
          }
          .bind-card.careful {
            background: var(--paper-card); border: 1px solid var(--rule);
          }
          .bind-card-head {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 20px;
            align-items: flex-end;
          }
          .bind-card-head-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
          .bind-card-head .btn { white-space: nowrap; }
          @media (max-width: 720px) {
            .bind-card-head { grid-template-columns: 1fr; align-items: stretch; }
            .bind-card-head .btn { justify-content: center; }
          }
          .bind-tag {
            font-family: var(--f-mono);
            font-size: 10.5px;
            letter-spacing: 0.8px;
            color: var(--ink-soft);
          }
          .bind-title {
            font-family: var(--f-display);
            font-size: 26px;
            font-weight: 500;
            letter-spacing: -0.4px;
            line-height: 1.05;
          }
          .bind-sub { font-size: 13.5px; opacity: 0.85; line-height: 1.5; max-width: 540px; color: var(--ink-soft); }
          .bind-filename {
            font-size: 11.5px; padding: 8px 12px;
            border-radius: var(--r-sm);
            background: var(--paper-sunken);
            border: 1px dashed var(--rule-strong);
            align-self: flex-start;
            color: var(--ink-soft);
          }
          .bind-preview-label {
            margin-top: 4px;
            color: var(--ink-soft);
          }
          .bind-preview {
            margin: 0;
            padding: 14px 16px;
            border-radius: var(--r-md);
            font-size: 11.5px;
            line-height: 1.55;
            overflow-x: auto;
            white-space: pre;
            tab-size: 2;
          }
          .bind-preview.fast,
          .bind-preview.careful {
            background: var(--paper-sunken);
            border: 1px solid var(--rule);
            color: var(--ink);
          }
          .bind-preview::-webkit-scrollbar { width: 10px; height: 10px; }
          .bind-preview::-webkit-scrollbar-thumb {
            background: var(--rule-strong); border-radius: 5px;
            border: 2px solid transparent; background-clip: padding-box;
          }
          .bind-card .btn { margin-top: 0; }
        `}</style>
      </section>

      {/* ── AFTER BIND ─ critical + cleanup callouts ─────────────────── */}
      <CriticalCallout />
      <CleanupCallout />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ────────────────────────────────────────────────────────────────────────

function StepHead({ step, title, annot }) {
  return (
    <div className="step-head">
      <span className="step-tag mono">STEP·{step}</span>
      <span className="step-title">{title}</span>
      {annot && <span className="step-annot">{annot}</span>}
    </div>
  );
}

function StepStrip({ steps, onClick }) {
  return (
    <nav className="step-strip" aria-label="Step jumper">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          {i > 0 && <span className="ss-sep" aria-hidden>·</span>}
          <button className="ss-step" onClick={() => onClick(s.id)}>
            <span className="ss-n mono">{s.n}</span>
            <span className="ss-t">{s.title}</span>
            {s.badge && <span className="ss-badge mono">{s.badge}</span>}
          </button>
        </React.Fragment>
      ))}
      <style>{`
        .step-strip {
          display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
          padding: 12px 14px;
          margin-bottom: 22px;
          border: 1px solid var(--rule);
          background: var(--paper-card);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-card);
        }
        .ss-step {
          background: transparent; border: none;
          display: flex; align-items: center; gap: 6px;
          padding: 4px 8px; border-radius: var(--r-sm);
          transition: background var(--dur) var(--ease);
        }
        .ss-step:hover { background: var(--paper-sunken); }
        .ss-n { font-size: 11px; color: var(--accent); font-weight: 500; }
        .ss-t { font-size: 13px; }
        .ss-sep { color: var(--ink-faint); padding: 0 2px; }
        .ss-badge {
          font-size: 10px; padding: 1px 5px; border-radius: 999px;
          background: var(--accent-soft); color: var(--accent);
          margin-left: 2px;
        }
      `}</style>
    </nav>
  );
}

function ModeCard({ tag, label, sub, selected, onClick, bullets }) {
  return (
    <button onClick={onClick} className={"mode-card" + (selected ? " on" : "")}>
      <div className="mc-row1">
        <span className="mc-tag mono">{tag}</span>
        {selected && <span className="mc-sel mono">◤ SELECTED</span>}
      </div>
      <div className="mc-label">{label}</div>
      <div className="mc-sub">{sub}</div>
      <ul className="mc-bullets">
        {bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
      <style>{`
        .mode-card {
          text-align: left;
          background: var(--paper-card);
          color: var(--ink);
          border: 1px solid var(--rule);
          border-radius: var(--r-lg);
          padding: 18px 20px 20px;
          transition: all var(--dur) var(--ease);
          display: flex; flex-direction: column; gap: 8px;
        }
        .mode-card:hover { border-color: var(--rule-strong); transform: translateY(-1px); }
        .mode-card.on {
          border-color: var(--accent);
          box-shadow: 0 0 0 4px var(--accent-soft), var(--shadow-card);
        }
        .mc-row1 { display: flex; justify-content: space-between; align-items: center; }
        .mc-tag { font-size: 10.5px; letter-spacing: 0.6px; color: var(--ink-soft); }
        .mc-sel { font-size: 10.5px; color: var(--accent); letter-spacing: 0.6px; }
        .mc-label { font-family: var(--f-display); font-size: 26px; font-weight: 500; letter-spacing: -0.4px; }
        .mc-sub { font-size: 13.5px; opacity: 0.78; }
        .mc-bullets { margin: 8px 0 0; padding-left: 16px; font-size: 12.5px; opacity: 0.72; line-height: 1.55; }
        .mc-bullets li { padding: 2px 0; }
      `}</style>
    </button>
  );
}

function BundleCard({ b, selected, onClick }) {
  return (
    <button onClick={onClick} className={"bundle-card" + (selected ? " on" : "")}>
      <div className="bc-row1">
        <span className="bc-n mono">№ {b.n}</span>
        {selected && <span className="bc-sel mono">◤ SELECTED</span>}
      </div>
      <div className="bc-title">{b.key}</div>
      <div className="bc-who dim">{b.who}</div>
      <div className="bc-blurb">{b.blurb}</div>
      <div className="bc-meta">
        <span className="pill">{b.posture}</span>
      </div>
      <style>{`
        .bundle-card {
          text-align: left;
          background: var(--paper-card);
          border: 1px solid var(--rule);
          border-radius: var(--r-lg);
          padding: 16px 18px 18px;
          transition: all var(--dur) var(--ease);
          display: flex; flex-direction: column; gap: 6px;
          color: var(--ink);
          position: relative;
          box-shadow: var(--shadow-card);
        }
        .bundle-card:hover { border-color: var(--rule-strong); transform: translateY(-1px); }
        .bundle-card.on {
          border-color: var(--accent);
          box-shadow: 0 0 0 4px var(--accent-soft), var(--shadow-card);
        }
        .bc-row1 { display: flex; justify-content: space-between; }
        .bc-n { font-size: 10.5px; color: var(--ink-faint); letter-spacing: 0.6px; }
        .bc-sel { font-size: 10.5px; color: var(--accent); letter-spacing: 0.6px; }
        .bc-title { font-family: var(--f-display); font-size: 17px; font-weight: 500; line-height: 1.15; letter-spacing: -0.3px; margin-top: 4px; }
        .bc-who { font-size: 12px; }
        .bc-blurb { font-size: 12.5px; line-height: 1.45; color: var(--ink-soft); margin-top: 4px; }
        .bc-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
      `}</style>
    </button>
  );
}

function Field({ label, hint, full, children }) {
  return (
    <label className={"field" + (full ? " field-full" : "")}>
      <div className="field-label">
        <span>{label}</span>
      </div>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </label>
  );
}

function TriToggle({ state, onSet }) {
  // value codes: 0 OFF, 1 ON, 2 ASK. Each segment is a real button that sets
  // its specific value directly — not a single button that cycles state.
  return (
    <div className="tri" role="radiogroup">
      <button
        type="button"
        role="radio"
        aria-checked={state === 1}
        className={"tri-seg tri-seg-on" + (state === 1 ? " active" : "")}
        onClick={() => onSet(1)}
        aria-label="set to ON"
      >ON</button>
      <button
        type="button"
        role="radio"
        aria-checked={state === 0}
        className={"tri-seg tri-seg-off" + (state === 0 ? " active" : "")}
        onClick={() => onSet(0)}
        aria-label="set to OFF"
      >OFF</button>
      <button
        type="button"
        role="radio"
        aria-checked={state === 2}
        className={"tri-seg tri-seg-ask" + (state === 2 ? " active" : "")}
        onClick={() => onSet(2)}
        aria-label="set to ASK"
      >ASK</button>
      <style>{`
        .tri {
          display: inline-flex;
          gap: 4px;
          padding: 3px;
          background: var(--paper-sunken);
          border: 1px solid var(--rule);
          border-radius: var(--r-md);
          justify-self: start;
          align-self: start;
          max-width: 100%;
        }
        .tri-seg {
          background: transparent;
          border: none;
          padding: 5px 10px;
          font-family: var(--f-mono);
          font-size: 10.5px;
          letter-spacing: 0.6px;
          color: var(--ink-faint);
          border-radius: var(--r-sm);
          transition: all var(--dur) var(--ease);
          cursor: pointer;
          min-width: 38px;
        }
        .tri-seg:hover { color: var(--ink); background: var(--paper-card); }
        .tri-seg.active.tri-seg-on { background: var(--surface-ink); color: var(--surface-ink-fg); }
        .tri-seg.active.tri-seg-off { background: var(--paper-card); color: var(--ink); box-shadow: inset 0 0 0 1px var(--rule); }
        .tri-seg.active.tri-seg-ask { background: var(--accent); color: var(--accent-ink); }
      `}</style>
    </div>
  );
}

function DimLine({ label }) {
  return (
    <div className="dim-line" aria-hidden>
      <div className="end" />
      <div className="span" />
      <div className="label mono">{label}</div>
      <div className="span" />
      <div className="end" />
    </div>
  );
}

function SubRow({ k, v, accent }) {
  return (
    <div className="sub-row">
      <div className="tag" style={{ marginBottom: 4 }}>{k}</div>
      <div className="mono" style={{ fontSize: 16, color: accent ? "var(--accent)" : "var(--ink)" }}>{v}</div>
      <style>{`
        .sub-row { padding: 4px 0; }
      `}</style>
    </div>
  );
}

// ── New informational + quick-control cards ────────────────────────────

// Counts how many of the advanced fields the user has filled, for the
// disclosure summary label.
function advancedFilledCount(p) {
  const n = ["description", "dev_branch", "branching_model", "license_holder", "timezone", "code_language"]
    .filter(k => {
      if (k === "dev_branch") return p.branching_model === "gitflow" && p.dev_branch && p.dev_branch !== "develop";
      return p[k] && p[k] !== "trunk" && p[k] !== "English" && p[k] !== "main";
    }).length
    + (p.architecture?.length || 0)
    + (p.stack_commands?.length || 0);
  return n > 0 ? `${n} set` : "all optional · skip if unsure";
}

// ChipFlatPicker — flat row of pill chips for simple multi-select cases.
function ChipFlatPicker({ label, hint, catalog, selected, onToggle, customPlaceholder }) {
  const [custom, setCustom] = React.useState("");
  const onCustom = () => {
    const v = custom.trim();
    if (!v) return;
    if (!selected.includes(v)) onToggle(v);
    setCustom("");
  };
  const items = catalog.map(c => typeof c === "string" ? { label: c } : { label: c.label });
  const itemLabels = items.map(i => i.label);
  return (
    <div className="chip-pick">
      <div className="chip-pick-head">
        <div className="chip-pick-label">{label}</div>
        {hint && <div className="chip-pick-hint">{hint}</div>}
      </div>
      <div className="chip-row">
        {items.map(({ label: name }) => (
          <button key={name} type="button"
            className={"chip" + (selected.includes(name) ? " on" : "")}
            onClick={() => onToggle(name)}>{name}</button>
        ))}
        {selected.filter(s => !itemLabels.includes(s)).map(item => (
          <button key={item} type="button"
            className="chip on chip-custom"
            onClick={() => onToggle(item)}>
            {item} <span className="chip-x" aria-hidden>×</span>
          </button>
        ))}
      </div>
      <div className="chip-custom-row">
        <input className="input" placeholder={customPlaceholder}
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onCustom(); } }} />
        <button type="button" className="btn ghost chip-add-btn" onClick={onCustom}>+ Add</button>
      </div>
      <style>{`
        .chip-pick { display: flex; flex-direction: column; gap: 10px; }
        .chip-pick-label { font-family: var(--f-mono); font-size: 10.5px; letter-spacing: 0.5px; color: var(--ink-soft); text-transform: uppercase; }
        .chip-pick-hint { font-size: 12px; color: var(--ink-faint); line-height: 1.5; }
        .chip-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--r-md); min-height: 50px; }
        .chip { display: inline-flex; align-items: center; padding: 5px 11px; border-radius: 999px; background: var(--paper-card); border: 1px solid var(--rule); color: var(--ink-soft); font-size: 12px; cursor: pointer; transition: all var(--dur) var(--ease); user-select: none; line-height: 1.3; font-family: inherit; }
        .chip:hover { border-color: var(--accent); color: var(--ink); }
        .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
        .chip-custom { border-style: dashed; border-color: var(--accent); }
        .chip-x { margin-left: 6px; opacity: 0.85; font-weight: 600; }
        .chip-custom-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
        .chip-add-btn { padding: 8px 14px; font-size: 12.5px; }
      `}</style>
    </div>
  );
}

// useCarouselScroll — wires a scrollable strip to prev/next buttons,
// scroll-snap behaviour, and exposes the visible cards.
function useCarouselScroll(deps = []) {
  const ref = React.useRef(null);
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(true);
  const update = React.useCallback(() => {
    const el = ref.current; if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);
  React.useEffect(() => {
    update();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const scroll = (delta) => {
    const el = ref.current; if (!el) return;
    // Scroll by ~80% of the visible width so the user sees a fresh batch
    // each click but keeps one anchor card overlapping for orientation.
    el.scrollBy({ left: delta * el.clientWidth * 0.8, behavior: "smooth" });
  };
  return { ref, canPrev, canNext, prev: () => scroll(-1), next: () => scroll(1), onScroll: update };
}

// PatternCarousel — Material-style hero carousel of pattern cards. Multiple
// cards visible at once; horizontal scroll-snap; prev/next arrows nudge by
// one card-width. Each card is fully readable, selectable, and persistent —
// selecting a card keeps it where it is.
function PatternCarousel({ label, hint, catalog, selected, onToggle, customPlaceholder }) {
  const [custom, setCustom] = React.useState("");
  const items = catalog.map(c => typeof c === "string" ? { label: c, desc: null } : { label: c.label, desc: c.desc });
  const itemLabels = items.map(i => i.label);
  const customItems = selected.filter(s => !itemLabels.includes(s)).map(s => ({
    label: s,
    desc: "Custom pattern — Claude researches this via web during setup before generating its section in .claude/rules/architecture.md.",
    isCustom: true,
  }));
  const slides = [...items, ...customItems];
  const onAdd = () => {
    const v = custom.trim();
    if (!v) return;
    if (!selected.includes(v)) onToggle(v);
    setCustom("");
  };
  const car = useCarouselScroll([slides.length]);

  return (
    <div className="chip-pick">
      <div className="chip-pick-head">
        <div className="chip-pick-label">
          {label} <span className="chip-count mono">{selected.length} selected</span>
        </div>
        {hint && <div className="chip-pick-hint">{hint}</div>}
      </div>

      <div className="hcar-wrap">
        <button type="button"
          className={"hcar-arrow hcar-arrow-prev" + (car.canPrev ? "" : " disabled")}
          onClick={car.prev}
          aria-label="scroll patterns left"
          disabled={!car.canPrev}>
          <span aria-hidden>‹</span>
        </button>
        <div className="hcar-strip patt-strip" ref={car.ref} onScroll={car.onScroll}>
          {slides.map(s => {
            const on = selected.includes(s.label);
            return (
              <button key={s.label} type="button"
                className={"patt-card" + (on ? " on" : "") + (s.isCustom ? " patt-custom" : "")}
                onClick={() => onToggle(s.label)}>
                <div className="patt-row1">
                  <span className="patt-tick" aria-hidden>{on ? "✓" : "+"}</span>
                  <span className="patt-name">{s.label}</span>
                  {s.isCustom && <span className="patt-tag mono">custom</span>}
                </div>
                {s.desc && <div className="patt-desc">{s.desc}</div>}
                <div className="patt-state mono">{on ? "SELECTED" : "TAP TO SELECT"}</div>
              </button>
            );
          })}
        </div>
        <button type="button"
          className={"hcar-arrow hcar-arrow-next" + (car.canNext ? "" : " disabled")}
          onClick={car.next}
          aria-label="scroll patterns right"
          disabled={!car.canNext}>
          <span aria-hidden>›</span>
        </button>
      </div>

      <div className="chip-custom-row">
        <input className="input" placeholder={customPlaceholder}
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }} />
        <button type="button" className="btn ghost chip-add-btn" onClick={onAdd}>+ Add</button>
      </div>

      <style>{`
        .chip-pick { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .chip-pick-label { font-family: var(--f-mono); font-size: 10.5px; letter-spacing: 0.5px; color: var(--ink-soft); text-transform: uppercase; }
        .chip-count { color: var(--accent); margin-left: 6px; text-transform: none; letter-spacing: 0.3px; }
        .chip-pick-hint { font-size: 12px; color: var(--ink-faint); line-height: 1.5; }

        .hcar-wrap { position: relative; min-width: 0; }
        .hcar-strip {
          display: flex; gap: 12px;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          scroll-behavior: smooth;
          scroll-padding-left: 4px;
          padding: 4px 4px 16px;
          -webkit-overflow-scrolling: touch;
        }
        .hcar-strip::-webkit-scrollbar { height: 8px; }
        .hcar-strip::-webkit-scrollbar-track { background: var(--paper); border-radius: 4px; }
        .hcar-strip::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 4px; }
        .hcar-strip::-webkit-scrollbar-thumb:hover { background: var(--rule-strong); }

        .hcar-arrow {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          z-index: 3;
          background: var(--paper-card);
          border: 1px solid var(--rule);
          box-shadow: var(--shadow-card);
          width: 34px; height: 34px;
          border-radius: 50%;
          color: var(--ink-soft);
          font-size: 18px; line-height: 1;
          cursor: pointer;
          transition: all var(--dur) var(--ease);
          display: inline-flex; align-items: center; justify-content: center;
          font-family: inherit;
        }
        .hcar-arrow-prev { left: -8px; }
        .hcar-arrow-next { right: -8px; }
        .hcar-arrow:hover { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
        .hcar-arrow.disabled { opacity: 0; pointer-events: none; transition: opacity var(--dur) var(--ease); }
        @media (max-width: 640px) {
          .hcar-arrow { display: none; }
          .hcar-strip { scroll-padding-left: 0; }
        }

        .patt-strip .patt-card {
          flex: 0 0 280px;
          scroll-snap-align: start;
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: var(--r-lg);
          padding: 14px 16px;
          text-align: left;
          cursor: pointer;
          transition: all var(--dur) var(--ease);
          display: flex; flex-direction: column; gap: 8px;
          color: var(--ink);
          font-family: inherit;
          min-height: 180px;
          position: relative;
        }
        .patt-card:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: var(--shadow-card); }
        .patt-card.on {
          border-color: var(--accent);
          background: var(--accent-tint);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .patt-row1 { display: flex; align-items: center; gap: 8px; }
        .patt-tick {
          width: 22px; height: 22px; flex-shrink: 0;
          border-radius: 5px;
          font-family: var(--f-mono); font-size: 13px;
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--paper-sunken); color: var(--ink-faint);
          font-weight: 600;
          transition: all var(--dur) var(--ease);
        }
        .patt-card.on .patt-tick { background: var(--accent); color: var(--accent-ink); }
        .patt-name {
          font-family: var(--f-display);
          font-size: 16px; font-weight: 500;
          letter-spacing: -0.2px;
          line-height: 1.2;
          flex: 1;
        }
        .patt-tag {
          font-size: 9.5px; letter-spacing: 0.5px;
          padding: 2px 7px; border-radius: var(--r-sm);
          background: var(--accent-soft); color: var(--accent);
          text-transform: uppercase;
        }
        .patt-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; flex: 1; }
        .patt-state {
          font-size: 9.5px;
          color: var(--ink-faint);
          letter-spacing: 0.8px;
          margin-top: auto;
        }
        .patt-card.on .patt-state { color: var(--accent); font-weight: 600; }
        .patt-custom { border-style: dashed; }
        .chip-custom-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
        .chip-add-btn { padding: 8px 14px; font-size: 12.5px; }
      `}</style>
    </div>
  );
}

// CardCarousel — Material-style strip of category cards. Multiple categories
// visible at once; each card is a self-contained mini-picker with its options
// as click-to-toggle rows. Horizontal scroll-snap aligns by card.
function CardCarousel({ label, hint, catalog, selected, onToggle, customPlaceholder }) {
  const [custom, setCustom] = React.useState("");
  const groups = Object.entries(catalog);
  const onCustom = () => {
    const v = custom.trim();
    if (!v) return;
    if (!selected.includes(v)) onToggle(v);
    setCustom("");
  };
  const allItems = Object.values(catalog).flat();
  const car = useCarouselScroll([groups.length]);

  return (
    <div className="chip-pick">
      <div className="chip-pick-head">
        <div className="chip-pick-label">
          {label} <span className="chip-count mono">{selected.length} selected</span>
        </div>
        {hint && <div className="chip-pick-hint">{hint}</div>}
      </div>

      {selected.length > 0 && (
        <div className="chip-row chip-selected-row">
          {selected.map(item => (
            <button key={item} type="button"
              className={"chip on" + (allItems.includes(item) ? "" : " chip-custom")}
              onClick={() => onToggle(item)}>
              {item} <span className="chip-x" aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}

      <div className="hcar-wrap">
        <button type="button"
          className={"hcar-arrow hcar-arrow-prev" + (car.canPrev ? "" : " disabled")}
          onClick={car.prev}
          aria-label="scroll categories left"
          disabled={!car.canPrev}>
          <span aria-hidden>‹</span>
        </button>
        <div className="hcar-strip ccar-strip" ref={car.ref} onScroll={car.onScroll}>
          {groups.map(([group, items]) => {
            const onCount = items.filter(i => selected.includes(i)).length;
            return (
              <div key={group} className={"ccar-card" + (onCount > 0 ? " has-on" : "")}>
                <div className="ccar-card-head">
                  <div className="ccar-card-name">{group}</div>
                  <div className="ccar-card-meta mono">
                    {items.length}
                    {onCount > 0 && <span style={{ color: "var(--accent)" }}> · {onCount}✓</span>}
                  </div>
                </div>
                <div className="ccar-card-body">
                  {items.map(item => {
                    const on = selected.includes(item);
                    return (
                      <button key={item} type="button"
                        className={"chip" + (on ? " on" : "")}
                        onClick={() => onToggle(item)}>{item}</button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <button type="button"
          className={"hcar-arrow hcar-arrow-next" + (car.canNext ? "" : " disabled")}
          onClick={car.next}
          aria-label="scroll categories right"
          disabled={!car.canNext}>
          <span aria-hidden>›</span>
        </button>
      </div>

      <div className="chip-custom-row">
        <input className="input" placeholder={customPlaceholder}
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onCustom(); } }} />
        <button type="button" className="btn ghost chip-add-btn" onClick={onCustom}>+ Add</button>
      </div>

      <style>{`
        .chip-pick { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .chip-pick-label { font-family: var(--f-mono); font-size: 10.5px; letter-spacing: 0.5px; color: var(--ink-soft); text-transform: uppercase; }
        .chip-count { color: var(--accent); margin-left: 6px; text-transform: none; letter-spacing: 0.3px; }
        .chip-pick-hint { font-size: 12px; color: var(--ink-faint); line-height: 1.5; }
        .chip-selected-row {
          background: var(--paper-tint); border-color: var(--accent-soft);
          display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px;
          border: 1px solid var(--accent-soft); border-radius: var(--r-md);
          min-height: 50px;
        }
        .chip-selected-row .chip {
          display: inline-flex; align-items: center;
          padding: 5px 11px; border-radius: 999px;
          background: var(--accent); border: 1px solid var(--accent);
          color: var(--accent-ink); font-size: 12px;
          cursor: pointer; line-height: 1.3; font-family: inherit;
        }
        .chip-selected-row .chip-custom { background: transparent; color: var(--accent); border-style: dashed; }
        .chip-x { margin-left: 6px; opacity: 0.85; font-weight: 600; }

        .ccar-strip .ccar-card {
          flex: 0 0 320px;
          scroll-snap-align: start;
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: var(--r-lg);
          padding: 12px;
          display: flex; flex-direction: column; gap: 10px;
          transition: border-color var(--dur) var(--ease);
        }
        @media (max-width: 640px) {
          .ccar-strip .ccar-card { flex: 0 0 calc(100% - 8px); }
          .patt-strip .patt-card { flex: 0 0 calc(100% - 8px); min-height: auto; }
        }
        .ccar-card.has-on { border-color: var(--accent-soft); }
        .ccar-card-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 8px;
          padding: 4px 4px 6px;
          border-bottom: 1px solid var(--rule-soft);
        }
        .ccar-card-name {
          font-family: var(--f-display);
          font-size: 14px; font-weight: 500;
          letter-spacing: -0.2px;
        }
        .ccar-card-meta { font-size: 10.5px; color: var(--ink-faint); letter-spacing: 0.3px; }
        .ccar-card-body {
          display: flex; flex-wrap: wrap; gap: 6px;
          max-height: 320px;
          overflow-y: auto;
          padding: 8px 4px;
          align-content: flex-start;
        }
        .ccar-card-body::-webkit-scrollbar { width: 6px; }
        .ccar-card-body::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 3px; }
        .ccar-card-body .chip {
          display: inline-flex; align-items: center;
          padding: 5px 11px; border-radius: 999px;
          background: var(--paper-card); border: 1px solid var(--rule);
          color: var(--ink-soft); font-size: 12px;
          cursor: pointer; transition: all var(--dur) var(--ease);
          user-select: none; line-height: 1.3; font-family: inherit;
        }
        .ccar-card-body .chip:hover { border-color: var(--accent); color: var(--ink); }
        .ccar-card-body .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
        .chip-custom-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
        .chip-add-btn { padding: 8px 14px; font-size: 12.5px; }
      `}</style>
    </div>
  );
}

function DiscoverySummary() {
  return (
    <section className="step disc-step">
      <div className="card pad disc-card">
        <div className="disc-row1">
          <span className="tag accent-tag">DISCOVERY · WHAT CLAUDE FIGURES OUT</span>
          <span className="display disc-title">Project &amp; toggles, inferred.</span>
        </div>
        <p className="disc-lead">
          In Discovery you commit to <strong>mode</strong>, <strong>bundle</strong>, and optionally <strong>tools</strong> here.
          Claude reads the repo and proposes the rest. You confirm before any file lands.
        </p>
        <ul className="disc-list">
          <li><span className="disc-tick" aria-hidden>✓</span>
            <span>Reads <code className="mono">package.json</code>, <code className="mono">pyproject.toml</code>, <code className="mono">Cargo.toml</code>, <code className="mono">pubspec.yaml</code>, <code className="mono">CMakeLists.txt</code>, file tree, README, LICENSE, <code className="mono">.git/config</code>, existing rules.</span></li>
          <li><span className="disc-tick" aria-hidden>✓</span>
            <span>Detects: language, framework, stack chips, architecture pattern, license, branches, bundle-relevant signals.</span></li>
          <li><span className="disc-tick" aria-hidden>✓</span>
            <span>Infers toggle states from bundle defaults + project signals (e.g. <code className="mono">visual_test_discipline</code> ON if a frontend chip is detected).</span></li>
          <li><span className="disc-tick" aria-hidden>✓</span>
            <span>Asks 0–3 questions for genuinely-not-in-code items (timezone, license holder, anything ambiguous).</span></li>
          <li><span className="disc-tick" aria-hidden>✓</span>
            <span>Proposes the plan with an <strong>evidence footnote on every inferred value</strong> before writing anything.</span></li>
        </ul>
        <p className="disc-foot">
          <strong>Tokensave makes the audit ~5× cheaper.</strong>{" "}
          <a href="https://github.com/aovestdipaperino/tokensave" target="_blank" rel="noreferrer">github.com/aovestdipaperino/tokensave</a>.
          Without it Claude falls back to <code className="mono">Glob + Read</code> — same outcome, more tokens.
        </p>
      </div>
      <style>{`
        .disc-step { padding-top: 8px; padding-bottom: 8px; border-top: none; }
        .disc-card {
          background: var(--paper-tint);
          border-color: var(--accent-soft);
          padding: 22px 24px 22px;
        }
        .disc-row1 {
          display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap;
          margin-bottom: 8px;
        }
        .accent-tag {
          color: var(--accent);
          background: var(--accent-soft);
          padding: 3px 8px;
          border-radius: var(--r-sm);
          letter-spacing: 0.7px;
        }
        .disc-title {
          font-size: 22px;
          font-weight: 500;
          letter-spacing: -0.4px;
        }
        .disc-lead { font-size: 14.5px; line-height: 1.55; color: var(--ink); margin: 4px 0 12px; max-width: 720px; }
        .disc-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex; flex-direction: column; gap: 8px;
        }
        .disc-list li {
          display: grid; grid-template-columns: 22px 1fr; gap: 8px;
          font-size: 13.5px; line-height: 1.55; color: var(--ink);
        }
        .disc-tick {
          color: var(--accent);
          font-weight: 600;
        }
        .disc-foot { margin: 14px 0 0; font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; }
      `}</style>
    </section>
  );
}

function QuickOptions({ codeResearchTool, tokensave, contextRefresh, onTokensave, onContextRefresh }) {
  // Tri-state respected: button row mirrors current toggle value.
  // The tokensave/code-research row is suppressed when "none" is selected.
  const showCodeResearchRow = !!codeResearchTool && codeResearchTool.name !== "none";
  const isTokensave = codeResearchTool && codeResearchTool.name === "tokensave";
  const toolName = codeResearchTool?.name || "tokensave";
  return (
    <section className="step quick-step">
      <div className="step-head">
        <span className="step-tag mono">QUICK</span>
        <span className="step-title">Quick options</span>
        <span className="step-annot">THE TWO MOST-TOUCHED</span>
      </div>
      <div className="quick-grid">
        {showCodeResearchRow && (
          <QuickRow
            k="tokensave_entry_point"
            title={isTokensave ? "I have tokensave installed" : `I have ${toolName} configured`}
            desc={
              isTokensave ? (
                <>Free, open-source code-graph MCP that indexes your codebase so Claude can ask "where is X / what calls Y" without reading whole files. Saves tokens. Runs locally — nothing leaves your machine. Source: <a href="https://github.com/aovestdipaperino/tokensave" target="_blank" rel="noreferrer">github.com/aovestdipaperino/tokensave</a>.</>
              ) : codeResearchTool.desc ? (
                <>
                  {codeResearchTool.desc}
                  {codeResearchTool.url && (
                    <>{" "}Project: <a href={codeResearchTool.url} target="_blank" rel="noreferrer">{codeResearchTool.url.replace(/^https?:\/\//, "")}</a>.</>
                  )}
                </>
              ) : (
                <>Custom code-research tool. Claude will reference <code className="mono">{toolName}</code> in the rules and skills it lands.</>
              )
            }
            hint={`Leave OFF if ${toolName} isn't configured for this project — Claude falls back to grep / file reads.`}
            value={tokensave}
            onSet={onTokensave}
          />
        )}
        <QuickRow
          k="context_refresh_files"
          title="Keep session-context-refresh files"
          desc={<>Claude regenerates a <code className="mono">PROJECT-CONTEXT_YYYY-MM-DD.md</code> at the end of each session, summarising the current state. Helpful for picking up where you left off.</>}
          hint="Turn OFF if you find them noisy or don't want context files committed."
          value={contextRefresh}
          onSet={onContextRefresh}
        />
      </div>
      <style>{`
        .quick-step { padding-top: 24px; }
        .quick-grid {
          display: grid; grid-template-columns: 1fr; gap: 12px;
        }
      `}</style>
    </section>
  );
}

function QuickRow({ k, title, desc, hint, value, onSet }) {
  return (
    <div className="quick-row">
      <div className="quick-body">
        <div className="mono quick-key">{k}</div>
        <div className="quick-title">{title}</div>
        <div className="quick-desc">{desc}</div>
        <div className="quick-hint">{hint}</div>
      </div>
      <TriToggle state={value} onSet={onSet} />
      <style>{`
        .quick-row {
          background: var(--paper-card);
          border: 1px solid var(--rule);
          border-radius: var(--r-lg);
          box-shadow: var(--shadow-card);
          padding: 16px 18px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 18px;
          align-items: start;
        }
        .quick-key { font-size: 11px; color: var(--ink-faint); letter-spacing: 0.4px; }
        .quick-title { font-family: var(--f-display); font-size: 17px; font-weight: 500; letter-spacing: -0.25px; margin-top: 2px; }
        .quick-desc { font-size: 13.5px; color: var(--ink-soft); margin-top: 4px; line-height: 1.55; }
        .quick-desc a { color: var(--accent); }
        .quick-hint { font-size: 12px; color: var(--ink-faint); margin-top: 6px; }
        @media (max-width: 640px) { .quick-row { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

function CriticalCallout() {
  return (
    <section className="step callout-step">
      <div className="callout callout-warn">
        <div className="callout-head">
          <span className="callout-mark" aria-hidden>⚠</span>
          <span className="callout-title">Critical — after Claude finishes</span>
        </div>
        <p>
          The current Claude Code session <strong>does not have access</strong> to the new rules, skills, or
          {" "}<code className="mono">CLAUDE.md</code> that just got installed. <strong>Close this session and start a fresh one</strong> before continuing,
          otherwise Claude won't follow the rules you just configured.
        </p>
        <ol className="callout-ol">
          <li>In the Claude Code session, type <code className="mono">/exit</code> and press Enter.</li>
          <li>Re-open Claude Code in the same project root — run <code className="mono">claude</code> from your terminal.</li>
          <li>The new rules + skills + <code className="mono">CLAUDE.md</code> auto-load on session start. Verify by asking Claude <em>"what's my session-start ritual?"</em></li>
        </ol>
        <p className="callout-foot">
          Why: Claude reads <code className="mono">CLAUDE.md</code> and <code className="mono">.claude/rules/</code> at session start. Files added mid-session aren't auto-loaded.
        </p>
      </div>
    </section>
  );
}

function CleanupCallout() {
  return (
    <section className="step callout-step">
      <div className="callout">
        <div className="callout-head">
          <span className="callout-mark" aria-hidden>↺</span>
          <span className="callout-title">After Claude applies — cleanup choice</span>
        </div>
        <p>
          Once the atomic commit lands, Claude asks (via <code className="mono">AskUserQuestion</code>) what to do with the {" "}
          <code className="mono">claude-code-templates/</code> folder. Three options:
        </p>
        <div className="cleanup-grid">
          <div className="cleanup-opt cleanup-recommended">
            <div className="cleanup-head">
              <span className="cleanup-letter">A</span>
              <span className="cleanup-name">Keep + gitignore</span>
              <span className="pill green">recommended</span>
            </div>
            <p>Folder stays on disk so you can re-run setup with different toggles later. Added to <code className="mono">.gitignore</code> so the repo stays clean.</p>
          </div>
          <div className="cleanup-opt">
            <div className="cleanup-head">
              <span className="cleanup-letter">B</span>
              <span className="cleanup-name">Delete</span>
            </div>
            <p>Folder removed. Cleanest state. Re-unzip if you ever want to re-run.</p>
          </div>
          <div className="cleanup-opt">
            <div className="cleanup-head">
              <span className="cleanup-letter">C</span>
              <span className="cleanup-name">Keep as-is</span>
            </div>
            <p>Folder stays, no <code className="mono">.gitignore</code> touch. Pick this only if you want to commit the templates folder so collaborators can re-run from inside the repo.</p>
          </div>
        </div>
        <p className="callout-foot">
          The plan file (<code className="mono">claude-code-setup-plan.html</code>) is always removed at this step — it's transient.
        </p>
      </div>
      <style>{`
        .callout-step { padding-top: 12px; padding-bottom: 12px; border-top: none; }
        .callout {
          background: var(--paper-card);
          border: 1px solid var(--rule);
          border-left: 3px solid var(--accent);
          border-radius: var(--r-lg);
          padding: 18px 22px 20px;
          box-shadow: var(--shadow-card);
        }
        .callout.callout-warn {
          border-left-color: var(--red);
          background: oklch(98% 0.025 25);
        }
        html[data-theme="dark"] .callout.callout-warn {
          background: oklch(22% 0.05 25);
        }
        .callout-head {
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 8px;
        }
        .callout-mark {
          font-size: 18px;
          color: var(--accent);
        }
        .callout.callout-warn .callout-mark { color: var(--red); }
        .callout-title {
          font-family: var(--f-display);
          font-size: 17px;
          font-weight: 500;
          letter-spacing: -0.25px;
        }
        .callout p { font-size: 13.5px; color: var(--ink); line-height: 1.6; margin: 6px 0 0; }
        .callout p code { font-size: 12px; }
        .callout-ol { margin: 8px 0 4px 18px; padding: 0; font-size: 13.5px; line-height: 1.6; color: var(--ink); }
        .callout-ol li { padding: 2px 0; }
        .callout-foot { font-size: 12px; color: var(--ink-soft); margin-top: 10px; }
        .cleanup-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
          margin-top: 14px;
        }
        @media (max-width: 720px) { .cleanup-grid { grid-template-columns: 1fr; } }
        .cleanup-opt {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: var(--r-md);
          padding: 12px 14px;
        }
        .cleanup-recommended {
          border-color: var(--accent);
          background: var(--paper-tint);
        }
        .cleanup-head {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 6px;
        }
        .cleanup-letter {
          font-family: var(--f-mono); font-size: 12px;
          width: 22px; height: 22px;
          border-radius: 5px;
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--surface-ink); color: var(--surface-ink-fg);
          font-weight: 500;
        }
        .cleanup-recommended .cleanup-letter { background: var(--accent); color: var(--accent-ink); }
        .cleanup-name {
          font-family: var(--f-display);
          font-size: 14px;
          font-weight: 500;
        }
        .cleanup-opt p { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; margin: 0; }
      `}</style>
    </section>
  );
}

// ── Utils ───────────────────────────────────────────────────────────────

function buildSetupMd(manifest, bundleId) {
  return `# SETUP.md — claude-code-templates ${manifest.version} orchestration prompt (FALLBACK)

> **This is the inline fallback stub.** The configurator tries to fetch the canonical
> \`SETUP.md\` from the GitHub Pages deployment at bundle time; if that fetch fails
> (file:// protocol, offline, CORS), you get this stub instead. The stub captures the
> same contract as the canonical but is intentionally concise. If you can,
> read the canonical at
> https://github.com/starfoxcom/claude-code-templates/blob/main/SETUP.md — it's
> the authoritative source and ships with worked examples.

## Phase 1 — Validate

1. Locate templates. They must be at \`./claude-code-templates/\`. If absent,
   abort with: "Run step 1 first: download + unzip the configurator output
   into the project root."
2. Parse \`./claude-code-templates/manifest.json\`. Required fields:
   \`bundle\`, \`project.name\`, \`project.repo_url\`, \`project.main_branch\`,
   \`project.dev_branch\`, \`toggles\`. Missing fields → run a short interview to fill them.
3. Cross-check every toggle key against the catalog. Unknown keys → reject.
4. Resolve \`ask\` toggles. For \`tokensave_entry_point\`, probe the chosen tool
   per its profile in \`_core/global-template/hooks/code-research-profiles.json\`
   (walk_up marker vs cli_available probe). Force \`false\` when
   \`tools.code_research === "none"\` (the profile has \`_skip_install: true\`).

## Phase 2 — Plan

Generate \`claude-code-setup-plan.html\` in the project root showing:

- Selected bundle and final toggle state (defaults + overrides + ask fills)
- Substituted placeholders (\`{{PROJECT_NAME}}\`, \`{{REPO_URL}}\`,
  \`{{MAIN_BRANCH}}\`, \`{{DEV_BRANCH}}\`,
  \`{{TOOLS_CODE_RESEARCH_NAME}}\`, \`{{TOOLS_CODE_RESEARCH_URL}}\`,
  \`{{TOOLS_CODE_RESEARCH_BYPASS_MARKER}}\`, \`{{TOOLS_CODE_RESEARCH_NAME_KEBAB}}\`)
- Per-toggle ON/OFF and what files/sections it affects
- Per-tool-slot value resolution: which \`:code_research:<value>\` blocks
  will be KEPT in each canonical template, which STRIPPED
- Every file that will be created, every section that will be stripped,
  every file that will be deleted
- The proposed commit message: \`chore(claude): bootstrap Claude Code setup\`

**Stop here.** Wait for the user to reply \`apply\` before writing anything.

## Phase 3 — Apply

1. Copy every file from \`./claude-code-templates/_core/project-template/\`
   into the project root, preserving the tree.
2. **First** resolve per-value toggle blocks (so unused tool branches are
   stripped before substitution wastes work on them):
   - For each \`<!-- TOGGLE:<slot>:<value> START/END -->\` block (slots:
     \`code_research\` / \`precommit\` / \`ci\` / \`ai_reviewer\` / \`issue_tracker\`):
     keep the block whose \`<value>\` matches \`manifest.tools.<slot>\`, strip
     all others entirely. "Other (specify)" UI choice resolves to \`:custom\`.
3. **Then** resolve boolean toggle markers:
   - ON: keep content, strip marker lines only.
   - OFF: remove block entirely (including marker lines).
   - \`:off\` inverse markers do the opposite.
4. **Then** substitute placeholders (UPPER_SNAKE_CASE only — doesn't collide
   with GitHub Actions \`\${{ ... }}\` expressions). Tool-slot placeholders
   (\`{{TOOLS_<SLOT>_NAME}}\`, \`_URL\`, \`_BYPASS_MARKER\`, \`_NAME_KEBAB\`)
   resolve from \`manifest.tools\` + the profile JSON.
5. After all resolution, collapse triple blank lines.
6. Render tools section (\`{{STACK_COMMANDS_ALLOWLIST}}\` etc.) from
   \`manifest.tools\` and \`manifest.project.stack_commands\`.
7. Merge global additions into \`~/.claude/CLAUDE.md\` if the memory or
   code-research toggles are ON. Ask before overwriting existing sections.
8. Initialize per-project memory at
   \`~/.claude/projects/<slug>/memory/MEMORY.md\` from the template.

## Phase 7a — Manage the code-research-first hook (GLOBAL)

This phase has TWO sub-phases that run independently:

- **Phase 7a-Cleanup (unconditional, runs first):** orphan-hook de-duplication
  + cleanup of stale \`*-first.py\` hook entries from prior binds with a
  different \`tools.code_research\` value. Runs whether the new bind installs a
  hook or not — so a switch from \`tokensave\` to \`none\` (or a
  decline-to-install) still cleans up the prior \`tokensave-first.py\`.
- **Phase 7a-Install (conditional, runs only if \`tokensave_entry_point\` is
  ON AND \`manifest.tools.code_research !== "none"\`):** render the template,
  write the new hook, register the matcher entry.

---

**Phase 7a-Cleanup (unconditional):** iterate
\`hooks.PreToolUse[*].hooks[*].command\` in \`~/.claude/settings.json\`
(atomic-write pattern: parse → mutate → write to \`.tmp\` → fsync →
\`os.replace\`). Before iterating, normalize the in-memory shape — \`{}\`,
\`{"hooks": null}\`, \`{"hooks": {"PreToolUse": null}}\` all coerce to the
canonical shape without clobbering sibling keys. Missing
\`~/.claude/settings.json\` is created with \`{"hooks": {"PreToolUse": []}}\`
(first-time-user case; no abort, no backup). For each command whose path ends
in \`-first.py\`:

- Compute the basename. Compare against the new bind's
  \`<filename_basename>.py\` — or against the sentinel \`None\` when there is
  no new hook to install (\`tokensave_entry_point: false\` OR
  \`tools.code_research === "none"\`), so every existing \`*-first.py\` is
  treated as orphan.
- If basename matches the new bind's target → leave alone (idempotent re-bind).
- If basename is a DIFFERENT \`*-first.py\` (or the new target is \`None\`) →
  ask the user before removing the array element AND \`os.unlink\`-ing the
  orphan file. Never leave two code-research-first hooks racing.
- **If the user declines orphan removal:** leave both file + entry intact, BUT
  surface a prominent ⚠️ warning in the bind summary naming the stale basename
  so the user can remove it manually later.

---

**Phase 7a-Install (conditional — only if \`tokensave_entry_point\` is ON AND
\`manifest.tools.code_research !== "none"\`):**

1. Read the profile for \`manifest.tools.code_research\` from
   \`_core/global-template/hooks/code-research-profiles.json\`.
2. For the \`custom\` profile (when user picked "Other"): resolve nested
   placeholders FIRST — compute \`NAME_KEBAB\` and \`NAME_UPPER_SNAKE\` from the
   user-supplied name (ASCII-sanitize, reject empty / digit-leading /
   over-40-chars / under-2-chars / collides-with-built-in-key, re-prompt on
   failure), substitute into the profile's values.
3. Substitute the profile's resolved values into
   \`_core/global-template/hooks/code-research-first.py.template\`. Use
   \`json.dumps()\` (or equivalent) when substituting \`{{TOOLS_CODE_RESEARCH_NAME}}\`
   into the Python string literal \`DISPLAY_NAME = "..."\`.
   **Triple-quote collision guard for \`SEQUENCE_BULLETS\` (custom profile only):**
   the template line \`SEQUENCE_BULLETS = """{{TOOLS_CODE_RESEARCH_SEQUENCE_BULLETS}}"""\`
   uses a triple-quoted Python literal. For the \`custom\` profile, \`sequence_bullets\`
   references \`{{TOOLS_CODE_RESEARCH_URL}}\` which is user-supplied free-text. If
   the resolved bullets string contains \`"""\` or \`'''\` (either triple-quote
   terminator), the rendered Python either breaks at load time OR breaks out of
   the literal — an arbitrary-code surface against the user's own machine.
   Before substituting, scan the resolved \`sequence_bullets\` for \`"""\` and \`'''\`;
   if either appears, escape the offending quotes (insert a zero-width joiner
   between the three characters, or fall back to \`json.dumps()\`-ing the bullets
   and assigning to a regular double-quoted string). Built-in profile URLs are
   pre-validated as safe — no guard needed for tokensave / ast-grep / sourcegraph
   / ctags / semgrep.
4. Write the result to \`~/.claude/hooks/<filename_basename>.py\` ATOMICALLY
   (write to \`<filename_basename>.py.tmp\`, fsync, \`os.replace\` to final).
   Ask before overwriting; show a diff if the existing file was hand-edited.
5. Register in \`~/.claude/settings.json\` under \`hooks.PreToolUse\`. ATOMIC
   write pattern: parse → mutate → write to \`.tmp\` → fsync → \`os.replace\`.
   Preserve unrelated user customisation (sibling matchers + user-added hooks).

**Hook is advisory, not a security boundary** — it fails open on JSON decode
errors and unknown detection modes. Document this in the bind summary so the
user knows the hook is best-effort enforcement.

---

**After both sub-phases (always run):**

6. Atomic commit. No \`Co-Authored-By:\` line. No push.
7. Self-verify: zero orphaned TOGGLE markers; zero unresolved
   \`{{PLACEHOLDERS}}\`; JSON files parse cleanly.

## Phase 4 — Cleanup

The plan file \`claude-code-setup-plan.html\` is always removed — transient.
For the \`claude-code-templates/\` source folder, ask the user (via
\`AskUserQuestion\`) to pick:

- **A · Keep + gitignore** (recommended) — folder stays, added to
  \`.gitignore\`; user can re-run setup with different toggles later.
- **B · Delete** — folder removed.
- **C · Keep as-is** — folder stays, no \`.gitignore\` change.

---

## Resolved configuration for this run

\`\`\`json
${JSON.stringify(manifest, null, 2)}
\`\`\`

Bundle: \`${bundleId}\`. See
\`./claude-code-templates/bundles/${bundleId}/bundle.toggles.md\` for the
defaults this bundle ships with.
`;
}

function buildBundleTogglesMd(bundleId, defaults) {
  // Mirror the upstream bundles/<id>/bundle.toggles.md format so step 2
  // can read it the same way as the canonical bundle.
  const lines = [
    `# ${bundleId} — bundle defaults`,
    ``,
    `Default toggle state for the \`${bundleId}\` bundle. The configurator's`,
    `manifest may override individual values; this file documents the baseline`,
    `the user would get without any overrides.`,
    ``,
    `| Toggle | Default |`,
    `|---|---|`,
  ];
  Object.entries(defaults).forEach(([id, v]) => {
    const label = ["off", "on", "ask"][v];
    lines.push(`| \`${id}\` | ${label} |`);
  });
  lines.push(``);
  return lines.join("\n");
}

function buildPasteText(manifest, bundleId) {
  return `# claude-code-templates ${manifest.version} — bootstrap brief

Please bootstrap claude-code-templates ${manifest.version} in this project.

PREREQUISITE — the user has already downloaded the configured bundle and
unzipped it at the project root, so a \`./claude-code-templates/\` folder
exists next to \`.git\`. If it does not exist, abort and ask the user to
re-run step 1 of the configurator.

Read \`./claude-code-templates/SETUP.md\` (relative to this project root,
NOT from any external repo) for the full orchestration instructions, then
apply the configuration below.

If \`./claude-code-templates/SETUP.md\` is missing or unreadable, abort and
ask the user to re-download from the configurator at
https://starfoxcom.github.io/claude-code-templates/ — do not improvise.

If any required manifest field is missing, run a short interview before
writing files.

\`\`\`json
${JSON.stringify(manifest, null, 2)}
\`\`\`

Land files atomically with a single commit:
\`chore: install claude-code-templates ${manifest.version} (${manifest.bundle})\`
`;
}

function buildZipManifestPreview(manifest, fileCount) {
  // Faux-tree of what's in the archive, mirroring the canonical _core/ tree
  // in the upstream repo. Files marked (toggled) are wholly omitted when
  // their toggle is OFF; section-scoped toggles strip blocks inside
  // otherwise-shared files (not visible at the file-list level).
  const togglesOn = Object.entries(manifest.toggles).filter(([_, v]) => v === "on").map(([k]) => k);
  const togglesAsk = Object.entries(manifest.toggles).filter(([_, v]) => v === "ask").map(([k]) => k);
  const toolsEntries = Object.entries(manifest.tools);
  const toolsLines = toolsEntries
    .map(([k, v], i) => `│   ${i === toolsEntries.length - 1 ? "└──" : "├──"} ${k.padEnd(15)} ${v}`);
  const has = (id) => togglesOn.includes(id);

  const lines = [
    `claude-code-templates-${manifest.bundle}-${manifest.version}.zip   (~${fileCount} files)`,
    `│`,
    `├── SETUP.md                          ← Claude reads this in step 2`,
    `├── README.md`,
    `├── CLAUDE.md                         (self-applied rules for this repo)`,
    `├── TOGGLES.md`,
    `├── COMPARISON.md`,
    `├── CHANGELOG.md`,
    `├── CONTRIBUTING.md`,
    `├── LICENSE`,
    `├── VERSION                           ${manifest.version}`,
    `├── manifest.json                     ← resolved config from folio I`,
    `│`,
    `├── bundles/`,
    `│   ├── 1-solo-personal/`,
    `│   │   ├── README.md`,
    `│   │   └── bundle.toggles.md`,
    `│   ├── 2-multi-dev-oss/`,
    `│   ├── 3-client-solo/`,
    `│   └── 4-client-team/`,
    `│`,
    `├── _core/`,
    `│   ├── project-template/             ← copied into <your-repo>/`,
    `│   │   ├── CLAUDE.md`,
    `│   │   ├── CHANGELOG.md`,
    has("contributing_md")             ? `│   │   ├── CONTRIBUTING.md             (toggled ON)` : null,
    `│   │   ├── .claude/rules/`,
    `│   │   │   ├── git.md`,
    `│   │   │   ├── review-tiers.md`,
    `│   │   │   ├── token-efficiency.md`,
    has("collaboration_rule")          ? `│   │   │   ├── collaboration.md       (toggled ON)` : null,
    has("confidentiality_rule")        ? `│   │   │   ├── confidentiality.md     (toggled ON)` : null,
    has("clean_room_rule")             ? `│   │   │   ├── clean-room.md          (toggled ON)` : null,
    has("visual_test_discipline")      ? `│   │   │   ├── visual.md              (toggled ON)` : null,
    `│   │   │   └── architecture/`,
    `│   │   │       └── (clean · hexagonal · layered · mvc · ddd · ecs · feature-based)`,
    `│   │   ├── .claude/skills/`,
    `│   │   │   ├── session-start/SKILL.md`,
    `│   │   │   ├── session-close/SKILL.md`,
    `│   │   │   ├── find/SKILL.md`,
    has("architecture_diagram_skill")  ? `│   │   │   └── architecture-graph/SKILL.md  (toggled ON)` : null,
    `│   │   ├── .github/`,
    has("pr_template")                 ? `│   │   │   ├── PULL_REQUEST_TEMPLATE.md  (toggled ON)` : null,
    has("github_issue_templates")      ? `│   │   │   └── ISSUE_TEMPLATE/         (toggled ON)` : null,
    `│   │   └── docs/lazy/`,
    `│   │`,
    `│   ├── global-template/              ← merged into ~/.claude/`,
    `│   │   ├── README.md`,
    `│   │   ├── hooks/                    (code-research entry hook)`,
    `│   │   └── memory-template/`,
    `│   │       ├── MEMORY.md`,
    `│   │       └── README.md`,
    `│   │`,
    `│   └── licenses/`,
    `│       └── MIT · Apache-2.0 · BSD-3-Clause · Proprietary`,
    `│`,
    `├── tools/                            (slots resolved from folio I)`,
    ...toolsLines,
    `│`,
    togglesOn.length  ? `├── toggles ON  (${togglesOn.length})` : null,
    ...togglesOn.map((t, i) => `│   ${i === togglesOn.length - 1 && !togglesAsk.length ? "└──" : "├──"} ${t}`),
    togglesAsk.length ? `└── toggles ASK (${togglesAsk.length}, asked during apply)` : null,
    ...togglesAsk.map((t, i) => `    ${i === togglesAsk.length - 1 ? "└──" : "├──"} ${t}`),
  ].filter(Boolean).join("\n");
  return lines;
}

function estimateTokens(text) {
  // Rough heuristic: ~3.6 chars per token for English + JSON mix.
  return Math.round(text.length / 3.6);
}

function loadScript(src, { integrity, crossOrigin } = {}) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    if (integrity) s.integrity = integrity;
    if (crossOrigin) s.crossOrigin = crossOrigin;
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

window.BindFolio = BindFolio;
