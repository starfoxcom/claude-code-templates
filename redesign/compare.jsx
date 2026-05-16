// Folio II — Compare bundles.
// Three sections: feature matrix, tier table, decision tree.

const FEATURE_ROWS = [
  ["Project CLAUDE.md", "Standard", "+ Contributor section", "+ Confidentiality", "+ Confidentiality + Team handoff"],
  ["git.md", "Gitflow + atomic + auto-merge on paths-ignore", "Gitflow + atomic + NO auto-merge", "+ audit-trail commits", "+ CODEOWNERS guide"],
  ["token-efficiency.md", "Aggressive — auto-merge fast path", "Conservative — always wait for human", "Aggressive on consultant's own work", "Conservative"],
  ["review-tiers.md", "Binary verdict, opt-in deep review", "+ mandatory deep on architectural surface", "Deep review recommended", "Mandatory deep review"],
  ["confidentiality.md", "—", "—", "NDA-aware", "NDA-aware + role-aware"],
  ["collaboration.md", "—", "PR etiquette + CONTRIBUTING", "—", "Team handoff + on-call"],
  ["Session-start ritual", "Standard", "+ collaborator activity (24h)", "+ client context isolation", "+ team handoff notes"],
  ["Session-close ritual", "Standard + DoD", "Push branch, no auto-merge", "+ billable handoff summary", "+ team handoff notes"],
  ["Memory system", "Rich, personal", "Personal per dev (not in repo)", "NDA-aware (no client secrets)", "NDA-aware + role-scoped"],
  ["GH routine review workflow", "Sonnet · binary verdict", "Sonnet · stricter labels", "Sonnet", "Sonnet · CODEOWNERS-routed"],
  ["GH deep review workflow", "Opt-in via @claude", "Auto-fire on trigger list", "Opt-in via @claude", "Auto-fire + required before merge"],
  ["Auto-merge on paths-ignore", "✓", "—", "Per-client", "—"],
  ["CONTRIBUTING.md", "—", "Public-facing", "—", "Internal team"],
  ["PR template", "Minimal", "Full (test plan, screenshots)", "+ audit-trail fields", "+ audit + reviewer checklist"],
  ["CODEOWNERS template", "—", "Optional", "—", "Required"],
  ["Branch protection", "Loose (1 reviewer = self)", "Strict (require deep review)", "Per-client", "Strict + CODEOWNERS-required"],
];


function CompareFolio() {
  const [activeCol, setActiveCol] = React.useState(null);
  const cols = window.BUNDLES.map(b => ({ id: b.id, n: b.n, label: b.key }));

  return (
    <>
      <div className="folio-head">
        <div className="kicker">Folio II · Bundle comparison</div>
        <h1>Compare bundles.</h1>
        <p className="lede">Side-by-side feature matrix and a decision tree for the in-between cases. Bold cells mark the strictness delta versus the universal core.</p>
      </div>

      {/* ── Feature matrix ─────────────────────────────────────────── */}
      <section className="step">
        <StepHead step="A" title="Feature matrix" annot="16 ROWS · 4 COLUMNS" />
        <div className="cmp-wrap">
          <div className="cmp">
            <div className="cmp-row cmp-head">
              <div className="cmp-cell cmp-rowlabel"></div>
              {cols.map(c => (
                <div key={c.id}
                  className={"cmp-cell cmp-colhead" + (activeCol === c.id ? " on" : "")}
                  onMouseEnter={() => setActiveCol(c.id)}
                  onMouseLeave={() => setActiveCol(null)}>
                  <div className="cch-n mono">{c.n}</div>
                  <div className="cch-l">{c.label}</div>
                </div>
              ))}
            </div>
            {FEATURE_ROWS.map((row, i) => (
              <div key={i} className="cmp-row">
                <div className="cmp-cell cmp-rowlabel mono">{row[0]}</div>
                {row.slice(1).map((c, j) => {
                  const colId = cols[j].id;
                  const colLabel = cols[j].label;
                  const empty = c === "—";
                  return (
                    <div key={j}
                      className={"cmp-cell" + (activeCol === colId ? " on" : "") + (empty ? " empty" : "")}
                      data-bundle={colLabel}>
                      {c}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <style>{`
          .cmp-wrap { border: 1px solid var(--rule); border-radius: var(--r-lg); background: var(--paper-card); box-shadow: var(--shadow-card); overflow: hidden; }
          .cmp { min-width: 0; }
          .cmp-row { display: grid; grid-template-columns: 220px repeat(4, 1fr); border-bottom: 1px solid var(--rule-soft); }
          .cmp-row:last-child { border-bottom: none; }
          .cmp-cell { padding: 12px 14px; font-size: 13px; border-right: 1px solid var(--rule-soft); transition: background var(--dur) var(--ease); }
          .cmp-cell:last-child { border-right: none; }
          .cmp-cell.on { background: var(--accent-soft); }
          .cmp-cell.empty { color: var(--ink-faint); }
          .cmp-rowlabel { color: var(--ink); font-size: 12px; background: var(--paper-sunken); }
          .cmp-head { background: var(--paper-sunken); position: sticky; top: 0; z-index: 4; }
          .cmp-head .cmp-cell { padding: 14px 14px; }
          .cch-n { font-size: 10.5px; color: var(--ink-faint); letter-spacing: 0.5px; }
          .cch-l { font-family: var(--f-display); font-size: 15px; font-weight: 500; margin-top: 2px; letter-spacing: -0.2px; }
          .cmp-colhead { cursor: pointer; }
          @media (max-width: 640px) {
            .cmp-head { display: none; }
            .cmp-row { grid-template-columns: 1fr; padding: 12px 16px 14px; border-bottom: 1px solid var(--rule); }
            .cmp-cell { border-right: none; padding: 6px 0; }
            .cmp-rowlabel {
              background: transparent;
              font-family: var(--f-display);
              font-size: 15px;
              font-weight: 500;
              color: var(--ink);
              padding: 0 0 8px;
              border-bottom: 1px dashed var(--rule);
              margin-bottom: 4px;
            }
            .cmp-row .cmp-cell:not(.cmp-rowlabel)::before {
              content: attr(data-bundle);
              display: block;
              font-family: var(--f-mono);
              font-size: 9.5px;
              color: var(--ink-faint);
              letter-spacing: 0.4px;
              text-transform: uppercase;
              margin-bottom: 2px;
            }
            .cmp-cell.empty { opacity: 0.65; }
          }
          .cmp-colhead.on { background: var(--accent-soft); color: var(--accent); }
        `}</style>
      </section>
      {/* ── Decision tree ──────────────────────────────────────────── */}
      <section className="step">
        <StepHead step="C" title="Decision tree" annot="3 QUESTIONS · 4 LEAVES" />
        <div className="tree">
          <TreeNode q="Are you the only one pushing to this repo?" />
          <TreeBranch label="YES" />
          <TreeNode q="Is the repo public?" inset={1} />
          <TreeBranch label="YES" inset={1} />
          <TreeLeaf bundle={window.BUNDLES[0]} inset={2} reason="public, but it's your project" />
          <TreeBranch label="NO" inset={1} />
          <TreeLeaf bundle={window.BUNDLES[0]} inset={2} reason="private, single author" />
          <TreeBranch label="NO" />
          <TreeNode q="Is this for a paying client / under NDA?" inset={1} />
          <TreeBranch label="YES" inset={1} />
          <TreeNode q="Other devs on it besides you?" inset={2} />
          <TreeBranch label="YES" inset={2} />
          <TreeLeaf bundle={window.BUNDLES[3]} inset={3} reason="client + team" />
          <TreeBranch label="NO" inset={2} />
          <TreeLeaf bundle={window.BUNDLES[2]} inset={3} reason="client + sole contractor" />
          <TreeBranch label="NO" inset={1} />
          <TreeLeaf bundle={window.BUNDLES[1]} inset={2} reason="open or community-collaborative" />
        </div>
        <style>{`
          .tree {
            background: var(--paper-card);
            border: 1px solid var(--rule);
            border-radius: var(--r-lg);
            padding: 24px;
            font-family: var(--f-mono);
            display: flex; flex-direction: column; gap: 0;
            box-shadow: var(--shadow-card);
          }
          .tn, .tb, .tl { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
          .tn { font-size: 13.5px; color: var(--ink); padding: 8px 0; font-family: var(--f-ui); font-weight: 500; }
          .tn .q-icon {
            width: 18px; height: 18px; border-radius: 4px;
            background: var(--accent-soft); color: var(--accent);
            display: inline-flex; align-items: center; justify-content: center;
            font-size: 11px; font-family: var(--f-mono);
          }
          .tb { color: var(--ink-faint); font-size: 11px; letter-spacing: 0.5px; padding: 2px 0 2px 4px; }
          .tb .ti-line { width: 24px; height: 1px; background: var(--ink-faint); }
          .tb .ti-l { padding: 2px 8px; background: var(--paper-sunken); border-radius: var(--r-xs); border: 1px solid var(--rule); }
          .tl {
            background: var(--paper-tint);
            border: 1px solid var(--accent-soft);
            border-radius: var(--r-md);
            padding: 10px 14px;
            margin: 4px 0;
            font-family: var(--f-ui);
            font-size: 13.5px;
          }
          .tl .tl-arrow { color: var(--accent); }
          .tl b { font-family: var(--f-display); font-weight: 500; font-size: 15px; }
          .tl .tl-r { color: var(--ink-soft); margin-left: 4px; font-style: italic; font-size: 12.5px; }
          .ind-1 { padding-left: 28px; }
          .ind-2 { padding-left: 56px; }
          .ind-3 { padding-left: 84px; }
        `}</style>
      </section>
    </>
  );
}

function TreeNode({ q, inset = 0 }) {
  return (
    <div className={"tn ind-" + inset}>
      <span className="q-icon">?</span>
      <span>{q}</span>
    </div>
  );
}
function TreeBranch({ label, inset = 0 }) {
  return (
    <div className={"tb ind-" + inset}>
      <span className="ti-line"></span>
      <span className="ti-l">{label}</span>
    </div>
  );
}
function TreeLeaf({ bundle, inset = 0, reason }) {
  return (
    <div className={"tl ind-" + inset}>
      <span className="tl-arrow">→</span>
      <b>{bundle.key}</b>
      <span className="tl-r">— {reason}</span>
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

window.PlaceholderFolio = window.PlaceholderFolio || (() => null);
window.CompareFolio = CompareFolio;
