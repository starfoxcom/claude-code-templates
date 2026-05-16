// Folio III — Toggle catalog. Searchable, filterable table.

const { useState: tUseState, useMemo: tUseMemo } = React;

function TogglesFolio() {
  const [q, setQ] = tUseState("");
  const [group, setGroup] = tUseState("all");

  const allToggles = tUseMemo(() => {
    const list = [];
    window.TOGGLE_GROUPS.forEach(g => {
      g.toggles.forEach(t => list.push({ ...t, group: g.title, groupId: g.id }));
    });
    return list;
  }, []);

  const filtered = tUseMemo(() => {
    const ql = q.toLowerCase();
    return allToggles.filter(t => {
      if (group !== "all" && t.groupId !== group) return false;
      if (!ql) return true;
      return t.id.toLowerCase().includes(ql)
        || t.short.toLowerCase().includes(ql)
        || t.blurb.toLowerCase().includes(ql)
        || t.controls.toLowerCase().includes(ql);
    });
  }, [q, group, allToggles]);

  return (
    <>
      <div className="folio-head">
        <div className="kicker">Folio III · Toggle catalog</div>
        <h1>The whole switchboard.</h1>
        <p className="lede">All thirty-six toggles, what each one controls, and the default state under each bundle. The shape of the discipline, flattened.</p>
      </div>

      {/* Search + filter */}
      <section className="step">
        <div className="tg-controls">
          <input className="input" placeholder="search toggle id, behaviour, file…"
            value={q} onChange={e => setQ(e.target.value)} />
          <select className="select" value={group} onChange={e => setGroup(e.target.value)}>
            <option value="all">All groups ({allToggles.length})</option>
            {window.TOGGLE_GROUPS.map(g => (
              <option key={g.id} value={g.id}>{g.title} ({g.toggles.length})</option>
            ))}
          </select>
        </div>

        <div className="catalog-wrap">
          <div className="catalog">
            <div className="cat-row cat-head">
              <div className="tag">Toggle</div>
              <div className="tag">Controls</div>
              <div className="tag" style={{ textAlign: "center" }}>Solo</div>
              <div className="tag" style={{ textAlign: "center" }}>OSS</div>
              <div className="tag" style={{ textAlign: "center" }}>Cli-Solo</div>
              <div className="tag" style={{ textAlign: "center" }}>Cli-Team</div>
            </div>
            {filtered.length === 0 ? (
              <div className="cat-empty mono dim">No toggle matches "{q}".</div>
            ) : filtered.map((t) => (
              <div key={t.id} className="cat-row">
                <div className="cat-toggle">
                  <div className="mono cat-id">{t.id}</div>
                  <div className="cat-short">{t.short}</div>
                  <div className="cat-blurb">{t.blurb}</div>
                  <div className="cat-group mono">in {t.group}</div>
                </div>
                <div className="cat-controls mono">{t.controls}</div>
                <DefCell s={t.d["1-solo-personal"]} />
                <DefCell s={t.d["2-multi-dev-oss"]} />
                <DefCell s={t.d["3-client-solo"]} />
                <DefCell s={t.d["4-client-team"]} />
              </div>
            ))}
          </div>
        </div>
        <div className="dim mono" style={{ fontSize: 11, marginTop: 12, letterSpacing: 0.3 }}>
          Showing {filtered.length} / {allToggles.length}. Tri-state cycle: ON · OFF · ASK (asked during interview).
        </div>
      </section>

      <style>{`
        .tg-controls { display: grid; grid-template-columns: 1fr 280px; gap: 12px; margin-bottom: 18px; }
        @media (max-width: 640px) { .tg-controls { grid-template-columns: 1fr; } }
        .catalog-wrap { overflow-x: auto; border: 1px solid var(--rule); border-radius: var(--r-lg); background: var(--paper-card); box-shadow: var(--shadow-card); }
        .catalog { min-width: 800px; }
        .cat-row {
          display: grid;
          grid-template-columns: 1.4fr 1.2fr 56px 56px 56px 56px;
          gap: 14px; padding: 14px 18px;
          border-top: 1px solid var(--rule-soft); align-items: center;
        }
        .cat-row:first-child { border-top: none; }
        .cat-head { background: var(--paper-sunken); padding: 10px 18px; position: sticky; top: 0; z-index: 4; }
        .cat-id { font-size: 12px; color: var(--ink); }
        .cat-short { font-family: var(--f-display); font-size: 14px; font-weight: 500; margin-top: 2px; }
        .cat-blurb { font-size: 12.5px; color: var(--ink-soft); margin-top: 2px; line-height: 1.45; }
        .cat-group { font-size: 10px; color: var(--ink-faint); margin-top: 4px; letter-spacing: 0.4px; text-transform: uppercase; }
        .cat-controls { font-size: 11px; color: var(--ink-soft); line-height: 1.45; }
        .cat-empty { padding: 28px; text-align: center; font-size: 12px; }
      `}</style>
    </>
  );
}

function DefCell({ s }) {
  // 0 OFF, 1 ON, 2 ASK — catalog state badges. ON is a filled dark pill,
  // ASK is an accent pill, OFF is a quiet em-dash so the catalog reads at a
  // glance: where the colour is, there's a default; everywhere else — not.
  if (s === 0) {
    return (
      <div className="cat-def">
        <span className="df df-off mono" aria-label="off by default">—</span>
        <style>{`
          .cat-def { text-align: center; }
          .df { display: inline-block; font-family: var(--f-mono); font-size: 11px; letter-spacing: 0.4px; }
          .df-off { color: var(--ink-faint); }
        `}</style>
      </div>
    );
  }
  const lab = s === 1 ? "on" : "ask";
  const cls = s === 1 ? "df df-on" : "df df-ask";
  return (
    <div className="cat-def">
      <span className={cls}>{lab}</span>
      <style>{`
        .cat-def { text-align: center; }
        .df { display: inline-block; font-family: var(--f-mono); font-size: 10px; letter-spacing: 0.6px; padding: 3px 9px; border-radius: var(--r-sm); }
        .df-on { background: var(--surface-ink); color: var(--surface-ink-fg); }
        .df-ask { background: var(--accent); color: var(--accent-ink); }
      `}</style>
    </div>
  );
}

window.TogglesFolio = TogglesFolio;
