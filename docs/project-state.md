# Parametric Tree — Current Product State and UI/UX Redesign Handoff

**Snapshot:** 2026-11-14
**Status:** Stage + dock UI/UX redesign implemented; validation passing
**Primary entry point:** `index.html` — the 2D/3D split studio  
**Standalone debug pages:** `prototype/2d-prototype.html`, `3d-prototype/3d-prototype.html`

> **How to use this document**
>
> This document describes the product as it exists today. It is intended to be given to a separate AI/designer together with a few screenshots of the current UI. The screenshots are the source of truth for visual appearance; this document is the source of truth for behavior, structure, constraints, and intent.
>
> This is not a request to rebuild the simulation. The goal is to redesign the **UI and UX** so the existing depth becomes easier to understand, navigate, and use — while preserving the behaviors listed in [Redesign constraints](#11-redesign-constraints-and-non-negotiables).
>
> Deferred work listed at the end is **not** part of this redesign brief unless the user explicitly expands the scope.

---

## 0. One-paragraph orientation

Parametric Tree is a browser-based procedural tree studio. A deterministic simulation grows a tree skeleton from a seed and a set of botanical/environmental parameters. Time is a scrubbable render dimension: the user can move from seed to a 300-year-old tree without re-running the simulation. Two renderers interpret the same idea: a clean, stylized **2D silhouette** on a Canvas 2D surface, and a richer, atmospheric **3D form** built with Three.js. The split studio places both side by side, gives them one shared transport and one universal control rail, and keeps their state synchronized. The product is already deep: species grammars, forests, solar/wind/light models, pruning, branch isolation, ghost comparison, analytics comparison, versioned persistence, share links, SVG/GLB/PNG/CSV/JSON/ZIP export, keyboard support, reduced motion, and a mobile drawer. The current UI, however, still reads like a powerful prototype: it is dense, flat in hierarchy, and organized around implementation categories rather than user workflows.

---

## 0. Redesign closeout (2026-11-14)

The **Stage + dock** redesign in [`ui-ux-redesign-plan.md`](ui-ux-redesign-plan.md) is implemented in the studio:

- **Mode rail + one flyout:** Grow, Sculpt, Study and Deliver replace the flat control rail. Every cloned control is described in `studio/manifest.js` and re-parented exactly once.
- **Stage:** Split, 2D-focus and 3D-focus layouts are separate from the acting view. The acting pane uses a 2px accent border and an “Acting here” chip; inactive panes show “Linked”. Focus layouts and phone pane switches suspend the hidden engine; it catches up from the shared state when shown again.
- **Transport dock:** persistent play/step/rewind, an editable age readout, a season-banded scrubber with stage labels, lifespan/speed/season popovers, sync status and a simulate progress sliver.
- **Grow:** species cards, Spread/Bushiness/Leafiness essentials, seed row, grouped Shape, grouped Environment with scope chips, collapsed Planting.
- **Sculpt:** tool flyout, floating toolbar, canvas hint strip, anchored inspector, renamed Capture before / Show ghost.
- **Study:** large analytics drawer with metric chips, stacked sparklines, source toggle, run A comparison, overlays and the full node inspector.
- **Deliver:** Record (deterministic takes for screen capture) and Export (SVG, PNG, GLB, CSV/JSON, batch ZIP, share link) tabs.
- **Discoverability:** command palette (`⌘K`), inline help, shortcut overlay, first-run tour, toasts and live-region announcements.
- **Responsive:** tablet overlay drawer, phone bottom sheet with peek/half/full snap points, one pane at a time, and a Timeline settings sheet.
- **Inspection:** node selection is Study-only, clears on empty clicks, `Esc`, the Clear selection button or the anchored close button, and survives state re-syncs by stable `budId:birthStep` identity.
- **View options:** Auto-zoom is independent for 2D and 3D, each exposed in its own pane View menu and persisted in `ptree.ui.v1`.
- **3D camera:** the 3D View menu exposes position, FOV, look-at, auto look-at, auto-orbit, and an optional separate orbit pivot; camera settings persist with the tree state.
- **Reset:** Project ▸ Reset app state clears saved tree/session state and UI layout preferences while preserving the tour-seen flag, then reloads to defaults.

UI preferences live in `localStorage` under `ptree.ui.v1` and never enter schema v2, state JSON or share links. The standalone 2D and 3D pages retain their original control surfaces and behavior.

---

## 1. Executive summary

### What it is

A **creative and analytical tool for growing, sculpting, studying, and exporting procedural trees**.

### What it currently does

- Grows deterministic 2D and 3D trees from a seed.
- Lets the user scrub age, play/pause, and change lifespan.
- Provides five species grammars plus a custom state: Poplar, Oak, Willow, Pine, Cherry.
- Simulates environment: sun, sky, wind, soil moisture, slope/aspect, obstacles/topiary, and forests of 1, 3, 5, or 7 trees.
- Renders seasons and species phenology: leaf-out, autumn color, leaf drop, evergreen behavior, cherry blossom/fruit.
- Supports pruning with thinning, heading, and pollard cuts; lasso multi-select; undo/redo; clear cuts.
- Supports inspection: click a node to read axis, bud, fate, light, load, tortuosity, and cut metadata.
- Supports branch isolation and before/after ghost comparison.
- Plots seven analytics rows and supports a pinned baseline comparison with deltas, tooltips, and chart-to-tree seeking.
- Persists state to localStorage, JSON files, and share links.
- Exports 2D SVG/PNG, 3D GLB/PNG, analytics CSV/JSON, state JSON, and batch ZIP handoffs.
- Runs as a true single-page split studio with no iframes, plus two standalone debug pages.

### Current maturity

The simulation, rendering, tooling, persistence, and export layers are substantially complete for the current phase. Automated checks pass for schema/determinism, environment, species traits, state migration, ZIP structure, studio UI, and visual regression. The product is **feature-rich but UX-underdesigned**. The main design debt is not missing capability; it is the absence of a clear information architecture, workflow model, visual hierarchy, and scope language around that capability.

### The core UX challenge

A new user sees a canvas, a timeline, two views, and a 390 px rail containing **80+ controls**. The rail mixes:

- tree creation,
- environment simulation,
- 3D-only rendering,
- analytics,
- canvas tools,
- destructive actions,
- persistence,
- export settings,
- debugging overlays,
- and help.

The redesign should make the product feel like a **deliberate studio** — one that supports a sequence such as:

1. choose a tree,
2. shape it,
3. study it,
4. deliver it,

without hiding the depth that makes the tool valuable.

---

## 2. Purpose, audience, and jobs to be done

### Product purpose

The project explores a simple but powerful idea:

> **A tree is a set of rules unfolding over time.**

The user can change the rules, change the environment, move through time, cut branches, compare outcomes, and export the result. The 2D view emphasizes silhouette, branch rhythm, and illustration. The 3D view emphasizes form, light, material, motion, and spatial presence.

### Likely users

The roadmap explicitly leaves the primary audience as an open question. Plausible audiences are:

- **Artists/illustrators** who want a distinctive tree silhouette or a reference for illustration.
- **Educators** who want to demonstrate how branching, light, and pruning affect form.
- **Landscape/urban designers** who want to explore tree form, spacing, shade, and maintenance interventions.
- **Game/asset developers** who want a GLB or SVG handoff.
- **Procedural graphics developers** who want an inspectable, deterministic growth model.

The redesign should not assume all of these are equally important. A key product decision is whether the primary experience is **artistic exploration**, **botanical/design analysis**, or **asset production**. The current UI tries to serve all three at once.

### Jobs to be done

| Job | User intent | Current support |
|---|---|---|
| **Explore** | “Show me what this species can become.” | Presets, timeline, 2D/3D views, seasons |
| **Tune** | “Make this tree narrower, older, windier, denser.” | Growth parameters, environment controls, advanced environment |
| **Sculpt** | “Cut this branch and show me the result.” | Prune, lasso, cut types, undo/redo, isolate, ghost compare |
| **Study** | “How does biomass/height/light change over time, and how does it compare?” | Analytics strip, baseline pin/compare, CSV/JSON |
| **Deliver** | “Give me an SVG, GLB, PNG, or batch package.” | Export options, LOD, units/axis, batch ZIP |
| **Return/share** | “Bring back exactly this tree.” | localStorage, save/load JSON, URL share links |

### Non-goals

The project is explicitly **not**:

- a full botanical/physiological simulator,
- a real-time physics solver for every branch,
- a photoreal replacement for offline 3D asset tools,
- a CAD/BIM tool,
- an engine that persists every random decision.

The design should communicate “convincing generative grammar,” not “scientific instrument.”

---

## 3. Design philosophy and invariants

These principles are central to the project and should survive a UI/UX redesign.

| Principle | Meaning | Design implication |
|---|---|---|
| **Simulate once, render by time** | `simulate()` runs when the seed/parameters change. Scrubbing time only re-derives visible growth, thickness, shade, season, and motion. | Time should feel like a first-class, instant dimension. Never make scrubbing feel like “regenerate.” |
| **Deterministic and inspectable** | Every random decision comes from hashed `(seed, budId, step, channel)` values. Same seed + params + cuts reproduce the tree. | Show the seed, make state reproducible, and keep the node inspector accessible. |
| **Species are grammars, not sliders** | Presets change axis behavior, branch angles, phenology, roots, and bark/leaf traits — not just five numbers. | Presets should feel like choosing a tree, not applying a filter. |
| **One model, two interpretations** | 2D and 3D share the parameter vocabulary, presets, cuts, and analytics, but use separate simulation/render loops. 2D is stylized; 3D is physical. | The UI must make “shared” vs “dimension-specific” obvious. |
| **Silhouette first** | Structure, branch rhythm, and leaf mass matter before material detail. | The canvas is the hero. Controls should support looking, not compete with looking. |
| **Fidelity hierarchy** | Structure → light → motion → material → micro-detail. | Advanced controls should be progressively disclosed, not dumped into one rail. |
| **Budgeted** | The 300-year simulation is CPU-heavy; 3D has LOD/quality tiers. | Design must communicate processing/regeneration states and avoid promising instant results for large forests. |
| **Progressive disclosure** | Keep the basic experience small; put grammar, biomechanics, and ecology behind “Advanced.” | The current “Advanced environment” details pattern is a start, but most depth is still visible at once. |
| **Test the look, not just the code** | Visual regression, silhouette recognition, and UX checks matter. | Preserve visual baselines; redesign should be reviewed visually, not only structurally. |
| **Accessible by default** | Keyboard, focus, labels, reduced motion, contrast, mobile. | The redesign must not regress the current accessibility work. |
| **No iframes** | The studio is one page; panes are shadow roots, not embedded pages. | Preserve the single-page, shared-state architecture unless there is a compelling reason to change it. |

### Architectural invariants

- `nodes[]` is a flat skeleton array; parents always have lower indices.
- 2D up is negative `y`; 3D up is positive `y`.
- Growth uses a bounded structural horizon (80 steps). The first 40 display years map 1:1; remaining growth is compressed across the lifespan.
- Prune cuts are stored as stable `budId:birthStep` keys.
- Pruning re-simulates and releases light, so unrelated branches can respond slightly; true byte-identity after pruning is an intentional non-goal.
- 2D and 3D simulations are separate implementations. Parity is at the schema/preset/state level, not identical skeletons.
- The studio state bus synchronizes full state plus lightweight time/season patches.

---

## 4. How the product works

### 4.1 Simulation model

The simulation grows the tree year by year into a flat `nodes[]` skeleton. Each node records:

- position,
- parent,
- birth/death years,
- branch order,
- axis identity and parent axis,
- segment index and path length,
- direction/frame vectors,
- bud type and fate,
- birth/current light,
- tortuosity and mechanical load,
- optional cut metadata.

Growth is shaped by:

- apical dominance,
- branch angle and order-specific angle bias,
- sympodial forking / leader decay,
- phototropism,
- gravity droop,
- plagiotropism,
- tortuosity,
- reiteration,
- root flare,
- shade sensitivity and branch shedding,
- wind lean and wind-shortened internodes,
- obstacle collision/containment,
- species phenology.

The light model is a cheap grid/voxel field: live nodes above a point shade it. Shade reduces growth and branching, can kill buds, and can shed whole lower branches so the crown lifts.

### 4.2 Rendering model

Given an age `t`, the renderer derives:

- how far each segment has grown or retracted,
- pipe-model radius,
- visible branch set,
- leaf/flower/fruit placement and seasonal style,
- ground/atmosphere,
- motion,
- analytics playhead.

The 2D renderer draws tapered quads, circular joints, roots, leaves, shadows, ground detail, overlays, and a canvas analytics strip. The 3D renderer builds a tapered branch mesh, instanced species leaves, roots, terrain, ground detail, atmosphere, shadows, debris/litter, snow, and optional bloom.

### 4.3 Two engines, one studio

The studio mounts both prototypes as ES modules into separate shadow roots. It does not use iframes. The shell provides:

- one shared transport,
- one universal control panel,
- active-pane selection,
- a fullscreen focus mode,
- an in-page state bus,
- shared export settings.

The universal panel is **cloned from the populated 2D control surface**, then 3D-only controls are injected. A 150 ms sync loop keeps the clone aligned with the engines. Controls dispatch to one or both hidden engine controls:

- shared edits go to both panes,
- canvas-bound actions go only to the active pane,
- dimension-specific controls exist only where their engine exists.

This is important for the redesign: the current panel is not a hand-authored React/Vue component. It is a shadow-root clone of the prototype’s form. A redesign can change the DOM and CSS, but it must preserve the behavior and scope rules.

| Aspect | 2D engine | 3D engine |
|---|---|---|
| Geometry | 2D branch plane; up is negative `y` | 3D; up is positive `y`; golden-angle phyllotaxis |
| Light | 2D light grid | 3D voxel light field |
| Roots | 2D root drawing | 3D root meshes |
| Renderer | Canvas 2D | Three.js |
| Camera | Fixed/auto-zoom | OrbitControls, auto-zoom, turntable |
| Ground | Stylized 2D ground detail | Terrain, instanced grass/rocks/shrubs/litter |
| Material | Flat silhouette | Bark, leaves, shadows, atmospheric light, optional bloom |

The two engines share the parameter vocabulary and state, but they do **not** produce identical skeletons.

### 4.4 State and persistence

Persisted state is **schema version 2**. A v1 payload is migrated in memory. The state contains:

```text
version, dimension, seed, params, cuts, time, season, seasonAuto,
activePreset, viz, ui, exportSettings, compare, camera
```

- `ui` is normalized but currently has no theme override; the scene drives the theme.
- `exportSettings` is shared across studio panes through `window.__TREE_EXPORT_SETTINGS__`.
- `compare` stores the analytics baseline and whether comparison is enabled.
- `camera` is 3D-only; 2D captures `null`.
- localStorage keys are `parametric-tree-state-app`, `-2d`, and `-3d`. Studio UI preferences use the separate key `ptree.ui.v1`.
- Share links encode base64 JSON in `?state=` (not compressed). UI preferences and Record settings never enter share links.
- Malformed JSON and future schema versions fail with a readable status message.
- Autosave is debounced ~400 ms.

### 4.5 Performance envelope

Measured on Apple Silicon, warm runs:

| Scene | Time | Nodes |
|---|---:|---:|
| 2D single tree, 300 years | ~0.67 s | 6,431 |
| 3D single tree, 300 years | ~1.31 s | 9,012 |
| 2D 7-tree auto mix, 300 years | ~1.51 s | 13,452 |
| 3D 7-tree auto mix, 300 years | ~1.60 s | 11,012 |

The 7-tree/300-year case is guarded at < 3 s. Simulation is synchronous on the main thread. The UI has no dedicated progress bar or skeleton-loading state; status text is the main feedback. GLB export builds geometry synchronously. Batch export pauses playback and restores the live time afterward. Visual regression uses tolerant pixel diffs; minor 3D MAE drift from GPU/timing nondeterminism is possible, but the checked-in baselines currently pass.

### 4.6 Technology and running

- Vanilla HTML/CSS/JavaScript.
- 2D: Canvas 2D.
- 3D: Three.js 0.170 via CDN import map; `OrbitControls`, `GLTFExporter`, `EffectComposer`, `UnrealBloomPass`.
- No npm/build step for the app.
- No backend, account system, or cloud storage; persistence is localStorage, JSON files, and share links.
- Node test scripts use headless Chrome/DevTools for UI and visual regression.
- Serve the project root over HTTP for the studio and 3D page:

```sh
python3 -m http.server 8000
# open http://127.0.0.1:8000/index.html
```

The studio fetches pane templates and shared modules. The standalone 2D page is dependency-light; the 3D page requires HTTP and the Three.js CDN. The current workspace is not a git repository; there are no commits or branches to inspect, only the files on disk. Automated validation covers `phase5`–`phase9`, `app-ui`, and visual regression; `docs/release-checklist.md` also contains optional manual smoke checks.

---

## 5. Feature inventory

| Area | Implemented today |
|---|---|
| **Tree creation** | Five species presets + Custom; lifespan 40–300; seed/reseed; growth sliders; root flare; crown forking |
| **Time** | Play/pause, scrub, restart, speed (buried in growth parameters), 4-year phenology cycle option |
| **Seasons/phenology** | Manual season slider; leaf-out, full canopy, senescence, leaf drop, autumn hue; evergreen pine; cherry blossom/fruit |
| **Environment** | Sun angle (2D) or azimuth/elevation (3D); solar model with latitude/day/hour; sky presets; wind direction/speed/gust; shelter; slope/aspect; soil moisture; exposure/fog; obstacles/topiary; 1/3/5/7-tree forests; species/age mix; spacing; crown shyness |
| **3D-only** | Orbit camera; turntable; sway and gust; ground detail/density; snow; espalier; bloom; bark/leaf materials; LOD; performance HUD; wireframe |
| **Sculpting** | Prune mode; thinning/heading/pollard; hover subtree ghost; lasso multi-select; clear cuts; undo/redo; cut history |
| **Inspection** | Click-to-inspect node metadata; selected-node marker; 3D wireframe marker |
| **Comparison** | Before/after ghost snapshot (2D/3D); branch isolation; analytics baseline pin/compare/clear with dashed overlays and deltas |
| **Analytics** | Seven-row strip: biomass, tips/shed, light, height, crown width, leaf area, leaf light; playhead; hover tooltip/crosshair; click/arrow-key seek; CSV/JSON; comparison columns |
| **Persistence** | localStorage autosave; save/load JSON; URL share link; v1→v2 migration; readable load errors |
| **Export** | 2D SVG with layers/line-art/background/dimensions/DPI/annotations/scale bar; 2D/3D PNG 1×/2×/4×; 3D GLB with roots/leaves/metadata/axis/units/LOD; CSV/JSON; batch ZIP with manifest |
| **Accessibility** | Skip links; focus-visible; ARIA labels/live regions; keyboard shortcuts; focus-trapped mobile drawer; reduced-motion defaults; coarse-pointer targets |
| **Standalone pages** | Independent 2D and 3D debug harnesses with their own controls and exports |

---

## 6. Current UI structure

> **Superseded for the studio.** The Stage + dock implementation is summarized in §0. The sections below record the pre-redesign structure and remain accurate for the standalone 2D/3D pages, the engine behavior and the control semantics that the new shell re-parents.

### 6.1 Surfaces

There are three visible surfaces:

1. **Split studio** — `index.html`. Primary product surface.
2. **Standalone 2D** — `prototype/2d-prototype.html`. Debug/reference page.
3. **Standalone 3D** — `3d-prototype/3d-prototype.html`. Debug/reference page.

The studio and standalone pages share visual DNA but are not identical:

- The studio has a fixed app shell and a universal panel.
- Standalone pages put the canvas at the top and all controls below it in a scrollable document.

### 6.2 Studio desktop layout

At widths above 1100 px:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Header: brand | Play · Age slider · 2D/3D switch · Active · Fullscreen · Hide controls · Copy link | status / standalone links │
├──────────────────────────────────────┬───────────────────────────────┤
│ 2D pane                              │ 3D pane                       │ Control rail (390 px) │
│ ┌ pane header: 2D silhouette  Active┐│ ┌ 3D form  Active ┐           │ ┌ Controls ─────────┐ │
│ │ canvas + legend                  ││ │ canvas + hint/legend/perf   │ │ Both views share  │ │
│ │ stats + analytics strip          ││ │ stats + analytics strip     │ │ one state          │ │
│ └──────────────────────────────────┘│ └──────────────────────────────┘ │ scrollable form    │ │
└──────────────────────────────────────┴───────────────────────────────┴───────────────────────┘
```

Key measurements and behavior:

- App background: warm off-white with a subtle radial highlight.
- Header spans both columns; brand left, transport center, status/links right.
- Main area: two equal panes with an 8 px gap and 8 px padding.
- Control rail: 390 px wide, full height, scrollable.
- Pane: rounded 14 px card, thin border, subtle shadow.
- Active pane: green-tinted border + glow + “Active” pill in the pane header.
- Pane content: only the viewport, stats, and analytics are shown; the prototype’s own `.wrap` controls are hidden inside the shadow root.
- The panel can be collapsed with “Hide controls”; on desktop it is removed from the grid.

### 6.3 Studio narrow/mobile layout

At widths ≤ 1100 px:

- Header becomes a single column.
- The control rail becomes a fixed right-side drawer: `width: min(92vw, 420px)`.
- The drawer starts closed; a backdrop appears when open.
- The drawer is modal: `role="dialog"`, `aria-modal="true"`, header/main `inert`, focus trap, Escape/backdrop/close button to close, focus returns to the toggle.
- The panes remain side by side until 800 px.

At widths ≤ 800 px:

- The two panes stack vertically in a 1fr/1fr grid.
- The transport wraps; the age control flexes.
- Each pane is its own scrollable `view-host`; the canvas is capped at `min(32vh, 320px)` at ≤ 900 px.
- This can create nested scrolling: the page is fixed height, each pane scrolls internally, and the drawer scrolls separately.

### 6.4 Standalone pages

Both standalone pages use the same top-to-bottom pattern:

```text
skip link
sticky top:
  canvas
  play | age slider | fullscreen
  stage + stats
  analytics strip
scrollable controls:
  species & season
  environment
  advanced environment
  growth parameters
  action row
  export options
  analytics comparison
  keyboard help
  algorithm visualizations
  node inspector
  “How it works” explainer
toast
fullscreen exit/hint
```

The 2D canvas is `min(46vh, 480px)`. The 3D canvas is `min(50vh, 520px)`. The controls area is max-width 760 px and centered. The growth parameter grid auto-fits at 220 px. This is a documentation/reference layout, not the primary product layout.

### 6.5 Header and shared transport

The studio header contains:

- **Brand:** “Parametric tree” / “2D / 3D split studio”.
- **Play/Pause:** toggles shared playback.
- **Age:** label, numeric value, and range slider. Max = lifespan + 1.
- **2D / 3D switch:** segmented control; this is not only a view switch — it selects the **active pane** for canvas-bound actions. `aria-pressed` reflects selection. Keyboard `1` / `2`.
- **Active:** `Active: 2D` / `Active: 3D` live region.
- **Fullscreen:** expands the active canvas. Title says “Expand the active canvas (F)”.
- **Hide/Show controls:** toggles the rail/drawer.
- **Copy link:** copies a share URL for the canonical state.
- **Status:** `#status`, `role="status"`, `aria-live="polite"`.
- **Standalone links:** “2D only” and “3D only”.

The header is fixed light even when the scene inside a pane is dark. This creates a deliberate or accidental visual split depending on the viewer.

### 6.6 Canvas pane anatomy

Each studio pane contains:

- Pane header: title (“2D silhouette” / “3D form”) and active pill.
- Shadow-root-rendered prototype view:
  - canvas,
  - legend pill (only when visualization modes are active),
  - 3D orbit hint (“Drag to orbit · Scroll to zoom”),
  - optional performance HUD,
  - stats line (`Seed`/`Seedling`/`Sapling`/`Young tree`/`Mature tree`, year, height, segments, tips, node-cap warning),
  - analytics strip.

The pane canvas is the main visual focus, but the pane header and analytics strip consume vertical space. In fullscreen, the header, stats, analytics, and controls disappear; only the canvas remains, plus an exit pill and a shortcut hint.

### 6.7 Universal control rail: actual section order

The panel is cloned from the 2D `.wrap`, with 3D-only sections injected. The effective order is:

1. **Species & season**
   - Preset buttons: Poplar, Oak, Willow, Pine, Cherry, Custom.
   - Lifespan slider.
   - Season slider.
   - Follow phenology checkbox.
2. **Environment**
   - 2D sun angle.
   - Wind.
   - Obstacle select.
   - Obstacle size.
   - Trees (1/3/5/7).
3. **Advanced environment** (collapsed)
   - Solar model, latitude, day, hour.
   - Sky preset, sun samples.
   - Wind direction, gust.
   - Species mix, spacing, age mix, crown shyness.
   - Slope, aspect, soil moisture.
   - Exposure, fog.
   - Reduce motion.
   - Quality.
4. **3D-only environment** (expanded by default)
   - 3D sun azimuth, 3D sun elevation.
   - 3D sway, scale sway with wind.
   - Ground detail, ground density.
   - Snowfall, espalier plane, bloom.
5. **Growth parameters**
   - Branch angle, branching, apical dominance, crown forking, phototropism, droop, plagiotropism, tortuosity, reiteration, root flare, shade sensitivity, branch shedding, leaf density, play speed.
   - One slider per row in the panel; a flat grid in standalone.
6. **Action row**
   - New seed, Reset, Prune, Lasso, Cut type, Clear cuts, Undo cut, Redo cut, Isolate selected, Snapshot, Compare.
   - Export 2D SVG, Export CSV, Save state, Load state, Copy link, Export PNG, Export JSON.
   - Auto-zoom, seed display.
7. **Export options** (collapsed)
   - SVG roots/branches/leaves/background/line art.
   - PNG scale 1×/2×/4×.
   - SVG width/height/DPI.
   - SVG annotations/scale bar.
   - Export batch ZIP.
8. **3D view & export** (collapsed)
   - 3D turntable, branch wireframe, performance HUD.
   - Export 3D GLB.
   - GLB roots/leaves/metadata.
   - Axis Y-up/Z-up.
   - Units metres/centimetres.
   - GLB detail Full/Light/Silhouette.
9. **Analytics comparison** (collapsed)
   - Pin baseline, Compare, Clear.
   - Baseline label.
   - Delta summary.
10. **Keyboard help** (collapsed)
    - Undo/redo, prune/lasso/isolate, Space, R, H, F, Esc.
11. **Algorithm visualizations**
    - Bark color mode: natural, branch order, light, vigor, pipe vs age floor.
    - Skeleton & nodes.
    - Light grid.
    - Tropism vectors.
    - Shed branch ghosts.
    - X-ray.
    - In the studio, the 3D branch wireframe and performance HUD are cloned into “3D view & export,” not this section. In the standalone 3D page they remain here.
12. **Node inspector**
    - Empty placeholder until a node is clicked.
13. **“How it works” explainer** — removed from the studio clone; still present in standalone pages.

This order is implementation-driven, not workflow-driven. In particular:

- 3D-only environment sits between “Advanced environment” and “Growth parameters.”
- 3D view/export sits after export options, not next to the 3D pane.
- Canvas tools, destructive actions, persistence, and several export buttons are all in one wrapping action row.
- Analytics and comparison are far below the chart they describe.
- Help and debugging overlays are at the bottom.

### 6.8 Control inventory

#### Species & season

| Control | Range / options | Default | Notes |
|---|---|---|---|
| Species preset | Poplar, Oak, Willow, Pine, Cherry, Custom | Custom | Applying a preset changes growth traits, phenology, bark/leaf traits, clears cuts, and regenerates. “Custom” only changes the active label; it does not reset parameters. |
| Lifespan | 40–300, step 5 | 300 | Changes time slider max and structural compression; clears cuts. |
| Season | 0–1, step 0.01 | 0.33 | Render-only; manual override. Labels Spring/Summer/Autumn/Winter. |
| Follow phenology | checkbox | off | Cycles season every 4 simulated years; manual season slider turns it off. |

#### Environment

| Control | Range / options | Default | Scope |
|---|---|---|---|
| 2D sun angle | -75–75° | 0 | 2D only |
| Wind | -0.5–0.5 | 0 | Both |
| Obstacle | None, Wall, Boulder, Topiary sphere, Topiary cone, Hedge wall, Box/arch | None | Both |
| Obstacle size | 20–150, step 5 | 60 | Both |
| Trees | 1, 3, 5, 7 | 1 | Both |
| 3D sun azimuth | 0–360° | 0 | 3D only |
| 3D sun elevation | 10–90° | 90 | 3D only |
| 3D sway | 0–1.5 | 0.6 | 3D only |
| Scale sway with wind | checkbox | off | 3D only |
| Ground detail | checkbox | on | 3D only |
| Ground density | Low, Medium, High | Medium | 3D only; disabled when ground detail is off |
| Snowfall | checkbox | off | 3D only |
| Espalier plane | checkbox | off | 3D only |
| Bloom | checkbox | off | 3D only |

> In the **standalone 3D page**, sun azimuth/elevation, sway, and ground detail/density live in the main Environment section, while snowfall/espalier/bloom live in Advanced environment. In the **studio**, those controls are regrouped into the “3D-only environment” section.

#### Advanced environment

| Control | Range / options | Default |
|---|---|---|
| Solar model | checkbox | off |
| Latitude | -60–60° | 40 |
| Day of year | 1–365 | 172 |
| Hour | 0–24, step 0.5 | 12 |
| Sky preset | Clear, Golden hour, Overcast, Winter | Clear |
| Sun samples | 1, 3, 5 | 3 |
| Wind direction | 0–360°, step 5 | 0 |
| Gust | 0–1 | 0.18 |
| Species mix | Current preset, Auto mix, Oak, Pine, Willow, Cherry, Poplar | Current preset |
| Spacing | 80–360, step 10 | 200 |
| Age mix | 0–1 | 0 |
| Crown shyness | 0–1 | 0.2 |
| Slope | 0–35° | 0 |
| Aspect | 0–360°, step 5 | 0 |
| Soil moisture | 0–1 | 0.6 |
| Exposure | 0.5–1.5, step 0.05 | 1.0 |
| Fog | 0–0.003, step 0.0001 | 0.0008 |
| Reduce motion | checkbox | OS preference |
| Quality | Auto, High, Medium, Low | Auto |

#### Growth parameters

| Control | Range | Default |
|---|---|---|
| Branch angle | 15–85° | 40 |
| Branching | 0.1–1 | 0.55 |
| Apical dominance | 0–0.9 | 0.35 |
| Crown forking | 0–1 | 0.2 |
| Phototropism | 0–0.6 | 0.15 |
| Droop | 0–0.6 | 0.2 |
| Plagiotropism | 0–1 | 0.35 |
| Tortuosity | 0–1 | 0.25 |
| Reiteration | 0–1 | 0.2 |
| Root flare | 0–1.5 | 0.6 |
| Shade sensitivity | 0–1.5 | 0.5 |
| Branch shedding | 0–1 | 0.4 |
| Leaf density | 0–1 | 0.6 |
| Play speed | 0.5–8 | 2.5 |

`PARAM_DEFS` includes `group` values (`Structure`, `Light`, `Render`) and `help` strings, but the current UI does **not** display the help text or use the groups. This is a clear opportunity: the content already exists in the data model.

#### Action row

| Group | Actions |
|---|---|
| Tree | New seed, Reset |
| Canvas tools | Prune, Lasso, Cut type (Thinning/Heading/Pollard), Clear cuts, Undo cut, Redo cut, Isolate selected |
| Comparison | Snapshot, Compare |
| Export | Export 2D SVG, Export CSV, Export PNG, Export JSON (batch ZIP and 3D GLB live in their own sections) |
| Persistence | Save state, Load state, Copy link |
| View | Auto-zoom (both); 3D turntable (standalone 3D action row; cloned into “3D view & export” in the studio) |
| Identity | Seed display |

> The studio panel’s action row is cloned from the 2D page, so **Export 3D GLB** and the 3D turntable appear under “3D view & export,” not in the action row. In the standalone 3D page they are in the action row.

Important semantics:

- **Reset** resets the timeline to year 0. It does not reset parameters, seed, cuts, or the tree.
- **New seed** generates a new tree and clears cuts.
- **Clear cuts** is undoable.
- **Snapshot/Compare** is a structural ghost comparison, separate from the analytics baseline comparison.
- **Isolate selected** does nothing if no node is selected.
- **Copy link** appears both in the header and the panel.
- **Save state / Load state / Export CSV / Export PNG / Export JSON / Snapshot / Compare / Isolate / Undo / Redo / Prune / Lasso / New seed** target the active pane in the studio. **Export batch ZIP** also targets the active pane. **Export SVG** exists only in 2D; **Export GLB** exists only in 3D.

#### Export options

2D:

- SVG roots, branches, leaves/flowers, background, line art.
- PNG scale 1×/2×/4×.
- SVG width 200–4096 (default 1200).
- SVG height 200–4096 (default 800).
- SVG DPI 96/150/300.
- SVG annotations.
- SVG scale bar.
- Export batch ZIP.

3D:

- GLB roots, leaves/flowers, metadata.
- Axis Y-up/Z-up.
- Units metres/centimetres.
- GLB detail Full/Light/Silhouette.
- PNG scale 1×/2×/4×.
- Export batch ZIP.

Export settings are persisted in tree state and shared across studio panes. The shared settings object includes both 2D and 3D keys even when one pane has no UI for them. In the studio, the panel’s **Export options** section is cloned from the 2D page: it contains the shared PNG scale and batch ZIP controls plus the 2D SVG settings. The 3D GLB controls are cloned into **3D view & export**. This explains why GLB configuration is spatially separate from the rest of export.

#### Analytics comparison

- **Pin baseline:** freezes the current analytics run (points, lifespan, seed, preset, time).
- **Compare:** toggles dashed baseline overlays.
- **Clear:** removes the baseline.
- Baseline label: `Baseline: seed … · preset · …y`.
- Summary: year vs baseline deltas for biomass, height, crown width, leaf area.

#### Algorithm visualizations

- Bark color mode: Natural bark, Branch order (0–4), Light level (0–1), Vigor (apical dominance), Pipe model vs age floor.
- Skeleton & nodes.
- Light grid cells (2D) / light voxels (3D).
- Tropism vectors.
- Shed branches (ghosts).
- X-ray (dim bark & leaves).
- 3D standalone also adds Branch wireframe and Performance HUD. In the studio panel, those two are cloned into “3D view & export.”

These are debugging/teaching overlays. They are valuable for the “inspectable” philosophy but are mixed into the main panel with the same visual weight as creative controls.

### 6.9 Fullscreen

- Trigger: Fullscreen button or `F`.
- The active pane fills the viewport; header, panel, pane header, stats, and analytics are hidden.
- A floating “Exit 2D/3D fullscreen” pill appears at top right.
- A shortcut hint appears below it: `Space play/pause · R restart · H hide UI · Esc exit`.
- `H` hides the exit pill and hint for a clean canvas.
- `Esc` exits fullscreen.
- `Space` toggles playback; `R` restarts from 0 and plays.
- In standalone pages, fullscreen hides the controls and analytics but keeps the canvas.

The fullscreen experience is canvas-first, but it removes the transport and all visible controls. A user who does not know the shortcuts can feel trapped or limited.

### 6.10 Feedback and empty states

- Studio status text: “Loading views…”, “Both views live · synced”, “Synced”, state-load warnings, “Share link copied”, “Analytics baseline pinned”, “Batch ZIP exported”, export failures.
- Standalone toast: bottom-center, transient.
- Active state: filled green buttons for Prune/Lasso/Play/Compare.
- Disabled state: undo/redo, compare/clear where appropriate.
- Inspector empty state: “Click the tree to inspect a node.”
- Analytics empty state: “Pin a run to compare metrics.”
- 3D legend/hint/perf HUD are conditional overlays.
- There is no global loading/progress indicator for a long regeneration beyond status text.

---

## 7. Current interaction model

### 7.1 Active pane

The active pane is the target for canvas-bound actions. It is selected by:

- clicking anywhere in a pane,
- the 2D/3D segmented switch,
- keyboard `1` / `2`.

The active pane is indicated by:

- green-tinted border and glow,
- “Active” pill in the pane header,
- `Active: 2D/3D` live text in the header,
- `aria-pressed` on the switch.

This is a subtle but critical model. The 2D/3D switch looks like a view selector, but it is also an **action target selector**. The redesign should make that dual role unmistakable.

### 7.2 Shared vs active-only behavior

| Interaction | Scope |
|---|---|
| Preset selection | Both panes |
| Growth parameter sliders | Both panes |
| Environment controls | Both panes where the control exists |
| Lifespan, season, follow phenology | Both panes |
| Time/playback | Shared transport drives both |
| Reset timeline | Both panes |
| Export settings | Shared object; UI exists per dimension |
| Auto-zoom | Both panes |
| Prune/Lasso | Active pane only |
| Cut type | Both panes (shared select) |
| Undo/Redo | Active pane only |
| Clear cuts | Both panes |
| Isolate/Snapshot/Compare | Active pane only |
| New seed | Active pane only |
| Save/Load state | Active pane only |
| Share link (panel) | Active pane only |
| Export SVG | 2D only |
| Export GLB | 3D only |
| Export CSV/PNG/JSON | Active pane only |
| Export batch ZIP | Active pane only |
| 3D turntable | 3D only |
| 3D camera | 3D only (persisted; not mirrored to 2D) |
| Ground detail/density | 3D only |

> **Important nuance:** “Active pane only” describes where the action is **targeted**. Because the studio shares state, a change made in the active pane is usually broadcast to the other pane afterward. For example, New seed targets the active engine, then the new seed syncs to both. The distinction is mainly about which engine receives the immediate canvas interaction and which state is used for the action.

The panel header says “Both views share one state,” but the UI does not consistently label which controls are shared and which are dimension-specific. The 3D-only sections help, but shared controls and 2D-only controls are not equally labeled.

### 7.3 Timeline and playback

- `Play` / `Pause` toggles playback.
- The age slider scrubs `0…lifespan+1`.
- Playback speed is in Growth Parameters (`Play speed`, 0.5–8 years/sec), not in the transport.
- `Space` toggles playback; `R` restarts from 0 and plays.
- `Reset` also sets time to 0 but stops playback.
- Changing lifespan clamps time and clears cuts.
- Season can be manual or follow phenology.
- The analytics chart can also seek time by click or arrow keys.

### 7.4 Canvas gestures

2D:

- Click: inspect a node (outside prune/lasso).
- Prune mode + click: cut the branch/subtree under the pointer.
- Prune mode + hover: red subtree ghost preview.
- Lasso mode + drag: select multiple branch roots inside the polygon and cut them.
- Auto-zoom fits the visible tree; off fits the final tree.

3D:

- Drag: orbit.
- Scroll: zoom.
- Click: inspect (outside prune/lasso).
- Prune mode + click/hover: cut/preview.
- Lasso mode + drag: select branch roots inside the screen-space polygon.
- Turntable toggle auto-rotates.
- Camera state persists in 3D save/load.
- Auto-zoom reframes to visible bounds while preserving orbit orientation.

### 7.5 Pruning model

- Cut types: Thinning (remove subtree cleanly), Heading (cut back to a bud, local regrowth), Pollard (repeated heading/knuckle, dense regrowth).
- Cuts are stored as stable `budId:birthStep` keys.
- Hover ghosts the subtree in red.
- Committed cuts add wound markers (dark rings in 2D, wound geometry in 3D).
- Undo/redo history is snapshot-based.
- Clear cuts is itself undoable.
- Cuts reset when seed, growth slider, preset, or lifespan changes; environment changes preserve cuts.
- Pruning releases shade, so nearby branches can respond.

### 7.6 Comparison and isolation

There are **two different comparison concepts** with similar language:

1. **Structural ghost comparison** — “Snapshot” captures the current visible branch set; “Compare” toggles a dashed/ghost overlay of that prior structure. This is for before/after pruning or growth.
2. **Analytics baseline comparison** — “Pin baseline” freezes the metrics run; “Compare” overlays dashed metric lines and shows deltas. This is for two parameter/seed runs.

The UI does not strongly distinguish these. “Snapshot/Compare” and “Pin baseline/Compare” both live in the panel, and both use the word “Compare.” This is a major naming/mental-model risk.

**Isolate selected** dims everything outside the selected node’s subtree and highlights the subtree (yellow/amber in 3D). It requires a selected node.

### 7.7 Node inspector

- Click a visible node outside Prune/Lasso to inspect it.
- 2D highlights the selected node with an amber ring; 3D uses a wireframe marker.
- The inspector shows:
  - node index and axis,
  - order and parent axis,
  - segment index and path length,
  - bud/step and bud type,
  - fate (live/shed/pruned/broken),
  - birth light and current light,
  - tortuosity and mechanical load,
  - cut metadata,
  - position.
- In the studio, the inspector is mirrored from the active pane into the universal panel.
- The empty state is a single line; there is no “click outside prune mode” hint in the panel.

### 7.8 Analytics interactions

- The strip is a canvas, `role="img"`, with a label describing click-to-seek and arrow-key stepping.
- Rows: biomass, tips/shed, light, height, crown, leaf area, leaf light*.
- Playhead follows current time.
- Hover shows a crosshair and tooltip for the row under the pointer.
- Click seeks time.
- Arrow keys step 1 year; Shift+Arrow steps 10.
- Pinned baseline draws dashed lines; a legend says “solid current · dashed baseline.”
- The summary shows deltas for biomass, height, crown width, and leaf area.
- CSV/JSON include baseline and delta columns when a baseline exists.
- Leaf light is explicitly a final-canopy approximation (`leafLightModel: 'final-canopy'`).

### 7.9 Keyboard shortcuts

Studio and standalone support:

| Key | Action |
|---|---|
| `Space` | Play/pause |
| `R` | Restart timeline (and play) |
| `F` | Toggle fullscreen |
| `H` | Hide/show remaining fullscreen UI |
| `Esc` | Exit fullscreen / close mobile drawer / clear lasso, isolation, compare |
| `1` | Select 2D pane (studio) |
| `2` | Select 3D pane (studio) |
| `P` | Toggle Prune mode |
| `L` | Toggle Lasso mode |
| `I` | Toggle Isolate selected |
| `Cmd/Ctrl+Z` | Undo cut |
| `Cmd/Ctrl+Shift+Z` or `Ctrl+Y` | Redo cut |
| `Alt/Option+1…4` | Switch Grow / Sculpt / Study / Deliver (matched by physical key) |
| `Cmd/Ctrl+K` | Open the command palette |
| `?` | Open the keyboard shortcuts overlay |

Shortcuts are surfaced in the header `?` overlay and the Project menu. In the redesigned studio, `1`/`2` set the acting view, while the header layout switch (`Split` / `2D` / `3D`) changes only what is visible and suspends the hidden engine until it is shown again.

### 7.10 Persistence and export flows

**Save state**

- Writes a versioned JSON file for the active pane.
- Includes seed, params, cuts, time, season, preset, viz, UI, export settings, comparison, camera (3D).
- Filename: `parametric-tree-2d-seed-<seed>.json` or `-3d-`.

**Load state**

- Opens a file picker for the active pane.
- Restores state and regenerates.
- Errors surface via status/toast.

**Copy link**

- Header: uses canonical studio state.
- Panel: active pane state.
- Encodes base64 JSON in `?state=`.
- Share links restore both dimensions in the studio.

**Exports**

- 2D SVG: vector branches, roots, leaves/flowers; optional background, line art, annotations, scale bar, dimensions/DPI; metadata.
- 2D PNG: 1×/2×/4×.
- 3D GLB: current visible branches, leaves/flowers, roots; optional metadata; Y-up/Z-up; m/cm; Full/Light/Silhouette LOD; excludes ground, lights, obstacles, overlays.
- CSV: per-step analytics table; comparison columns if pinned.
- JSON: analytics current/baseline/comparison.
- Batch ZIP: 2D writes five SVG frames at 0/25/50/75/100% of lifespan + current.svg + analytics.csv + state.json + manifest.json. 3D writes current.glb + analytics.csv + state.json + manifest.json. Playback/time are preserved. The ZIP writer is dependency-free, store-only (no compression), with CRC checks and a manifest.

---

## 8. Visual design language

### Palette

| Token | Light | Dark |
|---|---|---|
| Background | `#f6f4ee` (standalone) / `#e9e6dd` (studio shell) | `#171a16` |
| Foreground | `#22251f` / `#20241e` | `#e8eadf` |
| Muted | `#6b6f64` / `#687064` | `#9aa08f` |
| Card | `#ffffff` / `#fffdf8` | `#20241e` |
| Line | `#d9d6ca` / `#cfcabc` | `#34392f` |
| Accent | `#3f7d3a` | `#7fc46f` |
| Accent soft | — / `#e4efdf` | — |
| Sky/soil/grass | scene-driven CSS variables | scene-driven |

The visual identity is **warm paper + forest green + soft cards**, with a more atmospheric 3D scene. The 2D view is flatter and more illustrative; the 3D view adds sky gradients, terrain, bark, leaves, shadows, and bloom.

### Typography

- System UI stack: `system-ui, -apple-system, Segoe UI, Roboto, sans-serif`.
- Studio body: 14 px; standalone body: 15 px.
- Panel section headings: 11 px uppercase, letter-spaced, muted.
- Panel details summaries: 12 px, 650 weight.
- Panel buttons: 12 px; standalone buttons: 15 px.
- Stats: 13 px.
- Analytics labels: 10 px canvas text.
- No custom display typeface, no icon set.

### Surfaces and shape

- Rounded cards: 10–14 px.
- Buttons: 8–10 px.
- Pills: 999 px.
- Thin borders, low-contrast shadows.
- Studio panes are large rounded cards; panel is a flat rail with a header.
- Standalone controls are cards within a centered column.
- Native range inputs, selects, checkboxes; `accent-color` for ranges.

### Theme behavior

- **Scene-driven**, not OS-driven.
- In standalone pages, the sun elevation changes the whole document theme, sky, soil, and grass.
- In the studio, each pane’s shadow host gets `data-theme="light|dark"` based on its own sun state. The app shell and universal panel remain fixed light.
- There is no UI theme override. The state has a `ui.theme` field normalized to `'auto'`, but it is not used as a manual override.
- This means a dark 3D scene can sit inside a light shell, and the panel can look visually disconnected from the canvas.

### 2D vs 3D visual language

| Aspect | 2D | 3D |
|---|---|---|
| Canvas | Flat paper-like sky/ground, silhouette, tapered quads, ellipses | Atmospheric sky, terrain, shadows, bark, leaves, bloom, snow |
| Camera | Auto-zoom or fixed full-tree fit | OrbitControls + auto-zoom + turntable |
| Detail | Stylized, illustration-oriented | Physical, material-oriented |
| Overlays | Skeleton, light grid, tropism, shed ghosts, x-ray | Skeleton, voxels, tropism, shed ghosts, wireframe, perf HUD, x-ray |
| Performance | Lightweight | LOD/quality sensitive |

### Motion

- 2D: subtle wind offsets, leaf shimmer; reduced motion disables nonessential animation.
- 3D: hierarchical branch sway, leaf flutter, gust fronts, turntable, snow, falling debris/litter; reduced motion disables sway, snow, spin.
- UI transitions are short (120–160 ms) and disabled under reduced motion.
- Fullscreen and drawer transitions are the main UI motion.

### Iconography and affordances

- No icon system; actions are text buttons.
- Active tools use filled green.
- Destructive vs creative vs export actions are not visually differentiated.
- Range sliders show a numeric value floated right; no tick labels or units in most cases.
- Help text exists in `PARAM_DEFS.help` but is not rendered.
- The node inspector is a text table, not a spatial/contextual panel.

---

## 9. Accessibility and responsive behavior

### Implemented

- Skip links in studio and standalone pages.
- `:focus-visible` outlines with offset and contrasting halo.
- Canvas `role="img"` and `aria-describedby` help text.
- Analytics `role="img"` and descriptive label.
- Studio status live region.
- Pane switch `aria-pressed`, `aria-keyshortcuts`.
- Mobile drawer:
  - `role="dialog"`, `aria-modal="true"` when open,
  - focus trap,
  - `inert` on header/main,
  - Escape/backdrop/close,
  - focus restoration.
- Keyboard pane selection (`1`/`2`).
- Keyboard playback/fullscreen/prune/lasso/isolate/undo/redo.
- Reduced-motion defaults from `prefers-reduced-motion`; restored state can override.
- Coarse-pointer touch targets (~44 px).
- Responsive rail/drawer/stacked panes.
- Color-blind-safe analytics palette (Okabe-Ito).
- Basic contrast checks in the UI test.

### Current gaps / risks

- Direct canvas pruning and node selection require a pointing device; there is no keyboard branch navigation.
- The analytics canvas is interactive but exposed as `role="img"`; keyboard seeking works, but the role does not communicate the interaction model.
- The canvas is `role="img"` even though it is interactive (prune/inspect/orbit).
- Shortcut help is buried in a collapsed details.
- The mobile drawer is long and scroll-heavy; the canvases are behind a modal while editing.
- The stacked mobile panes create nested scroll regions.
- The fixed-light studio shell against a dark scene may reduce perceived contrast/coherence.
- No live announcement for long regeneration completion beyond “Synced.”
- `Isolate selected` with no selection is a silent no-op.
- Disabled/undo/redo states are present, but other no-op actions are not explained.

---

## 10. Current UX audit

This section is intentionally candid. These are observations about the current implementation, not criticisms of the underlying product.

### Strengths

1. **The core magic is strong.** Scrubbing time and watching a tree grow is immediately compelling.
2. **The 2D/3D pairing is distinctive.** Seeing silhouette and form side by side is the product’s signature.
3. **The depth is real.** Species grammars, environment, pruning, analytics, persistence, and export are not demos.
4. **The deterministic model is trustworthy.** The same seed reproduces the same tree; state and share links work.
5. **The visual language is coherent at the canvas level.** Warm paper, forest green, and atmospheric 3D feel related.
6. **Accessibility work is substantive.** Focus management, ARIA, reduced motion, and mobile drawer behavior are better than most prototypes.
7. **The export story is unusually complete.** SVG, GLB, PNG, CSV, JSON, state, share, and batch ZIP cover many handoffs.
8. **The analytics comparison is genuinely useful.** Pinning a baseline and seeing deltas is a real workflow.

### Friction points

| # | Observation | Why it matters |
|---|---|---|
| 1 | **80+ controls in one rail, with implementation-driven ordering.** | Users cannot tell where to start or what matters. The rail is a settings dump, not a workflow. |
| 2 | **Shared vs dimension-specific scope is inconsistent.** | Users may not know whether a change affects both views, only 2D, or only 3D. The panel subtitle is not enough. |
| 3 | **The 2D/3D switch is both a view selector and an action target.** | Clicking “3D” changes what Prune/Export/Save act on, but the control reads like a tab. This is a high-risk mental-model mismatch. |
| 4 | **Two different “Compare” systems share the same word.** | Structural ghost compare vs analytics baseline compare are unrelated. Users may pin the wrong baseline or expect the wrong overlay. |
| 5 | **“Reset” resets time, not the tree.** | Users may expect a full reset and instead only rewind the timeline. “New seed” is the actual tree reset. |
| 6 | **Canvas tools, destructive actions, persistence, and export are one undifferentiated button wall.** | High-consequence actions sit next to exports; grouping and hierarchy are absent. |
| 7 | **The timeline is split across the header, Growth Parameters, and keyboard help.** | Play, speed, restart, lifespan, season, and phenology are related but spatially scattered. |
| 8 | **Analytics is a small 140 px strip with seven compressed rows.** | The chart is hard to read, especially on smaller screens; axes/ticks are absent; the baseline workflow is far from the chart. |
| 9 | **Export configuration is split between “Export options” and “3D view & export,” while several export buttons live in the action row and batch ZIP lives in Export options.** | Users must hunt across three places to configure and trigger an export. |
| 10 | **The mobile experience is a long modal drawer plus nested scrolling panes.** | Editing while seeing the canvas is difficult; advanced controls are far away; the drawer is not task-oriented. |
| 11 | **The studio shell/panel is fixed light while the scenes are scene-themed.** | A dark 3D scene inside a light shell can feel visually disconnected; the panel does not inherit the scene mood. |
| 12 | **Help text exists but is not shown.** | `PARAM_DEFS.help` and `ENV_META.help` are unused, so users see labels like “Plagiotropism” and “Reiteration” with no explanation. |
| 13 | **There is no onboarding or first-run orientation.** | New users are not told about active pane, shared state, simulate-once, click-to-inspect, or prune. The “How it works” explainer is removed from the studio. |
| 14 | **Regeneration can take ~1.5 s for large forests with no progress indicator.** | Dragging a slider can feel unresponsive; “Synced” does not communicate “simulating.” |
| 15 | **Several actions are silent no-ops or ambiguous.** | “Isolate selected” with no selection, “Custom” preset, “Reset,” “Snapshot” vs “Compare,” and “Copy link” in two places all create uncertainty. |
| 16 | **Debug/teaching overlays have the same visual weight as creative controls.** | Skeleton, light grid, tropism, wireframe, and perf HUD are powerful but should not compete with the primary creation workflow. |
| 17 | **No visual iconography or primary/secondary button system.** | All text buttons look similar; scanning is slow; destructive vs creative vs export actions are not distinguishable at a glance. |
| 18 | **Fullscreen removes all controls.** | The canvas-first mode is beautiful but can feel trapping; only shortcut-literate users can operate it. |
| 19 | **The inspector is a text table at the bottom.** | It is useful for debugging but disconnected from the selected branch; a contextual inspector would better support “inspect this branch.” |
| 20 | **The current panel is a cloned DOM, not a component model.** | This constrains how easily the UI can be reorganized; a redesign should either work with the clone/sync model or deliberately refactor it. |

### The highest-leverage UX problems

If the redesign solves only five things, these are the five:

1. **Create a workflow-based information architecture** instead of a flat control dump.
2. **Make scope explicit** — shared vs 2D vs 3D vs active-pane action.
3. **Unify and rename comparison** — structural ghost vs analytics baseline.
4. **Make the timeline/transport a first-class, persistent control surface.**
5. **Turn analytics and export into real workspaces**, not compressed details sections.

---

## 11. Redesign constraints and non-negotiables

### Must preserve

- The true single-page split studio with **no iframes**.
- Both 2D and 3D renderers and their distinct visual character.
- The standalone 2D and 3D pages as working debug/reference surfaces.
- One universal control panel (it can be reorganized, but there should not be two independent control rails).
- Shared state: presets, parameters, environment, time, season, lifespan, cuts, and export settings stay synchronized.
- Active-pane behavior for canvas-bound actions.
- Pruning: prune, lasso, cut types, hover preview, undo/redo, clear cuts.
- Isolation and structural ghost comparison.
- Node inspector.
- Analytics and baseline comparison.
- Persistence: localStorage, JSON save/load, share links, schema v2 and v1 migration.
- Exports: SVG, GLB, PNG, CSV, JSON, batch ZIP; existing options and manifest behavior.
- Keyboard shortcuts: `Space`, `R`, `H`, `Esc` (and `F`, `1`, `2`, `P`, `L`, `I`, undo/redo).
- Reduced-motion behavior and current accessibility affordances.
- Scene-driven theme; do not add a UI theme override without a deliberate product decision.
- No pulling deferred render/ecology/performance backlog into the redesign.

### Can change

- Information architecture, grouping, labels, ordering, and panel structure.
- Visual hierarchy, spacing, typography, color usage, iconography, and component styling.
- Layout proportions, split behavior, panel placement, and responsive strategy.
- Onboarding, help, empty states, and feedback.
- Analytics presentation (larger, axes, selected metric, comparison workspace).
- Export flow (preview, presets, progress, grouping).
- Action grouping and primary/secondary/destructive styling.
- Contextual toolbars, command palette, or mode-based workspaces.
- The DOM/CSS implementation, provided behavior and compatibility are preserved.

### Must not break

- State round-trip: save → reload → load restores the same tree/cuts/time/camera.
- Share links restore both dimensions.
- Batch ZIP structure and manifest.
- Existing export options and filenames where practical.
- The active-pane action model.
- The `budId:birthStep` cut identity.
- 2D/3D state synchronization.
- Mobile drawer focus trap and keyboard access.
- Visual regression baselines (or intentionally update them after review).

### Deferred / out of scope

- 2D ground overhaul. The ground-overhaul direction remains low-poly and 3D-only.
- Adaptive ring topology.
- SSAO and color grading.
- Chunked branch meshes.
- Worker-based simulation.
- Full per-step light history.
- Ecology/biomechanics (root water competition, root:shoot ratio, full mechanical solver).
- Hidden-control API refactor.
- Unified single-simulation 2D/3D parity.

---

## 12. Redesign direction: opportunities and a possible organizing model

The following is a design brief, not a final specification. The redesign AI should use the screenshots and this document to settle on a concrete direction.

### 12.1 Organizing idea: a studio with modes, not a settings page

A strong direction is to organize the product around four user modes while keeping the canvas central:

| Mode | User question | Primary content |
|---|---|---|
| **Grow** | “What tree am I making?” | Species, seed, growth parameters, lifespan, season, environment |
| **Sculpt** | “How do I shape it?” | Prune, lasso, cut type, undo/redo, isolate, structural compare |
| **Study** | “What is happening over time?” | Timeline, analytics, baseline comparison, inspector, overlays |
| **Deliver** | “How do I take it with me?” | SVG/GLB/PNG/CSV/JSON/state/ZIP, export settings, share |

These modes do not need to be separate pages. They can be tabs, a segmented rail, a command palette, or contextual panels. The key is that the user should always know **what job the current controls serve**.

### 12.2 Scope model

Make scope visible at the control level:

- **Both views** — shared edits.
- **2D only** — 2D sun angle, SVG export.
- **3D only** — 3D sun, sway, ground detail, snow, espalier, bloom, GLB, turntable.
- **Active view only** — prune, lasso, isolate, snapshot/compare, save/load, CSV/PNG/JSON, batch ZIP.

Possible treatments:

- A small scope chip or icon on each section/control.
- A persistent “Active view: 2D” context bar above canvas tools.
- A panel filter: “All / Shared / 2D / 3D.”
- Separate “Shared controls” and “View-specific controls” groups.
- A clear “Applies to both” note on presets and growth parameters.

The redesign should remove the ambiguity where a control looks shared but only affects one view, or looks like a tab but changes action targets.

### 12.3 Persistent transport and timeline

Move time to a first-class dock:

- Play/pause, restart, step back/forward.
- Age scrubber with year readout.
- Playback speed.
- Lifespan.
- Season and phenology mode.
- Maybe markers for pruning events or structural milestones.

The timeline should remain available in fullscreen, at least in a minimal form. The current `Space`/`R` shortcuts can remain, but they should not be the only way to control time in a canvas-first mode.

### 12.4 Active-pane model

Make the active pane unmistakable:

- A clear “Working in 2D/3D” label near canvas tools.
- Distinct active-pane chrome, not only a border.
- Contextual action bar that says “Prune 3D” or “Export 3D GLB.”
- A focus/fullscreen action that clearly targets the active pane.
- Possibly a “link views” toggle if the redesign wants to allow independent editing later — but the current product is shared, so do not introduce divergence casually.

### 12.5 Action hierarchy

Replace the wrapping button wall with grouped, prioritized actions:

- **Primary:** Play, Prune/Lasso, Export.
- **Canvas tools:** Prune, Lasso, Cut type, Undo, Redo, Clear, Isolate.
- **Comparison:** Ghost snapshot, Ghost compare, Analytics baseline.
- **Persistence:** Save, Load, Share.
- **Export:** SVG/GLB/PNG/CSV/JSON/ZIP.
- **Destructive:** New seed, Clear cuts, Reset timeline — visually distinct and confirmed or undoable where appropriate.

Use icons + labels for scanability. Keep text labels for accessibility and clarity.

### 12.6 Analytics as a workspace

The current strip is a good start but too compressed. A redesign could:

- Give analytics a larger, resizable panel or a “Study” tab.
- Add axes, units, and tick labels.
- Let the user focus one or two metrics instead of seven tiny rows.
- Make baseline pinning a clear two-step flow: “Pin current run” → “Compare.”
- Rename structural vs metric comparison.
- Put the baseline controls next to the chart, not in a distant details section.
- Keep chart-to-tree seeking and keyboard stepping.
- Explain the final-canopy leaf-light approximation.

### 12.7 Export as a workflow

Create a dedicated “Deliver” area:

- Choose target: 2D SVG, 3D GLB, PNG, analytics CSV/JSON, state JSON, batch ZIP.
- Configure options with a preview or summary.
- Show what will be included (roots, leaves, metadata, LOD, dimensions, DPI).
- Show batch contents before export.
- Preserve the current manifest and file structure.
- Keep export settings shared/persisted.

### 12.8 Onboarding and help

Use the existing `PARAM_DEFS.help` and `ENV_META.help` content:

- Tooltips or inline help for each parameter.
- A first-run orientation: “This is a split studio. Both views share one state. Click a pane to make it active. Prune/export acts on the active pane.”
- Contextual hints for click-to-inspect and prune mode.
- A shortcut overlay accessible from the header.
- A short “How it works” explainer in the studio, not only standalone pages.

### 12.9 Mobile

A bottom sheet or mode-based control surface would likely work better than a long right drawer:

- Keep the active pane visible while editing.
- Use tabs/sections: Grow, Sculpt, Study, Deliver.
- Keep the transport sticky.
- Collapse advanced controls by default.
- Avoid nested scroll regions.
- Preserve focus trap, Escape, backdrop, and focus restoration.

### 12.10 Visual system

- Resolve the fixed-light shell vs scene-driven canvas tension.
- Consider letting the shell/panel follow the active scene theme, or deliberately frame the canvas as a “stage” inside a neutral studio.
- Use a small icon set for tools and export types.
- Establish primary/secondary/quiet/destructive button styles.
- Use section-level scope chips.
- Keep the warm paper/forest-green identity; it fits the product.
- Preserve the distinct 2D/3D visual languages rather than flattening them into one.

### 12.11 Success criteria for the redesign

A successful redesign should let a new user:

1. Understand within ~30 seconds that there are two linked views and which one is active.
2. Choose a species and scrub time without touching advanced controls.
3. Know which controls affect both views and which affect only one.
4. Prune a branch, undo it, isolate a branch, and compare before/after without hunting.
5. Pin an analytics baseline, change a parameter, and explain the delta.
6. Export the current 2D or 3D result without searching three sections.
7. Use the app on a narrow screen without losing the canvas or the transport.
8. Recover from a mistaken action via undo, clear labeling, or confirmation.

---

## 13. Open questions for the redesign AI

These are intentionally unresolved. The redesign should make a recommendation, not assume an answer.

1. **Who is the primary user?** Artist, educator, landscape designer, or asset developer?
2. **Is 2D a co-equal view, a technical illustration mode, or a lightweight preview of 3D?**
3. **Should both panes always be visible, or should the product support a focus mode with one pane at a time?**
4. **Is export a primary workflow or an end-of-session utility?**
5. **Is the forest/ecology mode a first-class feature or an advanced demo?**
6. **Should the shell follow the scene theme, stay neutral, or offer a deliberate UI theme control?**
7. **How much onboarding is appropriate for a creative tool?**
8. **Should advanced/debug overlays live in a separate “Inspect” mode rather than the main rail?**
9. **Should the structural ghost compare and analytics baseline compare be unified under one “Compare” concept, or clearly renamed and separated?**
10. **What is the target device mix?** Desktop-first, tablet, or phone?
11. **Is a build step/framework acceptable, or should the redesign stay vanilla/static?**
12. **Which export target matters most: Blender/Three.js, vector/print, or web/game engines?**

---

## 14. Acceptance criteria for the redesigned UI/UX

### Functional

- All current features remain reachable.
- Shared edits still update both panes.
- Canvas-bound actions still target the active pane.
- State save/load/share round-trips.
- Batch ZIP structure and manifest remain valid.
- Keyboard shortcuts still work.
- Standalone pages still work.

### Usability

- A new user can identify the active pane and the scope of a control.
- The primary workflow (choose → grow → scrub → sculpt → study → export) is discoverable.
- Destructive actions are distinguishable from creative/export actions.
- Structural compare and analytics compare are unambiguous.
- The timeline is usable without memorizing shortcuts.
- Analytics and export are not buried.

### Accessibility

- No regression in focus, labels, live regions, reduced motion, or mobile drawer behavior.
- Keyboard users can reach all controls and core actions.
- Canvas interactions have an accessible alternative or clear description.
- Contrast remains AA for primary text/controls.

### Responsive

- Desktop split studio remains usable at 1440×900 and common laptop sizes.
- Narrow/tablet drawer remains usable.
- Stacked mobile layout avoids nested-scroll traps and keeps the canvas/transport reachable.
- Touch targets remain adequate.

### Visual

- The 2D and 3D visual identities remain distinct.
- The canvas remains the hero.
- The UI feels like one product, not a prototype control dump.
- Visual regression baselines are intentionally reviewed/updated if the redesign changes rendering chrome.

### Performance

- No new main-thread blocking work on scrub.
- No regression in 7-tree/300-year budget.
- Long regeneration has visible feedback.
- LOD/quality controls remain available.

---

## Appendix A — File map

| Path | Role |
|---|---|
| `index.html` | Studio shell, header, mode rail, flyout, stage panes, transport dock, Study drawer, dialogs and record stage |
| `linked.css` | Studio tokens, shell, stage, dock, dialogs, fullscreen, record stage |
| `studio.css` | Mode rail, flyout chrome, stage tools, Study drawer, record chrome, responsive sheet |
| `linked.js` | Studio controller, manifest mount/sync, modes, layout, transport, Study chart, palette, record controller and mobile sheet |
| `studio/manifest.js` | One entry per cloned control with mode, group, disclosure level, scope and help |
| `studio/prefs.js` | UI-only preferences (`ptree.ui.v1`) |
| `studio/icons.js` | Inline SVG icon set |
| `studio/record-controller.js` | Deterministic take sampling, easing, holds, loops and camera orbit helpers |
| `prototype/2d-prototype.html` | Standalone 2D page and control markup |
| `prototype/styles.css` | Standalone 2D visual design and responsive/accessibility styles |
| `prototype/simulation.js` | 2D skeleton simulation |
| `prototype/main.js` | 2D renderer, UI wiring, analytics, inspector, pruning, export |
| `3d-prototype/3d-prototype.html` | Standalone 3D page and control markup |
| `3d-prototype/styles.css` | Standalone 3D visual design |
| `3d-prototype/simulation.js` | 3D skeleton simulation |
| `3d-prototype/main.js` | Three.js renderer, materials, LOD, camera, UI, analytics, pruning, export |
| `shared/params.js` | Shared defaults, parameter metadata, dimension overrides |
| `shared/presets.js` | Species grammar presets |
| `shared/grammar.js` | Order-angle and phenology helpers |
| `shared/environment.js` | Solar, sky, wind, slope, soil helpers |
| `shared/state.js` | Schema v2, migration, capture/restore, share/localStorage helpers |
| `shared/zip.js` | Dependency-free store-only ZIP writer |
| `tests/phase5.js` | Shared schema, determinism, metadata, roots, phenology, pruning |
| `tests/phase6.js` | Solar/wind/light, forests, obstacles, 7-tree/300-year profile |
| `tests/phase7.js` | Species render traits |
| `tests/phase8.js` | State v2/migration/round-trip |
| `tests/phase9.js` | ZIP/CRC structure |
| `tests/app-ui.js` | Studio manifest/modes/dock/record/palette/mobile checks plus standalone accessibility and behavior |
| `tests/record-controller.js` | Take sampling unit tests (easing, holds, loops, season, camera, determinism) |
| `tests/visual-regression.js` | 2D/3D/studio visual baselines |
| `docs/release-checklist.md` | Automated/manual release checks and current profile |
| `parametric-tree.md` | Refinement/fidelity roadmap and phase record |

---

## Appendix B — State schema summary

```text
{
  version: 2,
  dimension: "2d" | "3d",
  seed: number,
  params: {
    lifespan, angle, branch, apical, sympodial, photo, droop,
    plagiotropism, tortuosity, reiteration, rootFlare, shade, shed,
    leaves, speed, phenology, angleOrderBias, wind, obstacle,
    obstacleSize, trees, solarModel, latitude, dayOfYear, hour,
    skyPreset, sunSamples, windDirection, gustAmp, speciesMix,
    spacing, ageMix, crownShyness, slope, aspect, soilMoisture,
    exposure, fogDensity, quality, snow, bloom, reducedMotion,
    espalier, groundDetail, groundDensity, ...species traits
  },
  cuts: [[ "budId:birthStep", "thinning" | "heading" | "pollard" ], ...],
  time: number,
  season: number,
  seasonAuto: boolean,
  activePreset: string,
  viz: {
    colorMode, skeleton, lightGrid, vectors, shed, xray, wireframe
  },
  ui: { theme: "auto" },
  exportSettings: {
    svgWidth, svgHeight, svgDpi, svgRoots, svgBranches, svgLeaves,
    svgBackground, svgLineArt, svgAnnotations, svgScaleBar, pngScale,
    glbRoots, glbLeaves, glbMetadata, glbAxis, glbUnits, glbLod
  },
  compare: {
    enabled: boolean,
    baseline: {
      points, lifespan, leafLightModel, seed, preset, time
    }
  } | null,
  camera: {
    position: [x, y, z],
    target: [x, y, z],
    fov?: number,
    lookAt?: [x, y, z],
    autoLookAt?: boolean,
    useLookAtForOrbit?: boolean,
    orbitEnabled?: boolean,
    limitsEnabled?: boolean
  } | null
}
```

---

## Appendix C — Glossary

| Term | Meaning |
|---|---|
| **Skeleton** | The flat `nodes[]` array produced by the simulation. |
| **Bud** | A growing shoot tip used during simulation; not persisted. |
| **Structural step** | One simulation growth step. The first 40 display years map 1:1; later steps are compressed. |
| **Display year / age** | The time value on the slider; a render parameter. |
| **Pipe model** | Branch radius derived from the sum of child cross-sections. |
| **Apical dominance** | How strongly the leader suppresses lateral shoots. |
| **Sympodial / crown forking** | Leader decay and co-dominant limb splitting. |
| **Plagiotropism** | Flattening of lateral axes toward horizontal. |
| **Tortuosity** | Deterministic bend/wobble. |
| **Reiteration** | Epicormic/old-growth shoots from trunks and scaffolds. |
| **Phenology** | Species-specific timing of leaf-out, flowering, fruiting, and leaf drop. |
| **Prune / cut** | Removing a subtree; stored as `budId:birthStep` plus cut type. |
| **Thinning** | Clean subtree removal. |
| **Heading** | Cut back to a bud; local regrowth. |
| **Pollard** | Repeated heading/knuckle; dense regrowth. |
| **Lasso** | Drag a polygon to select multiple branch roots. |
| **Isolate** | Dim everything outside the selected subtree. |
| **Ghost compare** | Structural before/after overlay. |
| **Baseline** | A pinned analytics run used for metric comparison. |
| **Active pane** | The 2D or 3D pane that receives canvas-bound actions. |
| **Universal panel** | The single control rail cloned from the 2D form and extended with 3D controls. |
| **Scene theme** | Light/dark styling driven by sun elevation, not OS preference. |
| **LOD** | Level of detail: Full/Light/Silhouette in GLB export; near/mid/far in 3D rendering. |
| **GLB** | Binary glTF export. |
| **SVG** | Vector export of the 2D tree. |
| **Batch ZIP** | Multi-file export with frames/GLB, analytics, state, and manifest. |
| **Manifest** | JSON describing batch contents, seed, preset, age, settings, and files. |

---

*End of current-state handoff.*
