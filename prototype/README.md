# Parametric Tree Growth (2D Prototype)

A procedural tree generator that grows a tree from a seed to a mature adult, with time as a scrubbable dimension. This is a 2D prototype for developing and tuning the algorithms before porting them to 3D.

**Roadmap:** [refinement/fidelity plan](../parametric-tree.md) · [release checklist](../docs/release-checklist.md) · [Phase 1–4 archive](../docs/roadmap.md).

## Files

| File | Purpose |
|---|---|
| `2d-prototype.html` | Page structure |
| `styles.css` | Layout, sun-driven day/night theme, and node inspector |
| `simulation.js` | Skeleton simulation: growth, branching, species grammar, roots, light model, shedding, pruning |
| `main.js` | ES module: rendering, pipe model, playback, roots, phenology, inspector, and UI (imports `simulation.js`) |
| `../shared/params.js` | Shared defaults, `PARAM_META`, and dimension overrides |
| `../shared/presets.js` | Shared species grammar presets (`SPECIES_PRESETS_V2`) |
| `../shared/grammar.js` | Shared order-angle and phenology helpers |
| `../shared/environment.js` | Shared solar position, sky presets, wind, shelter, and soil helpers |
| `../shared/state.js` | Versioned save/load, v1→v2 migration, share-link, and localStorage state helpers |
| `../shared/zip.js` | Dependency-free store-only ZIP writer used by batch export |
| `../index.html` | Single-page split studio: both engines mounted in shadow-root panes with one shared state |
| `../tests/phase5.js` | Node-based parity, determinism, metadata, root, phenology, and prune checks |
| `../tests/phase6.js` | Solar parity, light/wind determinism, forest budgets, 7-tree/300-year profile, and environment checks |
| `../tests/phase7.js` | Species bark/leaf render-trait and merged-forest checks |
| `../tests/phase8.js` | State encode/decode, migration, and share-link round-trip checks |
| `../tests/phase9.js` | ZIP/CRC structure checks for batch export |
| `../tests/visual-regression.js` | Headless Chrome visual baselines for fixed seeds, presets, ages, and the combined split studio |
| `../tests/app-ui.js` | Headless Chrome smoke test for the split studio, universal panel, active pane, fullscreen, ground detail/density, analytics comparison, batch export, accessibility, mobile drawer, and shared state |
| `../tests/baselines/` | Compact luminance-grid baselines used by the visual harness |

Open `2d-prototype.html` in a browser. There are no dependencies or build steps.

## Core idea: simulate once, render by time

The program is split into two phases.

1. **Simulate** (runs when a parameter or the seed changes). The tree is grown year by year into a flat array of **nodes** (a skeleton). Every node records its parent, the year it was born, and the year it was shed (if ever).
2. **Render** (runs every frame). Given an age `t`, everything visible is derived from the skeleton alone: how far each segment has grown, how thick it is, and which branches have been shed.

Because time is only a render parameter, scrubbing the age slider never re-runs the simulation, so any point in the tree's life can be inspected instantly and in either direction.

```
parameters + seed ──► simulate() ──► skeleton (nodes[])
                                         │
                          age t ─────────┤
                                         ▼
                          growth + pipe model + shedding ──► canvas
```

## Data model

World units: the seed is at `(0, 0)`, `+x` is right and **up is negative `y`**.

**Node** is one point of the skeleton. Its segment runs from its parent to itself.

| Field | Meaning |
|---|---|
| `x, y` | Final position |
| `parent` | Index of parent node (parents always have lower indices than children) |
| `birth` | Year the segment starts growing (it takes one year to finish) |
| `order` | 0 = trunk, 1 = limb, 2 = twig, up to 4 |
| `death` | Year the node is shed (`1e9` = never) |
| `isBranchRoot` | First node of a lateral branch |
| `mainTip` | For branch roots: the latest node on that branch's main axis |
| `isLeader` | Trunk or co-dominant scaffold limb (never shed by the shade test) |
| `axisId`, `axisOrder`, `parentAxisId` | Stable axis identity and supporting axis |
| `segmentIndex`, `pathLength` | Position along the axis and distance from the root |
| `dirX, dirY, dirZ`, `upX, upY, upZ` | Unit direction and a stable perpendicular frame |
| `budType` | `leader`, `scaffold`, `lateral`, `cut regrowth`, or `reiteration` |
| `fate` | `live`, `shed`, `pruned`, or `broken` |
| `birthLight`, `birthShade` | Light at node creation |
| `tortuosity`, `mechanicalLoad` | Deterministic per-node bend and lightweight subtree/wind load |
| `cut` | `null` or `{ type, step, radius }` on a cut node |

**Bud** is a growing shoot tip that exists only during simulation. It carries a direction, an order, a vigor (strength, 1 = trunk), an age, a lifespan (laterals only), and the node it currently sits on.

## The simulation

The simulation runs for `min(P.lifespan, 80)` structural growth steps. In each step, every active bud grows one segment and may spawn side buds. After all buds have grown, shaded branches are shed. The first 40 display years map 1:1 to growth steps; beyond that, the remaining structural growth is compressed into the rest of the timeline (see Lifespan below).

### 1. Bud growth

**Segment length.** The trunk grows `BASE × ageFactor` per year. Laterals are shorter and depend on their order, vigor and light:

```
ageFactor = max(0.1, exp(−year / 60))
trunk:    L = BASE · ageFactor
lateral:  L = BASE · 0.85 · 0.9^order · (0.5 + 0.5·vigor) · (0.4 + 0.6·light) · ageFactor
```

The `ageFactor` makes the tree slow down as it matures. It is independent of lifespan, so changing how many years are simulated does not change the first decades of growth.

**Direction.** The new direction is the previous direction plus three influences, then normalized:

```
dx = dirX + (random − 0.5) · jitter          jitter: 0.25 trunk, 0.5 laterals
dy = dirY + (random − 0.5) · jitter
dy −= photo · (1.5 trunk | 1 lateral)         phototropism: pulls upward
dy += droop · min(budAge, 8) · 0.06 · (0.3 trunk | 1 lateral)   gravity: builds up as a shoot ages
```

This is a tropism model: instead of fixing branch shapes, shape emerges from competing steering forces. High phototropism gives upright columnar trees, and high droop gives weeping ones.

**Termination.** A lateral bud stops when it:
- reaches its lifespan, `life = 2 + floor(vigor · 8 · (0.6 + 0.8·random))` years (higher-vigor shoots live longer);
- would grow into the ground (`y > −1`);
- dies in deep shade (see the light model below).

The trunk never stops.

### 2. Branching (apical dominance)

After a bud grows, it may spawn lateral buds at its new node.

- **Trunk:** after 5 years, spawns on both sides each year. Delaying the start leaves a bare lower trunk.
- **Laterals:** after 1 year, spawn on one side per year, alternating sides.
- **Probability:** `branch · (0.4 + 0.6·light)`, so shaded buds branch less.
- **Angle:** `angle ± 10°` away from the parent direction.
- **Vigor:** `childVigor = parentVigor · (1 − apical·0.6) · (0.8 + 0.4·random)`.
- **Delay:** the new bud starts 0 to 1 years later.
- A bud is not created if `order ≥ 4`, if `vigor < 0.2`, or if the skeleton has reached 24000 nodes. After year 60 the branching chance tapers to 20% over 140 years, so long-lived trees keep a manageable size.

Because vigor compounds multiplicatively with each order, higher orders become shorter and shorter-lived. This is **apical dominance**: the leader suppresses its laterals, and the `apical` parameter controls how strongly.

### 3. Light model

Light competition is what turns a random branching pattern into a believable crown. The model is deliberately cheap.

Live nodes are counted in a coarse grid (cells of 8 units). Light at a point depends on how many live nodes lie **above** it:

```
shade = Σ count(cell) · columnWeight · rowFalloff
          columnWeight: 1 for the same column, 0.5 for the two neighbouring columns
          rowFalloff:   (1 − d/8) for a cell d rows above (d = 1…6)
light = exp(−shade_sensitivity · 0.1 · shade)
```

Light is evaluated at a lateral bud's tip each year, and it is used three ways:

| Effect | Rule |
|---|---|
| Shorter segments | length is multiplied by `0.4 + 0.6·light` |
| Less branching | spawn probability is multiplied by `0.4 + 0.6·light` |
| Bud death | below `light = 0.2`, a bud has a 50% chance per year of dying |

The trunk is treated as always in full light.

### 4. Branch shedding (crown lift)

From year 6, each lateral **branch root** older than 5 years is checked. If the light at the branch's main tip is below `shed × 0.3`, the branch is shed along with its whole subtree. Because children always have higher indices than parents, a single forward pass over the array handles this: a node dies if its parent died this year or if it is a failing branch root.

Shed nodes get a `death` year and are removed from the light grid, which lets light reach the branches beneath them. The effect is a clear lower trunk and a lifted crown, as in real forest trees. In the animation the shed limb retracts over one year and its leaves drop.

### 5. Deterministic randomness

Every random decision comes from a hash of `(seed, budId, year, channel)` instead of a shared random stream. Each bud has a stable id derived from its parent's id, the year and its side.

This matters for tuning. With a shared stream, changing one parameter changes how many numbers are drawn, which shifts every later decision and produces a different tree. With hashed randomness, each decision is independent, so a slider changes its own effect while the rest of the tree stays recognizably the same. Same seed plus same parameters always gives the same tree.

## Rendering

All of this is recomputed every frame from the skeleton and the current age `t`.

### Growth and retraction

A segment's length is scaled by a progress value:

```
progress = clamp(t − birth, 0, 1) · (1 − clamp(t − death, 0, 1))
end point = parent's current end point + (node − parent) · progress
```

So a segment extends over the year after it is born. If it is shed, it retracts over the year after its death. Since a child's start is its parent's current end point, retracting limbs pull their sub-branches in with them.

### Thickness (pipe model)

Branch thickness follows the **pipe model** (Leonardo da Vinci's rule, formalized by Shinozaki et al.): the cross-section of a branch equals the combined cross-section of its children. With exponent `n = 2.2`:

```
radius(parent)^n = Σ radius(child)^n          tips have radius R0 = 0.4
```

It is computed in one backward pass (children before parents), using only nodes visible at the current age, so the trunk visibly thickens as the crown fills in. A minimum thickness is also applied to any segment with children: `R0 + 3.2 · (1 − exp(−age/55)) · orderScale` (×1.6 for the trunk). This approaches a finite age thickness instead of growing forever, and the result is capped at 1.6× the pipe-model radius so branch ends taper instead of ending in thick stubs.

### Geometry

Each segment is drawn as a **tapered quad** from the parent's radius to its own, plus a circle at its end to round the joint. Bark colour darkens with thickness.

### Leaves

Leaves are attached to thin nodes (radius ≤ `R0 · 2.4`), with a higher chance at tips (`leaves · 1.4`) than along twigs (`leaves · 0.6`). Each chosen node gets two leaves at hashed angles and colours, which grow in over two years after the node is 0.8 years old, and fall when the node is shed.

### Camera

With auto-zoom on, the view fits the currently visible tree, so the seed fills the canvas and the view pulls back as the tree grows. With it off, the view stays fitted to the final tree.

## Parameters

| Parameter | Range | Effect |
|---|---|---|
| Branch angle | 15–85° | Angle of laterals away from the parent. Small is narrow, large is spreading. |
| Branching | 0.1–1 | Chance of spawning a lateral each year. Controls density. |
| Apical dominance | 0–0.9 | How much weaker laterals are than their parent. High gives a strong trunk and short branches. |
| Phototropism | 0–0.6 | Upward steering. High gives upright trees. |
| Droop | 0–0.6 | Downward sag as shoots age. High gives weeping forms. |
| Plagiotropism | 0–1 | Flattens lateral axes toward horizontal; leaders stay upright. |
| Tortuosity | 0–1 | Deterministic bend and wobble, stronger in old wood. |
| Reiteration | 0–1 | Old-growth epicormic shoots from trunks and scaffolds. |
| Root flare | 0–1.5 | Trunk-to-root taper and coarse-root buttress strength. |
| Shade sensitivity | 0–1.5 | Strength of the light model. High gives sparser, more open crowns. |
| Branch shedding | 0–1 | Shade threshold for shedding branches. 0 turns it off. |
| Leaf density | 0–1 | Rendering only. |
| Play speed | 0.5–8 | Years per second. |

Everything except leaf density and play speed re-runs the simulation.

## Species, crown forking, root flare and seasons

Phase 1 adds a broader range of growth habits without changing the simulate-once model.

- **Crown forking (`sympodial`)** — leaders slowly lose vigor and may split into two co-dominant scaffold limbs, producing a spreading, decurrent (broadleaf) crown instead of a single conifer-like leader. `0` keeps the original single-leader behavior.
- **Species presets v2** — Poplar, Oak, Willow, Pine and Cherry now set core growth parameters plus order-specific branch angles, plagiotropism, tortuosity, reiteration, root count/spread, and a phenology curve. Cherry blossoms before leaf-out; pine stays evergreen. Leaf density and playback speed are preserved.
- **Root flare** — the trunk visually widens near the soil line with a smooth exponential buttress.
- **Lifespan** — a **Lifespan** slider (40–300 years, default 300) sets how far the time slider can scrub. Structural growth uses a bounded 80-step horizon: the first 40 display years map 1:1, then the remaining growth is compressed across the rest of the timeline. Growth decelerates on a fixed 60-year exponential curve, so changing lifespan does not alter the early decades and old trees approach a realistic mature height instead of growing forever.
- **Old-age branching** — after year 60 the branching chance tapers toward 20%, keeping long simulations manageable and mimicking mature-tree allocation.
- **Scaffold growth** — as lifespan grows beyond 40 years, order-1 limb lifespans scale up to 8× and order-2 lifespans to 3×, causing real spreading scaffold limbs instead of a bare vertical leader. Their branching rates are reduced at the same time to control total node count. Leaders stop extending at growth year 60, so old trees widen instead of becoming tall poles with short, thick tips.
- **Old-age proportions** — the age-based minimum radius saturates instead of growing without bound, and very old internodes have a length floor. This keeps 300-year trees from turning into fat, blunt tubes.
- **Seasons** — a render-only `Season` slider (Spring/Summer/Autumn/Winter) recolors and drops leaves. Autumn warms outer, sunlit leaves toward gold and crimson first; winter drops foliage. “Cycle with years” runs a full cycle every 4 simulated years. Seasons never re-run the simulation.

## Environment

Phase 2 adds four environmental controls. All of them re-run the simulation.

- **Directional sun** — a `Sun angle` slider. The light field marches along the sun vector instead of straight up, so shade and growth become asymmetric. The default 0° is overhead, preserving the earlier look.
- **Day/night** — the active sun drives the page theme, sky gradient, soil/grass colours and light intensity. A high sun is day; a low sun fades through warm twilight into night. This replaces the OS light/dark preference, so the page no longer follows system settings.
- **Prevailing wind** — a `Wind` slider adds an `+x` steering force in `growBud`, producing windswept and flag-shaped crowns. Negative values bend the tree the other way.
- **Obstacles** — `None`, `Wall`, `Boulder`, `Topiary sphere`, `Topiary cone`, with an `Obstacle size` slider. Walls and boulders block and deflect branches and cast shade; topiary volumes reflect growth back inside the clipped volume. Topiary volumes do not cast shade.
- **Forest** — `Trees` switches between `1` and `3` roots sharing one light field. Branching is divided by the tree count to stay under the 24k node cap, and the shared shade produces competition and crown-shyness gaps.

## Interactive tooling (Phase 4)

- **Click-to-prune** — enable **Prune**, choose a **Cut** type, and hover a branch to preview the subtree in red before committing. Thinning removes the subtree; heading and pollard activate local regrowth. Cuts are stored as stable `budId:birthStep` keys, so scrubbing time leaves them intact; released light can still cause small growth responses on nearby branches. **Undo cut** / **Redo cut** (or Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y) navigate cut history; **Clear cuts** is undoable. Cuts and history reset when the seed, a growth slider, a preset, or the lifespan changes; environment changes preserve them.
- **Node inspector** — click the tree outside Prune mode to read axis, bud, fate, light, load, tortuosity, and cut metadata for the picked node.
- **SVG export** — **Export SVG** writes the current visible tree (including roots) as vector polygons and leaf/flower ellipses. Export options add dimensions, DPI metadata, annotations, a scale bar, layer toggles, background, and line-art mode.
- **Analytics v2** — the strip under the time slider plots biomass, active tips vs. shed nodes, mean canopy light, height, crown width, leaf area, and leaf light across the structural growth steps, with a playhead at the current age. **Pin baseline** freezes a run, **Compare** overlays dashed baseline lines, and the summary shows biomass/height/crown/leaf-area deltas at the current year. Hovering shows a tooltip/crosshair; clicking or using arrow keys seeks the tree. **Export CSV** writes the per-step table, adding baseline/delta columns when a baseline is pinned.

## Phase 5 — Botanical depth

Phase 5 keeps the simulate-once architecture and the separate 2D/3D loops, but shares the parameter schema, species presets, and grammar helpers.

- **Shared schema** — both pages load `../shared/params.js`, `../shared/presets.js`, and `../shared/grammar.js` before the simulation module. `PARAM_META` carries label, group, range, default, and help text; dimension-specific defaults keep the 2D and 3D silhouettes distinct.
- **Node and axis metadata** — every node now stores `axisId`, `axisOrder`, `parentAxisId`, `segmentIndex`, `pathLength`, `dir*`, `up*`, `tortuosity`, `budType`, `fate`, `birthLight`, `birthShade`, `mechanicalLoad`, and `cut`. A click on the tree (outside Prune mode) opens the **Node inspector** below the visualizations.
- **Axis grammar** — branch angle scales by axis order, laterals flatten with plagiotropism, deterministic tortuosity controls bend, and old trunks/scaffolds can throw capped reiteration shoots. Species presets are now grammars rather than five slider values.
- **Roots** — each tree gets a deterministic 4–8 root coarse root system. 2D draws tapered polygons below the soil line; roots are included in SVG export. The root flare uses the same `rootFlare` trait.
- **Phenology** — leaf-out, full canopy, senescence, leaf drop, autumn palette, evergreen behavior, and cherry flowering come from the species curve. The season slider remains the manual override; “Follow phenology” cycles the season with age.
- **Prune response** — the **Cut** selector offers **Thinning**, **Heading**, and **Pollard**. Hovering in Prune mode ghosts the subtree that would be removed; committed cuts can be undone/redone and **Clear cuts** is itself undoable. Thinning removes the subtree cleanly. Heading and pollard leave a wound and spawn capped wound-regrowth buds near the cut. Cut metadata is stored as `cut: { type, step, radius }` plus `cutType`/`cutStep`, and cut nodes render a dark wound ring.
- **Analytics/export** — the analytics strip now also plots height, crown width, and approximate leaf area, and **Export CSV** writes the per-step table.

Run the Phase 5 checks with:

```sh
# from the project root
node tests/phase5.js
```

The test compares shared parameter keys and presets, checks 2D/3D determinism, verifies metadata and root geometry, exercises phenology helpers, and checks that thinning/heading/pollard cuts persist and that `clearPrunes()` restores exact node counts.

Run the visual-regression harness with:

```sh
# from the project root; uses the installed Chrome binary
node tests/visual-regression.js
# rewrite the baselines after an intentional visual change
node tests/visual-regression.js --update
```

The harness samples an 80×50 luminance grid from the render canvas for seven fixed seed/preset/age/environment cases in both dimensions and compares it with the JSON baselines in `tests/baselines/`. It uses the DevTools protocol and needs no npm dependencies.

Run the split-studio UI smoke test with:

```sh
node tests/app-ui.js
```

It verifies the two-pane layout, universal control rail, shared state updates, active-pane prune targeting, fullscreen mode, ground detail/density, analytics pin/compare/clear and chart seeking, batch ZIP output and state preservation, canvas/ARIA labels, status contrast, the mobile drawer focus trap, and reduced-motion defaults.

## Phase 6 — Environmental depth

Phase 6 makes the environment affect growth and appearance through shared helpers in `shared/environment.js`.

- **Solar model and sky** — the basic one-slider sun remains; the Advanced environment panel adds a sun-path model driven by latitude, day of year, and hour. Both dimensions use the same sun direction and elevation. Sky presets (clear, golden hour, overcast, winter) drive exposure, daylight theme, and rendered light.
- **Light field v2** — the light field samples a small sun disk, adds a sky/ambient term, and applies slope/aspect gain. Nodes store both `birthLight` and final-canopy `currentLight`; rendering and analytics use current light and `leafLight`.
- **Wind field v2** — wind has direction, speed, gust amplitude/frequency, and shelter from neighboring trees. Growth responds with anemotropic lean and wind-shortened internodes. 3D sway adds a traveling gust term and leaf flutter on top of per-branch phase; 2D uses directional lean and phase offsets.
- **Forest ecology** — tree counts support 1/3/5/7 with deterministic spacing and jitter. Advanced controls add auto species mix, age mix, spacing, and crown shyness; edge trees lean outward and species traits follow each tree through growth, roots, leaves, and phenology.
- **Obstacles v2** — added hedge-wall and box/arch volumes, a soft contact-shade shell, and push-out collision response so branches wrap rather than clip. Topiary cut surfaces are intentionally deferred.
- **Soil/slope/aspect (first pass)** — added the shared schema and a minimal effect: slope/aspect changes direct sun, while soil moisture changes growth vigor and leaf size. Terrain meshes and root water competition remain future work.

Run the environmental checks with:

```sh
node tests/phase6.js
```

The tests compare 2D/3D solar directions, verify wind determinism and shelter, exercise all forest sizes and species mixes, check the node cap, smoke-test every obstacle type, and confirm that slope/aspect changes light.

## Phase 7A — Render fidelity

Phase 7A focuses on branch, bark, and leaf readability without changing the growth model.

- **Species bark palette** — poplar, oak, willow, pine, and cherry now carry bark hue/saturation/lightness plus fissure, moss, and lenticel traits. Natural bark color follows the species instead of one global brown.
- **Bark hatching** — thicker 2D branches receive deterministic hatch strokes and a shadow-side accent; trunk/scaffold detail remains readable at silhouette scale.
- **Species leaf silhouettes** — oak, pine, willow, cherry, and poplar use different 2D leaf shapes rather than one generic ellipse. The same shapes are emitted by SVG export.
- **Shared render traits** — `barkHue`, `barkSat`, `barkLight`, `barkFissure`, `barkMoss`, `barkLenticel`, and `leafShape` are merged through `traitsForPreset`, so forest mixes keep per-tree appearance.

Run the render-trait checks with:

```sh
node tests/phase7.js
```

## Phase 7B — Atmosphere and ground

- **Atmosphere** — horizon haze follows the active sky preset and fog setting. Exposure and fog density are exposed in the Advanced environment panel.
- **Contact shadows** — each tree gets a soft radial contact shadow at the root line.
- **2D ground detail** — deterministic grass tufts and leaf litter are drawn on the soil profile.
- **Terrain and planting** — 3D trees sit on a slopeable terrain plane; root bases and debris settle to the terrain height.
- **Ground detail** — deterministic instanced grass tufts and small rocks are placed around the forest roots.
- **Topiary caps** — topiary/hedge/box volumes get a simple clipped-surface cap.

Visual regression now covers fog/slope and topiary cases in addition to species, forest, and golden-hour cases.

## Phase 7C — Motion and performance

- **Render-only wind motion** — branches offset by height, axis phase, and gust strength while the growth simulation stays untouched.
- **Quality tiers** — `Auto`, `High`, `Medium`, and `Low` in the Advanced environment panel reduce 2D leaf density and disable bark hatching at low quality.
- **Deterministic captures** — quality and motion state are explicit, so visual-regression captures remain stable.

## Phase 7D — Render close-out

- Leaf-light analytics are explicitly labeled as final-canopy approximations through `analytics.leafLightModel` and the chart title.
- Leaf clusters now vary by species, with age-based color variation and simple fruit cards.
- The 2D soil profile gains subtle strata lines beneath the grass/soil surface.
- 2D quality tiers continue to reduce leaf density and bark hatching at lower quality.

## Phase 8 — Product depth (closeout)

- **Persistence** — `Save state` writes a versioned JSON file; `Load state` restores seed, params, cuts, time, season, preset, and visualization settings. URL share links encode the same state, and localStorage autosaves the current session.
- **Export options** — SVG export supports branch/root/leaf layer toggles, optional background, line-art mode, dimensions, DPI metadata, annotations, and a scale bar. PNG export supports 1×/2×/4×, analytics export supports CSV/JSON with comparison columns, and **Export batch ZIP** writes SVG frames at 0/25/50/75/100% plus analytics/state/manifest while preserving the live time.
- **Analytics** — points now also include crown ratio, trunk/branch volume, canopy closure, and a rough carbon estimate.
- **Accessibility/UX** — added keyboard help, a reduced-motion default from `prefers-reduced-motion`, focus-visible styles, skip links, keyboard pane selection (`1`/`2`), a focus-trapped mobile drawer, ARIA/live-region labels, a color-blind-safe analytics palette, and fullscreen canvas mode (`F` toggles, `Esc` exits, `Space` pauses/resumes, `R` restarts, `H` hides/shows UI); reduced motion disables 2D wind offsets.

The split studio at `../index.html` mounts both prototypes in one page without iframes: the 2D and 3D canvases sit side by side, with one universal control rail and one shared transport. Each simulation is an ES module, each renderer runs in its own shadow root, and a small in-page bus keeps presets, parameters, cuts, time, season, and playback synchronized. Canvas-bound actions such as prune, isolate, compare, undo, and export target the active pane. Press `F` or use Fullscreen to make the active canvas fill the viewport; `Esc` exits fullscreen, `Space` pauses/resumes, `R` restarts from year zero, and `H` hides/shows the remaining fullscreen UI. Serve the repository over HTTP (for example `python3 -m http.server`) so the studio can load both pane templates. Prune lasso, branch isolation, before/after ghost comparison, espalier, analytics comparison, and batch ZIP handoff are implemented. Use `1`/`2` to select the active pane; the mobile controls open as a focus-trapped drawer.

## Relationship to published algorithms

This prototype is a simplified blend of established ideas rather than an implementation of any one paper.

- **Self-organizing tree models** (Palubicki et al. 2009): bud-based growth, apical dominance and light competition shaping the crown. This version replaces their per-bud light and resource flow with the grid-based light field above.
- **Pipe model / Leonardo's rule**: branch radii, as above.
- **Weber and Penn-style parameters**: branch order, angle and per-order decay of length.
- **Tropisms**: phototropism and gravitropism as steering vectors.

It does not use L-systems or space colonization. Space colonization could replace the bud-growth step later and would use the same skeleton and render code.

## Known limitations

- The light field samples a sun disk and sky ambient, but leaf mass still does not cast shade and the grid resolution is fixed.
- `currentLight` is a final-canopy value rather than a per-step light history; early-time leaf light is approximate.
- A branch's own side shoots can shade its tip, which may shed branches slightly early.
- Branches are straight segments, so kinks are visible. Curve fitting (for example Catmull-Rom) would smooth them.
- Roots are render-only in this phase; they do not yet compete for water or influence shoot growth.
- Topiary cut surfaces, terrain meshes, and full forest LOD remain future work.
- Pruning removes shade, so branches outside the cut can respond slightly to the released light. The cut identity and deterministic random decisions remain stable.
- The 24000-node cap stops growth silently when reached; reiteration and wound regrowth are capped to stay below it.
- This renderer is 2D only: angles are single rotations rather than a rotation around the parent axis. The 3D prototype shares the schema and grammar but keeps its own simulation loop.

## Porting to 3D

The skeleton and the time model carry over unchanged. What changes:

| 2D | 3D |
|---|---|
| Direction `(dx, dy)` | Unit vector `(x, y, z)` |
| Lateral = rotate by ±angle | Rotate around the parent axis by the golden angle (about 137.5°) per spawn, then tilt by the branch angle |
| 2D light grid | 3D voxel grid (shade from voxels above) |
| Tapered quads | Swept cylinders using parallel-transport frames (avoids twisting), radius from the same pipe model |
| Ellipse leaves | Instanced alpha-textured cards |

The simulation functions (`growBud`, `spawnLaterals`, `shedShadedBranches`) and the per-frame state computation (`computeFrameState`) only need their vector math changed.

