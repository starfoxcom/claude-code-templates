// Folio V — Receipts. Telemetry that earned each rule.
// 8 stat tiles, 3 receipt cards, 7-entry timeline, 6-bar chart, tool-shift table, footnotes.

function ReceiptsFolio() {
  const maxBar = Math.max(...window.RECEIPTS_BARS.map(b => b.v));

  return (
    <>
      <div className="folio-head">
        <div className="kicker">Folio V · Receipts &amp; telemetry</div>
        <h1>Every rule earned its place.</h1>
        <p className="lede">A receipt is a moment where the absence of a rule produced a measurable cost — minutes wasted, files corrupted, secrets nearly leaked. Each one in this folio fathered a rule, a toggle, or a bundle.</p>
        <div className="ledemeta">
          <span className="pip"></span>
          <span>Tracked since 2026-04-06 · 2 private projects · 36 days · 143 sessions</span>
        </div>
      </div>

      {/* ── Stat tiles ─────────────────────────────────────────────── */}
      <section className="step">
        <StepHead step="A" title="Telemetry" annot="THE WHOLE STORY · IN NUMBERS" />
        <div className="rstats">
          {window.RECEIPTS_STATS.map((s, i) => (
            <div key={s.k} className={"rstat " + (i === 0 || i === 1 || i === 6 ? "rstat-hi" : "")}>
              <div className="rstat-v display">{s.v}</div>
              <div className="rstat-k">{s.k}</div>
              {s.sub && <div className="rstat-sub">{s.sub}</div>}
            </div>
          ))}
        </div>
        <style>{`
          .rstats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
          .rstat {
            background: var(--paper-card);
            border: 1px solid var(--rule);
            border-radius: var(--r-lg);
            padding: 18px 18px 16px;
            display: flex; flex-direction: column; gap: 6px;
            box-shadow: var(--shadow-card);
          }
          .rstat-hi { border-color: var(--accent-soft); background: var(--paper-tint); }
          .rstat-hi .rstat-v { color: var(--accent); }
          .rstat-v { font-size: 32px; font-weight: 500; line-height: 1; letter-spacing: -1px; }
          .rstat-k { font-family: var(--f-mono); font-size: 10.5px; letter-spacing: 0.5px; color: var(--ink-soft); text-transform: uppercase; }
          .rstat-sub { font-size: 11px; color: var(--ink-faint); margin-top: 4px; line-height: 1.4; }
          @media (max-width: 720px) { .rstats { grid-template-columns: 1fr 1fr; } }
          @media (max-width: 420px) { .rstats { grid-template-columns: 1fr; } }
        `}</style>
      </section>

      {/* ── Receipt cards ──────────────────────────────────────────── */}
      <section className="step">
        <StepHead step="B" title="Costliest receipts" annot="TOP 3 BY MEASURED COST" />
        <div className="recs">
          {window.RECEIPTS_CARDS.map(r => (
            <article key={r.id} className="rec">
              <div className="rec-head">
                <div className="rec-id mono">{r.id}</div>
                <div className="rec-cost mono">cost · {r.cost}</div>
              </div>
              <div className="rec-title display">{r.title}</div>
              <div className="rec-date mono">{r.date}</div>
              <div className="rec-grid">
                <div className="rec-block">
                  <div className="tag">Cause</div>
                  <div className="rec-text">{r.cause}</div>
                </div>
                <div className="rec-block">
                  <div className="tag">Rule earned</div>
                  <div className="rec-text">{r.rule}</div>
                </div>
              </div>
              <div className="rec-foot">
                <span className="dim mono" style={{ fontSize: 11 }}>encodes toggle</span>
                <span className="pill accent mono">{r.toggle}</span>
              </div>
            </article>
          ))}
        </div>
        <style>{`
          .recs { display: grid; grid-template-columns: 1fr; gap: 14px; }
          .rec {
            background: var(--paper-card);
            border: 1px solid var(--rule);
            border-radius: var(--r-lg);
            padding: 22px 24px 22px;
            box-shadow: var(--shadow-card);
            position: relative;
            display: flex; flex-direction: column; gap: 10px;
          }
          .rec::before {
            content: ""; position: absolute; left: -1px; top: 22px; bottom: 22px;
            width: 3px; background: var(--accent); border-radius: 2px;
          }
          .rec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
          .rec-id { font-size: 11px; color: var(--accent); letter-spacing: 1px; }
          .rec-cost { font-size: 11.5px; color: var(--red); letter-spacing: 0.4px; }
          .rec-title { font-size: 20px; font-weight: 500; line-height: 1.2; letter-spacing: -0.4px; }
          .rec-date { font-size: 11px; color: var(--ink-faint); }
          .rec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 4px; }
          .rec-block .tag { margin-bottom: 4px; }
          .rec-text { font-size: 13.5px; color: var(--ink); line-height: 1.5; }
          .rec-foot {
            margin-top: 6px;
            display: flex; align-items: center; gap: 10px;
            padding-top: 10px; border-top: 1px dashed var(--rule);
          }
          @media (max-width: 640px) { .rec-grid { grid-template-columns: 1fr; } }
        `}</style>
      </section>

      {/* ── Timeline ───────────────────────────────────────────────── */}
      <section className="step">
        <StepHead step="C" title="Timeline" annot="MAR 26 → MAY 12 · 7 RULE LANDINGS" />
        <div className="tl">
          {window.RECEIPTS_TIMELINE.map((e, i) => (
            <div key={i} className="tl-row">
              <div className="tl-date mono">{e.d}</div>
              <div className="tl-mark">
                <span className="tl-dot"></span>
                {i < window.RECEIPTS_TIMELINE.length - 1 && <span className="tl-stem"></span>}
              </div>
              <div className="tl-text">{e.t}</div>
            </div>
          ))}
        </div>
        <style>{`
          .tl {
            background: var(--paper-card);
            border: 1px solid var(--rule);
            border-radius: var(--r-lg);
            padding: 22px 24px;
            box-shadow: var(--shadow-card);
          }
          .tl-row {
            display: grid;
            grid-template-columns: 100px 28px 1fr;
            align-items: flex-start;
            gap: 12px;
          }
          .tl-date {
            font-size: 11px; color: var(--ink-soft); letter-spacing: 0.3px;
            padding-top: 4px;
          }
          .tl-mark { position: relative; display: flex; justify-content: center; padding-top: 6px; }
          .tl-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
          .tl-stem { position: absolute; top: 18px; bottom: -16px; width: 1px; background: var(--rule); }
          .tl-text { font-size: 14px; line-height: 1.55; padding: 1px 0 16px; color: var(--ink); }
          .tl-row:last-child .tl-text { padding-bottom: 0; }
          @media (max-width: 640px) {
            .tl-row { grid-template-columns: 80px 22px 1fr; gap: 8px; }
          }
        `}</style>
      </section>

      {/* ── Bar chart ──────────────────────────────────────────────── */}
      <section className="step">
        <StepHead step="D" title="Weekly session volume + intensity" annot="APR 06 → MAY 11 2026 · AVG K-TOKENS / SESSION" />
        <div className="bars">
          <div className="bars-scroll-wrap">
          <div className="bars-grid">
            <div className="bars-y">
              <span>300K</span><span>225</span><span>150</span><span>75</span><span>0</span>
            </div>
            <div className="bars-plot">
              <div className="bars-grid-lines">
                {[0, 25, 50, 75, 100].map(t => <div key={t} className="bgl" style={{ bottom: t + "%" }}></div>)}
              </div>
              {window.RECEIPTS_BARS.map((b, i) => (
                <div key={i} className="bar-col">
                  <div className="bar-val mono">{b.v}K</div>
                  <div className="bar-rect" style={{ height: Math.min(100, b.v / 300 * 100) + "%" }}
                    title={`${b.sessions} session${b.sessions === 1 ? "" : "s"} · ${b.v}K avg out · ${b.note}`}></div>
                  <div className="bar-meta">
                    <div className="bar-l mono">{b.l}</div>
                    <div className="bar-n mono">{b.sessions} session{b.sessions === 1 ? "" : "s"}</div>
                    <div className="bar-note mono">{b.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          </div>
          <div className="bars-foot dim">
            Each bar: average output tokens per session in that week. Note the inflection at <strong>Apr 27</strong> — first full week on Max x5. Session count jumped ~10×; average per-session tokens stayed flat. The discipline absorbed Max's headroom without burning it on a few long sessions.
          </div>
        </div>
        <style>{`
          .bars {
            background: var(--paper-card);
            border: 1px solid var(--rule);
            border-radius: var(--r-lg);
            padding: 20px 24px 24px;
            box-shadow: var(--shadow-card);
          }
          .bars-grid { display: grid; grid-template-columns: 50px 1fr; gap: 14px; height: 280px; }
          .bars-scroll-wrap { min-width: 0; }
          @media (max-width: 720px) {
            .bars-scroll-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 6px; }
            .bars-scroll-wrap::-webkit-scrollbar { height: 8px; }
            .bars-scroll-wrap::-webkit-scrollbar-track { background: var(--paper-sunken); border-radius: 4px; }
            .bars-scroll-wrap::-webkit-scrollbar-thumb { background: var(--rule-strong); border-radius: 4px; }
            .bars-grid { min-width: 560px; }
          }
          .bars-y { display: flex; flex-direction: column; justify-content: space-between; font-family: var(--f-mono); font-size: 10.5px; color: var(--ink-faint); text-align: right; padding-top: 2px; padding-bottom: 56px; }
          .bars-plot { position: relative; display: flex; justify-content: space-around; align-items: flex-end; gap: 14px; padding-bottom: 56px; border-bottom: 1px solid var(--rule); }
          .bars-grid-lines { position: absolute; inset: 0 0 56px 0; }
          .bgl { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--rule-soft); }
          .bar-col {
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
            position: relative; height: 100%; max-width: 96px;
          }
          .bar-rect {
            width: 100%; background: var(--accent);
            border-radius: var(--r-sm) var(--r-sm) 0 0;
            min-height: 6px;
            transition: height 600ms var(--ease), filter var(--dur) var(--ease);
          }
          .bar-col:hover .bar-rect { filter: brightness(1.12); }
          .bar-val {
            font-size: 10.5px; color: var(--ink-soft);
            margin-bottom: 4px;
          }
          .bar-meta {
            position: absolute; bottom: -52px;
            display: flex; flex-direction: column; align-items: center; gap: 1px;
            text-align: center; width: 100%;
          }
          .bar-l { font-size: 10.5px; color: var(--ink); }
          .bar-n { font-size: 9.5px; color: var(--ink-soft); letter-spacing: 0.2px; }
          .bar-note { font-size: 9.5px; color: var(--ink-faint); letter-spacing: 0.1px; max-width: 100px; line-height: 1.3; word-break: normal; overflow-wrap: anywhere; }
          .bars-foot { font-size: 12.5px; line-height: 1.55; margin-top: 14px; color: var(--ink-soft); }
          .bars-foot strong { color: var(--accent); }
        `}</style>
      </section>

      {/* ── Tool shift table ───────────────────────────────────────── */}
      <section className="step">
        <StepHead step="E" title="Tool-usage shift" annot="FIRST HALF (71 SESSIONS) → SECOND HALF (72)" />
        <div className="card flush" style={{ overflow: "hidden" }}>
          <div className="ts-row ts-head">
            <div className="tag">Tool category</div>
            <div className="tag">Share shift</div>
            <div className="tag">Δ</div>
            <div className="tag">Reading</div>
          </div>
          {window.RECEIPTS_TOOL_SHIFTS.map((row, i) => {
            const delta = (row.saved || "").trim();
            const sign = delta.startsWith("−") || delta.startsWith("-") ? "minus" : delta.startsWith("+") ? "plus" : "flat";
            return (
              <div key={i} className="ts-row">
                <div className="ts-from mono">{row.from}</div>
                <div className="ts-to mono">{row.to}</div>
                <div className={"ts-delta mono ts-delta-" + sign}>{delta}</div>
                <div className="ts-earned">{row.earned}</div>
              </div>
            );
          })}
        </div>
        <div className="card pad" style={{ marginTop: 12, borderColor: "var(--accent-soft)", background: "var(--paper-tint)" }}>
          <div className="tag" style={{ marginBottom: 6 }}>HONEST FINDING</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, margin: 0, color: "var(--ink)" }}>
            The <code className="mono">tokensave_*</code> share went <em>down</em>, not up. The tokensave-first
            rule was added but adoption is still spotty (hit in 14 / 86 recent sessions per the rule corpus audit).
            <strong> This is a signal the rule needs better surfacing</strong>, not a win — and it's exactly why the
            toggle is in the bundle, defaulted to "ask the user" rather than silently on. The discipline only
            works when applied.
          </p>
        </div>
        <style>{`
          .ts-row {
            display: grid;
            grid-template-columns: 1.2fr 1.4fr 0.8fr 1.6fr;
            gap: 16px;
            padding: 12px 18px;
            align-items: center;
            border-top: 1px solid var(--rule-soft);
            font-size: 13px;
          }
          .ts-row:first-child { border-top: none; background: var(--paper-sunken); padding: 10px 18px; }
          .ts-from { color: var(--ink); }
          .ts-to { color: var(--ink-soft); font-size: 12.5px; }
          .ts-delta-minus { color: var(--red); }
          .ts-delta-plus { color: var(--green); }
          .ts-delta-flat { color: var(--ink-faint); }
          .ts-earned { color: var(--ink-soft); font-size: 12.5px; }
          @media (max-width: 720px) {
            .ts-row { grid-template-columns: 1fr; gap: 2px; padding: 12px 18px; }
            .ts-row:first-child { display: none; }
            .ts-row .ts-from::before { content: "tool · "; color: var(--ink-faint); font-family: var(--f-mono); font-size: 10.5px; }
            .ts-row .ts-to::before { content: "shift · "; color: var(--ink-faint); font-family: var(--f-mono); font-size: 10.5px; }
          }
        `}</style>
      </section>

      {/* ── Methodology footnotes ──────────────────────────────────── */}
      <section className="step">
        <StepHead step="F" title="Methodology" annot="HOW THE NUMBERS WERE EARNED" />
        <div className="meth">
          <div className="meth-block">
            <div className="meth-mark mono">¹</div>
            <div className="meth-body">
              <b>Cost measured wall-clock.</b> Each receipt logs the elapsed real time between the harmful action (or omission) and the recovery. Not idealised; not estimated.
            </div>
          </div>
          <div className="meth-block">
            <div className="meth-mark mono">²</div>
            <div className="meth-body">
              <b>Two source projects.</b> One consumer-software side project (private), one solo voxel-game build. Counts are de-duplicated across projects when the same rule was earned twice.
            </div>
          </div>
          <div className="meth-block">
            <div className="meth-mark mono">³</div>
            <div className="meth-body">
              <b>"Rule earned" is binding.</b> A receipt that didn't produce a rule, toggle, or bundle change isn't a receipt — it's a war story. War stories live in <span className="mono">CLAUDE.md</span>; receipts live here.
            </div>
          </div>
          <div className="meth-block">
            <div className="meth-mark mono">⁴</div>
            <div className="meth-body">
              <b>Baseline.</b> The baseline is the per-session cost in week 1 of tracking (2026-04-06, on Pro), before any of the v1.0.0 rules existed. The −18.4% tool-error figure at May-2026 reflects steady-state with the v1.0.0 toggle set applied.
            </div>
          </div>
        </div>
        <style>{`
          .meth { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
          .meth-block {
            display: grid; grid-template-columns: 32px 1fr; gap: 10px;
            background: var(--paper-card);
            border: 1px solid var(--rule);
            border-radius: var(--r-lg);
            padding: 16px 18px;
            box-shadow: var(--shadow-card);
          }
          .meth-mark { font-size: 18px; color: var(--accent); padding-top: 1px; }
          .meth-body { font-size: 13.5px; line-height: 1.55; color: var(--ink); }
          .meth-body b { font-family: var(--f-display); font-weight: 500; }
          @media (max-width: 720px) { .meth { grid-template-columns: 1fr; } }
        `}</style>
      </section>
    </>
  );
}

window.ReceiptsFolio = ReceiptsFolio;

function StepHead({ step, title, annot }) {
  return (
    <div className="step-head">
      <span className="step-tag mono">{step.length > 2 ? step : `STEP·${step}`}</span>
      <span className="step-title">{title}</span>
      {annot && <span className="step-annot">{annot}</span>}
    </div>
  );
}
