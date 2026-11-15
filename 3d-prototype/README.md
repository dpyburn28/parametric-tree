# Parametric Tree Growth (3D Prototype)

A procedural 3D tree generator that grows a tree from a seed to a mature adult, with time as a scrubbable dimension. Ported from the 2D prototype in `../prototype/` to 3D using Three.js.

**Roadmap:** [refinement/fidelity plan](../parametric-tree.md) · [release checklist](../docs/release-checklist.md) · [Phase 1–4 archive](../docs/roadmap.md).

## Files

| File | Purpose |
|---|---|
| `3d-prototype.html` | Page structure + Three.js import map |
| `styles.css` | Layout, viewport styling, sun-driven day/night theme, and node inspector |
| `simulation.js` | 3D skeleton simulation: growth, golden-angle phyllotaxis, species grammar, roots, 3D voxel light model, shedding, pruning |
| `main.js` | ES module: Three.js renderer, pipe-model thickness, dynamic tapered branch mesh, instanced leaves/flowers, root meshes, orbit camera, inspector, and UI (imports `simulation.js`) |
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

### Running

Because `main.js` is an ES module (`<script type="module">`), open `3d-prototype.html` via a local static server. Serve the **project root** so the page can also load `../shared/params.js`, `../shared/presets.js`, and `../shared/grammar.js`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/3d-prototype/3d-prototype.html
```

## Core idea: simulate once, render by time

The program is split into the same two phases as the 2D prototype:

1. **Simulate** (runs when a parameter or the seed changes). The tree is grown year by year into a flat array of 3D **nodes** (`nodes[]`). Every node records its parent, the year it was born, and the year it was shed (if ever).
2. **Render** (runs every frame). Given an age `t`, everything visible is derived from the skeleton alone: how far each 3D segment has grown, how thick it is (pipe model), and which branches have been shed.

Scrubbing the age slider never re-runs the simulation.

## 3D Coordinate System & Data Model

World units: the seed is at `(0, 0, 0)`, `+x` is right, `+z` is forward, and **up is positive `y`** (`y = 0` is the ground plane).

**Node** is one point of the 3D skeleton. Its segment runs from its parent to itself:

| Field | Meaning |
|---|---|
| `x, y, z` | Final 3D position |
| `parent` | Index of parent node (`parent < index`) |
| `birth` | Year the segment starts growing (takes one year to finish) |
| `order` | `0` = trunk, `1` = limb, `2` = twig, up to `4` |
| `death` | Year the node is shed (`1e9` = never) |
| `isBranchRoot` | First node of a lateral branch |
| `mainTip` | For branch roots: latest node on that branch's main axis |
| `isLeader` | Trunk or co-dominant scaffold limb (never shed by the shade test) |
| `axisId`, `axisOrder`, `parentAxisId` | Stable axis identity and supporting axis |
| `segmentIndex`, `pathLength` | Position along the axis and distance from the root |
| `dirX, dirY, dirZ`, `upX, upY, upZ` | Unit direction and a stable perpendicular frame |
| `budType` | `leader`, `scaffold`, `lateral`, `cut regrowth`, or `reiteration` |
| `fate` | `live`, `shed`, `pruned`, or `broken` |
| `birthLight`, `birthShade` | Light at node creation |
| `tortuosity`, `mechanicalLoad` | Deterministic per-node bend and lightweight subtree/wind load |
| `cut` | `null` or `{ type, step, radius }` on a cut node |

**Bud** is a growing 3D shoot tip used only during simulation. It carries a unit direction `(dirX, dirY, dirZ)`, an accumulated `phyllotaxis` roll angle around its axis, `order`, `vigor`, `age`, and `life`.

## What changed from 2D to 3D

| Feature | 2D Prototype | 3D Prototype |
|---|---|---|
| Coordinates | `(x, y)` with `-y` up | `(x, y, z)` with `+y` up |
| Lateral branching | Alternate left/right (`±angle`) | Roll around parent axis by the **golden angle (`137.5°`)** + tilt by `angle` |
| Light grid | 2D grid (`3 × 6` cells above) | 3D voxel grid (`3 × 6 × 3` column above in `+y`) |
| Branches | 2D tapered quads + circle joints | Single dynamic `THREE.BufferGeometry` of tapered 3D cylinders with top caps |
| Leaves | 2D canvas ellipses | Single `THREE.InstancedMesh` of 3D leaf cards |
| Camera | 2D scale + translate | `THREE.PerspectiveCamera` + `OrbitControls` + optional turntable spin |

## Species, crown forking, root flare and seasons

Phase 1 adds a broader range of growth habits without changing the simulate-once model.

- **Crown forking (`sympodial`)** — leaders slowly lose vigor and may split into two co-dominant scaffold limbs, producing a spreading, decurrent (broadleaf) crown instead of a single conifer-like leader. `0` keeps the original single-leader behavior.
- **Species presets v2** — Poplar, Oak, Willow, Pine and Cherry now set core growth parameters plus order-specific branch angles, plagiotropism, tortuosity, reiteration, root count/spread, and a phenology curve. Cherry blossoms before leaf-out; pine stays evergreen. Leaf density and playback speed are preserved.
- **Root flare** — trunk rings near the soil are displaced by a height-decaying five-lobed buttress.
- **Spline branches** — each internode is swept along a Hermite curve with a parallel-transport frame, so branch joins no longer show hard kinks.
- **Lifespan** — a **Lifespan** slider (40–300 years, default 300) sets how far the time slider can scrub. Structural growth uses a bounded 80-step horizon: the first 40 display years map 1:1, then the remaining growth is compressed across the rest of the timeline. Growth decelerates on a fixed 60-year exponential curve, so changing lifespan does not alter the early decades and old trees approach a realistic mature height instead of growing forever.
- **Old-age branching** — after year 60 the branching chance tapers toward 20%, keeping long simulations manageable and mimicking mature-tree allocation.
- **Scaffold growth** — as lifespan grows beyond 40 years, order-1 limb lifespans scale up to 8× and order-2 lifespans to 3×, causing real spreading scaffold limbs instead of a bare vertical leader. Their branching rates are reduced at the same time to control total node count. Leaders stop extending at growth year 60, so old trees widen instead of becoming tall poles with short, thick tips.
- **Old-age proportions** — the age-based minimum radius saturates instead of growing without bound, and very old internodes have a length floor. This keeps 300-year trees from turning into fat, blunt tubes.
- **Seasons** — a render-only `Season` slider (Spring/Summer/Autumn/Winter) recolors and drops instanced leaves. Autumn warms outer, sunlit leaves toward gold and crimson first; winter drops foliage. “Cycle with years” runs a full cycle every 4 simulated years. Seasons never re-run the simulation.
- **Algorithm visualizations** — bark color modes (order, light, vigor, pipe vs age floor) and overlays (skeleton, light voxels, tropism vectors, shed ghosts, x-ray) are available from the same panel.

## Environment

Phase 2 adds four environmental controls. All of them re-run the simulation.

- **Directional sun** — `Sun azimuth` and `Sun elevation` sliders. The 3D voxel light field marches along the sun vector, and the Three.js directional light is positioned from the same vector so cast shadows match the simulated shade. Defaults are overhead (azimuth 0°, elevation 90°).
- **Day/night** — sun elevation drives the page theme, sky gradient, ground materials and light intensity. A high sun is day; a low sun fades through warm twilight into night. This replaces the OS light/dark preference, so the page no longer follows system settings.
- **Prevailing wind** — a `Wind` slider adds an `+x` steering force in `growBud`, producing windswept and flag-shaped crowns.
- **Obstacles** — `None`, `Wall`, `Boulder`, `Topiary sphere`, `Topiary cone`, with an `Obstacle size` slider. Walls and boulders block/deflect branches and cast shade; topiary volumes reflect growth back inside the clipped volume. Topiary volumes do not cast shade. Obstacles are shown as translucent preview meshes.
- **Forest** — `Trees` switches between `1` and `3` roots sharing one light field. Branching is divided by the tree count to stay under the 24k node cap, and the shared shade produces competition and crown-shyness gaps.

## Visual detail (Phase 3)

Phase 3 is 3D-only.

- **Procedural bark** — a `MeshStandardMaterial` with an injected shader adds vertical fissures and moss/lichen tint on upward faces. The bark shader is disabled in the order/light/vigor/pipe diagnostic colour modes so those remain readable.
- **Backlit leaves** — leaf cards use a `MeshStandardMaterial` with a view/sun-dependent transmit term. Leaves glow when the camera looks toward the sun through the canopy, and the glow fades at night.
- **Real-time sway** — a GPU vertex-shader displacement sways branches and leaves. The `Sway` slider controls the amplitude; `Scale sway with wind` multiplies it by the prevailing wind strength. Sway continues while paused and does not re-run the simulation.
- **Falling debris and litter** — shed subtrees fall under gravity and fade out, while shed material accumulates as instanced litter on the ground. Both follow the current age when scrubbing.

## Interactive tooling (Phase 4)

- **Click-to-prune** — enable **Prune**, choose a **Cut** type, and hover a branch/leaf to preview the subtree in red before committing. Thinning removes the subtree; heading and pollard activate local regrowth. Cuts are stored as stable `budId:birthStep` keys, so scrubbing time leaves them intact; released light can still cause small growth responses on nearby branches. **Undo cut** / **Redo cut** (or Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y) navigate cut history; **Clear cuts** is undoable. Cuts and history reset when the seed, a growth slider, a preset, or the lifespan changes; environment changes preserve them.
- **Node inspector** — click the tree outside Prune mode to read axis, bud, fate, light, load, tortuosity, and cut metadata for the picked node. A wireframe marker highlights it in 3D.
- **GLB export** — **Export GLB** writes the current visible branches, leaves/flowers, and roots as a binary glTF, excluding ground, lights, obstacles and overlays. Export options include roots/leaves/metadata, Y-up/Z-up, metres/centimetres, and Full/Light/Silhouette LOD. **Export batch ZIP** writes the current GLB plus analytics/state/manifest while preserving the live time.
- **Analytics v2** — the strip under the time slider plots biomass, active tips vs. shed nodes, mean canopy light, height, crown width, leaf area, and leaf light across the structural growth steps, with a playhead at the current age. **Export CSV** writes the same per-step table.

## Phase 5 — Botanical depth

Phase 5 keeps the simulate-once architecture and the separate 2D/3D loops, but shares the parameter schema, species presets, and grammar helpers.

- **Shared schema** — both pages load `../shared/params.js`, `../shared/presets.js`, and `../shared/grammar.js` before the simulation module. `PARAM_META` carries label, group, range, default, and help text; dimension-specific defaults keep the 2D and 3D silhouettes distinct.
- **Node and axis metadata** — every node stores `axisId`, `axisOrder`, `parentAxisId`, `segmentIndex`, `pathLength`, `dir*`, `up*`, `tortuosity`, `budType`, `fate`, `birthLight`, `birthShade`, `mechanicalLoad`, and `cut`. A click on the tree outside Prune mode opens the **Node inspector** below the visualizations.
- **Axis grammar** — branch angle scales by axis order, laterals flatten with plagiotropism, deterministic tortuosity controls bend, and old trunks/scaffolds can throw capped reiteration shoots. Species presets are now grammars rather than five slider values.
- **Roots** — each tree gets a deterministic 4–8 root coarse root system rendered as tapered swept tubes, with surface roots and deeper roots. Roots are included in GLB export; root flare blends into the trunk.
- **Phenology** — leaf-out, full canopy, senescence, leaf drop, autumn palette, evergreen behavior, and cherry flowering come from the species curve. The season slider remains the manual override; “Follow phenology” cycles the season with age.
- **Prune response** — the **Cut** selector offers **Thinning**, **Heading**, and **Pollard**. Hovering in Prune mode ghosts the subtree in red; committed cuts can be undone/redone and **Clear cuts** is itself undoable. Thinning removes the subtree cleanly. Heading and pollard leave a dark wound marker and spawn capped wound-regrowth buds near the cut. Cut metadata is stored as `cut: { type, step, radius }` plus `cutType`/`cutStep`. Pruning releases shade, so nearby branches can respond slightly to the changed light field.
- **Analytics/export** — the analytics strip now also plots height, crown width, and approximate leaf area. **Pin baseline** freezes a run, **Compare** overlays dashed baseline lines, and the summary shows metric deltas; hover shows a tooltip/crosshair and click/arrow keys seek the tree. **Export CSV/JSON** writes the per-step table and comparison columns when a baseline is pinned.

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

- **Solar model and sky** — the basic sun controls remain; the Advanced environment panel adds a sun-path model driven by latitude, day of year, and hour. Both dimensions use the same sun direction and elevation. Sky presets (clear, golden hour, overcast, winter) drive exposure, daylight theme, and rendered light.
- **Light field v2** — the 3D voxel field samples a small sun disk, adds a sky/ambient term, and applies slope/aspect gain. Nodes store both `birthLight` and final-canopy `currentLight`; rendering and analytics use current light and `leafLight`.
- **Wind field v2** — wind has direction, speed, gust amplitude/frequency, and shelter from neighboring trees. Growth responds with anemotropic lean and wind-shortened internodes. The branch shader adds traveling gust fronts; the leaf shader adds flutter on top of per-branch sway.
- **Forest ecology** — tree counts support 1/3/5/7 with deterministic spacing and jitter. Advanced controls add auto species mix, age mix, spacing, and crown shyness; edge trees lean outward and species traits follow each tree through growth, roots, leaves, and phenology.
- **Obstacles v2** — added hedge-wall and box/arch volumes, a soft contact-shade shell, and push-out collision response so branches wrap rather than clip. Topiary cut surfaces are intentionally deferred.
- **Soil/slope/aspect (first pass)** — added the shared schema and a minimal effect: slope/aspect changes direct sun, while soil moisture changes growth vigor and leaf size. Terrain meshes and root water competition remain future work.

Run the environmental checks with:

```sh
node tests/phase6.js
```

The tests compare 2D/3D solar directions, verify wind determinism and shelter, exercise all forest sizes and species mixes, check the node cap, smoke-test every obstacle type, and confirm that slope/aspect changes light.

## Phase 7A — Render fidelity

Phase 7A raises branch, bark, and leaf fidelity without changing the growth model.

- **Branch mesh v2 (first pass)** — preserved the single branch draw call while adding elliptical/irregular cross-sections, branch-root collars, end collars, and seed-driven trunk flutes. A **Branch wireframe** toggle exposes the swept topology.
- **Species bark v2** — bark hue/saturation/lightness and fissure, moss, and lenticel traits now travel with each tree. The branch shader uses per-vertex bark parameters, procedural fissures, dark lenticels, moss accumulation on shaded/damp surfaces, sun-bleached highlights, roughness variation, and normal bump detail.
- **Species leaf v2** — oak, pine, willow, cherry, and poplar now use distinct leaf geometries in separate instanced meshes. Leaf placement includes light-facing orientation and water-stress droop; the leaf shader adds procedural veins, subtle normal detail, and translucency. GLB export emits one `leaves-<species>` mesh per active species.
- **Render traits** — `barkHue`, `barkSat`, `barkLight`, `barkFissure`, `barkMoss`, `barkLenticel`, and `leafShape` are merged through `traitsForPreset`, so forest mixes keep per-tree appearance.

Run the render-trait checks with:

```sh
node tests/phase7.js
```

## Phase 7B — Atmosphere and ground

- **Procedural sky IBL** — the active sky preset and sun state generate a small equirectangular environment map through `PMREMGenerator`.
- **Fog and exposure** — `FogExp2`, ACES tone mapping, exposure, and fog-density controls are wired into the Advanced environment panel.
- **Contact shadows** — each tree gets a soft radial shadow decal at its root line, supplementing the sun shadow.
- **Terrain and planting** — the flat ground strips are replaced by a large slopeable terrain plane. Tree root bases, root meshes, lateral growth limits, debris, and litter all follow the terrain height.
- **Ground detail** — deterministic low-poly meadow detail now covers the visible terrain: grass clumps, pebbles, rocks, shrubs, and ambient litter, with clustered distribution, root/obstacle avoidance, and broad terrain colour mottling.
- **Topiary caps** — topiary sphere/cone, hedge, and box volumes get a simple clipped-surface cap.
- **Atmosphere stability** — the environment map is cached by sky colors so slider changes do not rebuild it unnecessarily.

Visual regression now covers fog/slope and topiary cases in addition to species, forest, and golden-hour cases.

## Phase 7C — Motion and performance

- **Hierarchical rigid motion** — each segment gets a CPU-computed rotation from wind, order, mass, and path phase; transforms are composed from trunk to twig. Branch vertices move as rigid segments and leaves inherit their anchor transform, with only a small shader flutter left over.
- **Far LOD** — `High`, `Medium`, `Low`, and `Auto` quality tiers switch between the full branch/leaf meshes, reduced leaf density, and a far line/point impostor.
- **Adaptive quality** — Auto mode uses camera distance and measured frame time, with hysteresis, to select the tier.
- **Performance HUD** — an optional overlay reports frame time, fps, LOD, node count, segment count, and leaf count.
- **Understory** — deterministic instanced shrubs supplement the grass/rock ground detail.
- **Export safety** — GLB export defaults to full leaf instances; the optional LOD selector can request Light or Silhouette output without changing the live view.

## Phase 7D — Render close-out

- **Performance instrumentation** — the HUD reports simulation, analytics, branch-mesh, rigid-motion, leaf-motion, and render times.
- **LOD performance guard** — far LOD skips full branch-mesh rebuilds; mid LOD updates rigid motion at half cadence.
- **Rigid motion optimization** — per-segment rotation matrices replace per-vertex quaternion work.
- **Analytics labeling** — leaf light is explicitly marked as a final-canopy approximation via `analytics.leafLightModel` and the chart title.
- **Close-up fidelity** — triplanar-style species bark with wetness/snow, geometric knots, species leaf clusters, leaf-age color, and fruit cards.
- **Atmosphere extras** — falling snow is render-only; optional bloom uses an `EffectComposer` path and is excluded from exports.
- **Ground/topiary detail** — topiary trim rings and 2D soil strata add close-range surface cues.

Chunked branch meshes, worker simulation, adaptive ring topology, SSAO, and color grading remain follow-ups.

## Phase 8 — Product depth (closeout)

- **Persistence** — `Save state` writes a versioned JSON file; `Load state` restores seed, params, cuts, time, season, preset, visualization settings, and camera. URL share links encode the same state, and localStorage autosaves the session.
- **Export options** — GLB export supports root/leaf toggles, Y-up/Z-up, metres/centimetres, optional metadata, and Full/Light/Silhouette LOD. PNG supports 1×/2×/4×, analytics export supports CSV/JSON with comparison columns, and batch ZIP export writes the current GLB plus analytics/state/manifest while preserving the live time.
- **Analytics** — points now also include crown ratio, trunk/branch volume, canopy closure, and a rough carbon estimate.
- **Ground detail controls** — a Ground detail toggle hides/shows the decorative meadow layer, with separate Low/Medium/High ground density settings independent of overall quality.
- **Accessibility/UX** — added keyboard help, a reduced-motion toggle, and fullscreen canvas mode (`F` toggles, `Esc` exits, `Space` pauses/resumes, `R` restarts, `H` hides/shows UI); reduced motion disables rigid sway, snowfall, and spin.

The split studio at `../index.html` mounts both prototypes in one page without iframes: the 2D and 3D canvases sit side by side, with one universal control rail and one shared transport. Each simulation is an ES module, each renderer runs in its own shadow root, and a small in-page bus keeps presets, parameters, cuts, time, season, and playback synchronized. Canvas-bound actions such as prune, isolate, compare, undo, and export target the active pane. Press `F` or use Fullscreen to make the active canvas fill the viewport; `Esc` exits fullscreen, `Space` pauses/resumes, `R` restarts from year zero, and `H` hides/shows the remaining fullscreen UI. Serve the repository over HTTP (for example `python3 -m http.server`) so the studio can load both pane templates. Prune lasso, branch isolation, before/after ghost comparison, espalier, analytics comparison, and batch ZIP handoff are implemented. Use `1`/`2` to select the active pane; the mobile controls open as a focus-trapped drawer.

## Relationship to published algorithms
