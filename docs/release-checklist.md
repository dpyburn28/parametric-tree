# Release checklist — Phase 8 closeout

**Last validated:** 2026-11-14

This checklist covers the split studio and the standalone 2D/3D debug pages. Serve the project root over HTTP; the studio fetches pane templates and shared modules.

```sh
python3 -m http.server 8000
# open http://127.0.0.1:8000/linked.html
```

## Automated validation

| Check | Command | Expected |
|---|---|---|
| Shared schema, determinism, pruning | `node tests/phase5.js` | pass |
| Solar/wind/light, forests, obstacles, 7-tree profile | `node tests/phase6.js` | pass; 7-tree/300-year simulation < 3 s |
| Species and mixed-forest render traits | `node tests/phase7.js` | pass |
| State v2, v1 migration, malformed/future versions | `node tests/phase8.js` | pass |
| ZIP/CRC batch structure | `node tests/phase9.js` | pass |
| Studio/standalone UI, manifest, modes, dock, record stage, mobile sheet | `node tests/app-ui.js` | pass |
| Deterministic take controller | `node tests/record-controller.js` | pass |
| 2D/3D and split-studio visual baselines | `node tests/visual-regression.js` | pass |

To intentionally refresh visual baselines after a reviewed render change:

```sh
node tests/visual-regression.js --update
```

## Manual smoke checks

- [ ] `linked.html` boots both panes without iframes or console errors.
- [ ] The four-mode rail switches Grow / Sculpt / Study / Deliver; clicking the active mode collapses the flyout.
- [ ] Every control carries a scope chip and inline help popover; no control appears twice.
- [ ] Layout `Split` / `2D` / `3D` changes visibility only; clicking a pane or pressing `1` / `2` sets the acting view.
- [ ] Canvas-bound actions (prune, lasso, isolate, capture before, export) target only the acting pane.
- [ ] Shared edits update both panes; time, season, seed, lifespan, and cuts stay in sync.
- [ ] Dock: play/pause, step ±1 (Shift ±10), rewind, editable age, season band, stage labels, lifespan/speed/season popovers and sync chip.
- [ ] Grow: species cards, Spread/Bushiness/Leafiness, seed row, grouped Shape/Environment, collapsed Planting; Revert restores the base species.
- [ ] Sculpt: floating toolbar, hint strip, anchored inspector, undo/redo, clear cuts, isolate and Show ghost.
- [ ] Study: large chart, metric chips, source toggle, click/arrow seek, run A pin/compare/clear, overlays, node inspector.
- [ ] Node inspection: select only in Study; click sky/ground, press Esc, use Clear selection or the anchor close to deselect; the highlight and inspector card disappear and stay gone.
- [ ] Auto-zoom: independent 2D and 3D toggles are reachable from each pane View menu and persist across reloads.
- [ ] Hard reset: Project ▸ Reset app state clears the tree/session and UI layout, preserves the tour-seen flag, strips `?state=` and returns to Split / Grow defaults.
- [ ] Deliver Export: all six targets show the right options, switch the acting view when needed, and keep filenames/contents.
- [ ] Deliver Record: preset fills settings, preflight reports frame/quality/motion, preview runs, and a take goes Armed → Countdown → Running → Complete; `Esc` restores prior state.
- [ ] `Space` play/pause, `R` rewind-and-play, `H` hide/show UI, and `Esc` exit fullscreen work in the studio and both standalone pages.
- [ ] Fullscreen shows the acting pane plus the minimal dock; `H` hides the pill and dock.
- [ ] `⌘K` opens the command palette; results show group path and scope; Enter opens the control and focuses it.
- [ ] `?` opens the shortcut overlay; the first-run tour appears once and can be replayed from Help.
- [ ] Tablet (801–1100 px) uses the modal overlay drawer; phone (≤800 px) uses the bottom sheet with peek/half/full and one pane at a time.
- [ ] Touch targets are at least ~44 px where practical; the phone Timeline settings sheet exposes lifespan, speed and season.
- [ ] Skip link, focus-visible rings, canvas labels/descriptions, chart slider semantics, and the `#status` live region are present.
- [ ] Reduced motion defaults on when the OS requests it; restored state can override it.
- [ ] Prune modes, lasso, isolate, before/after compare, espalier, and undo/redo still work.
- [ ] Analytics: pin run A, compare toggle, clear, hover tooltip/crosshair, click-to-seek, arrow-key stepping.
- [ ] Export: SVG dimensions/DPI/annotations/scale bar; PNG 1×/2×/4×; GLB roots/leaves/metadata/axis/units/LOD; CSV/JSON comparison columns.
- [ ] Batch ZIP: 2D writes SVG frames at 0/25/50/75/100% plus analytics/state/manifest; 3D writes the current GLB plus analytics/state/manifest; playback/time are preserved.
- [ ] Save/load state JSON round-trips, including `ui`, `exportSettings`, and `compare`.
- [ ] Share links restore the same state in both dimensions; UI prefs (`ptree.ui.v1`) never enter share links.
- [ ] Standalone 2D/3D pages still render and export independently.

## Accessibility checks

- [ ] Keyboard-only: skip link, panel controls, pane switch, transport, and export buttons are reachable.
- [ ] Focus is not lost when the drawer opens/closes or fullscreen toggles.
- [ ] Status/toast text is announced politely and remains readable.
- [ ] Text contrast passes AA for status and primary controls in the light/dark scene themes.
- [ ] Reduced motion removes nonessential animation (2D wind offsets, 3D sway/gust, snow).
- [ ] Chart is exposed as a slider with `aria-valuemin/max/now/valuetext` and is operable with arrow keys; data table disclosure is present.
- [ ] Touch targets in the drawer and phone sheet are at least ~44 px where practical.

## Performance profile

Measured in the Node simulation harness on Apple Silicon (warm runs):

| Scene | Time | Nodes |
|---|---|---|
| 2D single tree, 300 years | ~0.67 s | 6,431 |
| 3D single tree, 300 years | ~1.31 s | 9,012 |
| 2D 7-tree `auto`, 300 years | ~1.51 s | 13,452 |
| 3D 7-tree `auto`, 300 years | ~1.60 s | 11,012 |

The 300-year simulation is intentionally CPU-heavy. Keep a loading/progress state; do not promise interactive regeneration for large forests. `tests/phase6.js` guards the 7-tree case at < 3 s. Chunked meshes, worker simulation, and adaptive ring topology remain deferred.

## Known deferred work

- 2D ground overhaul.
- Adaptive ring topology.
- SSAO and color grading.
- Chunked branch meshes and worker-based simulation.
- Full per-step light history.
- Ecology/biomechanics (root water competition, root:shoot ratio).
- Hidden-control API refactor.

## Release notes

- Persisted state is schema **v2**. v1 files migrate in memory; future versions and malformed JSON fail with a readable status message.
- Export settings, analytics baselines, and comparison state persist with the tree state and share links.
- The split studio is a true single-page app with shadow-root panes, not iframes.
- Studio UI preferences (mode, flyout, layout, Record settings, tour) use `localStorage` key `ptree.ui.v1` and never enter schema v2 or share links.
- The Record tab plays deterministic takes for OS screen capture; the app does not encode video.
- Standalone pages remain available at `prototype/2d-prototype.html` and `3d-prototype/3d-prototype.html`.
