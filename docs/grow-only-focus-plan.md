# Grow-Only Product Focus Plan

## Goal

Focus Parametric Tree on procedurally growing and viewing trees. Keep the Grow workflow, shared timeline, and 2D/3D renderers. Remove Sculpt, Study/stat-analysis, and Deliver/Record features from the main studio, standalone pages, and engines.

Retain save/load, copy/share links, and direct SVG, PNG, and GLB export. Remove recording, batch export, analytics CSV/JSON, and analytics comparison. Keep natural growth behavior, including branch shedding and environmental light responses; these are part of the tree model, not Sculpt or Study.

## Product Scope

### Keep

- Species presets, custom species, seed control, shape and environment parameters, and planting/forest controls.
- 2D, 3D, and split layouts, camera/view controls, and the shared timeline: age, play/pause, step, rewind, lifespan, speed, and season.
- Save/load, copy/share links, and direct SVG/PNG/GLB export. Place these in a compact Project menu or another persistent, easy-to-find utility area.
- Standalone 2D and 3D prototype pages as simplified grow/view/export tools.
- Simulation and rendering data that still controls procedural growth or the visible result, even if it overlaps with removed features.

### Remove

- Sculpt tools and behavior: prune/lasso interaction, cut history, cut markers and wounds, branch isolation, selection inspector, and before/after ghost comparison.
- Study/stat-analysis: analytics charts and metric aggregation, baseline comparison, chart seeking, analytics-only overlays and metric exports.
- Deliver workflows: Record mode, recording overlays/chrome, batch ZIP, analytics CSV/JSON, and advanced delivery-only controls.
- Mode switching and mode-specific palette actions, shortcuts, help, onboarding, and persisted UI preferences.

## Implementation Plan

### 1. Establish the Grow-only contract

- Confirm the retained controls and utility placement above before changing behavior.
- Record current default 2D/3D/studio visual outputs and run the existing focused tests as a baseline.
- Keep simulation grammar, deterministic generation, parameter meanings, and default appearance unchanged.

### 2. Simplify the main studio

- In `index.html`, remove the mode rail and make Grow the permanent control panel.
- Remove Study drawer, Sculpt toolbar/hints/inspector, Record chrome/overlays, and related mode-specific help and shortcut content.
- In `linked.js`, remove mode dispatch and state, Study chart rendering and comparison, Sculpt/selection interactions, Record and batch-export flows, analytics export actions, and obsolete palette commands.
- Keep Grow control mounting, 2D/3D layout and active-pane behavior, transport, Project persistence/sharing, and direct exports.
- In `studio/manifest.js`, retain Grow, dock, project, view, and direct-export controls only. Route direct export actions through the retained utility area.
- Remove styles and UI preferences that become unused; avoid unrelated layout redesign.

### 3. Remove Sculpt from standalone pages and engines

- Remove prune/lasso controls, hit testing, selection and history handling, cut overlays, wounds, and ghost comparisons from both standalone UIs and renderer controllers.
- Remove cut application and cut-only metadata/state from both simulations where no remaining growth/render path needs them.
- Preserve natural senescence, branch shedding, light competition, and other endogenous growth behavior. Do not equate naturally shed branches with user-authored cuts.
- Keep standalone pages functional for growing, viewing, and direct export.

### 4. Remove statistical analysis and delivery-only features

- Remove standalone and studio analytics canvases, chart renderers, metric aggregation, chart navigation, baseline state/comparison, and analytics-only export code.
- Remove analysis-only overlays and their controls; preserve visualization settings that still help inspect or configure the tree's growth/rendering when they fit the Grow focus.
- Remove Record and batch ZIP workflows and their settings, overlays, and command-palette actions.
- Retain direct SVG/PNG/GLB exports, plus save/load/share. Keep only export options needed to produce those direct outputs.

### 5. Migrate persisted state and update documentation

- In `shared/state.js`, move the tree-state schema from v3 to v4. Stop writing cut and comparison state, and add a migration that safely ignores those legacy fields in existing saved files and share links.
- Preserve tree parameters, seed, time, season, camera/view settings, and relevant direct-export settings during migration.
- Remove stale Sculpt/Study/Deliver references from palette data, shortcuts, help, onboarding, reset behavior, and persisted UI preferences.
- Update `project-state.md`, `ui-ux-redesign-plan.md`, relevant roadmap/release notes, and prototype READMEs to describe the focused product and retained utilities.

### 6. Rework tests around the new product contract

- `tests/app-ui.js`: assert Grow is the only workflow; assert the timeline, layouts, persistence, sharing, and direct exports remain usable; assert removed UI/actions are absent.
- `tests/phase5.js`: preserve determinism, parameter/preset parity, and natural growth checks; remove prune-specific behavior and cut metadata expectations.
- `tests/phase8.js`: cover v3-to-v4 migration, saved-state and share-link round trips, and retained export settings without cut/comparison state.
- `tests/visual-regression.js`: retain existing baselines if growth rendering is unchanged. Refresh a baseline only for an intentional, reviewed visual change.

## Files and Ownership

- Studio shell and controller: `index.html`, `linked.js`, `linked.css`, `studio.css`, `studio/manifest.js`.
- Standalone 2D app and engine: `prototype/2d-prototype.html`, `prototype/main.js`, `prototype/simulation.js`, `prototype/styles.css`.
- Standalone 3D app and engine: `3d-prototype/3d-prototype.html`, `3d-prototype/main.js`, `3d-prototype/simulation.js`, `3d-prototype/styles.css`.
- Shared persisted state: `shared/state.js`.
- Tests: `tests/app-ui.js`, `tests/phase5.js`, `tests/phase8.js`, `tests/visual-regression.js`.
- Product documentation: `docs/project-state.md`, `docs/ui-ux-redesign-plan.md`, `docs/roadmap.md`, `docs/release-checklist.md`, and prototype READMEs.

## Acceptance Criteria

- Grow is the only workflow presented in the studio; no Sculpt, Study/stat-analysis, Deliver, or Record controls, commands, shortcuts, or help references remain.
- Users can still select and customize a tree, adjust its environment, plant multiple trees, switch between 2D/3D/split views, and scrub/play its growth timeline.
- Save/load and copy/share links continue to work. Existing v3 files and links load without restoring cuts or analysis comparisons.
- Direct SVG, PNG, and GLB export remain discoverable and work from the focused app; recording, batch, and analytics exports are absent.
- Standalone pages expose only the retained grow/view/export experience.
- Natural growth and rendering remain deterministic, and default output is unchanged unless an intentional visual change is approved.
- Desktop and mobile layouts remain usable, accessible, and free of dead controls or references to removed features.

## Verification

1. Run `node tests/phase5.js` for both engines' deterministic growth, parameter/preset parity, and natural growth behavior.
2. Run `node tests/phase8.js` for state migration, round trips, share links, and retained export settings.
3. Run the browser UI suite in `tests/app-ui.js` for the Grow-only shell and retained timeline, layouts, persistence, sharing, and direct exports.
4. Run `tests/visual-regression.js` to confirm 2D, 3D, and studio growth outputs remain stable.
5. Manually check desktop and mobile layouts, keyboard/help content, playback/scrubbing, save/load/share, and SVG/PNG/GLB exports.
