// App shell: theme, sidebar, folio routing.
const { useState, useEffect, useCallback, useRef, useMemo } = React;

const FOLIOS = [
  { id: "bind",     n: "I",   label: "Bind",        sub: "configurator", comp: () => window.BindFolio   ? <window.BindFolio /> : null },
  { id: "compare",  n: "II",  label: "Compare",     sub: "bundle matrix", comp: () => window.CompareFolio? <window.CompareFolio /> : null },
  { id: "toggles",  n: "III", label: "Toggles",     sub: "catalog",    comp: () => window.TogglesFolio? <window.TogglesFolio /> : null },
  { id: "how",      n: "IV",  label: "How it binds",sub: "two paths",  comp: () => window.HowFolio    ? <window.HowFolio /> : null },
  { id: "receipts", n: "V",   label: "Receipts",    sub: "telemetry",  comp: () => window.ReceiptsFolio? <window.ReceiptsFolio /> : null },
  { id: "about",    n: "VI",  label: "About",       sub: "colophon",   comp: () => window.AboutFolio  ? <window.AboutFolio /> : null },
];

const APP_DEFAULTS = /*EDITMODE-BEGIN*/{
  "radius": 14,
  "accentHue": 38,
  "density": "normal"
}/*EDITMODE-END*/;

// ────────────────────────────────────────────────────────────────────────
// Tweaks: radius + accent + density.
// ────────────────────────────────────────────────────────────────────────
function applyTweaks(t) {
  const r = +t.radius || 14;
  document.documentElement.style.setProperty("--r-md", (r * 0.71).toFixed(0) + "px");
  document.documentElement.style.setProperty("--r-lg", r + "px");
  document.documentElement.style.setProperty("--r-xl", (r * 1.3).toFixed(0) + "px");
  document.documentElement.style.setProperty("--r-2xl", (r * 1.6).toFixed(0) + "px");
  document.documentElement.style.setProperty("--r-sm", Math.max(4, (r * 0.43).toFixed(0)) + "px");

  const h = +t.accentHue || 38;
  // Brand accent stays the same across themes; only the very-light/very-dark
  // tint background (used for accent-bg cards) flips for contrast.
  document.documentElement.style.setProperty("--accent", `oklch(72% 0.16 ${h})`);
  document.documentElement.style.setProperty("--accent-hi", `oklch(78% 0.17 ${h})`);
  document.documentElement.style.setProperty("--accent-soft", `oklch(72% 0.16 ${h} / 0.15)`);
  if (document.documentElement.getAttribute("data-theme") === "dark") {
    document.documentElement.style.setProperty("--accent-tint", `oklch(28% 0.07 ${h})`);
  } else {
    document.documentElement.style.setProperty("--accent-tint", `oklch(96% 0.025 ${h})`);
  }

  document.documentElement.setAttribute("data-density", t.density || "normal");

  // Force bg/color on documentElement (the host overrides them on body/#root,
  // but html element accepts inline !important).
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  document.documentElement.style.setProperty("background-color", isDark ? "#0b0e13" : "#f3f4f6", "important");
  document.documentElement.style.setProperty("background-image",
    `radial-gradient(${isDark ? "rgba(160,180,210,0.09)" : "rgba(20,30,50,0.10)"} 0.8px, transparent 0.8px)`,
    "important");
  document.documentElement.style.setProperty("background-size", "18px 18px", "important");
  document.documentElement.style.setProperty("color", isDark ? "#e6eaf0" : "#0e1116", "important");
}

// ────────────────────────────────────────────────────────────────────────
// Theme hook
// ────────────────────────────────────────────────────────────────────────
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const s = localStorage.getItem("cctpl-theme");
      if (s === "light" || s === "dark") return s;
    } catch {}
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("cctpl-theme", theme); } catch {}
  }, [theme]);
  return [theme, () => setTheme(t => t === "dark" ? "light" : "dark")];
}

// ────────────────────────────────────────────────────────────────────────
// Toasts
// ────────────────────────────────────────────────────────────────────────
const ToastCtx = React.createContext({ toast: () => {} });
function ToastHost({ children }) {
  const [list, setList] = useState([]);
  const toast = useCallback((msg) => {
    const id = Math.random().toString(36).slice(2);
    setList(l => [...l, { id, msg }]);
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="toast-stack">
        {list.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
window.useToast = () => React.useContext(ToastCtx);

// ────────────────────────────────────────────────────────────────────────
// Sidebar — replaces the old masthead. Holds brand, version, folio nav,
// theme toggle, and external links.
// ────────────────────────────────────────────────────────────────────────
function Sidebar({ folio, setFolio, theme, toggleTheme, mobileOpen, setMobileOpen }) {
  return (
    <aside className={"sidebar" + (mobileOpen ? " mobile-open" : "")}>
      <div className="sb-head">
        <div className="brand">
          <span className="brand-dot"></span>
          <span className="brand-name">claude-code-templates</span>
        </div>
        <div className="brand-rev mono">v1.3.0</div>
      </div>

      <nav className="sb-nav" aria-label="Folios">
        {FOLIOS.map(f => (
          <button key={f.id}
            className={"sb-link" + (folio === f.id ? " on" : "")}
            onClick={() => { setFolio(f.id); setMobileOpen(false); }}>
            <span className="sb-num">{f.n}</span>
            <span className="sb-label">{f.label}</span>
            <span className="sb-sub mono">{f.sub}</span>
          </button>
        ))}
      </nav>

      <div className="sb-foot">
        <button className="icon-btn" onClick={toggleTheme} aria-label="toggle theme"
          title={`switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <a className="icon-btn" href="https://github.com/starfoxcom/claude-code-templates"
          target="_blank" rel="noreferrer" aria-label="source on GitHub"
          title="source on GitHub">
          <GhIcon />
        </a>
        <span className="sb-meta mono">MIT · solo-maintained</span>
      </div>
    </aside>
  );
}

function MobileBar({ folio, setMobileOpen }) {
  const f = FOLIOS.find(x => x.id === folio);
  return (
    <header className="mobile-bar">
      <button className="hamburger" onClick={() => setMobileOpen(true)} aria-label="open menu">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 5h12M3 9h12M3 13h12"/>
        </svg>
      </button>
      <div className="mb-brand">
        <span className="brand-dot"></span>
        <span className="brand-name">claude-code-templates</span>
        <span className="mono mb-rev">v1.3.0</span>
      </div>
      <div className="mb-now mono">{f && `${f.n} · ${f.label}`}</div>
    </header>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.3 3.3l1 1M11.7 11.7l1 1M3.3 12.7l1-1M11.7 4.3l1-1"/>
      </g>
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 105.5 6.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}
function GhIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
  );
}

// ────────────────────────────────────────────────────────────────────────
// App
// ────────────────────────────────────────────────────────────────────────
function App() {
  const [folio, setFolio] = useState(() => {
    const h = (window.location.hash || "").replace("#", "");
    return FOLIOS.find(f => f.id === h) ? h : "bind";
  });
  useEffect(() => {
    window.location.hash = folio;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [folio]);
  useEffect(() => {
    const onHashChange = () => {
      const h = (window.location.hash || "").replace("#", "");
      if (FOLIOS.find(f => f.id === h)) {
        setFolio(prev => prev === h ? prev : h);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();

  // Tweaks
  const [tweaks, setTweak] = window.useTweaks(APP_DEFAULTS);
  useEffect(() => { applyTweaks(tweaks); }, [tweaks, theme]);

  const FolioBody = FOLIOS.find(f => f.id === folio);

  return (
    <ToastHost>
      <div className="app-shell">
      <Sidebar folio={folio} setFolio={setFolio} theme={theme} toggleTheme={toggleTheme}
        mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <MobileBar folio={folio} setMobileOpen={setMobileOpen} />
      {mobileOpen && <div className="sb-scrim" onClick={() => setMobileOpen(false)}></div>}
      <main className="page" id="main">
        <div key={folio} className="folio">
          {FolioBody && FolioBody.comp ? FolioBody.comp() : null}
        </div>
      </main>

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection title="Form" subtitle="Radius and accent hue.">
          <window.TweakSlider label="Corner radius" value={tweaks.radius} min={0} max={28} step={1}
            onChange={(v) => setTweak("radius", v)} unit="px" />
          <window.TweakSlider label="Accent hue" value={tweaks.accentHue} min={0} max={360} step={1}
            onChange={(v) => setTweak("accentHue", v)} unit="°" />
        </window.TweakSection>
      </window.TweaksPanel>
      </div>
    </ToastHost>
  );
}

ReactDOM.createRoot(document.getElementById("cct-app")).render(<App />);
