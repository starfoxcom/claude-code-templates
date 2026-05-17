// Folio IV — How it binds. Two sequential steps explanation.
// Both are required: download/unzip → paste-and-apply.

function HowFolio() {
  return (
    <>
      <div className="folio-head">
        <div className="kicker">Folio IV · Mechanics</div>
        <h1>How it binds.</h1>
        <p className="lede">Two sequential moves from this page to your repo. Both required. Step 1 lands the templates folder on disk so Claude can find it; Step 2 hands Claude the bootstrap prompt and waits for your <code className="mono">apply</code>.</p>
      </div>

      {/* The two sequential steps */}
      <section className="step">
        <Path
          n="1"
          tag="STEP 1 · DOWNLOAD & UNZIP"
          title="Land the templates at your project root."
          steps={[
            "Configure Mode, Bundle, Project, Tools, Toggles in Folio I.",
            <>Click <span className="mono inline-code">Bind &amp; download</span>. JSZip stitches the configured templates into a single archive in your tab — nothing transmitted to a server.</>,
            <>Unzip the archive at your project root so the folder lands as <span className="mono inline-code">claude-code-templates/</span> next to your <span className="mono inline-code">.git</span>.</>,
            <>This folder is the <strong>source</strong> Claude reads in step 2 — it must exist on disk before pasting the command.</>,
          ]}
          dark
        />

        <div className="bind-then" aria-hidden>
          <span className="bind-then-line"></span>
          <span className="bind-then-label mono">THEN</span>
          <span className="bind-then-line"></span>
        </div>

        <Path
          n="2"
          tag="STEP 2 · PASTE IN CLAUDE"
          title="Hand Claude the bootstrap brief."
          steps={[
            <>Click <span className="mono inline-code">Copy to clipboard</span> in Folio I. The clipboard now holds a manifest + a directive to read <span className="mono inline-code">SETUP.md</span>.</>,
            <>Open Claude Code inside the same project root (where you unzipped in step 1).</>,
            "Paste the command as your first message.",
            <>Claude reads <span className="mono inline-code">SETUP.md</span> from the unzipped folder, runs a short interview if anything's missing, and proposes an HTML plan.</>,
            <>Inspect the plan, reply <span className="mono inline-code">apply</span>. Claude lands every file atomically in a single commit.</>,
          ]}
        />

        <style>{`
          .path {
            background: var(--paper-card);
            border: 1px solid var(--rule);
            border-radius: var(--r-lg);
            padding: 22px 24px 24px;
            box-shadow: var(--shadow-card);
            display: flex; flex-direction: column; gap: 12px;
          }
          .path.dark {
            background: var(--surface-ink);
            color: var(--surface-ink-fg);
            border-color: var(--surface-ink);
          }
          .path-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
          .path-step-pip {
            display: inline-flex;
            align-items: center; justify-content: center;
            width: 26px; height: 26px;
            border-radius: 6px;
            font-family: var(--f-mono);
            font-size: 12px;
            font-weight: 600;
            background: var(--accent);
            color: var(--accent-ink);
          }
          .path.dark .path-step-pip { background: var(--accent); color: var(--accent-ink); }
          .path-tag {
            font-family: var(--f-mono);
            font-size: 11px;
            letter-spacing: 0.8px;
            color: var(--ink-soft);
          }
          .path.dark .path-tag { color: var(--surface-ink-fg-muted); }
          .path-title {
            font-family: var(--f-display);
            font-size: 24px;
            font-weight: 500;
            letter-spacing: -0.4px;
            line-height: 1.1;
            margin-top: 4px;
          }
          .path-steps { display: flex; flex-direction: column; gap: 10px; padding: 6px 0 0; }
          .path-step {
            display: grid; grid-template-columns: 26px 1fr;
            gap: 10px; align-items: flex-start;
            font-size: 14px; line-height: 1.55;
          }
          .path-step-n {
            width: 22px; height: 22px;
            border-radius: 50%;
            font-family: var(--f-mono); font-size: 10.5px;
            display: inline-flex; align-items: center; justify-content: center;
            background: var(--accent-soft);
            color: var(--accent);
            border: 1px solid var(--accent-soft);
            margin-top: 2px;
            font-weight: 500;
          }
          .path.dark .path-step-n { background: var(--surface-ink-wash-2); color: var(--accent-hi); border-color: var(--surface-ink-rule); }
          .inline-code {
            font-size: 12px;
            padding: 1px 6px;
            border-radius: var(--r-xs);
            background: var(--paper-sunken);
            border: 1px solid var(--rule);
          }
          .path.dark .inline-code { background: var(--surface-ink-wash-1); border-color: var(--surface-ink-rule); color: var(--surface-ink-fg); }
          .bind-then {
            display: flex; align-items: center; gap: 12px;
            margin: 4px 0;
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
        `}</style>
      </section>

      {/* The four phases — operationally what Claude does */}
      <section className="step">
        <StepHead step="A" title="What Claude does during step 2" annot="FOUR PHASES" />

        <div className="phases">
          <Phase n="1" name="Validate">
            <ul>
              <li><strong>Locate templates.</strong> Claude expects them at <code className="mono">./claude-code-templates/</code>. If absent, the run aborts with instructions.</li>
              <li><strong>Parse the manifest.</strong> Required fields: bundle, project.name, project.repo_url, project.default_branch, toggles. Missing → short interview.</li>
              <li><strong>Cross-check toggles</strong> against the catalog. Unknown keys → reject.</li>
              <li><strong>Resolve <em>ask</em> toggles</strong>: the code-research toggle resolves to ON only if your selected tool reports ready via its status probe; architecture scaffold only if clear layers exist.</li>
            </ul>
          </Phase>
          <Phase n="2" name="Plan">
            <p>Claude generates <code className="mono">claude-code-setup-plan.html</code> in your project root showing the resolved bundle, final toggle state, substituted placeholders, every file that will be created / stripped / deleted, and the proposed commit message.</p>
            <p><strong>Claude stops here.</strong> Nothing is written until you reply <code className="mono">apply</code>.</p>
          </Phase>
          <Phase n="3" name="Apply">
            <ul>
              <li>Copy every file from <code className="mono">_core/project-template/</code> into your project root.</li>
              <li>Substitute placeholders (<code className="mono">{`{{PROJECT_NAME}}`}</code>, <code className="mono">{`{{REPO_URL}}`}</code>, <code className="mono">{`{{MAIN_BRANCH}}`}</code>, etc.) — UPPER_SNAKE_CASE only so it doesn't collide with GitHub Actions <code className="mono">{`\${{ … }}`}</code>.</li>
              <li>Resolve toggles: ON keeps content, OFF strips marker block, <code className="mono">:off</code> inverse markers do the opposite.</li>
              <li>Merge global additions into <code className="mono">~/.claude/CLAUDE.md</code> if the memory or code-research toggles are ON (asks before overwriting).</li>
              <li>Atomic commit: <code className="mono">chore(claude): bootstrap Claude Code setup</code>. No push.</li>
              <li>Self-verify: zero orphaned <code className="mono">TOGGLE</code> markers, zero unresolved <code className="mono">{`{{PLACEHOLDERS}}`}</code>.</li>
            </ul>
          </Phase>
          <Phase n="4" name="Cleanup">
            <p>The plan file (<code className="mono">claude-code-setup-plan.html</code>) is always removed — it was transient. For the <code className="mono">claude-code-templates/</code> source folder, Claude asks you to pick one of:</p>
            <ul>
              <li><strong>A · Keep + gitignore (recommended)</strong> — re-run setup later without re-downloading.</li>
              <li><strong>B · Delete</strong> — cleanest project root.</li>
              <li><strong>C · Keep as-is</strong> — commits the templates folder so collaborators can re-run from inside the repo.</li>
            </ul>
          </Phase>
        </div>

        <style>{`
          .phases { display: flex; flex-direction: column; gap: 12px; }
          .phase {
            background: var(--paper-card);
            border: 1px solid var(--rule);
            border-radius: var(--r-lg);
            box-shadow: var(--shadow-card);
            padding: 18px 22px 20px;
            display: grid;
            grid-template-columns: 60px 1fr;
            gap: 18px;
          }
          .phase-num {
            font-family: var(--f-display);
            font-size: 48px;
            font-weight: 500;
            line-height: 1;
            color: var(--accent);
            letter-spacing: -2px;
          }
          .phase-body .phase-name {
            font-family: var(--f-display);
            font-size: 17px;
            font-weight: 500;
            letter-spacing: -0.3px;
            margin-bottom: 6px;
          }
          .phase-body p { font-size: 13.5px; line-height: 1.6; color: var(--ink); margin: 0 0 8px; }
          .phase-body p:last-child { margin-bottom: 0; }
          .phase-body ul { margin: 0; padding-left: 18px; font-size: 13.5px; line-height: 1.6; color: var(--ink); }
          .phase-body ul li { padding: 2px 0; }
          .phase-body code { font-size: 12px; padding: 1px 5px; background: var(--paper-sunken); border: 1px solid var(--rule); border-radius: var(--r-xs); }
          @media (max-width: 640px) {
            .phase { grid-template-columns: 1fr; gap: 4px; }
            .phase-num { font-size: 32px; }
          }
        `}</style>
      </section>

      {/* What's in the zip */}
      <section className="step">
        <StepHead step="B" title="What lands on disk" annot="ARCHIVE CONTENTS · STEP 1 OUTPUT" />
        <div className="card flush" style={{ overflow: "hidden" }}>
          <div className="filelist">
            <FileEntry kind="dir" path="claude-code-templates/" desc="lands at your project root after step 1" />

            <FileEntry kind="file" path="  SETUP.md" desc="orchestration prompt — Claude reads this first in step 2" />
            <FileEntry kind="file" path="  README.md" desc="repo overview" />
            <FileEntry kind="file" path="  CLAUDE.md" desc="self-applied rules for editing this repo" />
            <FileEntry kind="file" path="  CONTRIBUTING.md" />
            <FileEntry kind="file" path="  CHANGELOG.md" />
            <FileEntry kind="file" path="  TOGGLES.md" desc="catalog mirror, readable as git-diff fodder" />
            <FileEntry kind="file" path="  COMPARISON.md" desc="bundle matrix mirror" />
            <FileEntry kind="file" path="  LICENSE" />
            <FileEntry kind="file" path="  VERSION" desc="v1.1.0" />
            <FileEntry kind="file" path="  manifest.json" desc="resolved config baked from your folio I choices" />

            <FileEntry kind="dir" path="  bundles/" desc="bundle defaults Claude resolves against" />
            <FileEntry kind="dir" path="    1-solo-personal/" />
            <FileEntry kind="file" path="      README.md" />
            <FileEntry kind="file" path="      bundle.toggles.md" desc="per-bundle default toggle state" />
            <FileEntry kind="dir" path="    2-multi-dev-oss/" />
            <FileEntry kind="dir" path="    3-client-solo/" />
            <FileEntry kind="dir" path="    4-client-team/" />

            <FileEntry kind="dir" path="  _core/" desc="canonical templates (source of truth)" />

            <FileEntry kind="dir" path="    project-template/" desc="copied into <your-repo>/" />
            <FileEntry kind="file" path="      CLAUDE.md" desc="memory entrypoint + bundle-specific sections" />
            <FileEntry kind="file" path="      CONTRIBUTING.md" desc="toggled — contributing_md" />
            <FileEntry kind="file" path="      CHANGELOG.md" desc="toggled — changelog_seed" />
            <FileEntry kind="dir" path="      .claude/" />
            <FileEntry kind="dir" path="        rules/" desc="git.md, review-tiers.md, token-efficiency.md, …" />
            <FileEntry kind="file" path="          git.md" />
            <FileEntry kind="file" path="          review-tiers.md" />
            <FileEntry kind="file" path="          token-efficiency.md" />
            <FileEntry kind="file" path="          collaboration.md" desc="toggled" />
            <FileEntry kind="file" path="          confidentiality.md" desc="toggled" />
            <FileEntry kind="file" path="          clean-room.md" desc="toggled" />
            <FileEntry kind="file" path="          visual.md" desc="toggled" />
            <FileEntry kind="dir" path="          architecture/" desc="one .md per pattern you picked" />
            <FileEntry kind="file" path="            README.md" />
            <FileEntry kind="file" path="            clean.md · hexagonal.md · layered.md · mvc.md · ddd.md · ecs.md · feature-based.md" />
            <FileEntry kind="dir" path="        skills/" />
            <FileEntry kind="file" path="          session-start/SKILL.md" />
            <FileEntry kind="file" path="          session-close/SKILL.md" />
            <FileEntry kind="file" path="          find/SKILL.md" desc="code-research entry skill" />
            <FileEntry kind="file" path="          architecture-graph/SKILL.md" desc="toggled" />
            <FileEntry kind="dir" path="      .github/" />
            <FileEntry kind="dir" path="        ISSUE_TEMPLATE/" desc="toggled — github_issue_templates" />
            <FileEntry kind="file" path="          bug_report.yml · feature_request.yml · config.yml" />
            <FileEntry kind="file" path="        PULL_REQUEST_TEMPLATE.md" desc="toggled — pr_template" />
            <FileEntry kind="dir" path="      docs/lazy/" desc="rules that only load at specific milestones" />
            <FileEntry kind="file" path="        README.md" />

            <FileEntry kind="dir" path="    global-template/" desc="merged into ~/.claude/" />
            <FileEntry kind="file" path="      README.md" />
            <FileEntry kind="dir" path="      hooks/" desc="code-research entry hook (global only)" />
            <FileEntry kind="dir" path="      memory-template/" desc="long-term memory scaffolding" />
            <FileEntry kind="file" path="        MEMORY.md" />
            <FileEntry kind="file" path="        README.md" />

            <FileEntry kind="dir" path="    licenses/" desc="LICENSE template variants" />
            <FileEntry kind="file" path="      MIT.txt · Apache-2.0.txt · BSD-3-Clause.txt · Proprietary.txt" />
          </div>
        </div>
        <div className="filelist-foot dim">
          <strong>43 files total</strong> in the zip before toggle application · ~50 KB packed.
          Files marked <em>toggled</em> are deleted wholesale when their toggle is OFF; section-scoped toggles strip blocks inside otherwise-shared files. The exact set you receive depends on the bundle + toggle state you chose in Folio I.
        </div>
        <style>{`
          .filelist { padding: 6px 0; }
          .fe { display: grid; grid-template-columns: 24px minmax(0, 1fr) minmax(0, 1.4fr); gap: 12px; padding: 6px 18px; align-items: baseline; }
          .fe .fe-icon { font-family: var(--f-mono); font-size: 11px; color: var(--ink-faint); text-align: center; }
          .fe.dir .fe-icon { color: var(--accent); }
          .fe .fe-path { font-family: var(--f-mono); font-size: 12.5px; color: var(--ink); white-space: pre; overflow: hidden; text-overflow: ellipsis; }
          .fe.dir .fe-path { color: var(--ink-strong); font-weight: 500; }
          .fe .fe-desc { font-size: 12px; color: var(--ink-soft); line-height: 1.5; }
          @media (max-width: 720px) {
            .fe { grid-template-columns: 24px minmax(0, 1fr); row-gap: 2px; padding: 8px 14px; }
            .fe .fe-desc { grid-column: 2 / -1; font-size: 11px; padding-top: 2px; }
          }
          .filelist-foot { font-size: 12.5px; line-height: 1.6; margin-top: 12px; padding: 12px 16px; background: var(--paper-tint); border: 1px solid var(--accent-soft); border-radius: var(--r-md); }
          .filelist-foot em { font-style: italic; color: var(--accent); }
        `}</style>
      </section>

      {/* Privacy footer */}
      <section className="step">
        <div className="card pad" style={{ background: "var(--paper-tint)", borderColor: "var(--accent-soft)" }}>
          <div className="display" style={{ fontSize: 20, fontWeight: 500, letterSpacing: -0.3 }}>
            Nothing leaves the tab.
          </div>
          <p style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: 6, lineHeight: 1.55, maxWidth: 720 }}>
            The page is static HTML and JavaScript hosted on GitHub Pages. No cookies, no analytics,
            no tracking pixels, no server endpoints. Step 1 fetches template files from this same
            origin and assembles a zip in your browser. Your toggle selections and project metadata
            never leave the tab — they live inside the zip you download.
          </p>
        </div>
      </section>
    </>
  );
}

function Path({ n, tag, title, steps, dark }) {
  return (
    <div className={"path" + (dark ? " dark" : "")}>
      <div className="path-head">
        <span className="path-step-pip">{n}</span>
        <span className="path-tag">{tag}</span>
      </div>
      <div className="path-title">{title}</div>
      <div className="path-steps">
        {steps.map((s, i) => (
          <div key={i} className="path-step">
            <span className="path-step-n">{i + 1}</span>
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Phase({ n, name, children }) {
  return (
    <div className="phase">
      <div className="phase-num">{n}</div>
      <div className="phase-body">
        <div className="phase-name">{name}</div>
        {children}
      </div>
    </div>
  );
}

function FileEntry({ kind, path, desc }) {
  return (
    <div className={"fe " + kind}>
      <span className="fe-icon">{kind === "dir" ? "▸" : "·"}</span>
      <span className="fe-path">{path}</span>
      <span className="fe-desc">{desc || ""}</span>
    </div>
  );
}

function StepHead({ step, title, annot }) {
  return (
    <div className="step-head">
      <span className="step-tag mono">{step.length > 2 ? step : `STEP·${step}`}</span>
      <span className="step-title">{title}</span>
      {annot && <span className="step-annot">{annot}</span>}
    </div>
  );
}

window.HowFolio = HowFolio;
