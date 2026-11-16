/**
 * Parametric tree growth: simulation
 * ==================================
 *
 * Grows the tree skeleton once per parameter change. Everything the renderer
 * needs is left in the globals below (`nodes`, `fullBounds`); see main.js for
 * drawing and UI.
 *
 * SIMULATE
 * --------
 * The tree is grown year by year into a flat array of nodes (a skeleton).
 * Every node stores its parent, birth year and (if shed) death year.
 *
 * COORDINATES
 * -----------
 * World units: the seed is at (0, 0), +x is right, and UP IS NEGATIVE y
 * (same as the canvas). One growth step of the trunk is about BASE units.
 *
 * PORTING TO 3D
 * -------------
 * The skeleton (nodes + parent + birth + order) is renderer-independent.
 * To go 3D, make directions 3D vectors, rotate laterals around the parent
 * axis by the golden angle, and swap the render section for cylinder meshes.
 */

'use strict';

/* ==========================================================================
   ! 1. CONFIGURATION
   ========================================================================== */

/** Growth model constants (not exposed in the UI). */
export const BASE = 10;            // trunk internode length per year (world units)
export const MAX_NODES = 24000;    // hard cap on skeleton size (stops growth beyond it)
export const MAX_ORDER = 4;        // deepest branch order (0 = trunk)
export const MIN_VIGOR = 0.2;      // lateral buds weaker than this are not created
export const TRUNK_MIN_AGE = 5;    // trunk must be this many years old before it branches
export const LATERAL_MIN_AGE = 1;  // lateral shoots may branch after this many years

/** Growth-rate decay: independent of lifespan so early years stay consistent. */
export const GROWTH_DECAY = 60;    // years for annual length to fall to ~e^-1
export const GROWTH_FLOOR = 0.1;   // oldest annual segment length (fraction of the trunk)
export const OLD_AGE_START = 60;   // branching begins to taper after this year
export const OLD_AGE_SPAN = 140;   // years over which branching tapers to 20%
export const OLD_AGE_MIN = 0.2;    // minimum branching multiplier in old age

/**
 * Structural growth horizon. The simulation no longer runs one step per
 * display year: the first 40 years map 1:1, then the remaining structural
 * growth is compressed into the rest of the timeline. This keeps 300-year
 * trees from becoming bare vertical poles and bounds the node count.
 */
export const GROWTH_HORIZON = 80;  // maximum structural growth steps
export const JUVENILE_YEARS = 40;  // display years that map 1:1 to growth years
export const LEADER_STOP_STEP = 60; // leaders stop extending in this growth year

/** Number of structural growth steps for the current lifespan. */
export function growthSteps() {
    return Math.min(P.lifespan, GROWTH_HORIZON);
}

/** Map a display year onto structural growth time. */
export function growthTime(displayYear) {
    const steps = growthSteps();
    if (displayYear <= JUVENILE_YEARS || steps <= JUVENILE_YEARS || P.lifespan <= GROWTH_HORIZON) {
        return Math.min(displayYear, steps);
    }
    const spanTail = P.lifespan - JUVENILE_YEARS;
    const growthTail = steps - JUVENILE_YEARS;
    const t = Math.min(1, (displayYear - JUVENILE_YEARS) / spanTail);
    return JUVENILE_YEARS + t * growthTail;
}

/** 0 at <=40-year lifespan, 1 once the full growth horizon is available. */
export function horizonBlend() {
    return Math.max(0, Math.min(1, (growthSteps() - JUVENILE_YEARS) / (GROWTH_HORIZON - JUVENILE_YEARS)));
}

/** Light model constants. */
export const LIGHT_CELL = 8;           // grid cell size used to count shading nodes
export const LIGHT_ROWS_ABOVE = 6;     // how many cell rows above a point cast shade on it
export const SHADE_KILL_LIGHT = 0.2;   // buds below this light level may die
export const SHED_MIN_STEP = 6;        // shedding starts after this year
export const SHED_MIN_BRANCH_AGE = 5;  // branches must be this old before they can be shed
export const OBSTACLE_MARGIN = 4;      // clearance kept around blocking obstacles

export const NEVER = 1e9;      // "death year" of a node that is never shed

/**
 * Tunable parameters. Shared defaults live in ../shared/params.js; the 2D
 * dimension overrides preserve the existing side-alternating silhouette.
 */
const prefersReducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const P = Object.assign({}, BASE_PARAMS, DIMENSION_PARAMS_2D, {
    angleOrderBias: BASE_PARAMS.angleOrderBias.slice(),
    phenology: Object.assign({}, BASE_PARAMS.phenology),
    reducedMotion: prefersReducedMotion,
});

let _automationState = (typeof createAutomation === 'function') ? createAutomation() : { version: 1, enabled: true, tracks: {} };
export function setSimulationAutomation(next) {
    _automationState = (typeof normalizeAutomation === 'function') ? normalizeAutomation(next) : next;
}
export function getSimulationAutomation() { return _automationState; }

/* ==========================================================================
   ! 2. STATE
   ========================================================================== */

/**
 * @typedef {Object} Node  One point of the skeleton. Its segment runs from
 *                         its parent to itself.
 * @property {number} x, y        World position (up is negative y).
 * @property {number} parent      Index of the parent node (-1 for the root).
 * @property {number} birth       Year the segment starts growing (it finishes a year later).
 * @property {number} order       Branch order: 0 = trunk, 1 = limb, 2 = twig...
 * @property {number} death       Year the node is shed (NEVER if it survives).
 * @property {boolean} isBranchRoot  True for the first node of a lateral branch.
 * @property {number} mainTip     For branch roots: index of the branch's latest main-axis node.
 * @property {boolean} isLeader   True along the trunk and its co-dominant scaffold limbs.
 * @property {number} budId      Stable id of the bud that created this node.
 * @property {number} birthStep  Growth step that created this node (-1 for roots).
 * @property {number} axisId     Stable axis identity (root = 1, laterals increment).
 * @property {number} axisOrder  Branch order of the axis (0 = trunk).
 * @property {number} parentAxisId Axis that supports this node (-1 for roots).
 * @property {number} segmentIndex Position along the axis.
 * @property {number} pathLength Distance from the root along the skeleton.
 * @property {number} dirX, dirY Unit direction of the segment.
 * @property {number} budType    0 leader, 1 scaffold, 2 lateral, 3 cut regrowth, 4 reiteration.
 * @property {number} fate       0 live, 1 shed, 2 pruned, 3 broken.
 * @property {number} birthLight Light level when the node was created.
 * @property {number} birthShade 1 - birthLight.
 * @property {number} cutType    0 none, 1 thinning, 2 heading, 3 pollard.
 * @property {number} cutStep    Growth step of the cut (-1 if none).
 *
 * @typedef {Object} Bud  A growing shoot tip (simulation only).
 * @property {number} id        Stable id used to seed this bud's random choices.
 * @property {number} tipNode   Index of the node the bud currently sits on.
 * @property {number} rootNode  Index of the first node this bud created (laterals only).
 * @property {number} dirX, dirY Current unit growth direction.
 * @property {number} order     Branch order (0 = trunk).
 * @property {number} axisId    Axis identity inherited by nodes this bud creates.
 * @property {number} parentAxisId Supporting axis.
 * @property {number} segmentIndex Position along the axis.
 * @property {number} pathLength Distance from the root at the bud tip.
 * @property {number} budType   Semantic bud type (leader/scaffold/lateral/...).
 * @property {number} vigor     1 = trunk-strong; smaller values grow shorter shoots.
 * @property {number} age       Years this bud has been growing.
 * @property {number} start     First year the bud is active.
 * @property {number} life      Years after which a lateral shoot stops growing.
 * @property {number} side      Last side (+1/-1) a lateral was spawned on (alternation).
 * @property {boolean} leader   True for the trunk and its co-dominant replacement limbs.
 * @property {number} leaderDepth How many leader bifurcations produced this bud (capped).
 * @property {boolean} dead     True once the bud stops growing.
 */

export let seed = 1234;
/** @type {Node[]} The skeleton. Parents always have a lower index than children. */
export let nodes = [];
/** Coarse root geometry, generated deterministically after the shoot skeleton. */
export let rootSystem = [];
/** Forest root positions for the current simulation. */
export let treeRoots = [];
/** Per-tree species traits for species mixes. */
export let treeTraits = [];
/** Per-tree species name for rendering/debugging. */
export let treeSpecies = [];
/** Cuts that remove a bud's growth at a particular step: `${budId}:${step}`. */
export const prunedCuts = new Map();
/** Deterministic axis id counter, reset at the start of each simulation. */
export let nextAxisId = 1;
/** Old-growth reiteration cap, reset at the start of each simulation. */
export let reiterationCount = 0;
/** Bounding box of the finished, surviving tree (used when auto-zoom is off). */
export let fullBounds = { minX: -50, maxX: 50, minY: -100 };

/* ==========================================================================
   ! 3. RANDOMNESS
   ========================================================================== */

/**
 * Deterministic random number in [0, 1) from three integers plus the global
 * seed. Hashing (instead of drawing from one shared stream) means each
 * decision depends only on (bud, year, channel), so changing one parameter
 * does not reshuffle every later random choice.
 */
export function hashRandom(a, b, c) {
    let x = Math.imul(a ^ seed, 0x85ebca6b)
        ^ Math.imul((b + 0x27d4eb2f) | 0, 0xc2b2ae35)
        ^ Math.imul((c + 0x165667b1) | 0, 0x9e3779b1);
    x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d);
    x ^= x >>> 12; x = Math.imul(x, 0x297a2d39);
    x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
}

/** Cut type names used by the UI and metadata. */
export const CUT_TYPES = { thinning: 1, heading: 2, pollard: 3 };

/** Add a prune cut at a node's stable bud/step identity. */
export function addPrune(budId, birthStep, type = 'thinning') {
    if (birthStep < 0) return;
    prunedCuts.set(budId + ':' + birthStep, {
        type: CUT_TYPES[type] ? type : 'thinning',
    });
}

export function clearPrunes() {
    prunedCuts.clear();
}

/* ==========================================================================
   ! 3B. ENVIRONMENT HELPERS
   ========================================================================== */

/** Unit vector from a point toward the sun (up is negative y). */
export function sunDir(params = P) {
    return environmentSunDirection(params, '2d');
}

/** Active obstacle description, or null when disabled. */
export function obstacleSpec() {
    const s = P.obstacleSize;
    switch (P.obstacle) {
        case 1: return { type: 'wall', blocking: true, x: 55, half: 6 };
        case 2: return { type: 'sphere', blocking: true, x: 55, y: -25, r: s * 0.8 };
        case 3: return { type: 'sphere', blocking: false, x: 0, y: -s * 1.2, r: s * 1.6 };
        case 4: return { type: 'cone', blocking: false, x: 0, y: 0, r: s * 1.8, h: s * 2.2 };
        case 5: return { type: 'wall', hedge: true, blocking: true, x: 55, half: 8 };
        case 6: return { type: 'box', blocking: true, x: 55, half: 14, height: s * 2.2 };
        default: return null;
    }
}

/** Signed distance to the active obstacle (negative inside). */
export function obstacleSdf(x, y) {
    const o = obstacleSpec();
    if (!o) return Infinity;
    if (o.type === 'wall') return Math.abs(x - o.x) - o.half;
    if (o.type === 'box') {
        const cx = x - o.x;
        const cy = y + o.height / 2;
        return Math.max(Math.abs(cx) - o.half, Math.abs(cy) - o.height / 2);
    }
    if (o.type === 'sphere') return Math.hypot(x - o.x, y - o.y) - o.r;
    const height = -y;
    const radial = Math.abs(x - o.x);
    if (height < 0) return Math.max(radial - o.r, height);
    if (height > o.h) return Math.max(radial, height - o.h);
    return radial - o.r * (1 - height / o.h);
}

/** Outward unit normal of the active obstacle (finite-difference gradient). */
export function obstacleNormal(x, y) {
    const e = 0.5;
    const gx = obstacleSdf(x + e, y) - obstacleSdf(x - e, y);
    const gy = obstacleSdf(x, y + e) - obstacleSdf(x, y - e);
    const m = Math.hypot(gx, gy) || 1;
    return { x: gx / m, y: gy / m };
}

/** Root positions for the current forest mode. */
export function rootPositions() {
    const count = [1, 3, 5, 7].includes(P.trees) ? P.trees : 1;
    const spacing = P.spacing || 200;
    const base = {
        1: [0],
        3: [-spacing, 0, spacing],
        5: [-2 * spacing, -spacing, 0, spacing, 2 * spacing],
        7: [-3 * spacing, -2 * spacing, -spacing, 0, spacing, 2 * spacing, 3 * spacing],
    }[count];
    return base.map((x, i) => ({
        x: x + (hashRandom(seed, i, 80) - 0.5) * spacing * 0.12,
        y: 0,
    }));
}

/* ==========================================================================
   ! 4. SIMULATION
   ========================================================================== */

/**
 * Cheap light model. Live nodes are counted in a coarse grid; the light at a
 * point falls off exponentially with the (weighted) number of nodes in the
 * cells above it: the same column counts fully, neighbouring columns half,
 * and distant rows count less.
 */
export class LightField {
    constructor(params = P) { this.counts = new Map(); this.params = params || P; }

    _key(i, j) { return (i + 3000) * 10000 + (j + 3000); }
    _cellKey(node) {
        return this._key(Math.floor(node.x / LIGHT_CELL), Math.floor(node.y / LIGHT_CELL));
    }

    add(node) {
        const k = this._cellKey(node);
        this.counts.set(k, (this.counts.get(k) || 0) + 1);
    }

    /** Add static shade (for obstacles) without a skeleton node. */
    addShade(x, y, count) {
        const k = this._key(Math.floor(x / LIGHT_CELL), Math.floor(y / LIGHT_CELL));
        this.counts.set(k, (this.counts.get(k) || 0) + count);
    }

    remove(node) {
        const k = this._cellKey(node);
        this.counts.set(k, this.counts.get(k) - 1);
    }

    /** @returns {number} light level in (0, 1]; 1 = full sun. */
    lightAt(x, y, params = this.params) {
        const p = params || this.params || P;
        const ci = Math.floor(x / LIGHT_CELL), cj = Math.floor(y / LIGHT_CELL);
        const dir = sunDir(p);
        // Perpendicular to the sun ray, used for the disk samples.
        const px = -dir.y, py = dir.x;
        const samples = sunSampleOffsets(p.sunSamples || 3);
        let shade = 0;
        for (const sample of samples) {
            const sx = dir.x + px * sample * 0.16;
            const sy = dir.y + py * sample * 0.16;
            for (let d = 1; d <= LIGHT_ROWS_ABOVE; d++) {
                const rowFalloff = 1 - d / 8;
                const baseI = ci + Math.round(sx * d);
                const baseJ = cj + Math.round(sy * d);
                for (let off = -1; off <= 1; off++) {
                    const i = baseI + Math.round(px * off);
                    const j = baseJ + Math.round(py * off);
                    const count = this.counts.get(this._key(i, j));
                    if (count) shade += count * (off === 0 ? 1 : 0.5) * rowFalloff;
                }
            }
        }
        shade /= samples.length;
        const sky = p.skyLight ?? 0.14;
        const direct = Math.exp(-(p.shade ?? P.shade) * 0.1 * shade);
        const intensity = Math.max(0.3, environmentSunIntensity(p, dir));
        const gain = environmentSlopeGain(p, dir.azimuth || 0);
        return Math.max(0.02, Math.min(1,
            (sky + (1 - sky) * direct * intensity) * gain
        ));
    }
}

/** Pre-seed the light field with shade inside the active obstacle volume. */
export function seedObstacleShade(field) {
    const o = obstacleSpec();
    if (!o || !o.blocking) return; // topiary volumes prune, they do not cast shade
    let minX, maxX, minY, maxY;
    if (o.type === 'wall') {
        minX = o.x - o.half - LIGHT_CELL; maxX = o.x + o.half + LIGHT_CELL;
        minY = -420; maxY = 10;
    } else if (o.type === 'box') {
        minX = o.x - o.half - LIGHT_CELL; maxX = o.x + o.half + LIGHT_CELL;
        minY = -o.height - LIGHT_CELL; maxY = LIGHT_CELL;
    } else if (o.type === 'cone') {
        minX = o.x - o.r - LIGHT_CELL; maxX = o.x + o.r + LIGHT_CELL;
        minY = -o.h - LIGHT_CELL; maxY = LIGHT_CELL;
    } else {
        minX = o.x - o.r - LIGHT_CELL; maxX = o.x + o.r + LIGHT_CELL;
        minY = o.y - o.r - LIGHT_CELL; maxY = o.y + o.r + LIGHT_CELL;
    }
    for (let x = Math.floor(minX / LIGHT_CELL) * LIGHT_CELL; x <= maxX; x += LIGHT_CELL) {
        for (let y = Math.floor(minY / LIGHT_CELL) * LIGHT_CELL; y <= maxY; y += LIGHT_CELL) {
            const sdf = obstacleSdf(x, y);
            if (sdf < 0) field.addShade(x, y, 3);
            else if (sdf < LIGHT_CELL) field.addShade(x, y, 1);
        }
    }
}

/** Grow the whole tree from a seed and store the skeleton in `nodes`. */
export function simulate() {
    const lightField = new LightField(P);
    const roots = rootPositions();
    nextAxisId = 1;
    reiterationCount = 0;
    rootSystem = [];
    treeRoots = roots;
    treeSpecies = roots.map((_, i) => environmentSpeciesFor(seed, i, P.speciesMix));
    treeTraits = roots.map((_, i) => {
        const name = treeSpecies[i];
        return name ? traitsForPreset(name, P) : P;
    });
    const steps = growthSteps();
    nodes = roots.map((r, i) => ({
        x: r.x, y: r.y, parent: -1, birth: 0, order: 0, death: NEVER,
        isBranchRoot: false, mainTip: i, isLeader: true,
        budId: 1 + i * 100003, birthStep: -1,
        axisId: i + 1, axisOrder: 0, parentAxisId: -1, segmentIndex: 0, pathLength: 0,
        dirX: 0, dirY: -1, dirZ: 0, upX: 1, upY: 0, upZ: 0, tortuosity: 0,
        budType: 0, fate: 0, birthLight: 1, birthShade: 0, mechanicalLoad: 0,
        cutType: 0, cutStep: -1, cut: null,
        tree: i, species: treeSpecies[i] || P.speciesMix,
        light: 1, currentLight: 1, vigor: 1, shootAge: 0, preDirX: 0, preDirY: -1,
    }));
    for (const root of nodes) lightField.add(root);
    seedObstacleShade(lightField);

    /** @type {Bud[]} */
    let buds = roots.map((r, i) => {
        let dx = Math.sign(r.x) * (P.edgeLean || 0);
        let dy = -1;
        const m = Math.hypot(dx, dy) || 1;
        dx /= m; dy /= m;
        return {
            id: 1 + i * 100003, tipNode: i, rootNode: i, dirX: dx, dirY: dy, order: 0, vigor: 1,
            axisId: i + 1, parentAxisId: -1, segmentIndex: 0, pathLength: 0, budType: 0,
            tree: i, species: treeSpecies[i] || P.speciesMix, traits: treeTraits[i],
            age: 0,
            start: Math.floor(hashRandom(seed, i, 90) * (P.ageMix || 0) * steps * 0.35),
            life: Infinity, side: 1, leader: true, leaderDepth: 0, dead: false,
        };
    });

    for (let step = 0; step < steps; step++) {
        // Buds created this year are appended and must not grow until next year,
        // so only iterate over the buds that existed when the year began.
        const year = displayYearForStep(step, P.lifespan);
        const epoch = growthOverlay(_automationState, year);
        const ep = epoch ? mergeParams(P, epoch) : P;
        lightField.params = ep;
        const activeCount = buds.length;
        for (let i = 0; i < activeCount; i++) growBud(buds[i], step, lightField, buds, epoch);

        const shed = shedShadedBranches(step, lightField, ep);
        buds = buds.filter((b) => !b.dead && !shed[b.tipNode]);
    }
    lightField.params = P;

    computeMechanicalLoad();
    computeCurrentLight();
    rootSystem = buildRootSystem();
    fullBounds = survivingBounds();
}

/**
 * Advance one bud by one year: extend its shoot by one segment, then maybe
 * spawn lateral buds.
 * @param {Bud} bud
 * @param {number} step       Current year (0-based).
 * @param {LightField} lightField
 * @param {Bud[]} buds        Bud list; new lateral buds are appended to it.
 */
export function growBud(bud, step, lightField, buds, epoch = null) {
    if (bud.dead || step < bud.start) return;
    const cut = prunedCuts.get(bud.id + ':' + step);
    if (cut) {
        const cutNode = nodes[bud.tipNode];
        cutNode.cutType = CUT_TYPES[cut.type] || 1;
        cutNode.cutStep = step;
        cutNode.cut = { type: cut.type, step, radius: 1.5 };
        cutNode.fate = 2;
        if (cut.type !== 'thinning') spawnCutRegrowth(bud, step, cut, buds);
        bud.dead = true;
        return;
    }
    if (bud.leader && step >= LEADER_STOP_STEP) { bud.dead = true; return; }
    if (nodes.length >= MAX_NODES) { bud.dead = true; return; } // hard skeleton cap

    const tip = nodes[bud.tipNode];
    const baseTraits = bud.traits || P;
    const t = epoch ? mergeParams(baseTraits, epoch) : baseTraits;
    const ep = epoch ? mergeParams(P, epoch) : P;
    const rand = (channel) => hashRandom(bud.id, step, channel);
    const isLateral = bud.order > 0;
    const light = isLateral ? lightField.lightAt(tip.x, tip.y, ep) : 1; // trunk is never shaded
    const wind = environmentWind(ep, tip.x, tip.y, 0, step, treeRoots);

    // Deep shade: lateral buds may die before growing.
    if (isLateral && light < SHADE_KILL_LIGHT && rand(9) < 0.5) { bud.dead = true; return; }

    // Segment length: shorter for higher orders, weaker vigor, shade and age.
    const ageFactor = Math.max(GROWTH_FLOOR, Math.exp(-step / GROWTH_DECAY));
    const orderFactor = isLateral
        ? 0.85 * Math.pow(0.9, bud.order) * (0.5 + 0.5 * bud.vigor) * (0.4 + 0.6 * light)
        : 1;
    const windStress = Math.min(1, wind.speed * (t.windTaper ?? P.windTaper ?? 0));
    const length = BASE * orderFactor * ageFactor
        * environmentWaterGain(ep) * (1 - windStress * 0.2);

    // Direction = previous direction + random jitter + wind + phototropism + droop.
    const jitter = (isLateral ? 0.5 : 0.25) * (0.6 + (t.tortuosity || 0) * 0.9);
    let dx = bud.dirX + (rand(1) - 0.5) * jitter;
    let dy = bud.dirY + (rand(2) - 0.5) * jitter;
    dx += wind.x * (isLateral ? 1 : 0.35);                                           // prevailing wind (+x)
    if (P.trees > 1 && P.crownShyness > 0) {
        for (let ti = 0; ti < treeRoots.length; ti++) {
            if (ti === bud.tree) continue;
            const d = tip.x - treeRoots[ti].x;
            if (Math.abs(d) < (P.spacing || 200) * 1.2) {
                dx += Math.sign(d || 1) * P.crownShyness * 0.02;
            }
        }
    }
    const preMag = Math.hypot(dx, dy) || 1;
    const preDirX = dx / preMag, preDirY = dy / preMag;
    dy -= t.photo * (isLateral ? 1 : 1.5);                                          // up
    dy += t.droop * Math.min(bud.age, 8) * 0.06 * (isLateral ? 1 : 0.3);            // down
    const mag = Math.hypot(dx, dy) || 1;
    dx /= mag; dy /= mag;

    let x = tip.x + dx * length, y = tip.y + dy * length;
    if (isLateral && y > -1) { bud.dead = true; return; } // shoots stop at the ground

    // Obstacles: blocking shapes deflect growth, containment shapes prune it.
    const spec = obstacleSpec();
    if (spec) {
        const sdf = obstacleSdf(x, y);
        if (spec.blocking) {
            if (sdf < OBSTACLE_MARGIN) {
                const n = obstacleNormal(x, y);
                const dot = dx * n.x + dy * n.y;
                dx -= n.x * dot; dy -= n.y * dot;
                const dm = Math.hypot(dx, dy);
                if (dm < 0.05) { bud.dead = true; return; }
                dx /= dm; dy /= dm;
                x = tip.x + dx * length; y = tip.y + dy * length;
                const after = obstacleSdf(x, y);
                if (after < OBSTACLE_MARGIN) {
                    const push = OBSTACLE_MARGIN - after + 0.5;
                    x += n.x * push; y += n.y * push;
                }
            }
        } else if (sdf > -OBSTACLE_MARGIN) {
            // Containment: reflect outgoing growth back inside the topiary
            // volume so the clipped shape fills with dense interior shoots.
            const n = obstacleNormal(x, y);
            const dot = dx * n.x + dy * n.y;
            if (dot > 0) { dx -= 2 * n.x * dot; dy -= 2 * n.y * dot; }
            const dm = Math.hypot(dx, dy);
            if (dm < 0.05) { bud.dead = true; return; }
            dx /= dm; dy /= dm;
            x = tip.x + dx * length; y = tip.y + dy * length;
            const after = obstacleSdf(x, y);
            if (after > -OBSTACLE_MARGIN) {
                const push = after + OBSTACLE_MARGIN + 0.5;
                x -= n.x * push; y -= n.y * push;
            }
        }
    }

    // Add the new node to the skeleton.
    const pathLength = bud.pathLength + length;
    const nodeTortuosity = (t.tortuosity || 0) * (0.6 + rand(70) * 0.8);
    nodes.push({
        x, y, parent: bud.tipNode, birth: step + 1, order: bud.order, death: NEVER,
        isBranchRoot: isLateral && bud.age === 0, mainTip: 0, isLeader: bud.leader,
        budId: bud.id, birthStep: step,
        axisId: bud.axisId, axisOrder: bud.order, parentAxisId: bud.parentAxisId,
        segmentIndex: bud.segmentIndex, pathLength,
        dirX: dx, dirY: dy, dirZ: 0, upX: -dy, upY: dx, upZ: 0, tortuosity: nodeTortuosity,
        budType: bud.budType, fate: 0,
        tree: bud.tree, species: bud.species,
        birthLight: light, birthShade: 1 - light, mechanicalLoad: 0, windStress,
        cutType: 0, cutStep: -1, cut: null,
        light, currentLight: 0, vigor: bud.vigor, shootAge: bud.age, preDirX, preDirY,
    });
    const index = nodes.length - 1;
    lightField.add(nodes[index]);
    if (isLateral) {
        if (bud.age === 0) bud.rootNode = index;
        nodes[bud.rootNode].mainTip = index; // lets the shedding pass test the branch's tip light
    }

    bud.tipNode = index;
    bud.dirX = dx; bud.dirY = dy;
    bud.segmentIndex++;
    bud.pathLength = pathLength;
    bud.age++;
    if (isLateral && bud.age >= bud.life) bud.dead = true;

    // Sympodial growth: the leader slowly loses dominance and may split into
    // two co-dominant scaffold limbs (broadleaf/decurrent habit).
    if (bud.leader && step >= TRUNK_MIN_AGE) {
        bud.vigor *= 1 - t.sympodial * 0.03;
        if (bud.leaderDepth < 2 && rand(20) < t.sympodial * 0.15) {
            bifurcateLeader(bud, step, index, dx, dy, buds, epoch);
            bud.dead = true;
            return;
        }
    }

    spawnLaterals(bud, step, index, dx, dy, light, buds, epoch);
}

/**
 * Replace a leader bud with two co-dominant scaffold limbs, ending the single
 * vertical axis and starting a spreading crown.
 */
export function bifurcateLeader(bud, step, index, dx, dy, buds, epoch = null) {
    const t = epoch ? mergeParams(bud.traits || P, epoch) : (bud.traits || P);
    const rand = (channel) => hashRandom(bud.id, step, channel);
    const halfAngle = (angleForOrder(bud.order + 1, t) * 0.55 + (rand(21) - 0.5) * 12) * Math.PI / 180;
    const cos = Math.cos(halfAngle), sin = Math.sin(halfAngle);
    const dirs = [
        { x: dx * cos - dy * sin, y: dx * sin + dy * cos },
        { x: dx * cos + dy * sin, y: -dx * sin + dy * cos },
    ];

    for (let k = 0; k < 2; k++) {
        const dir = dirs[k];
        const mag = Math.hypot(dir.x, dir.y) || 1;
        buds.push({
            id: (bud.id * 31 + step * 7 + 41 + k) | 0,
            tipNode: index, rootNode: 0,
            dirX: dir.x / mag, dirY: dir.y / mag,
            order: bud.order,
            axisId: nextAxisId++,
            parentAxisId: nodes[index].axisId,
            segmentIndex: 0,
            pathLength: nodes[index].pathLength,
            budType: 1,
            tree: bud.tree, species: bud.species, traits: bud.traits || P,
            vigor: 0.9,
            age: 0,
            start: step + 1,
            life: Infinity,
            side: k ? -1 : 1,
            leader: true,
            leaderDepth: bud.leaderDepth + 1,
            dead: false,
        });
    }
}

/** Possibly create lateral buds at the node `index` the bud just produced. */
export function spawnLaterals(bud, step, index, dx, dy, light, buds, epoch = null) {
    const t = epoch ? mergeParams(bud.traits || P, epoch) : (bud.traits || P);
    const minAge = bud.order ? LATERAL_MIN_AGE : TRUNK_MIN_AGE;
    if (bud.age < minAge || nodes.length >= MAX_NODES) return;

    // Trunk branches on both sides at once; laterals alternate sides.
    const sides = bud.order ? [(bud.side = -bud.side)] : [1, -1];
    const rand = (channel) => hashRandom(bud.id, step, channel);
    // Mature trees allocate less to new branching, which also keeps long
    // simulations (hundreds of years) from filling the node cap.
    const oldAge = step > OLD_AGE_START
        ? Math.max(OLD_AGE_MIN, 1 - (step - OLD_AGE_START) / OLD_AGE_SPAN)
        : 1;
    const blend = horizonBlend();
    const scaffoldChance = 1 - 0.85 * blend;  // order-1 parents spawn fewer children
    const twigChance = 1 - 0.65 * blend;      // order-2 parents spawn fewer children
    const scaffoldLife = 1 + 7 * blend;       // order-1 limbs live much longer
    const twigLife = 1 + 2 * blend;           // order-2 branches live longer too
    const forestScale = P.trees > 1 ? 1 / Math.pow(P.trees, 0.6) : 1; // keep forests under the node cap

    sides.forEach((side, si) => {
        // Branching chance is reduced in shade, in old age, and in forests.
        let chance = t.branch * (0.4 + 0.6 * light) * oldAge * forestScale;
        if (bud.order === 1) chance *= scaffoldChance;
        if (bud.order === 2) chance *= twigChance;
        if (rand(3 + si) > chance) return;

        const vigor = bud.vigor * (1 - t.apical * 0.6) * (0.8 + 0.4 * rand(7 + si));
        if (bud.order >= MAX_ORDER || vigor < MIN_VIGOR) return;

        // Rotate the parent direction by the order-specific branch angle.
        const angle = (angleForOrder(bud.order + 1, t) + (rand(5 + si) - 0.5) * 20) * Math.PI / 180 * side;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        let bx = dx * cos - dy * sin;
        let by = dx * sin + dy * cos;
        // Plagiotropism flattens lateral axes toward horizontal.
        by *= 1 - (t.plagiotropism || 0) * 0.35;
        const bm = Math.hypot(bx, by) || 1;
        bx /= bm; by /= bm;

        const baseLife = 2 + Math.floor(vigor * 8 * (0.6 + rand(12 + si) * 0.8));
        const lifeScale = bud.order === 0 ? scaffoldLife : bud.order === 1 ? twigLife : 1;
        buds.push({
            id: (bud.id * 31 + step * 7 + (side > 0 ? 1 : 2)) | 0,
            tipNode: index, rootNode: 0,
            dirX: bx, dirY: by,
            order: bud.order + 1,
            axisId: nextAxisId++,
            parentAxisId: nodes[index].axisId,
            segmentIndex: 0,
            pathLength: nodes[index].pathLength,
            budType: bud.order === 0 ? 1 : 2,
            tree: bud.tree, species: bud.species, traits: bud.traits || P,
            vigor,
            age: 0,
            start: step + 1 + Math.floor(rand(10 + si) * 2),                       // 0 to 1 year delay
            life: baseLife * lifeScale,
            side,
            leader: false,
            leaderDepth: bud.leaderDepth,
            dead: false,
        });
    });

    // Old-growth reiteration: trunks and scaffolds throw epicormic shoots.
    if (bud.order <= 1 && step > OLD_AGE_START && reiterationCount < 48) {
        const chance = (t.reiteration || 0) * oldAge * (bud.order === 0 ? 0.09 : 0.045);
        if (rand(30) < chance) {
            spawnReiteration(bud, step, index, dx, dy, buds);
            reiterationCount++;
        }
    }
}

/** Spawn an old-growth epicormic/reiteration shoot from a trunk or scaffold. */
export function spawnReiteration(bud, step, index, dx, dy, buds) {
    const t = bud.traits || P;
    const rand = (channel) => hashRandom(bud.id, step, channel);
    const side = rand(31) < 0.5 ? -1 : 1;
    let bx = dx * 0.3 + side * (0.65 + rand(32) * 0.35);
    let by = dy * 0.3 - (0.55 + rand(33) * 0.35); // up is negative in 2D
    const bm = Math.hypot(bx, by) || 1;
    bx /= bm; by /= bm;

    const order = Math.min(MAX_ORDER, bud.order + 1);
    buds.push({
        id: (bud.id * 31 + step * 7 + 77 + Math.floor(rand(34) * 1000)) | 0,
        tipNode: index, rootNode: 0,
        dirX: bx, dirY: by,
        order,
        axisId: nextAxisId++,
        parentAxisId: nodes[index].axisId,
        segmentIndex: 0,
        pathLength: nodes[index].pathLength,
        budType: 4,
        tree: bud.tree, species: bud.species, traits: bud.traits || P,
        vigor: 0.72 + rand(35) * 0.28,
        age: 0,
        start: step + 1 + Math.floor(rand(36) * 3),
        life: 8 + Math.floor(rand(37) * 12),
        side,
        leader: false,
        leaderDepth: bud.leaderDepth,
        dead: false,
    });
}

/** Spawn wound-regrowth buds after a heading or pollard cut. */
export function spawnCutRegrowth(bud, step, cut, buds) {
    const rand = (channel) => hashRandom(bud.id, step, channel);
    const count = cut.type === 'pollard' ? 3 : 1 + (rand(40) > 0.5 ? 1 : 0);
    const order = Math.min(MAX_ORDER, bud.order + 1);
    for (let k = 0; k < count; k++) {
        const side = k % 2 === 0 ? 1 : -1;
        let bx = bud.dirX * 0.35 + side * (0.55 + rand(41 + k) * 0.45);
        let by = bud.dirY * 0.35 - (0.55 + rand(45 + k) * 0.35);
        const bm = Math.hypot(bx, by) || 1;
        bx /= bm; by /= bm;
        buds.push({
            id: (bud.id * 31 + step * 7 + 101 + k) | 0,
            tipNode: bud.tipNode, rootNode: 0,
            dirX: bx, dirY: by,
            order,
            axisId: nextAxisId++,
            parentAxisId: nodes[bud.tipNode].axisId,
            segmentIndex: 0,
            pathLength: nodes[bud.tipNode].pathLength,
            budType: 3,
            tree: bud.tree, species: bud.species, traits: bud.traits || P,
            vigor: 0.68 + rand(50 + k) * 0.25,
            age: 0,
            start: step + 1 + Math.floor(rand(55 + k) * 2),
            life: cut.type === 'pollard' ? 5 + Math.floor(rand(60 + k) * 5) : 7 + Math.floor(rand(65 + k) * 8),
            side,
            leader: false,
            leaderDepth: bud.leaderDepth,
            dead: false,
        });
    }
}

/**
 * Shed branches whose main tip is in deep shade. A shed branch takes its
 * whole subtree with it (children always have higher indices than parents,
 * so one forward pass is enough).
 * @returns {Uint8Array} flags: 1 where a node was shed this year.
 */
export function shedShadedBranches(step, lightField, params = P) {
    const shed = new Uint8Array(nodes.length);
    if ((params.shed ?? P.shed) <= 0 || step < SHED_MIN_STEP) return shed;

    for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.death < NEVER) continue;                    // already shed earlier

        let dies = shed[node.parent] === 1;                  // inherits parent's fate
        if (!dies && !node.isLeader && node.isBranchRoot && step + 1 - node.birth >= SHED_MIN_BRANCH_AGE) {
            const tip = nodes[node.mainTip];
            dies = lightField.lightAt(tip.x, tip.y, params) < (params.shed ?? P.shed) * 0.3;
        }
        if (dies) {
            shed[i] = 1;
            node.death = step + 1;
            node.fate = 1;
            lightField.remove(node);
        }
    }
    return shed;
}

/**
 * Precompute a lightweight mechanical load from subtree size and wind. The
 * renderers can use this for diagnostics without running a physics solver.
 */
export function computeMechanicalLoad() {
    const subtree = new Float32Array(nodes.length);
    for (let i = 1; i < nodes.length; i++) {
        if (nodes[i].fate === 1) continue;
        subtree[nodes[i].parent] += 1;
    }
    for (let i = nodes.length - 1; i >= 1; i--) {
        const node = nodes[i];
        if (node.fate === 1) continue;
        subtree[node.parent] += subtree[i];
    }
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.mechanicalLoad = subtree[i] * (0.25 + Math.abs(node.dirX))
            * (1 + Math.abs(P.wind) * 2);
    }
}

/** Precompute final-canopy current light separately from birth light. */
export function computeCurrentLight() {
    const field = new LightField();
    for (const node of nodes) {
        if (node.death >= NEVER) field.add(node);
    }
    for (const node of nodes) {
        node.currentLight = field.lightAt(node.x, node.y);
    }
}

/**
 * Generate a deterministic coarse root system for each tree. Roots are
 * render-only in this phase: they do not affect shoot growth, but they give
 * the trunk a believable anchor and soil profile.
 */
export function buildRootSystem() {
    const out = [];
    const roots = nodes.filter((n) => n.parent < 0);
    for (let tree = 0; tree < roots.length; tree++) {
        const root = roots[tree];
        const traits = treeTraits[tree] || P;
        const count = Math.max(4, Math.round(traits.rootCount || 6));
        const spread = traits.rootSpread || 28;
        const flare = traits.rootFlare || 0.6;
        for (let j = 0; j < count; j++) {
            const a = Math.PI * (0.08 + 0.84 * (j + 0.5) / count);
            const dirX = Math.cos(a);
            const dirY = Math.sin(a);
            const len1 = spread * (0.55 + hashRandom(root.budId, j, 1) * 0.75);
            const len2 = len1 * (0.45 + hashRandom(root.budId, j, 2) * 0.45);
            const x0 = root.x;
            const y0 = 1.2;
            const x1 = x0 + dirX * len1;
            const y1 = y0 + dirY * len1;
            const x2 = x1 + (dirX * 0.35 + (hashRandom(root.budId, j, 3) - 0.5) * 0.55) * len2;
            const y2 = y1 + (0.65 + hashRandom(root.budId, j, 4) * 0.45) * len2;
            const w0 = (1.1 + flare * 2.6) * (0.75 + hashRandom(root.budId, j, 5) * 0.5);
            const w1 = w0 * (0.45 + hashRandom(root.budId, j, 6) * 0.2);
            const w2 = Math.max(0.35, w0 * 0.12);
            out.push({ x0, y0, x1, y1, w0, w1, tree });
            out.push({ x0: x1, y0: y1, x1: x2, y1: y2, w0: w1, w1: w2, tree });
        }
    }
    return out;
}

/** Bounding box of nodes that are never shed. */
export function survivingBounds() {
    let minX = 0, maxX = 0, minY = 0;
    for (const n of nodes) {
        if (n.death < NEVER) continue;
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y);
    }
    return { minX, maxX, minY };
}


/** Set the deterministic seed from the renderer/UI. */
export function setSeedValue(value) {
    seed = value;
}
