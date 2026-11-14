# Parametric Tree — Phase 1–4 Master Roadmap (Archived)

> **Archived:** This is the original four-phase roadmap that delivered species presets, environmental interaction, 3D rendering upgrades, and interactive tooling. The current refinement and fidelity roadmap is at [`../parametric-tree.md`](../parametric-tree.md).

This document outlines the four-phase roadmap for evolving the 2D (`prototype/`) and 3D (`3d-prototype/`) parametric tree prototypes. Every phase preserves the core architecture: **simulate once into a flat `nodes[]` skeleton (`parent < index`), and derive growth, thickness, and visuals at render time from `time`**.

---

## Roadmap Overview

```
Phase 1: Botanical & Structural Realism     (Species presets, leader decay, seasons, root flare, smooth splines)
   │
   ▼
Phase 2: Environmental Interaction          (Directional sun, prevailing wind, obstacles/topiary, multi-tree competition)
   │
   ▼
Phase 3: Visual & Rendering Upgrades (3D)   (Procedural bark, backlit leaves, real-time wind shader, falling litter)
   │
   ▼
Phase 4: Interactive Tooling & Export       (Click-to-prune & regrow, GLB/SVG export, biomass & light sparklines)
```

---

## Phase 1: Botanical & Structural Realism

**Goal**: Move beyond a single conifer/poplar growth habit so the model can generate oaks, willows, pines, cherries, and bonsai, complete with root flares and seasonal cycles.

### 1.1 Decaying Apical Dominance & Forking Leaders (`simulation.js`)
- **New Parameter**: `P.sympodial` (`0..1`, default `0.2`, "Crown spread / Forking").
- **Mechanism**:
  - Currently, the trunk (`order === 0`) has `life: Infinity` and never loses dominance, always producing an *excurrent* (single-leader) tree.
  - When `P.sympodial > 0` and `step > TRUNK_MIN_AGE`:
    - Each year, the leader's upward dominance decays slightly (`vigor *= 1 - P.sympodial * 0.03`).
    - With probability `P.sympodial * 0.15`, the leader **bifurcates** (splits into two co-dominant `order = 1` scaffold limbs tilted by `±P.angle * 0.55` with `vigor ≈ 0.9` and long `life`), ending the single vertical axis and forming a spreading *decurrent* broadleaf crown.

### 1.2 Species Presets (`simulation.js` + `main.js`)
- Add a `SPECIES_PRESETS` dictionary and a preset bar in the UI:
  - **Poplar / Cypress**: `angle: 24, branch: 0.75, apical: 0.55, photo: 0.35, droop: 0.05, sympodial: 0.0`
  - **Spreading Oak**: `angle: 58, branch: 0.70, apical: 0.18, photo: 0.12, droop: 0.18, sympodial: 0.65`
  - **Weeping Willow**: `angle: 48, branch: 0.80, apical: 0.25, photo: 0.04, droop: 0.52, sympodial: 0.45`
  - **Scots Pine**: `angle: 65, branch: 0.50, apical: 0.40, photo: 0.18, droop: 0.12, shed: 0.75, sympodial: 0.15`
  - **Cherry Blossom**: `angle: 50, branch: 0.65, apical: 0.22, photo: 0.14, droop: 0.20, sympodial: 0.55, leafPalette: 'blossom'`

### 1.3 Root Flare & Buttress Roots (`main.js`)
- In `updateBranchMesh()` (3D) and `drawBranches()` (2D):
  - For trunk segments near the ground (`y < 18` in 3D / `y > -18` in 2D), multiply the base ring radius by a smooth exponential flare:
    $$r(\theta, y) = r_{\text{pipe}} \cdot \left(1 + 0.55\,e^{-y / 8}\,(1 + 0.3\cos(5\theta + \text{seed}))\right)$$
  - Increase `RADIAL_SEGMENTS` on the lowest trunk segments (or globally from `7` to `10`) so the 5-lobed buttress flutes read cleanly where the trunk meets the soil.

### 1.4 Seasonal Cycle & Leaf Phenology (`main.js`)
- **New Render Parameter**: `season` slider (`0.0 = Spring`, `0.33 = Summer`, `0.66 = Autumn`, `1.0 = Winter`) or a **"Cycle seasons with years"** toggle.
- Purely a render-time transformation (never re-runs `simulate()`):
  - **Spring**: blossoms (pink/white hues) + small emerging leaves (`scale * 0.6`).
  - **Summer**: full green canopy.
  - **Autumn**: shift leaf hue from green (`100°`) toward gold (`45°`) and crimson (`8°`) weighted by `node.light` (sun-exposed outer leaves turn reddest first).
  - **Winter**: leaves scale down / drop to the ground plane based on a hashed threshold.

### 1.5 Spline-Smoothed Branches (`3d-prototype/main.js`)
- Instead of 1 linear frustum per segment, interpolate 2–3 subdivisions per internode using the parent segment's tangent and current segment's tangent (Hermite / Catmull-Rom) with a **parallel-transport frame** (`u, v` rotated minimally from parent to child) to eliminate sharp kinks and frame twist.

---

## Phase 2: Environmental Interaction

**Goal**: Let external forces (sun direction, wind, obstacles, neighboring trees) shape the crown dynamically.

### 2.1 Directional Sun (`LightField` in `simulation.js` + `sunLight` in `main.js`)
- **New Parameters**: `P.sunAngle` (`-60°..+60°` zenith tilt) and `P.sunAzimuth` (`0°..360°` in 3D).
- **In `LightField.lightAt(x, y, z)`**:
  - Instead of stepping straight up `(ci, cj + d, ck)`, step along the unit sun ray `(ci + round(d * sunDx), cj + d, ck + round(d * sunDz))`.
  - In `3d-prototype/main.js`, move the Three.js `DirectionalLight` and a visible sun gizmo to match `(sunDx, sunDy, sunDz)` so cast shadows align with the simulated shade field.

### 2.2 Prevailing Wind (Anemotropism) (`simulation.js`)
- **New Parameter**: `P.wind` (`-0.5..+0.5`, wind strength along `+X`).
- **In `growBud()`**:
  - Add `dx += P.wind * (isLateral ? 1.0 : 0.35)` before normalization.
  - Slightly reduce lateral survival on the windward side when `|P.wind| > 0.25` to create classic flag-shaped coastal/alpine (*krummholz*) trees.

### 2.3 Obstacles & Topiary Volumes (`simulation.js` + `main.js`)
- Add an optional **Environment Obstacle** mode (`None`, `Wall`, `Boulder`, `Topiary Sphere`, `Topiary Cone`):
  - **Wall / Boulder (Exclusion + Shade)**:
    - Pre-seed `LightField` with high shade inside the wall/boulder volume.
    - In `growBud()`, if the candidate segment `(x, y, z)` enters the obstacle SDF (signed distance < `margin`), project `(dx, dy, dz)` tangent to the surface normal so branches wrap *around* the wall or rock.
  - **Topiary Volume (Containment)**:
    - If a lateral shoot exits the bounding sphere/cone SDF, terminate `bud.dead = true` (simulating hedge shears) while letting interior buds branch densely.

### 2.4 Multi-Tree Forest / Crown Shyness (`simulation.js`)
- **New Mode**: `Tree count` (`1`, `3`, `5`).
- Spawn multiple root nodes at `y = 0` spaced across the ground disk (`(x_m, 0, z_m)`), all registering into and querying the **same shared `LightField`**.
- Inner branches facing a neighbor hit high voxel shade and self-prune (`shedShadedBranches`), naturally producing **crown shyness** gaps and asymmetric outward-leaning edge trees.

---

## Phase 3: Visual & Rendering Upgrades (`3d-prototype`)

**Goal**: Elevate the Three.js viewport from flat Lambert shading to a rich, tactile 3D scene while keeping 60 fps time-scrubbing.

### 3.1 Procedural Bark Material (`MeshStandardMaterial` + `onBeforeCompile`)
- Replace `MeshLambertMaterial` on `branchMesh` with `MeshStandardMaterial({ roughness: 0.88, metalness: 0.02, vertexColors: true })`.
- Pass a `(u, v)` attribute on the cylinder rings (`u = radial angle`, `v = cumulative distance from root`) and inject a lightweight procedural GLSL fragment snippet for vertical bark fissures and lichen/moss tinting on upward-facing surfaces (`normal.y > 0.4`).

### 3.2 Backlit Subsurface Leaf Shading
- Inject a wrap-lighting / translucency term into `leafMat`:
  - When `dot(viewDir, -lightDir) > 0`, add warm yellow-green transmitted light proportional to `node.light`, making the outer canopy glow against the sun while deep interior leaves stay cool and shadowed.

### 3.3 Real-Time Vertex-Shader Wind Sway
- Store `(order, height)` in a vertex attribute on `branchGeo` and `leafMesh`.
- In the vertex shader, apply a layered sine wave driven by a `uTime` uniform:
  - Trunk (`order 0`) sways slowly with tiny amplitude; higher orders (`1..4`) and leaves add higher-frequency flutter.
  - Runs 100% on the GPU, so it works even while paused or orbiting at any age.

### 3.4 Detached Falling Branches & Ground Litter
- For shed segments (`node.death < time < node.death + 1.5`), instead of scaling `progress` back toward the parent, optionally translate the detached subtree downward (`y -= 0.5 * g * dt²`) until `y = 0`, leaving a subtle ring of fallen twigs/leaves on the grass disk.

---

## Phase 4: Interactive Tooling, Analytics & Export

**Goal**: Turn the prototype into an interactive design and analysis tool.

### 4.1 Interactive Click-to-Prune (Bonsai / Arboriculture Mode)
- **How it works without breaking the time model**:
  - Maintain a `prunedSet` of `{ budId, step }` records.
  - When the user clicks a branch in the viewport (via `THREE.Raycaster` in 3D or segment hit-test in 2D) while in **Prune mode**:
    1. Record `{ budId, step }` of the clicked node in `prunedSet`.
    2. Re-run `simulate()` (~3 ms): when `growBud` reaches a pruned `(budId, step)`, mark that bud `dead = true` and remove its downstream shade from `LightField`; existing lateral buds below the cut then receive more light and fill the gap.
  - Because `hashRandom(budId, step, channel)` is independent per bud, **every unpruned branch on the tree stays identical**, while shoots below the cut burst into new growth to fill the newly sunlit gap.
  - **Implemented in both prototypes.** Cuts are stored as `${budId}:${birthStep}` keys; clicking a segment removes that segment and its whole distal subtree. Cuts survive time scrubbing and reset on seed / growth-slider / preset / lifespan changes.

### 4.2 3D `.glb` and 2D `.svg` Export
- **In `3d-prototype`**:
  - Import `GLTFExporter` from `three/addons/exporters/GLTFExporter.js`.
  - Add an **Export `.glb`** button that packages `branchMesh` (trimmed to the active draw range) + `leafMesh` at the current `time` and triggers a browser download ready for Blender / Three.js / game engines.
  - **Implemented:** the export contains only the current branches and leaves, excluding ground, lights, obstacles, debris and overlays.
- **In `prototype` (2D)**:
  - Add an **Export `.svg`** button that serializes the current frame's tapered branch polygons and leaf ellipses into a clean standalone SVG file.
  - **Implemented:** tree geometry only; overlays, ground and prune markers are omitted.

### 4.3 Live Growth Analytics Sparklines
- After `simulate()`, precompute a yearly metrics array:
  - **Wood Volume / Biomass**: $\sum \pi r_i^2 L_i$
  - **Active Shoot Tips** vs. **Shed Nodes** per year
  - **Mean Canopy Light Level**
- Draw a compact SVG/Canvas sparkline right below the `time` scrubber with a vertical playhead cursor linked to `time`, showing exactly when canopy closure and crown lift occur.
- **Implemented:** one point per structural growth step (81 points at the default 300-year lifespan), plotted as three compact strips with a blue playhead.

---

## Recommended Implementation Sequence

1. **Milestone 1 (Phase 1)**: Decaying apical dominance (`P.sympodial`), **Species Presets**, **Root Flare**, and **Season slider**.
2. **Milestone 2 (Phase 2)**: **Directional Sun**, **Prevailing Wind**, **Obstacles/Topiary**, and **Multi-Tree Competition**.
3. **Milestone 3 (Phase 3)**: **GPU Wind Sway**, **Procedural Bark & Backlit Leaves** in `3d-prototype`.
4. **Milestone 4 (Phase 4)**: **Click-to-Prune**, **GLB / SVG Export**, and **Timeline Sparklines**.
