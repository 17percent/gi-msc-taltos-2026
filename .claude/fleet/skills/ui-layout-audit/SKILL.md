---
name: ui-layout-audit
description: Measure a web UI's layout instead of eyeballing a screenshot. Use before saying a UI is done, in QA of any page, and when a design looks off. Reports big unused gaps between blocks, asymmetric side strips, horizontal overflow, overlapping or clipped text, and unbalanced columns at phone, tablet and desktop widths.
---
# UI layout audit

Why: on 2026-10-01 a large gap under the left scene (the table sat below the taller right column) and an empty strip next to the canvas passed QA, review and product review, because everyone looked at a screenshot and the page "worked". Layout is measurable.

## Procedure
1. Make sure the app is served (not necessarily by you): `node scripts/layout-audit.cjs <url> [--viewports 390x844,1024x800,1400x900,1700x900] [--out report.json] [--shots dir]`.
   - The script finds Playwright and a headless Chromium by itself (env `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_CHROMIUM` override).
   - Run it as a script, read only its summary (do not paste screenshots back into context unless a finding needs a look).
2. Read the findings (each has viewport, kind, selector, px values). Kinds:
   - `overflow-x`: page wider than the viewport.
   - `gap`: vertical empty space between two blocks in the same column larger than 3x the grid gap (min 32 px).
   - `strip`: media (canvas/img/svg) narrower than its wrapper with more than 16 px of asymmetry or more than 40 px free on both sides.
   - `overlap`: two text elements overlapping by more than 30% of the smaller one.
   - `clipped`: text cut off by `overflow:hidden`.
   - `unbalanced`: in a two-column layout one column is less than half the height of the other and leaves more than 200 px empty (fill it, make it sticky, or move content).
3. Fix at the cause (grid rows `auto auto 1fr` with the tall side item spanning rows, center or stretch the media, allow wrapping), rerun, and attach the before/after counts to your report.
4. A clean run is evidence, a screenshot is not. Say which viewports were measured and which were not (real phone, Safari/Firefox are never covered by this).

## Pitfalls
- The check is heuristic: confirm each finding with a look at the screenshot before changing the design; false positives happen (e.g. intentionally empty areas). Mark those as accepted in the report.
- Do not run it on a production system that requires login without the owner's approval.
- Positive control: if you changed the checker, run it against a page with a known gap to prove it still fires.
