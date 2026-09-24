# Bindwright design system

Approved direction, 2026-09-23. `mockup.html` is the reference. This file holds the tokens and the rules that keep the page from reading as a generated template.

## Idea

The product is a set of files that land in a repo, so the most important thing on the page is that output: a live file tree and file preview that change as you answer. Controls feel physical, like keys on a keyboard or a synth. Color is used for one thing only: showing which setup you are building.

## Tokens

```css
--canvas:  oklch(0.20 0.006 240);  /* page */
--panel:   oklch(0.245 0.007 240); /* raised surfaces */
--key:     oklch(0.29 0.008 240);  /* unpressed controls */
--rule:    oklch(0.34 0.008 240);  /* dividers */
--text:    oklch(0.97 0 0);
--text-2:  oklch(0.80 0.01 240);   /* secondary text, stays readable */
--accent:      oklch(0.80 0.13 var(--hue));
--accent-deep: oklch(0.62 0.13 var(--hue)); /* key underside */
--on-accent:   oklch(0.20 0.03 var(--hue)); /* text on accent */
--add: oklch(0.80 0.14 150);  /* diff added */
--del: oklch(0.72 0.15 25);   /* diff removed */
```

`--hue` is a registered custom property, so it animates when the answers change (380 ms, ease-out).

| Setup (team?, client?) | Hue |
|---|---|
| Just me, my project | 150 |
| Team, my project | 200 |
| Just me, client project | 70 |
| Team, client project | 340 |

Radii: 12 px for keys and buttons, 18 px for panels. No other values.

## Type

- **Hubot Sans** (OFL, variable width and weight) for all interface text. Headline: weight 700, width 118%, tracking -0.03em.
- **Fragment Mono** (OFL) only inside real file contents. Never for labels.

## Controls

- Keys have a bottom lip (`inset 0 -3px 0`) and press down 2 px on `:active`.
- The selected key fills with `--accent`. Unselected keys keep a small colored light showing their hue.
- Switches and the primary button use `--accent` when on.
- The output panel carries a 3 px accent line on its top edge. The selected file in the tree gets a 2 px accent bar.

## Layout

- Desktop: headline and one-line explanation on top, then answers on the left and the live output on the right.
- Mobile: one column. The output collapses into a sticky bottom bar ("24 files, Preview, Download") that opens a sheet with a visible close button.

## Rules that keep it from looking generated

- No tracked all-caps labels, no middle-dot metadata strings, no monospace labels, no arrows appended to links.
- No gradients, glows, glass, or dot-grid backgrounds.
- No fade-in-on-scroll. Motion only confirms a state change: key press, hue shift, file tree update. Respect `prefers-reduced-motion`.
- Copy is plain, sentence case, specific. No em dashes, no "it's not X, it's Y", no aspirational filler.
- Every color has a job. If a color cannot be explained as "this is your setup" or "added/removed", remove it.

## Accessibility

- Text contrast at least 4.5:1, control boundaries and focus rings at least 3:1.
- Targets at least 24 by 24 px.
- Visible focus ring in `--accent`.
- Sticky bars use `scroll-padding` so focused controls are never hidden.
- Status changes ("Preview updated: 24 files", "Link copied") go through `role="status"`.
