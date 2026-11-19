# Parametric Tree — Stage + Dock UI/UX Implementation Plan

> **Companion:** [`project-state.md`](project-state.md) (snapshot 2026-11-14)  
> **Audience:** the project AI that will implement the redesign  
> **Status:** implemented 2026-11-14 — see `project-state.md` §0 for the closeout

> **Superseded:** This document specifies the former Grow / Sculpt / Study / Deliver product. The current Grow-only scope and implementation checklist are in [grow-only-focus-plan.md](grow-only-focus-plan.md); references below to removed workflows are historical.

## 1. How to use this plan

This plan turns the approved **Direction A (Stage + dock)** into an implementable spec. `project-state.md` remains the source of truth for current behavior; its §11 (redesign constraints) and §14 (acceptance criteria) apply in full. This plan is the source of truth for the new structure, behavior and build order.

### Rules of engagement

- Redesign UI and UX only. Do not change simulation, determinism or state-schema semantics.
- Build in the phases in §12. Every phase must leave the studio fully working with tests green.
- An item marked **engine touchpoint** is a small, backward-compatible change inside a prototype engine. Standalone 2D and 3D pages must keep working unchanged.
- When something is unspecified, choose the option that best protects: canvas as hero, explicit scope, instant time scrubbing, accessibility.

## 2. Decisions

### Locked (from design review)

| Decision | Detail |
|---|---|
| Direction | Stage + dock: left mode rail, one flyout panel, two-pane stage, persistent bottom transport dock |
| Modes | Grow, Sculpt, Study, Deliver (one rail, one flyout visible at a time) |
| Grow | Species cards, essentials, grouped shape controls, grouped environment, planting |
| Deliver | Two tabs: Record (default, focus of the mode) and Export (all existing export options, retained) |
| Borrowed ideas | Floating canvas toolbar and anchored inspector (from direction B) for Sculpt; large analytics drawer (from direction C) for Study; bottom-sheet mobile layout |
| Keep | Single page, no iframes, one universal control set, shared state, active-pane model, scene-driven pane theming |

### Defaults for the open questions in handoff §13

Change only if the owner objects.

1. Primary user: visual creators and educators who explore, then deliver (video, images, assets). Study and analytics are a strong secondary, not the front door.
2. 2D is a co-equal view.
3. Both panes visible by default, plus Focus layouts (2D only, 3D only).
4. Delivery is a primary workflow, with video capture first, then GLB, SVG and the rest.
5. Forest and ecology controls live in a collapsed Planting group.
6. Shell is deliberately neutral warm paper. Panes keep scene-driven themes. No UI theme override.
7. Onboarding is light: a three-step first-run tour, contextual hints and `?` help.
8. Debug and teaching overlays move out of Grow into Study, under Overlays.
9. The two compare systems are renamed and separated (§10).
10. Desktop-first, with a tablet layout and a phone bottom sheet.
11. Stay vanilla and static. No framework or build step unless the owner approves.

## 3. Problems solved

The five highest-leverage problems from handoff §10, and where this plan solves each:

| Problem | Solution |
|---|---|
| Flat 80-control rail | Four workflow modes, short flyouts, three disclosure levels (essential, advanced, expert) |
| Unclear scope | Scope chips on every control, an Acting on chip, layout switch separated from the active pane |
| Two things called Compare | Before / after (ghost) lives in Sculpt; Run A vs B (baseline) lives in Study |
| Scattered timeline | One persistent dock holds play, scrub, step, speed, lifespan, season and phenology |
| Buried analytics and export | Study drawer with a large chart; Deliver mode with Record and Export |

## 4. Layout and regions

```text
┌ Header 52px: brand · Project ▾ │ layout [Split | 2D | 3D] │ Search ⌘K · ? · Fullscreen ┐
├ Rail 72 ┬ Flyout 280 (collapsible) ┬ Stage (flex) ────────────────────────────────────────┤
│ Grow    │ active mode content      │ 2D pane │ 3D pane                                    │
│ Sculpt  │                          │ (+ Sculpt toolbar, Study drawer, Record frame)       │
│ Study   │                          │                                                      │
│ Deliver │                          │                                                      │
├ Dock 96px: Play ‹ › · scrubber · Age · Speed · Lifespan · Season · sync status ───────────┤
```

### 4.1 Header

- **Left:** wordmark (serif) and **Project ▾** menu: Save state, Load state, Copy link, Export JSON, seed readout, Preferences (quality, reduce motion), Open standalone 2D, Open standalone 3D, Keyboard shortcuts.
- **Center:** layout switch with Split, 2D, 3D. It changes only what is visible. Clicking a pane, or pressing `1` or `2`, still sets the active pane. In a Focus layout the visible pane is forced active.
- **Right:** Search (`⌘K` or `Ctrl+K`), Help `?`, Fullscreen (`F`, targets the active pane).
- Remove the always-visible “Both views live · synced” text and the standalone links from the header. Sync state moves to the dock (§4.4).
- Keep the skip link and the `#status` live region.

### 4.2 Rail

- Four items with icon and label: Grow, Sculpt, Study, Deliver. Roving tabindex, arrow-key navigation, `aria-current`.
- Shortcuts: `Alt/Option+1` to `Alt/Option+4` (match on `event.code`, not the typed character). Existing keys keep their meaning.
- Clicking the active mode collapses or expands the flyout. Remember the last mode and open state in UI prefs.

### 4.3 Flyout and stage

- Flyout is 280px wide (320px at 1440px or wider), scrolls internally, and has a sticky header: mode title and an **Acting on: 2D/3D** chip for modes with active-pane actions (Sculpt, Study, Deliver Export).
- Stage has 12px padding and 12px gaps. Each pane keeps its card, header and stats line, but loses its own analytics strip. Analytics move to the Study drawer.
- Pane header: title, a **link chip** when inactive, and an **Acting here** chip when active. Active chrome is a 2px accent border, not only a glow.
- Remove the dead vertical space under the panes seen in the current screenshots. The canvas flexes to fill.
- At 1100px or narrower, the flyout becomes an overlay drawer that reuses the existing modal behavior (`role=dialog`, focus trap, `inert`, Escape, backdrop, focus return). Mobile is §8.

### 4.4 Transport dock (always visible, 96px)

- **Left:** Play/Pause (primary), Step back, Step forward (1 year; Shift = 10), Restart.
- **Scrubber track:** the track carries information.
  - **Season band:** gradient derived from the same phenology function the engines use (`shared/grammar.js`).
  - **Stage labels** (Seedling, Sapling, Young, Mature): reuse the thresholds that drive the existing stats line.
  - **Cut markers:** small ticks at the birth year of each cut branch, with a tooltip. Optional; omit if the step-to-year mapping makes this unreliable.
  - **Keyboard:** it is a real slider with `aria-valuetext` like “Year 173.1”. Retain the first-40-years 1:1 step mapping.
- **Readouts:** Age (numeric, editable), Speed (popover, 0.5 to 8 years/sec, moved from Growth parameters), Lifespan (popover, with an inline note: “Changing lifespan clears cuts”), Season (popover with slider and Follow phenology).
- **Sync status chip:** Synced or Simulating…. Show a thin progress sliver on the dock’s top edge. **Engine touchpoint:** emit simulate start and end events; if progress is unavailable, use an indeterminate sliver. Announce completion politely through the live region.
- Dock stays visible in fullscreen as an auto-hiding minimal pill (play, scrubber, age). `H` toggles it. `Space` and `R` keep working.

## 5. Build approach

The universal panel is currently a clone of the 2D form with 3D sections injected (handoff §6.7, #20). A full component refactor is out of scope (hidden-control API refactor is deferred). Build the new UI around the existing controls:

1. **Control manifest.** Create `studio/manifest.js` describing every existing control by its stable selector: `{ id, label, mode, group, level, scope, helpKey, order }`. Values: `level` is `essential`, `advanced` or `expert`; `scope` is `both`, `2d`, `3d` or `active`. Derive ids from the cloned panel and `PARAM_DEFS` / `ENV_META`.
2. **Re-parent, do not duplicate.** At startup, after the panel clone is built, move each control’s DOM node into its new slot through `mountControl(id, slot)`. Moving nodes preserves listeners and state sync. Every control must appear exactly once. Add a test that fails on any orphan or duplicate.
3. **Small vanilla modules** (plain ES modules or custom elements, no build step): `studio-rail`, `studio-flyout`, `studio-dock`, `studio-palette`, `record-controller`, `study-drawer`, `tour`.
4. **UI preferences are separate from simulation state.** Store mode, flyout state, layout, Record settings and tour-seen in `localStorage` under a new key such as `ptree.ui.v1`. Do not add them to the shared schema v2 or to share links. If a persisted UI field is ever added to state, it needs a migration and a round-trip test.
5. **Engine touchpoints** (all optional-parameter, backward compatible):
   - Analytics renderer accepts size, axes, focused metric(s) and a seek callback, with current behavior as default (both engines).
   - Simulate start and end events.
   - A way to read a node’s on-screen position, for the anchored inspector (both engines).
   - Canvas resize notification when the stage frame changes, for Record framing (verify the engines already respond to resize; fix if not).
6. **CSS.** Add `studio.css` with the tokens in §9. Refactor `linked.css` onto them. Leave standalone page CSS alone except where an engine touchpoint requires it.
7. **Keep the shadow-root pane architecture.** Panes still own their canvases, hover legends and perf HUD.

## 6. Mode specs

Every control keeps its current behavior. Each appears once, with a scope chip (**Both**, **2D**, **3D**, **Active view**) and a `?` help popover fed by the existing `PARAM_DEFS.help` and `ENV_META.help` strings. Disclosure levels: **essential** (visible), **advanced** (collapsed group), **expert** (collapsed, below advanced).

### 6.1 Grow: “What tree am I making?”

Flyout sections, top to bottom:

1. **Species.** Six cards in a 3x2 grid (Poplar, Oak, Willow, Pine, Cherry, Custom), each with a small silhouette icon (hand-authored inline SVG per grammar). The active card has an accent border. When any parameter diverges from the preset, show **Custom · based on Oak · Revert**. Revert re-applies the active preset’s values (and, as today, clears cuts).
2. **Essentials.** Three sliders with friendly names that are direct promotions of real controls, not hidden macros:
   - **Spread** = Branch angle
   - **Bushiness** = Branching
   - **Leafiness** = Leaf density

   The help popover shows the technical name. Macro sliders that drive several parameters are a possible later enhancement and are out of scope.
3. **Seed row.** Shows **Seed 1234** and a **New seed** button (destructive-tier style). Tooltip and toast copy: “Starts a new tree and clears cuts.” It targets the active pane exactly as today.
4. **Shape** (collapsed groups, advanced):
   - **Form:** Apical dominance, Crown forking, Plagiotropism, Droop
   - **Response to light:** Phototropism, Shade sensitivity, Branch shedding
   - **Character:** Tortuosity, Reiteration, Root flare
5. **Environment** (basic: 2D sun angle, Wind, Obstacle and size; the rest advanced):
   - **Sun and sky:** 2D sun angle [2D], 3D sun azimuth and elevation [3D], Solar model with Latitude, Day and Hour, Sky preset, Sun samples, Exposure
   - **Wind:** Wind, Wind direction, Gust, 3D sway [3D], Scale sway with wind [3D]
   - **Ground and terrain:** Slope, Aspect, Soil moisture, Ground detail and density [3D], Snowfall [3D]
   - **Obstacle:** Obstacle, Obstacle size
   - **Look:** Fog, Bloom [3D], Espalier plane [3D]
   - **Performance:** Quality, Reduce motion
6. **Planting** (collapsed): Trees (1, 3, 5, 7), Species mix, Spacing, Age mix, Crown shyness. When Trees is above 1, show a note that regeneration may take longer.

**Moved out of Grow:** Lifespan, Season, Follow phenology and Play speed go to the dock (§4.4).

**Optional enhancement (Phase 2b, after the grouped sliders ship):** a sun-path arc widget and a wind compass that drive the same inputs (latitude, day, hour, wind direction). They are additive and must stay in sync with the sliders.

### 6.2 Sculpt: “How do I shape it?”

Flyout (header shows **Acting on: 2D/3D**):

- **Tools:** Inspect, Prune, Lasso as a toggle group (`P`, `L`). Only one is active; `Esc` exits to Inspect.
- **Cut type:** radio list with one-line descriptions: Thinning (clean removal), Heading (cut back to a bud, local regrowth), Pollard (repeated heading, dense regrowth). Shared across both panes.
- **History:** Undo, Redo, and a cut count. **Clear cuts** is destructive-tier, undoable, and clears both panes as today.
- **Selection:** Isolate selected. Disabled until a node is selected, with the reason shown (“Select a branch first”). `I` toggles.
- **Before / after** (renamed from Snapshot and Compare): **Capture before** and a **Show ghost** toggle. Short explainer: “Overlays the structure you captured so you can see what your cuts changed.”

Canvas additions while Sculpt is open:

- A floating toolbar at the top center of the active pane: Acting-on chip, Inspect, Prune, Lasso, cut type, Undo, Redo, cut count.
- A hint strip at the bottom-left of the active pane, for example “Prune mode · click a branch · Esc to exit”. Show it whenever Prune or Lasso is on, in any mode.
- **Anchored inspector:** clicking a node in any mode opens a card next to it with a leader line, showing axis, order, fate, light and load, plus **Isolate** and **Prune this**, and a **More** disclosure for the full field list. **Engine touchpoint:** node screen position. Fallback if unavailable: show the card in the flyout’s Selection area. The full inspector table also lives in Study.
- Pruning behavior, cut identity (`budId:birthStep`), hover ghosts, wound markers and history are unchanged.

### 6.3 Study: “What is happening over time?”

- **Study drawer** above the dock, default 280px, resizable 160 to 480px, collapsible. It replaces the per-pane analytics strips.
  - **Header:** metric chips (Biomass, Height, Crown, Leaf area, Light, Tips/shed); multi-select, with the first selected metric drawn large.
  - **Large chart** with axes, units and tick labels; playhead; phenology band; cut markers; legend “solid current · dashed Run A”.
  - Other selected metrics appear as stacked sparklines under the large chart.
  - **Source toggle:** 2D, 3D, or overlay both (default: the active pane).
  - Retain click-to-seek and arrow-key stepping (1 year; Shift = 10). **Engine touchpoint:** analytics renderer options.
  - **Accessibility:** expose the chart as `role=slider` with `aria-valuemin/max/now` and `aria-valuetext`, plus a “View data table” disclosure.
  - Footnote on leaf light: “Final-canopy approximation.”
- **Flyout:**
  - **Run A vs B** (renamed from Analytics comparison): step 1 **Pin run A** (shows a label such as “Oak · seed 1234 · year 173”); step 2 change anything; **Compare** toggle; delta chips for biomass, height, crown width and leaf area with sign and units; **Clear**. Behavior and data are unchanged.
  - **Selection card:** the full node inspector.
  - **Overlays** (renamed from Algorithm visualizations): Bark color mode, Skeleton and nodes, Light grid, Tropism vectors, Shed branches (ghosts), X-ray, and the 3D branch wireframe and performance HUD. Show a legend chip on the canvas whenever an overlay is on (as today).

### 6.4 Deliver: “How do I take it with me?”

The flyout header has a segmented control **Record | Export**. Record is the default and the focus of this mode: the main deliverable is a clean, repeatable growth rendering that the user captures with an OS screen recorder to make a video. Export keeps every existing option.

#### 6.4.1 Record tab: a take for screen recording

The app does not encode video. It plays a precisely controlled, deterministic take in a clean frame, so a screen recorder captures good footage. Because time is a render parameter, the same settings always give identical growth.

**Presets** (cards; each fills the settings below and stays editable):

| Preset | Setup |
|---|---|
| Growth time-lapse | Range 0 to lifespan, 20 s, linear, hold end 3 s |
| Slow reveal | Same range, 60 s, ease-out (fast early growth, slow late) |
| Turntable | Age fixed at the current year, 3D camera orbits 360° over 15 s |
| Four seasons | Age fixed, season sweeps over 16 s |

**Settings:**

| Setting | Options | Default |
|---|---|---|
| Source | 2D, 3D, Split (side by side) | Split |
| Frame | 16:9, 9:16, 1:1, 4:3, Fit window | 16:9 |
| Range | Start age, end age | 0 to lifespan |
| Pace | Duration (s) linked to speed (years/s); editing one updates the other | 20 s |
| Easing | Linear, Ease out, Ease in-out | Linear |
| Hold | Start hold and end hold, 0 to 10 s | 1 s and 3 s |
| Loop | Once, Loop, Ping-pong | Once |
| Camera (3D) | Fixed (auto-zoom), Turntable with degrees/s | Fixed |
| Season | Follow phenology, Lock at a value, Sweep | Follow phenology |
| Overlays | Year counter, Title, Caption (position and size presets) | Year counter on |
| Guides | Safe-frame and crop marks while armed or previewing | On |
| Countdown | Off, 3 s, 5 s | 3 s |
| Hide cursor | On or off | On |

**Preflight checklist** (live rows with status and a fix link):

- Frame fits the window; show the frame size in CSS pixels.
- Quality tier; link to Preferences; suggest Medium or High for 3D.
- Reduce motion; warn that sway and turntable are suppressed when on.
- **Performance check:** runs a 3-second stress playback, reports average fps and dropped frames, and recommends a lower quality tier if below about 50 fps.
- A collapsed **Capturing the take** tip: use the OS screen recorder or OBS, record the window or the frame area, prefer 60 fps. The take can be repeated for identical frames.

**Actions:** Preview (plays the take in the normal studio view, chrome visible) and Start take (primary).

**Take flow** (state machine in `record-controller`):

```text
idle → preview or armed → countdown → running → hold-end → complete
```

1. **Armed:** on a user gesture, enter the Record stage. Hide header, rail, flyout and dock. Request browser fullscreen where available. Show the frame letterboxed on a flat neutral background with crop marks, and a card: “Start your screen recorder, then press Start.”
2. **Countdown:** large 3-2-1 (announce through the live region once, not per tick), then the controls and guides disappear.
3. **Running:** the controller drives time. Per frame, `t = start + (end - start) * ease(p)` where `p` is elapsed over duration. Apply hold-start, hold-end and loop modes. Update season and camera as configured. Cursor hidden if enabled.
4. **Complete:** show a small card, “Take complete — stop your recorder,” with Replay and Back to studio. The card must be dismissible so the user can trim it out in editing.
5. `Esc` aborts at any time. `Space` pauses or resumes (a paused take shows a subtle indicator the user can trim out). While a take runs, disable Play, Speed, scrubbing and canvas interaction so nothing disturbs it.

**Technical requirements:**

- The controller only calls the shared transport’s set-time API (and season and camera setters). It must not use the normal Play path or Play speed, so the two never conflict.
- Before the take, snapshot `{ time, season, seasonAuto, playing, camera, layout, mode }`. Restore on exit, unless the user checks **Keep end state**.
- Frame is a CSS aspect-ratio box fitted to the window. **Engine touchpoint:** panes resize and re-render correctly when the frame changes (2D canvas and the 3D renderer size and pixel ratio).
- Overlays are real DOM layered over the frame, so they are captured. Style: serif, high contrast with a soft shadow, never covering the tree’s base by default.
- Record settings persist in UI prefs, never in share links or schema v2.
- Keep the controller pure enough to unit-test: time mapping, easing, holds, loop and ping-pong need tests with a fake clock. A future in-app frame-by-frame or MediaRecorder export could reuse it, but is out of scope.

#### 6.4.2 Export tab

A three-step layout (as in the wireframe): **1 Choose a target**, **2 Options**, **3 Preview and action**.

| Target | Options shown (existing controls, re-parented) | View used |
|---|---|---|
| 2D drawing (SVG) | Roots, Branches, Leaves, Background, Line art, Width, Height, DPI, Annotations, Scale bar | 2D |
| Image (PNG) | PNG scale 1x, 2x, 4x | Active |
| 3D model (GLB) | Roots, Leaves, Metadata, Axis (Y-up, Z-up), Units (metres, centimetres), Detail (Full, Light, Silhouette) | 3D |
| Data (CSV, JSON) | Analytics CSV and Analytics JSON buttons (with baseline columns when a baseline exists) | Active |
| Batch package (ZIP) | Contents checklist (frames or GLB, analytics, state, manifest); current structure and manifest unchanged | Active |
| Share link | Copy link (canonical state) | Both |

- Choosing SVG or GLB switches the active pane to 2D or 3D and says so in the Acting-on chip. Other targets use the current active pane.
- The preview shows a thumbnail of what will be exported and the final filename. Show estimated size only if it is cheap to compute; otherwise omit it.
- The primary button names the action (“Export GLB”). Filenames and file contents stay as they are today.
- Save state and Load state live in the Project menu, not here.

## 7. Discoverability and feedback

- **Command palette** (`⌘K` / `Ctrl+K`, and the header Search button). Fuzzy search over every manifest control and action. Each result shows its group path and scope chip (for example “Plagiotropism · Grow › Shape › Form · Both”). Enter opens the right mode and flyout section, scrolls to the control, focuses it and briefly highlights it. Actions (Export GLB, Start take, Undo) run directly. Full keyboard support, `role=dialog` with a combobox pattern, `Esc` closes.
- **Inline help.** Every parameter gets a `?` button that opens a popover with the existing help text. Plain-language one-liners for botanical terms (plagiotropism, reiteration, apical dominance). Optional tiny diagrams are a later nicety.
- **Shortcut overlay** on `?` (when not typing in a field) and from the Project menu. Lists all current shortcuts plus the new ones: `Alt/Option+1..4` modes, `⌘K` palette.
- **First-run tour** (three short steps, skippable, never repeats once seen):
  1. “Two linked views: one tree, shown two ways.”
  2. “Click a view to act on it; Prune, Export and Save follow the view marked Acting here.”
  3. “Drag the timeline to grow the tree. Click a branch to inspect it.”

  Re-open from Help. Keyboard accessible, no focus traps beyond the tour card.
- **Contextual hints.** Canvas hint strip for Prune, Lasso and Isolate; empty inspector says “Click a branch to inspect it (switch to Inspect if Prune or Lasso is on).”
- **No silent no-ops.** Disabled controls explain why (Isolate, Undo, Redo, Compare with no Run A). Success and failure of Save, Load, Copy link and exports use toasts that also go through the live region.
- **Regeneration feedback.** Dock sync chip, progress sliver, and a 40% dim with a small “Simulating…” label on the affected pane when regeneration takes longer than about 300 ms. Never block scrubbing.
- **Destructive actions** (New seed, Clear cuts, Revert, Lifespan change that clears cuts) are visually distinct and either undoable (Clear cuts, already) or show a toast with Undo where feasible. Do not add blocking confirm dialogs for undoable actions.

## 8. Mobile and tablet

| Width | Behavior |
|---|---|
| Above 1100px | Docked rail, flyout and dock as in §4 |
| 801 to 1100px | Flyout becomes an overlay drawer (existing modal behavior); panes stay side by side; dock stays |
| 800px or narrower | One pane at a time with a 2D / 3D toggle and swipe; bottom sheet replaces the drawer |

**Phone requirements:**

- Fixed-viewport app shell; no nested scroll regions except inside the sheet’s content area.
- Canvas at the top, then sticky transport (play, scrubber, age), then the sheet. The canvas and transport are always visible, including while editing controls.
- Bottom sheet has three snap points: peek (mode tabs only), half (default; roughly 40% of the viewport), full. Drag handle with button alternatives for keyboard and screen readers. Modes appear as four tabs; sections inside use the same collapsed groups as desktop.
- Dock readouts (speed, lifespan, season) collapse into a single “Timeline settings” sheet.
- Preserve the current accessibility behavior at full snap: `role=dialog`, `aria-modal`, `inert` on background, focus trap, Escape, focus return. At peek and half, the background stays interactive, so use a non-modal region with proper labeling instead.
- Touch targets at least 44px. Canvas gestures: one-finger orbit (3D) is unchanged; add a clear Inspect/Prune toggle in the Sculpt tab because there is no hover.
- Record is allowed on mobile but labeled “Best on a larger screen”; Frame defaults to 9:16 on portrait phones.

## 9. Visual system

Keep the warm paper and forest green identity. Wireframe greys are placeholders; use the existing tokens (handoff §8).

| Token | Value | Notes |
|---|---|---|
| Shell background | `#e9e6dd` (existing) | Neutral studio frame; does not follow scene theme |
| Card / flyout | `#fffdf8` | — |
| Line | `#cfcabc` | — |
| Foreground / muted | `#20241e` / `#687064` | Muted text must pass AA on cards |
| Accent / accent soft | `#3f7d3a` / `#e4efdf` | Primary, active tool, active pane |
| Destructive | text and border `#8f2f22` | Verify AA on card; filled style only on confirmation |
| Scope chips | Both: neutral outline. 2D: warm tint. 3D: cool tint | Pick tints that pass AA; never rely on color alone, always include the text label |
| Spacing | 4px grid | 8, 12, 16 most common |
| Radii | 8 buttons, 10 to 14 cards, 999 pills | — |
| Shadow | One low, soft elevation for popovers and floating toolbars | — |
| Motion | 120 to 160ms; none under reduced motion | Flyout slide, popover fade |

- **Typography:** system UI stack for controls (13 to 14px), 12px labels, 11px uppercase section labels. Serif stack (Georgia, no webfont) for the wordmark, mode titles and Record overlays. `font-variant-numeric: tabular-nums` for age, year and value readouts. Do not add webfont downloads.
- **Icons:** a small inline-SVG stroke set on a 20px grid with `currentColor`: Grow, Sculpt, Study, Deliver, Play, Pause, Step, Rewind, Record, Search, Help, Scope glyphs. Icons always paired with text labels or `aria-label`.
- **Buttons, four tiers:** primary (filled accent: Play, Start take, Export), secondary (outline), quiet (text), destructive (outline in danger color). Tool toggles use the accent fill when active.
- **Pane chrome:** active pane gets a 2px accent border plus the Acting here chip; inactive shows Linked. Scene-driven pane theming is unchanged. Optional subtle edge tint sampled from the scene sky is allowed to soften the light-shell-versus-dark-scene contrast; it must not alter canvas pixels.

## 10. Naming and microcopy

| Today | New | Notes |
|---|---|---|
| Reset (timeline) | Rewind | Stops at year 0. `R` still means restart and play |
| Snapshot | Capture before | Sculpt, Before / after |
| Compare (ghost overlay) | Show ghost | Sculpt |
| Pin baseline | Pin run A | Study |
| Compare (analytics) | Compare to run A | Study |
| Analytics comparison | Run A vs B | Study |
| Algorithm visualizations | Overlays | Study |
| Advanced environment | Grouped Environment sections | Grow |
| Export options / 3D view & export | Export tab | Deliver |
| Keyboard help | Keyboard shortcuts overlay | Header `?` and Project menu |
| Active pane | Acting here / Acting on: 2D | Chip text |
| 2D / 3D switch | Layout: Split, 2D, 3D | No longer implies the action target |
| Custom | Custom · based on {preset} | With Revert |

## 11. Control placement map

Every control from handoff §6.7 and §6.8 must land in exactly one place:

| Current section | New home |
|---|---|
| 1 Species and season: presets | Grow › Species |
| 1 Lifespan, Season, Follow phenology | Dock popovers |
| 2 Environment: 2D sun angle, Wind, Obstacle, size | Grow › Environment (basic) |
| 2 Trees | Grow › Planting |
| 3 Advanced environment | Grow › Environment groups; forest items to Planting; Quality and Reduce motion to Environment › Performance |
| 4 3D-only environment | Grow › Environment groups, tagged [3D] |
| 5 Growth parameters | Grow › Essentials and Shape; Play speed to dock |
| 6 Actions: New seed | Grow › Seed row |
| 6 Reset | Dock Rewind |
| 6 Prune, Lasso, Cut, Undo, Redo, Clear cuts, Isolate | Sculpt |
| 6 Snapshot, Compare (ghost) | Sculpt › Before / after |
| 6 Save state, Load state, Copy link, Export JSON (state) | Project menu |
| 6 Export 2D SVG, Export PNG, Export CSV, Export JSON (analytics) | Deliver › Export |
| 6 Auto-zoom, seed readout | Pane header View menu (Auto-zoom, and Turntable for 3D); seed in Seed row |
| 7 Export options, batch ZIP | Deliver › Export |
| 8 3D view & export: GLB options and export | Deliver › Export |
| 8 3D turntable | Pane header View menu and Record camera |
| 8 Branch wireframe, Performance HUD | Study › Overlays |
| 9 Analytics comparison | Study › Run A vs B |
| 10 Keyboard help | Shortcuts overlay |
| 11 Algorithm visualizations | Study › Overlays |
| 12 Node inspector | Anchored inspector and Study › Selection |

The manifest test in §13 enforces this table.

## 12. Phased implementation

Each phase ends with all existing tests passing, the studio fully usable, and updated visual baselines reviewed by a human.

### Phase 0: Prep

- Run the full test suite and capture current screenshots as the “before” set.
- Write the control manifest covering 100% of controls in the cloned panel, using §11.
- Define the UI-prefs module, a small internal event bus (mode changed, layout changed, take state changed), and the §9 tokens in `studio.css`.
- **Done when:** manifest coverage test passes against the current panel.

### Phase 1: Shell and dock

- Build header, rail, flyout container, stage layout, layout switch with Focus layouts, and the dock (transport, scrubber with season band and stage labels, readouts, sync chip). Move Lifespan, Season, Follow phenology and Play speed into the dock.
- Temporarily mount the remaining existing panel sections into modes by manifest, unchanged, so nothing is lost. Keep per-pane analytics strips visible for now.
- Separate layout from active pane; add the Acting on chip and pane header chips.
- **Done when:** every action still works, shortcuts unchanged, mobile drawer behavior intact.

### Phase 2: Grow

- Species cards and icons, Custom and Revert, Essentials, Seed row, Shape groups, grouped Environment with scope chips, Planting. Wire help popovers where help text exists.
- Optional Phase 2b: sun-path and wind compass widgets.
- **Done when:** a new user can pick a species, scrub and tweak essentials without touching a collapsed group.

### Phase 3: Deliver (priority)

- **3a:** Export tab with six targets, option re-homing, preview and action, active-pane switching, Project menu for save, load and share.
- **3b:** `record-controller`, Record settings, presets, Preview, Record stage (frame, guides, overlays, hide cursor, fullscreen), take state machine, restore logic.
- **3c:** Preflight checklist and performance check. **Engine touchpoint:** resize.
- **Done when:** a Growth time-lapse take runs from Armed to Complete, repeats with identical frames, and Esc restores the prior state exactly.

### Phase 4: Sculpt

- Flyout, floating toolbar, hint strip, anchored inspector (with fallback), renamed Before / after, disabled-state explanations. **Engine touchpoint:** node screen position.
- **Done when:** prune, lasso, undo, isolate, ghost and inspect all work from the new UI with existing shortcuts.

### Phase 5: Study

- Study drawer with large chart, metric chips, sparklines, source toggle, seek and keyboard. Run A vs B flow. Overlays group. Remove per-pane analytics strips only after the drawer is verified. **Engine touchpoint:** analytics renderer options.
- **Done when:** pinned baseline workflow, deltas, CSV and JSON all still work and are reachable.

### Phase 6: Discoverability

- Command palette, shortcut overlay, first-run tour, remaining help popovers, toast and live-region coverage.

### Phase 7: Mobile and tablet

- Bottom sheet, one-pane-at-a-time layout, timeline settings sheet, touch tuning.

### Phase 8: Polish and close-out

- Accessibility audit, contrast verification, visual regression baseline updates, performance check, update `project-state.md`, `docs/release-checklist.md` and the “How it works” explainer for the studio.

## 13. Testing and acceptance

### Automated (extend `tests/app-ui.js` and add suites)

- **Manifest:** every cloned control is mounted exactly once; none orphaned or duplicated; every control has a scope chip and group.
- **Layout vs active pane:** the layout switch changes visibility and suspends the hidden engine; clicking a pane and keys `1`, `2` set the active pane; Focus layouts force it.
- **Dock:** play, step, rewind, speed, lifespan (clears cuts, shows note), season and phenology, scrub keyboard behavior, sync chip transitions.
- **Record controller (unit, fake clock):** time mapping, all easings, holds, loop, ping-pong, season sweep, turntable, pause and resume, abort and restore of prior state, determinism (same settings give the same sampled times).
- **Record stage (UI):** armed to countdown to running to complete; chrome hidden during run; Esc aborts; cursor hidden; frame aspect ratios; overlays present.
- **Export:** each target shows its options, switches the active pane when needed, produces the same filenames and contents as before; batch ZIP structure and manifest unchanged (`tests/phase9.js` stays green).
- **State:** save, reload, load round trip; share links restore both dimensions; schema v1 migration; UI prefs never leak into share links.
- **Sculpt and Study regression:** cut identity, undo and redo, isolate, ghost; baseline pin, deltas, CSV and JSON.
- **Keyboard:** all existing shortcuts plus new ones; focus order; palette and tour keyboard paths; drawer and sheet focus trap and return.
- **Accessibility:** AA contrast checks on new tokens and chips, labels on all icon-only buttons, chart slider semantics, reduced motion disables the flyout slide and countdown animation.
- **Standalone 2D and 3D pages:** unchanged behavior and visual baselines.
- **Visual regression:** update studio baselines intentionally; 2D and 3D canvas baselines should not change.

### Manual

- 1440x900, 1280x720 and 1024x768 desktops; a tablet; a phone in portrait and landscape.
- Record a real screen capture of a Growth time-lapse and check smoothness, framing and that no UI leaks into the frame.

### Performance

- No new main-thread work during scrub (cache the season band and stage labels; redraw only on changes).
- Keep the 7-tree, 300-year budget. Long regeneration shows feedback.
- The Record take must hold a steady frame rate on the reference machine at High quality; report the measured fps.

## 14. Risks and open items

| Risk | Mitigation |
|---|---|
| Moving cloned nodes could drop listeners if the panel is re-cloned on sync | Re-parent after the final clone; add the manifest test; never clone twice |
| Engines may not resize cleanly when the Record frame changes | Treat resize as a Phase 3c blocker; fix in the engines with a backward-compatible API |
| Analytics canvases live in shadow roots | Use the renderer-options touchpoint; keep standalone defaults |
| Browser fullscreen needs a user gesture and differs across browsers | Enter from the Start take click; degrade to a windowed Record stage |
| Alt+digit produces characters on macOS | Match `event.code`; document in the overlay |
| Cut markers on the scrubber may be misleading because cuts are keyed by birth step | Ship as optional; fall back to omitting them |
| Per-view analytics differ slightly (for example 34.6 m versus 34.1 m height) | Default the Study chart to the active pane and label its source |

> **Open items with defaults** (flag to the owner, do not block on them): Record Source default (Split), the essentials trio (Branch angle, Branching, Leaf density), whether the Study chart overlays both views by default (no), and whether to show estimated export size (only if cheap).

## 15. Out of scope

- In-app video or GIF encoding, frame-sequence export and MediaRecorder capture (the deterministic take controller is designed so these could be added later).
- Any simulation, rendering-fidelity, ecology or performance backlog item in handoff §11 “Deferred”.
- Macro sliders that drive several parameters, a UI theme override, a framework or build step, and independent (unlinked) 2D and 3D state.
