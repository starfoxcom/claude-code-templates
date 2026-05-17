// Folio VI — About / colophon.

function AboutFolio() {
  return (
    <>
      <div className="folio-head">
        <div className="kicker">Folio VI · Colophon</div>
        <h1>About this thing.</h1>
        <p className="lede">A configurator distilled from real session telemetry across two private projects. Solo-maintained, open-source, opinion-heavy.</p>
      </div>

      <section className="step">
        <div className="colophon">

          <ColRow k="Project" v="claude-code-templates" sub="MIT licensed · solo-maintained" />
          <ColRow k="Version" v="v1.1.0" sub="2026-05-16" />
          <ColRow k="Source" v={<a href="https://github.com/starfoxcom/claude-code-templates" target="_blank" rel="noreferrer">github.com/starfoxcom/claude-code-templates</a>} sub="issues + PRs welcome on best-effort basis" />
          <ColRow k="Hosting" v="GitHub Pages" sub="static HTML + JavaScript · no server · no analytics" />

          <ColDivider label="materials" />

          <ColRow k="Type" v="Space Grotesk · Inter Tight · JetBrains Mono" sub="Google Fonts" />
          <ColRow k="Color system" v="OKLCH · dual-theme" sub="drafting blue accent · single hue rotated for dark" />
          <ColRow k="Grid" v="220 / 1fr / 200 with 40px gutters" sub="responsive: gutter-right hides <1180, gutter-left hides <900" />
          <ColRow k="Motion" v="180ms cubic-bezier(.2,.8,.2,1)" sub="restrained · respects prefers-reduced-motion" />

          <ColDivider label="provenance" />

          <ColRow k="Methodology" v="Receipt-based" sub="every rule earns its place from a measurable cost" />
          <ColRow k="Source projects" v="2 private" sub="one consumer-software, one solo voxel-game build" />
          <ColRow k="Telemetry span" v="2026-04-06 → 2026-05-12" sub="36 days · 143 sessions logged at v1.0.0 cut" />
          <ColRow k="Toggle catalog" v="36 entries · 7 chapters" sub="grows monotonically; rarely shrinks" />

          <ColDivider label="acknowledgements" />

          <div className="ack">
            <p>
              The bundles encode patterns that came out of receipts — moments where the absence
              of a rule produced a measurable cost. The most expensive of those are printed verbatim
              in <a href="#receipts">Folio V</a>.
            </p>
            <p>
              The discipline this project teaches is serious, honest, receipt-based. The design
              tries to match: confident, specific, not aspirational.
            </p>
          </div>
        </div>

        <style>{`
          .colophon {
            background: var(--paper-card);
            border: 1px solid var(--rule);
            border-radius: var(--r-lg);
            padding: 26px 28px;
            box-shadow: var(--shadow-card);
          }
          .col-row {
            display: grid;
            grid-template-columns: 200px 1fr;
            gap: 24px;
            padding: 14px 0;
            border-top: 1px solid var(--rule-soft);
          }
          .col-row:first-child { border-top: none; padding-top: 6px; }
          .col-k {
            font-family: var(--f-mono);
            font-size: 11px;
            color: var(--ink-soft);
            text-transform: uppercase;
            letter-spacing: 0.6px;
            padding-top: 4px;
          }
          .col-v { font-family: var(--f-display); font-size: 18px; font-weight: 500; letter-spacing: -0.2px; }
          .col-v a { color: inherit; border-bottom: 1px solid var(--accent-soft); }
          .col-v a:hover { border-bottom-color: var(--accent); text-decoration: none; }
          .col-sub { font-size: 12.5px; color: var(--ink-soft); margin-top: 2px; }
          .col-divider {
            display: flex; align-items: center; gap: 14px;
            padding: 22px 0 6px;
            font-family: var(--f-mono);
            font-size: 11px;
            letter-spacing: 0.8px;
            color: var(--ink-faint);
            text-transform: uppercase;
          }
          .col-divider .cdl { flex: 1; height: 1px; background: var(--rule); }
          .ack { padding: 8px 0 4px; font-size: 14.5px; line-height: 1.65; color: var(--ink); max-width: 720px; }
          .ack p { margin: 0 0 12px; }
          .ack a { color: var(--accent); }
          @media (max-width: 640px) { .col-row { grid-template-columns: 1fr; gap: 4px; } }
        `}</style>
      </section>
    </>
  );
}

function ColRow({ k, v, sub }) {
  return (
    <div className="col-row">
      <div className="col-k">{k}</div>
      <div>
        <div className="col-v">{v}</div>
        {sub && <div className="col-sub">{sub}</div>}
      </div>
    </div>
  );
}
function ColDivider({ label }) {
  return (
    <div className="col-divider">
      <span>{label}</span>
      <span className="cdl"></span>
    </div>
  );
}

window.AboutFolio = AboutFolio;
