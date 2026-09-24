# Configurator UX research (2026-09-23)
1. Split-pane: collapsible numbered sections left + sticky live preview right (file tree, file view, brief, Download/Copy). Not a strict wizard (steps interdependent). NN/g wizards, progressive-disclosure, complex-apps heuristics.
2. Preset-first: bundle pre-fills all; "Modified: N changes vs OSS" badge, per-item reset, reset all. (NN/g power of defaults; shadcn/create preset codes)
3. URL state + Share button (start.spring.io, better-t-stack). Covers WCAG 3.3.7.
4. Explore output before download: file tree + highlighted file + per-file copy; mark files changed by overrides (spring Explore).
5. Toggles: 2 levels (bundle-differing + most-changed; rest by category accordions + search + "only changed"). Checkboxes, not switches. Applied-overrides chip summary (Baymard).
6. Stack chips: ~10 popular inline, rest via combobox search, Clear all, arrow keys (Smashing Feb 2026).
7. Inline conflict explanations (better-t-stack).
8. Compare matrix: highlight differences / hide identical, sticky header, mobile 2-at-a-time.
9. Mobile: accordion column + sticky bottom bar "12 files · Preview · Download" -> bottom sheet with visible X.
10. WCAG 2.2: 24px targets, scroll-padding for sticky bars, role=status announcements, 3:1 control contrast, reduced motion.
11. Preview <100ms, no spinners <1s, preload JSZip on idle.
12. Review panel (GOV.UK check answers) before download.
Refs: start.spring.io, better-t-stack.dev/new, ui.shadcn.com create, astro.new, create.t3.gg
