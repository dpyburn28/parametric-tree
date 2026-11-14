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
| Studio/standalone UI, analytics, batch, a11y | `node tests/app-ui.js` | pass |
| 2D/3D and split-studio visual baselines | `node tests/visual-regression.js` | pass |

To intentionally refresh visual baselines after a reviewed render change:

```sh
node tests/visual-regression.js --update
```

## Manual smoke checks

- [ ] `linked.html` boots both panes without iframes or console errors.
- [ ] `1` / `2` select the active pane; the active-pane highlight and `aria-pressed` state agree.
- [ ] Canvas-bound actions (prune, lasso, isolate, snapshot/compare, export) target only the active pane.
- [ ] Shared edits update both panes; time, season, seed, lifespan, and cuts stay in sync.
- [ ] `Space` play/pause, `R` restart, `H` hide/show UI, and `Esc` exit fullscreen work in the studio and both standalone pages.
- [ ] Fullscreen enters the active pane, hides the panel/header, and restores focus/UI on exit.
- [ ] Mobile/narrow layout opens the control drawer; backdrop click, `Esc`, and the close button close it; focus returns to the toggle.
- [ ] Skip link, focus-visible rings, canvas labels/descriptions, analytics `role="img"`, and the `#status` live region are present.
- [ ] Reduced motion defaults on when the OS requests it; restored state can override it.
- [ ] Prune modes, lasso, isolate, before/after compare, espalier, and undo/redo still work.
- [ ] Analytics: pin baseline, compare toggle, clear, hover tooltip/crosshair, click-to-seek, arrow-key stepping.
- [ ] Export: SVG dimensions/DPI/annotations/scale bar; PNG 1×/2×/4×; GLB roots/leaves/metadata/axis/units/LOD; CSV/JSON comparison columns.
- [ ] Batch ZIP: 2D writes SVG frames at 0/25/50/75/100% plus analytics/state/manifest; 3D writes the current GLB plus analytics/state/manifest; playback/time are preserved.
- [ ] Save/load state JSON round-trips, including `ui`, `exportSettings`, and `compare`.
- [ ] Share links restore the same state in both dimensions.
- [ ] Standalone 2D/3D pages still render and export independently.

## Accessibility checks

- [ ] Keyboard-only: skip link, panel controls, pane switch, transport, and export buttons are reachable.
- [ ] Focus is not lost when the drawer opens/closes or fullscreen toggles.
- [ ] Status/toast text is announced politely and remains readable.
- [ ] Text contrast passes AA for status and primary controls in the light/dark scene themes.
- [ ] Reduced motion removes nonessential animation (2D wind offsets, 3D sway/gust, snow).
- [ ] Chart is described and operable with arrow keys; the visual comparison is not the only way to read deltas.
- [ ] Touch targets in the drawer are at least ~44 px where practical.

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
- Standalone pages remain available at `prototype/2d-prototype.html` and `3d-prototype/3d-prototype.html`.
