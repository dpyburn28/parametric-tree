

# Parametric Tree — Refinement & Fidelity Roadmap

> **Current product scope:** Grow-only procedural tree generation, the shared timeline, 2D/3D views, save/load/share, and direct SVG/PNG/GLB export. Sculpting, analytics, recording, and batch export have been removed. See [the Grow-only focus plan](docs/grow-only-focus-plan.md). The implementation notes below are historical where they describe those features.

The Phase 1–4 roadmap is archived at [`docs/roadmap.md`](docs/roadmap.md). That document was about adding breadth: species, environment, rendering, pruning, export, analytics. This document is about depth.

The prototype already does a lot. The next pass should make what it does feel **deliberate, botanical, and production-ready**: stronger silhouettes, clearer species identity, better light and motion, a more tactile 3D surface, and tooling that supports iteration instead of one-off demos.

The core architecture should not change:

> **Simulate once into a flat `nodes[]` skeleton, then derive growth, thickness, shade, season, motion, and visuals at render time from `time`.**

New simulation data must be deterministic, precomputed, and cheap enough to regenerate interactively. New render features must not require re-running `simulate()`.

---

## 1. Where the prototype is now

### Delivered

- Species presets, sympodial forking, root flare, seasons, and 300-year lifespans.
- Directional sun, prevailing wind, obstacle/topiary volumes, and 1–3 tree competition.
- Procedural bark, backlit leaves, GPU sway, falling debris, and ground litter in 3D.
- Direct SVG/PNG/GLB export and reproducible tree state.
- A clean 2D renderer and a richer 3D renderer sharing the same growth-model architecture and parameter vocabulary.

### Architectural invariants

- `nodes[]` is flat; parents always have a lower index.
- `simulate()` runs once per seed/parameter change, not per frame.
- `growthTime(displayYear)` maps display years to structural steps.
- Per-bud hashing (`hashRandom(budId, step, channel)`) keeps repeated growth deterministic.
- 2D up is negative `y`; 3D up is positive `y`.

### Known fidelity ceilings

| Area | Current state | What still reads as “prototype” |
|---|---|---|
| Structure | Presets, forking, 80-step horizon, old-age proportions, topiary | Old-growth reiteration and adaptive ring topology remain limited |
| Roots | Procedural root system, root flare, root plate, root meshes | No root water competition or root:shoot allocation model |
| Light | Sun path, sky ambient, voxel shade, final-canopy leaf-light approximation | No full per-step light history or SSAO/penumbra |
| Wind | Wind field, shelter, gust/flutter shaders, hierarchical rigid motion | Branch-mass/damping tuning and worker simulation remain deferred |
| Ecology | 1/3/5/7-tree forests, species/age mixes, obstacles, understory | No root competition, biomechanics, or full ecology loop |
| Phenology | Leaf-out/drop, flowering/fruiting, species-specific autumn behavior | Fine-grained phenology timing remains approximate |
| 3D surface | Branch collars, knots, lenticels, bark/leaf traits, near/mid/far LOD | SSAO, color grading, and chunked meshes remain deferred |
| Ground | Slopeable terrain, instanced grass/rocks/shrubs/litter, contact shadows | Full 2D terrain/soil-profile geometry remains deferred |
| Tooling | Prune hover/undo/redo/lasso/isolate/compare, persistence, export v2, analytics comparison, split studio | Hidden-control API refactor remains deferred |
| Engineering | Phase 5–9 Node checks, app-ui headless suite, 2D/3D/studio visual baselines, 7-tree profile | Worker simulation, chunked meshes, and adaptive ring topology remain conditional |

---

## 2. Design principles for the next pass

1. **Silhouette first.** A tree is recognized by its outline, branch rhythm, and leaf mass before any material detail. Spend effort there first.
2. **Species are grammars, not slider values.** Oak, pine, willow, cherry, and poplar should differ in axis behavior, bud fate, branch angles, and phenology — not just in five numeric parameters.
3. **One model, two interpretations.** The 2D and 3D views should share parameters, presets, cuts, and analytics. 2D can stay stylized; 3D can be physical; their semantics must match.
4. **Fidelity hierarchy.** Structure → light → motion → material → micro-detail. Do not add bark noise before the branch joints read correctly.
5. **Deterministic and inspectable.** Every new random decision goes through `hashRandom` or a documented deterministic source. Add a debug inspector for node/axis/bud state.
6. **Budgeted.** Every feature gets a cost target. The prototype should remain interactive at 300 years.
7. **Progressive disclosure.** Keep the basic UI small. Put species grammar, biomechanics, and ecology behind an “Advanced” panel.
8. **Test the look, not just the code.** Visual regression and blind species-recognition checks matter as much as syntax checks.

---

## 3. Fidelity gaps worth closing

### 3.1 Structural grammar

- Branch angles are mostly global; real trees vary angle by axis order, age, light, and gravity.
- Apical dominance decays, but there is no explicit **reiteration** (epicormic shoots, water sprouts, old-growth sprouts).
- Branches are smooth tapered tubes; there are no **branch collars**, **knots**, **bud scars**, or **lenticels**.
- The trunk stops extending at a fixed step; old trees do not develop the gnarled, partially retrenched crown that makes them read as ancient.
- Roots are a flare on the trunk, not a system.

### 3.2 Light and environment

- The shade field is coarse and high-contrast at canopy scale. There is little soft shadow, sky fill, or directional variation across the crown.
- Sun angle affects growth, but there is no sun path, latitude, date, or day/night cycle beyond the theme.
- Wind is a single lean plus a shader wave. It does not vary by height, shelter, branch mass, or gust frequency.
- Obstacles affect growth, but there is no convincing contact, occlusion, or topiary cut surface.
- Multi-tree mode is a shared light field; it does not model spacing, species mix, root competition, or edge effects.

### 3.3 Phenology and life history

- Season is a render slider, not a species-specific schedule.
- Cherry stays pink all season; deciduous trees do not leaf out or drop in waves.
- There is no flowering, fruiting, seed, or leaf-litter cycle.
- Pruning removes a subtree but does not produce a visible wound, callus, or explicit regrowth response.

### 3.4 Surface and atmosphere

- Bark is a fragment-shader pattern, not geometry. Close-up, branches lack collars, cracks, and irregular cross-sections.
- Leaves are flat cards with uniform orientation. There is no species leaf shape, phyllotaxis, leaf age, or vein/normal detail.
- The ground is a disk. Contact shadows, grass, rocks, and root exposure are missing.
- There is no fog, depth of field, bloom, color grading, or sky model beyond a gradient.

### 3.5 Tooling and workflow

- Prune mode is one-way: no hover highlight, subtree preview, undo/redo, or cut-type choice.
- There is no save/load or shareable state.
- Export has no options (LOD, units, axis, leaves on/off, line-art SVG).
- Analytics are read-only sparklines; there is no comparison, hover tooltip, or CSV export.
- 2D and 3D controls are intentionally different in places (3D-only features), but parity is maintained by hand.

---

## 4. Roadmap at a glance

| Phase | Theme | Headline outcomes |
|---|---|---|
| **5** | Fidelity foundations | Shared schema, node/axis metadata, species grammar v2, roots, phenology, prune response |
| **6** | Environmental depth | Sun path and sky, light field v2, wind field and shelter, obstacles v2, forest ecology |
| **7** | Render depth | Branch mesh v2, bark/material v2, leaf v2, lighting/atmosphere, ground, motion, LOD |
| **8** | Product depth | Prune UX v2, persistence/undo, export v2, analytics v2, 2D/3D parity, accessibility |
| **9** | Validation & polish | Determinism/visual/perf tests, profiling, docs, release checklist |

The phases are ordered by dependency, not by novelty. Structure and metadata come first because rendering, analytics, and pruning all depend on them.

---

## 5. Phase 5 — Botanical depth

**Status (first pass):** shared schema, node/axis metadata and inspector, axis grammar v1, species presets v2, coarse roots, phenology, thinning/heading/pollard cuts, prune hover/ghost/undo, analytics v2 with CSV export, and visual-regression baselines are implemented in both prototypes. True byte-identical unrelated branches after pruning remain an intentional non-goal while pruning releases light.

**Goal:** Make the tree structurally legible as a species and as an individual, before adding more surface detail.

### 5.1 Shared parameter and species schema

Create a shared source of truth for parameters and presets so the 2D and 3D prototypes cannot drift.

- Add `shared/params.js` with `PARAM_META`:
  - key, label, group (`Basic` / `Advanced`), min, max, step, default, help text.
  - groups for `Structure`, `Light`, `Wind`, `Phenology`, `Ecology`, `Render`.
- Add `shared/presets.js` with `SPECIES_PRESETS_V2`.
- Load shared files before `simulation.js` in both HTML pages.
- Add a parity test that compares parameter keys, defaults, and preset values between prototypes.
- Decide the 2D/3D simulation relationship:
  - **Preferred:** one shared simulation core with a `dimensions` flag, so 2D is a projection of the same skeleton.
  - **Fallback:** a documented projection/parity contract plus structural-metrics tests and explicit notes where 2D and 3D intentionally diverge.
- **Implemented (first pass):** the fallback. The shared schema and presets are the source of truth, but 2D and 3D keep separate simulation loops. Intentional differences are documented: 2D alternates lateral sides, 3D uses golden-angle phyllotaxis and a voxel light field, and root rendering/export differs.
- Keep the visible basic controls small; move grammar and biomechanics into an “Advanced” panel.

### 5.2 Node and axis metadata

Add deterministic metadata that renderers and analytics can consume without re-simulating.

```js
node = {
  ...existing,
  axisId,            // stable axis identity
  axisOrder,         // 0 = trunk, 1 = scaffold, 2+ = lateral
  parentAxisId,
  segmentIndex,      // position along the axis
  pathLength,        // distance from root
  dirX, dirY, dirZ,  // unit direction
  upX, upY, upZ,     // stable frame for geometry
  tortuosity,        // deterministic per-node bend
  budType,           // leader | scaffold | lateral | epicormic | reiteration
  fate,              // live | shed | pruned | broken
  birthLight,
  birthShade,
  mechanicalLoad,    // derived from subtree mass / wind
  cut: null | { type, step, radius },
};
```

Keep every new field deterministic and precomputed. Renderers should read it, not invent it.

### 5.3 Axis and bud grammar

Replace “one global branch rule” with a small grammar.

- **Axis rules:** leader, scaffold, lateral, epicormic, reiteration.
- **Order-specific branch angles:** e.g. oak scaffolds open wide, pine laterals are short and horizontal, willow laterals sweep down.
- **Plagiotropism:** lateral axes flatten toward horizontal; leaders stay upright.
- **Tortuosity:** species-specific deterministic bend, stronger in old wood and near the trunk.
- **Reiteration:** old trees throw epicormic shoots from the trunk and scaffolds, especially after light changes or pruning. This is the single biggest visual cue for “old tree.”
- **Bud fate:** probabilities for dormant, lateral, flower, fruit, abort, and epicormic buds, modulated by light and axis age.
- **Age-dependent behavior:** young trees are excurrent and simple; old trees are decurrent, retrenched, and irregular.

Acceptance:

- Blind silhouette test: a viewer can distinguish oak, pine, willow, cherry, and poplar from outline alone at least 80% of the time.
- Same seed + parameters produce deterministic, comparable structure in 2D and 3D; if 2D is a projection, the skeleton is identical.
- No new UI parameter without a preset/default and a help string.

### 5.4 Roots and biomechanics

- Add a coarse root system: 4–8 structural roots, branching, taper, and soil contact.
- 2D: roots as tapered polygons below the soil line.
- 3D: root mesh or swept tubes; root flare blends into the trunk.
- Add root plate / buttress geometry for old trees.
- Add a root:shoot ratio and optional root competition in forest mode.
- Add a lightweight mechanical pass:
  - Estimate subtree mass from pipe-model volume.
  - Use it to modulate droop, branch angle, and taper.
  - Add a safety-factor target so long horizontal branches do not look impossibly rigid.
- Keep this precomputed; do not run a physics solver per frame.

Acceptance:

- Trees look planted, not placed.
- Roots are visible in both renderers and do not clip through the ground.
- Old trees have buttress/root-plate character.
- No significant regeneration cost increase.

### 5.5 Phenology and life history

Separate three ideas that are currently conflated:

1. **Season** — the global visual phase (spring/summer/autumn/winter).
2. **Phenology** — species-specific timing of leaf-out, flowering, fruiting, and leaf drop.
3. **Weather** — optional short-term variation (late frost, drought, storm).

Add per-species phenology curves:

- Deciduous: leaf-out window, full canopy, senescence, leaf drop.
- Evergreen: gradual needle turnover; no bare winter.
- Cherry: flower before/with leaf-out, then fruit, then autumn color.
- Oak: late leaf-out, acorns, bronze autumn.
- Willow: early leaf-out, long season, yellow autumn.
- Pine: fixed needle retention, no autumn color.

Render-time derivation:

- Leaf scale/opacity/color from `time`, `season`, species curve, and node light.
- Flower/fruit instancing on eligible buds.
- Leaf litter accumulation tied to drop rate.
- Keep the manual season slider as an override; add a “follow phenology” toggle.

Acceptance:

- Spring, summer, autumn, and winter are visually distinct without changing the simulation.
- Cherry blossoms at the right phase; evergreen stays green.
- Leaf drop is uneven and species-specific, not a global fade.

### 5.6 Pruning response

Move from “delete subtree” to “horticultural cut.”

- Cut types:
  - **Thinning:** remove at the branch collar; parent remains clean.
  - **Heading:** cut back to a bud; local buds activate.
  - **Pollard:** repeated heading on a knuckle; dense regrowth.
  - **Espalier / plane constraint:** constrain growth to a plane or wall.
- Wound response:
  - Add a cut stub, wound-wood ring, and optional decay tint.
  - Mark the cut node/axis with `cut` metadata.
  - Boost local lateral/epicormic activation based on cut severity, light, and species.
- Preview:
  - Hover highlights the subtree that would be removed.
  - Ghost the removed subtree before committing.
- History:
  - Undo/redo stack of cut snapshots.
  - “Clear cuts” remains, but becomes one action in history.

Acceptance:

- A cut reads as a cut, not a missing branch.
- Regrowth appears near the cut in the following growth steps.
- Cut identity and deterministic random decisions remain stable across a cut; pruning releases light, so nearby branches may respond slightly to the changed light field. *(Intentional trade-off; true byte-identity would require light-neutral pruning.)*
- Undo/redo restores exact prior structure.

---

## 6. Phase 6 — Environmental depth

**Status (first pass):** shared solar/sky/wind/soil helpers, sun-disk light field with sky ambient, birth/current light split, wind lean/taper/shelter, 3D gust/flutter shaders, 1/3/5/7 forest with species/age mixes, hedge/box obstacles with contact shade, and a minimal slope/aspect/moisture effect are implemented.

**Deferred follow-ups:**

- Topiary cut surfaces, hedge interior detail, and clipped-surface shading → Phase 7.5 *(7B first pass delivered simple caps)*.
- Terrain meshes, ground slope/aspect rendering, and a 2D soil profile → Phase 7.5 *(7B first pass delivered slopeable terrain and 2D ground detail)*.
- Per-step `currentLight` history and a leaf-light timeline → Phase 7D.2.
- Forest understory, edge layering, and 5/7-tree LOD → Phase 7.7 / 7D.1.
- Root water competition, root:shoot ratio, and soil-moisture fields → later ecology pass (not yet scheduled).
- Full biomechanical modulation of droop/taper from `mechanicalLoad` → later render/biomechanics pass.

**Goal:** Make the environment shape the tree in ways a viewer can feel, not just measure.

### 6.1 Sun path and sky

- Replace the single sun-angle control with a small solar model:
  - latitude, date, time of day, azimuth, elevation.
  - seasonal declination and sun path arc.
  - 2D sun vector and 3D directional light stay in sync.
- Add sky/ambient controls:
  - sky color, horizon haze, sun color temperature, exposure.
  - golden hour, overcast, clear-day presets.
- Keep the simple “sun angle” control as a basic mode; put the solar model in Advanced.

Acceptance:

- Changing date/time changes both growth light and rendered shadows consistently.
- 2D and 3D agree on the sun direction.
- Day/night theme remains driven by the sun.

### 6.2 Light field v2

- Sample a small sun disk instead of one ray; average 3–5 directions for soft shade.
- Add sky occlusion: a cheap hemisphere sample or ambient term so interior branches are not pitch black.
- Separate **birth light** (used for bud fate) from **current light** (used for rendering/analytics).
- Add leaf-level light interception to analytics.
- Keep the voxel grid but make resolution adaptive or species-tuned.
- Consider temporal reuse across growth steps if profiling demands it.

Acceptance:

- Canopy closure and crown shyness read clearly.
- Interior branches are shaded but not black.
- Light-field cost stays within the regeneration budget.

### 6.3 Wind field and shelter

- Replace global wind strength with a small wind field:
  - direction, base speed, gust amplitude/frequency, exposure.
  - shelter from obstacles and neighboring trees.
- Simulation effects:
  - anemotropism (lean and flagging),
  - thigmomorphogenesis (wind-induced taper and shorter internodes),
  - optional branch breakage in extreme wind.
- 3D motion:
  - hierarchical sway with branch mass/damping,
  - per-order frequency and phase,
  - leaf flutter distinct from branch sway,
  - gust fronts that travel through the canopy.
- 2D: directional lean and subtle branch-phase offsets.

Acceptance:

- Windward/leeward asymmetry is obvious.
- Calm and storm states feel different.
- Motion is not a single uniform sine wave.
- No jitter or frame-rate-dependent behavior.

### 6.4 Soil, water, slope, and aspect

Treat this as optional/long-term, but design the data model for it now.

- Slope and aspect affect sun exposure and water.
- Soil moisture field affects vigor and leaf size.
- Roots compete for water in forest mode.
- Ground plane can tilt; trees remain vertical or lean with slope.
- 2D can show a simple soil profile.

Acceptance:

- A slope/aspect change produces a readable growth difference.
- The feature is optional and does not complicate the basic UI.

### 6.5 Obstacles and topiary v2

- Improve SDF collision response so branches wrap smoothly instead of clipping.
- Add contact shade/occlusion around walls and boulders.
- Add topiary cut surfaces and dense interior branching.
- Support hedge walls and simple architectural volumes.
- Show a 2D obstacle preview, not just 3D.

Acceptance:

- Branches visibly avoid or wrap obstacles.
- Topiary reads as clipped, not merely contained.
- Obstacles cast plausible shade.

### 6.6 Forest ecology

- Expand tree count to 1/3/5/7 with spacing and species mix.
- Add age mix and edge/understory trees.
- Share light, wind shelter, and root competition.
- Add crown shyness and asymmetric edge trees.
- Add forest-floor litter and understory vegetation (render-only).
- Use LOD and instancing to keep performance.

Acceptance:

- A forest reads as a stand, not repeated clones.
- Edge trees lean and fill outward.
- Performance remains interactive.

---

## 7. Phase 7 — Render depth

**Status (7A + 7B + 7C first pass):** branch-mesh irregularity/collars, species bark and leaf rendering, 2D bark hatching, branch wireframe debug, procedural sky IBL, fog/exposure, contact shadows, slopeable terrain with root-base alignment, instanced ground detail, terrain-aware debris/litter, simple topiary caps, hierarchical rigid segment motion, far line/point LOD, adaptive quality tiers, performance HUD, and understory shrubs are implemented.

**7D close-out required before Phase 8:** performance/LOD hardening, per-step light-history correctness, and the remaining environment/fidelity follow-ups below.

**Deferred render follow-ups:**

- Full adaptive CPU ring topology, geometric knots/bud scars, and cross-section geometry beyond the shader-side first pass → Phase 7.1 follow-up.
- Full triplanar/object-space bark with species plate/peeling/wetness/snow detail and texture-based normal maps → Phase 7.2 follow-up.
- Leaf phyllotaxis clusters, leaf-age color, flower/fruit instancing, and near/far leaf LOD/impostors → Phase 7.3 + 7.7.
- SSAO/bloom/color grading, full per-step leaf-light history, and advanced atmosphere post-processing → Phase 7.4 follow-up.
- Full 2D soil-profile geometry, detailed topiary cut surfaces, and hedge interior detail → Phase 7.5 follow-up.
- Falling snow, per-branch contact damping, and full leaf shimmer detail → Phase 7.6 follow-up *(7C first pass delivered hierarchical branch motion and mass-aware sway)*.
- True chunked branch meshes, worker-based simulation, and per-branch distance LOD → Phase 7.7 follow-up *(7C first pass delivered near/mid/far LOD, adaptive quality, understory, and performance HUD)*.

**Goal:** Raise 3D fidelity without sacrificing the clean 2D language or the frame budget.

### 7.1 Branch mesh v2

**Status:** first-pass shader-side irregularity, elliptical cross-sections, root/end collars, and wireframe debug are implemented. Adaptive CPU ring topology, geometric knots/bud scars, and true cross-section geometry remain deferred.

- Sweep tubes with variable, slightly elliptical cross-sections.
- Add irregular rings, buttress flutes, branch collars, knots, bud scars, and lenticels.
- Use parallel-transport frames to avoid twist.
- Add adaptive ring counts: more rings near joints, fewer on straight runs.
- 2D: variable-width polygons, collars, bark hatching, and shadow-side accents.
- Add a debug “wireframe/cross-section” view.

Acceptance:

- No visible kinks or frame twist.
- Branch joints read as joints.
- Close-up branches have believable irregularity.

### 7.2 Bark and surface v2

**Status:** species palettes, procedural fissures, lenticels, moss, sun-bleached highlights, roughness variation, and normal bump are implemented. Full triplanar/object-space bark, species plate/peeling, wetness, snow, and texture-based normal maps remain deferred.

- Triplanar or object-space procedural bark.
- Species-specific fissures, plates, peeling, lenticels, moss/lichen, wetness, snow.
- Normal/roughness detail, not just color.
- Age and light modulation: moss on shaded, damp sides; sun-bleached upper surfaces.
- 2D: bark hatching and species-specific trunk texture.

Acceptance:

- Bark reads at close range and at silhouette scale.
- Species bark is distinguishable.
- Shader cost stays within budget.

### 7.3 Leaf v2

**Status:** species leaf silhouettes, light-facing placement, water-stress droop, veins, translucency, and per-species GLB meshes are implemented. Phyllotaxis clusters, leaf-age color, flower/fruit instancing, and near/far leaf LOD/impostors remain deferred.

- Species leaf shapes: lobed oak, needle pine, long willow, serrated cherry, poplar.
- Phyllotaxis and cluster rules.
- Leaf orientation toward light; droop with age/water stress.
- Translucency, veins, subtle normal detail.
- Leaf age and seasonal color.
- LOD: cards near, billboards/impostors far.

Acceptance:

- Leaf shape is recognizable per species.
- Canopy mass is fuller and less uniform.
- Leaf rendering stays fast at 300 years.

### 7.4 Light and atmosphere

**Status:** procedural sky IBL, ACES exposure, `FogExp2`, contact-shadow decals, softer shadow settings, and horizon haze are implemented. SSAO/bloom/color grading and full per-step leaf-light history remain deferred.

- PBR materials with sky IBL or a cheap ambient probe.
- Ambient occlusion / contact shadows.
- Soft sun shadows; shadow camera fit to the crown.
- Optional screen-space shadows, fog, depth of field, bloom, color grading.
- Per-step current-light history for leaf light and analytics (deferred from Phase 6).
- 2D: atmospheric gradient, depth haze, soft ground shadow.

Acceptance:

- The scene has depth and contact.
- The tree does not look pasted onto the background.
- Post-processing is optional and does not break performance.

### 7.5 Ground and debris

**Status:** slopeable 3D terrain, root-base planting, contact shadows, instanced grass/rocks, terrain-aware debris/litter, 2D soil detail, and simple topiary caps are implemented. Full 2D terrain geometry, detailed topiary cut surfaces, and hedge interior detail remain deferred.

- Terrain/ground plane with grass, rocks, roots, and litter.
- Ground slope/aspect rendering, terrain meshes, and a 2D soil profile (deferred from Phase 6).
- Topiary cut surfaces, hedge interior detail, and clipped-surface shading (deferred from Phase 6).
- Contact shadows and ambient occlusion at the root flare.
- Falling debris and leaf litter with simple settling.
- 2D: soil line, grass tufts, leaf litter.

Acceptance:

- The tree feels grounded.
- Debris/litter accumulates plausibly.
- Ground detail is LOD-aware.

### 7.6 Motion v2

**Status:** hierarchical rigid segment transforms, mass-aware sway, leaf-anchor inheritance, 2D render-only sway, and gust coupling are implemented. Falling snow and deeper branch damping remain deferred.

- Hierarchical wind: trunk → scaffold → twig → leaf.
- Branch mass/damping; heavier branches move slower.
- Leaf flutter distinct from branch sway.
- Gust fronts and shelter.
- Falling debris and snow.
- 2D: subtle sway/lean and leaf shimmer.

Acceptance:

- Motion feels weighted, not uniform.
- No popping when time or wind changes.
- GPU cost stays within budget.

### 7.7 LOD and performance

**Status:** near/mid/far render tiers, camera/frame-time adaptive quality, far branch lines + leaf points, understory shrubs, and a performance HUD are implemented. Chunked branch meshes, worker simulation, and per-branch distance LOD remain deferred.

- Three LOD levels: near (full geometry), mid (reduced rings/leaves), far (billboard/impostor).
- Instancing for leaves, flowers, fruit, litter.
- Frustum culling and chunked branch meshes.
- Shader variants for quality tiers.
- Forest understory, edge layering, and 5/7-tree LOD (deferred from Phase 6).
- Optional worker-based `simulate()` for large forests.
- Adaptive quality based on measured frame time.

Acceptance:

- 60 fps at 300 years on the target machine.
- No visible LOD popping at normal camera distances.
- Memory stays within budget.

### 7D. Render close-out — before Phase 8

**Status (first pass):** performance HUD instrumentation, far-LOD branch-mesh skip, CPU-motion matrix optimization, mid-LOD motion throttling, final-canopy leaf-light labeling, triplanar-style species bark with wetness/snow, geometric knots, species leaf clusters/age color, fruit cards, topiary trim rings, 2D soil strata, falling snow, and optional bloom are implemented. Full adaptive ring topology, SSAO/color grading, chunked branch meshes, and worker simulation remain deferred.

**Goal:** Close the deferred Phase 7 items that protect correctness, performance, or visible quality before starting product-depth work.

#### 7D.1 — Performance and LOD hardening (P0, must do first)

**Implemented:** HUD now reports simulation, analytics, branch-mesh, motion, and render timings. Far LOD skips full branch-mesh rebuilds. CPU rigid motion uses per-segment rotation matrices and mid LOD updates at half cadence. Chunked meshes/worker simulation remain conditional follow-ups.

- Profile CPU hierarchical rigid motion at 1/3/5/7 trees and 300 years.
- Optimize the CPU motion path if frame time exceeds budget.
- Add chunked branch meshes or per-tree branch chunks where profiling shows benefit.
- Add true per-tree/per-branch distance LOD where global near/mid/far is insufficient.
- Consider worker-based `simulate()` only if regeneration profiling demands it.
- Verify no LOD popping and no joint separation under motion.

Acceptance:
- 300-year/7-tree scene meets the frame budget on the target machine.
- CPU motion remains stable and correctly attached at all LOD levels.
- Performance HUD reports the actual active tier.

#### 7D.2 — Light/analytics correctness (P0/P1)

**Implemented:** chose the documented final-canopy fallback. `analytics.leafLightModel = 'final-canopy'`, the chart labels leaf light with an asterisk, and the canvas title documents the approximation.

- Add lightweight per-step `currentLight`/leaf-light history, or explicitly document final-canopy approximation in analytics.
- Ensure `leafLight` and canopy-closure metrics are reproducible and exported correctly.

Acceptance:
- Leaf-light analytics are either step-accurate or clearly labeled as final-canopy estimates.
- CSV/JSON analytics remain deterministic.

#### 7D.3 — Environment and close-up fidelity (P1, before Phase 8 if budget allows)

**Status:** 7D.3a delivered topiary trim rings and 2D soil strata. 7D.3b delivered triplanar-style species bark with wetness/snow, geometric knots, leaf clusters/age color, and fruit cards. 7D.3c delivered falling snow and optional bloom. Full hedge interior detail, adaptive ring topology, SSAO/color grading, and full 2D terrain geometry remain deferred.

- Detailed topiary cut surfaces, hedge interior detail, and clipped-surface shading.
- Full 2D soil-profile geometry.
- Adaptive CPU branch ring topology, geometric knots/bud scars, and cross-section geometry.
- Full triplanar/object-space bark with plate/peeling/wetness/snow and texture-based normal maps.
- Leaf phyllotaxis clusters, leaf-age color, and flower/fruit instancing.
- SSAO, bloom, color grading, falling snow, and deeper branch damping.

Acceptance:
- Close-up branch, bark, leaf, and topiary views hold up at inspection distance.
- Atmosphere and ground remain within the frame budget.
- 2D/3D visual baselines updated intentionally.

#### Later ecology/biomechanics pass (P2, after Phase 8)

- Root water competition and root:shoot ratio.
- Soil-moisture fields and slope/aspect water effects.
- Full biomechanical modulation from `mechanicalLoad` for droop, taper, and safety factor.
- Terrain/understory ecology beyond render-only detail.

---

## 8. Phase 8 — Product depth

**Status (closeout):** versioned state save/load with a v1→v2 migration registry, URL share links, localStorage autosave, SVG/GLB/PNG/JSON export options, extra analytics metrics, a no-iframe split 2D/3D studio, lasso/multi-select pruning, branch isolation, before/after ghost compare, espalier plane, keyboard shortcuts, reduced-motion defaults, fullscreen canvas mode (with Space pause/resume, R restart, and H hide/show UI shortcuts), and independent 3D ground detail/density controls are implemented. The closeout adds persisted export settings, SVG dimensions/DPI/annotations/scale bar, GLB LOD selection, batch ZIP handoff with a manifest, analytics baseline comparison with overlays/deltas/chart-to-tree linking, focus-visible styles, skip links, keyboard pane selection, a focus-trapped mobile drawer, ARIA/live-region coverage, a color-blind-safe analytics palette, and contrast checks. Remaining deferred work: 2D ground overhaul, adaptive ring topology, SSAO/color grading, chunked meshes, worker simulation, full per-step light history, ecology/biomechanics, and the hidden-control API refactor.

**Goal:** Turn the prototype into a tool that supports iteration, comparison, and handoff.

### 8.1 Prune UX v2

**Status:** hover preview, subtree ghost, undo/redo, lasso/multi-select, isolate, before/after ghost compare, espalier plane, and keyboard help are implemented. Full lasso editing of arbitrary sub-branches and richer compare metrics remain deferred.

- Hover highlight and subtree ghost.
- Cut-type selector: thinning, heading, pollard, espalier.
- Undo/redo and cut history.
- Multi-select and lasso pruning.
- Isolate/ghost a branch to inspect it.
- Before/after compare.
- Keyboard shortcuts and a compact help overlay.

Acceptance:

- A user can make, inspect, undo, and redo a cut without leaving the viewport.
- The preview accurately matches the committed result.
- The UI remains usable with a trackpad and keyboard.

### 8.2 Persistence and sharing

**Status:** versioned JSON save/load, URL share links, localStorage autosave, and a v1→v2 migration registry are implemented. v1 files are upgraded in memory with tolerant defaults; unknown/newer versions and malformed JSON fail with a readable message. The split studio shares state across both dimensions, and the standalone pages show load failures as a non-blocking toast.

- Save/load a versioned `tree.json`:
  - seed, parameters, lifespan, cuts, time, camera, season, render settings.
- URL share links (compressed state).
- localStorage autosave.
- Import/export state without exporting geometry.
- Schema versioning and migration notes.

Acceptance:

- Save → reload → load restores the exact tree and cuts.
- A shared URL reproduces the same view.
- Old files fail gracefully with a migration message.

### 8.3 Export v2

**Status:** SVG layer/line-art options, SVG dimensions/DPI/annotations/scale bar, GLB roots/leaves/axis/units/metadata/LOD options, PNG 1×/2×/4× selection, JSON analytics export, and batch ZIP export with a manifest are implemented. Export settings persist in the tree state and share links. Batch export pauses playback, preserves the live time/state, writes 2D SVG frames (0/25/50/75/100%) plus analytics/state/manifest, and writes the current GLB for 3D.

GLB options:

- Include/exclude leaves, flowers, fruit, litter.
- LOD level.
- Units (m/cm), axis (Y-up/Z-up), origin at root/ground.
- Include metadata/extras (seed, parameters, cuts).
- Optional merged geometry vs. instanced leaves.

SVG options:

- Layers (branches, leaves, flowers, litter).
- Line-art vs. filled style.
- Palette and background.
- Dimensions and DPI.
- Optional annotations/scale bar.

Other:

- PNG render at 1x/2x/4x.
- CSV/JSON analytics export.
- Batch export across seeds/ages.

Acceptance:

- GLB round-trips in Blender and Three.js.
- SVG opens cleanly in a browser and vector editor.
- Export options are discoverable and remembered.

### 8.4 Analytics v2

**Status:** crown ratio, trunk/branch volume, canopy closure, carbon estimate, CSV/JSON export, baseline pin/compare, dashed baseline overlays, delta summaries, hover tooltips/crosshairs, and chart click/arrow-key seeking are implemented. Comparison CSV/JSON include baseline and delta columns. The palette uses Okabe-Ito colors, and the chart labels adapt to the scene theme.

Add metrics that answer design questions:

- Height, crown width, crown ratio.
- Trunk volume, branch volume, leaf area.
- Light interception and canopy closure.
- Carbon estimate (rough).
- Shed biomass and pruning biomass.
- Mechanical stress / safety factor.
- Cut count and regrowth volume.

UI:

- Axes, gridlines, hover tooltips, and a legend.
- Compare two seeds or two parameter sets.
- Export CSV/JSON.
- Link chart hover to the tree (highlight the corresponding age/cut).

Acceptance:

- A user can compare two trees and explain the difference from the charts.
- Metrics are exported and reproducible.

### 8.5 2D/3D parity

**Status:** shared schema, presets, state links, and a true single-page split studio are implemented. The 2D and 3D simulations are ES modules with separate scopes; each renderer is mounted in its own shadow root, and an in-page bus synchronizes full state plus season patches. The studio uses one universal control rail, a shared transport, an active-pane model for canvas-bound actions, and a fullscreen focus mode for the selected canvas. Unified single-simulation parity remains deferred.

- Shared parameter and preset schema.
- Shared analytics definitions.
- Split studio: side-by-side 2D/3D with one shared transport for time, season, and playback, plus synchronized presets, parameters, and cuts.
- Parity tests for keys, defaults, presets, and structural metrics.
- Standalone prototype pages remain available as debug harnesses.

Acceptance:

- The same seed and parameters produce the same structural metrics, or an explicitly documented projection of them.
- No parameter exists in one prototype but not the other without a documented reason.

### 8.6 Accessibility and UX

**Status:** reduced-motion defaults from `prefers-reduced-motion`, focus-visible styles, skip links, keyboard pane selection (`1`/`2`), a focus-trapped mobile drawer with backdrop/click-outside/Escape handling, ARIA labels/live regions, a color-blind-safe analytics palette, contrast checks, and the responsive rail/drawer/stacked layout are implemented. Core panel controls and canvas-bound actions are reachable without a mouse; direct canvas pruning still requires a pointing device.

- Keyboard navigation for all controls.
- Visible focus states and ARIA labels.
- Reduced-motion mode for sway/debris.
- Color-blind-safe palettes for analytics and overlays.
- Contrast checks for dark/light themes.
- Responsive layout for narrow screens.

Acceptance:

- Core workflows work without a mouse.
- The UI passes basic contrast and focus checks.
- Reduced-motion mode disables nonessential animation.

---

## 9. Phase 9 — Validation and polish

**Goal:** Make the prototype trustworthy enough to hand to someone else.

### 9.1 Automated tests

- Node simulation tests:
  - parent index invariant,
  - deterministic seed output,
  - prune determinism (unrelated branches identical),
  - no NaN positions/radii,
  - node-count and performance budgets.
- Shared-schema parity tests.
- Export smoke tests (GLB magic bytes, SVG well-formedness, ZIP/CRC structure).
- Headless Chrome checks:
  - no console/WebGL errors,
  - analytics canvas non-empty,
  - prune click changes cuts,
  - export button produces a blob,
  - analytics pin/compare/clear and chart-to-tree seeking,
  - 2D/3D batch ZIP output and live-state preservation,
  - reduced-motion default and mobile drawer focus behavior,
  - canvas/ARIA labels and status contrast.
- Visual regression:
  - fixed seeds, fixed camera, fixed time,
  - screenshot 2D and 3D,
  - a combined split-studio baseline (2D left / 3D right),
  - pixel-diff against baselines,
  - update baselines intentionally.

### 9.2 Performance profiling

- Instrument `simulate()`, `computeAnalytics()`, mesh rebuild, and render.
- Add a small performance HUD (optional, dev-only).
- Profile before optimizing; keep a regression budget.
- Current Node profile (Apple Silicon, warm runs):
  - single tree at 300 years: ~0.67 s (2D) / ~1.31 s (3D).
  - 7-tree `auto` forest at 300 years: ~1.51 s / 13,452 nodes (2D), ~1.60 s / 11,012 nodes (3D).
  - The 7-tree/300-year profile is guarded by `tests/phase6.js` at < 3 s.
- The 300-year simulation is intentionally CPU-heavy; the UI should keep a progress/loading state rather than promise interactive regeneration. Chunked meshes, worker simulation, and adaptive ring topology remain deferred.
- GLB export remains a synchronous geometry build and should be profiled before adding larger scenes.

### 9.3 Documentation

- Parameter reference with ranges, defaults, and visual effects.
- Algorithm notes: growth, light field, pruning, analytics.
- Species guide: what each preset is trying to express.
- Export guide: Blender/Three.js/vector-editor workflows.
- Changelog and migration notes.
- A small gallery of example seeds/parameters.

### 9.4 Release checklist

- All tests pass.
- No console/WebGL errors in both prototypes.
- 2D/3D parity tests pass.
- Export round-trip verified, including ZIP/CRC and live-state preservation.
- Performance profile recorded; the 300-year simulation is documented as CPU-heavy.
- Docs, READMEs, and visual baselines updated.
- Accessibility checks pass (labels, live regions, focus, contrast, reduced motion).
- See [`docs/release-checklist.md`](docs/release-checklist.md) for the current release record.

### 9.5 Phase 8 closeout record

**Validated:** 2026-11-14

- `node tests/phase5.js` — shared schema, determinism, metadata, roots, phenology, pruning.
- `node tests/phase6.js` — solar parity, wind/light determinism, forest budgets, obstacles, slope/aspect, and the 7-tree/300-year profile.
- `node tests/phase7.js` — species render traits and mixed-forest traits.
- `node tests/phase8.js` — schema v2, v1 migration, malformed/future-version handling, and state round-trip.
- `node tests/phase9.js` — ZIP local/central-directory structure and CRC32.
- `node tests/app-ui.js` — studio/standalone fullscreen, keyboard, active pane, ground controls, analytics pin/compare/clear, chart seeking, batch ZIP, accessibility, mobile drawer, reduced motion.
- `node tests/visual-regression.js` — 2D/3D fixed cases plus the combined studio baseline.

The 2D ground overhaul, adaptive ring topology, SSAO/color grading, chunked meshes, worker simulation, full per-step light history, ecology/biomechanics, and the hidden-control API refactor remain deferred. Do not pull them into a closeout patch without a separate plan and budget.

---

## 10. Prioritized sequence

### Immediate next pass — “Render close-out” (before Phase 8)

**Status:** 7D.1 performance instrumentation/optimization, 7D.2 final-canopy labeling, 7D.3a topiary/soil detail, 7D.3b triplanar bark/knots/leaf clusters/fruit, and 7D.3c snow/bloom are complete. Remaining conditional work: adaptive ring topology, SSAO/color grading, chunked branch meshes, and worker simulation.

1. **7D.1 Performance/LOD hardening** — HUD timings, far-LOD branch skip, matrix-based rigid motion, mid-LOD motion throttle. Chunked meshes/worker simulation remain conditional.
2. **7D.2 Light/analytics correctness** — final-canopy leaf-light approximation documented and labeled.
3. **7D.3 Environment/fidelity close-out** — 7D.3a topiary trim rings and soil strata done; 7D.3b/c remain.

### Completed — “Readable tree” (Phase 5)

Shared schema, metadata/inspector, axis grammar, species presets v2, roots, phenology, prune response, analytics v2/CSV, and visual regression.

### Completed — “Believable environment” (Phase 6–7)

Solar/sky/wind/soil helpers, light field v2, forest ecology, obstacles v2, branch/bark/leaf fidelity, atmosphere/ground, rigid hierarchical motion, LOD/quality tiers, and performance HUD.

### Completed — “Production tool” (Phase 8 closeout)

1. Persistence, schema migration, share links, and batch ZIP export.
2. Export v2 (SVG dimensions/DPI/annotations/scale bar, GLB LOD) and analytics comparison.
3. Split 2D/3D parity and standalone debug pages.
4. Prune UX v2: espalier, multi-select/lasso, isolate/compare, help overlay.
5. Accessibility, reduced-motion defaults, focus/keyboard/mobile drawer, and responsive polish.
6. Documentation, automated validation, and baseline refresh.

**Deferred:** 2D ground overhaul, adaptive ring topology, SSAO/color grading, chunked meshes, worker simulation, full per-step light history, ecology/biomechanics, and the hidden-control API refactor.

### Later — “Ecology/biomechanics”

1. Root water competition, root:shoot ratio, and soil-moisture fields.
2. Slope/aspect water effects and terrain ecology.
3. Full biomechanical response from `mechanicalLoad`.
4. Forest understory ecology beyond render-only detail.

---

## 11. First concrete milestone: Fidelity Pass 1

A realistic first slice that improves the look and the workflow without destabilizing the architecture.  

### Deliverables

- [x] `shared/params.js` and `shared/presets.js`, loaded by both prototypes.
- [x] `PARAM_META` shared metadata (label, group, range, default, help); controls generated from the shared schema.
- [x] Parity test for parameter keys/defaults/presets.
- [x] Node fields: `axisId`, `axisOrder`, `parentAxisId`, `segmentIndex`, `pathLength`, `dir`, `up`, `tortuosity`, `budType`, `fate`, `birthLight`, `birthShade`, `mechanicalLoad`, `cut`.
- [x] Debug inspector panel for a clicked node (2D + 3D).
- [x] Axis grammar v1: order-specific branch angles, plagiotropism, tortuosity, reiteration.
- [x] Species grammar v2 for oak, pine, willow, cherry, poplar.
- [x] Root flare + 4–8 coarse roots in 2D and 3D.
- [x] Phenology curves for leaf-out/drop and cherry blossom.
- [x] Prune hover highlight, subtree ghost, undo/redo.
- [x] Analytics v2 with height, crown width, leaf area, and CSV export.
- [x] Visual-regression baseline for 2D and 3D at 7 fixed seed/preset/age/environment cases.

### Acceptance

- Oak/pine/willow/cherry/poplar silhouettes are distinguishable in a blind test.
- Same seed + parameters + cuts produce deterministic, comparable structure in 2D and 3D; if 2D is a projection, the skeleton is identical.
- Prune undo restores the exact prior node set.
- 3D stays above 60 fps at 300 years on the target machine.
- No console or WebGL errors.
- Export smoke tests pass.

---

## 12. Metrics of success

| Metric | Target |
|---|---|
| Species silhouette recognition | ≥ 80% in a blind 5-species test |
| Determinism | 100% identical output for same seed/params/cuts |
| 3D frame time at 300 years | ≤ 16.6 ms |
| 2D frame time at 300 years | ≤ 8 ms |
| `simulate()` at 300 years | ≤ 50 ms |
| Analytics recompute | ≤ 10 ms |
| GLB export at 300 years | ≤ 5 s |
| Console/WebGL errors | 0 |
| 2D/3D parameter parity | 100% |
| Export round-trip | Opens in Blender/Three.js/vector editor |

---

## 13. Risks, non-goals, and open questions

### Risks

- **Parameter explosion.** More controls can make the tool harder to use. Use presets, Advanced panels, and sensible defaults.
- **Botanical overfitting.** Chasing a specific real tree can make the generator less general. Aim for “convincing grammar,” not a species database.
- **Performance cliffs.** LOD, instancing, and shader variants must land before high-detail geometry.
- **2D/3D drift.** Shared schema and parity tests are non-negotiable.
- **Visual regression noise.** GPU rendering is nondeterministic across machines. Use fixed software rendering for baselines or tolerant pixel diffs.
- **Scope creep.** Each phase should ship a visible improvement, not a half-finished system.

### Non-goals

- A full botanical or physiological simulator.
- Real-time physics for every branch.
- Photorealism at the cost of the stylized 2D language.
- A full CAD/BIM tool.
- Persisting every random decision in the save file; the seed + parameters + cuts should be enough.

### Open questions

1. Is the primary audience artists, educators, landscape designers, or game/asset developers?
2. Should the target look be stylized illustration, botanical illustration, or photoreal previs?
3. What is the target hardware for the 60 fps budget?
4. Which export pipeline matters most: Blender, Three.js, Unity, Unreal, or vector/print?
5. Should 2D remain a separate stylized view, or become a “technical illustration” mode of the same scene?
6. How much persistence is needed: single-session, local save, or shareable URLs?
7. Is a forest/ecology mode a first-class feature or a demo?

---

## 14. References and inspiration

- Honda, H. (1971). Description of form and growth of trees.
- Prusinkiewicz, P. & Lindenmayer, A. *The Algorithmic Beauty of Plants*.
- Shlyakhter, I. et al. (2001). Reconstructing 3D tree models.
- Palubicki, W. et al. (2009). Self-organizing tree models for image synthesis.
- Shinozaki, K. et al. (1964). Pipe-model theory.
- Boudon, F. et al. Work on tree architecture and geometric modeling.
- Weber, J. & Penn, J. (1995). Creation and rendering of realistic trees.
- Botanical illustration traditions for silhouette, branch rhythm, and leaf arrangement.

---

## 15. Deferred backlog (revisit later)

These items are intentionally not blocking Phase 8. Revisit them after the product-depth pass, or earlier only if profiling or a specific visual target demands it.

### P1 — Render/fidelity follow-ups

| Item | Trigger / reason | Target |
|---|---|---|
| Full adaptive branch ring topology and cross-section geometry | Close-up branch inspection still uses shader/vertex approximation; adaptive rings would improve joints and reduce waste | Post-Phase 8 fidelity pass |
| Texture-based triplanar bark maps, plate/peeling, deeper wetness/snow | Current bark is procedural triplanar-style; texture maps would add close-range detail | Post-Phase 8 fidelity pass |
| Detailed hedge interior geometry and full topiary cut surfaces | Current topiary uses simple caps/trim rings; full clipped surfaces remain stylized | Post-Phase 8 environment pass |
| Full 2D terrain/soil-profile geometry | Current 2D ground uses soil strata and surface detail, not a full terrain profile | Post-Phase 8 environment pass |
| Per-step `currentLight` / leaf-light history | Current analytics uses a documented final-canopy approximation | When analytics comparison becomes a priority |
| SSAO and color grading | Optional bloom exists; SSAO/grading were deferred for performance risk | When atmosphere polish is requested |
| Full flower/fruit instancing and leaf-cluster phyllotaxis | Current fruit/flower cards and species leaf counts are first-pass | Post-Phase 8 fidelity pass |
| Split side-by-side 2D/3D studio | Implemented in `index.html` without iframes: module-scoped engines, shadow-root renderers, one universal control rail, active-pane actions, and an in-page state bus | Done |
| Analytics comparison mode and chart-to-tree linking | Metrics and CSV/JSON exist; comparison UI does not | Phase 8 follow-up |
| Prune espalier, multi-select/lasso, isolate/before-after | Lasso, isolate, ghost compare, espalier plane, and shortcuts implemented | Done |
| Batch export, SVG dimensions/DPI/annotations | Single-export options exist | Phase 8 follow-up |
| Full accessibility audit and responsive pass | Reduced motion and keyboard help exist | Phase 8 follow-up |

### P2 — Conditional performance work

| Item | Trigger / reason | Target |
|---|---|---|
| Chunked branch meshes | Profile first; needed only if 7-tree near-LOD scrubbing/frame time misses budget | Performance follow-up |
| True per-branch/per-tree distance LOD | Current LOD is near/mid/far plus frame-time fallback | Performance follow-up |
| Worker-based `simulate()` | Regeneration is still main-thread; use only if profiling shows it is the bottleneck | Performance follow-up |

### P3 — Later ecology/biomechanics

| Item | Trigger / reason | Target |
|---|---|---|
| Root water competition and root:shoot ratio | Requires a soil/water model and shared forest resources | Later ecology pass |
| Soil-moisture fields and slope/aspect water effects | Current moisture effect is a global multiplier | Later ecology pass |
| Full biomechanical modulation from `mechanicalLoad` | Current load is metadata and motion damping input, not a full taper/droop solver | Later biomechanics pass |
| Understory ecology beyond render-only shrubs | Current understory is render-only instancing | Later ecology pass |

### Revisit rule

Do not pull these into Phase 8 unless a specific product-depth workflow depends on them. Otherwise finish Phase 8, then choose the highest-value P1/P2 items based on visual review and profiling.

---

*This document is intentionally a plan, not a specification. The next step is to pick the first slice, prototype it behind a flag, and measure whether it improves the silhouette before committing to the full phase.*
