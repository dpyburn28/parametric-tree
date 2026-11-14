/**
 * Parametric tree growth: 3D simulation
 * =====================================
 *
 * Grows the 3D tree skeleton once per parameter change. Everything the renderer
 * needs is left in the globals below (`nodes`, `fullBounds`); see main.js for
 * Three.js rendering, pipe-model thickness and UI.
 *
 * SIMULATE
 * --------
 * The tree is grown year by year into a flat array of 3D nodes (a skeleton).
 * Every node stores its parent, birth year and (if shed) death year.
 *
 * COORDINATES
 * -----------
 * World units: the seed is at (0, 0, 0), +x is right, +z is forward, and
 * UP IS POSITIVE y (standard 3D right-handed coordinates). The ground plane is
 * y = 0. One growth step of the trunk is about BASE units.
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
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.508 deg phyllotaxis roll

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
export const LIGHT_CELL = 9;           // 3D voxel size used to count shading nodes
export const LIGHT_ROWS_ABOVE = 6;     // how many voxel layers above a point cast shade on it
export const SHADE_KILL_LIGHT = 0.2;   // buds below this light level may die
export const SHED_MIN_STEP = 6;        // shedding starts after this year
export const SHED_MIN_BRANCH_AGE = 5;  // branches must be this old before they can be shed
export const OBSTACLE_MARGIN = 4;      // clearance kept around blocking obstacles

export const NEVER = 1e9;      // "death year" of a node that is never shed

/**
 * Tunable parameters. Shared defaults live in ../shared/params.js; the 3D
 * dimension overrides preserve the existing golden-angle, volume-aware look.
 */
const prefersReducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const P = Object.assign({}, BASE_PARAMS, DIMENSION_PARAMS_3D, {
    angleOrderBias: BASE_PARAMS.angleOrderBias.slice(),
    phenology: Object.assign({}, BASE_PARAMS.phenology),
    reducedMotion: prefersReducedMotion,
});

/* ==========================================================================
   ! 2. STATE
   ========================================================================== */

/**
 * @typedef {Object} Node  One point of the 3D skeleton. Its segment runs from
 *                         its parent to itself.
 * @property {number} x, y, z     World position (up is positive y).
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
 * @property {number} dirX, dirY, dirZ Unit direction of the segment.
 * @property {number} budType    0 leader, 1 scaffold, 2 lateral, 3 cut regrowth, 4 reiteration.
 * @property {number} fate       0 live, 1 shed, 2 pruned, 3 broken.
 * @property {number} birthLight Light level when the node was created.
 * @property {number} birthShade 1 - birthLight.
 * @property {number} cutType    0 none, 1 thinning, 2 heading, 3 pollard.
 * @property {number} cutStep    Growth step of the cut (-1 if none).
 *
 * @typedef {Object} Bud  A growing 3D shoot tip (simulation only).
 * @property {number} id          Stable id used to seed this bud's random choices.
 * @property {number} tipNode     Index of the node the bud currently sits on.
 * @property {number} rootNode    Index of the first node this bud created (laterals only).
 * @property {number} dirX, dirY, dirZ  Current unit growth direction.
 * @property {number} order       Branch order (0 = trunk).
 * @property {number} axisId      Axis identity inherited by nodes this bud creates.
 * @property {number} parentAxisId Supporting axis.
 * @property {number} segmentIndex Position along the axis.
 * @property {number} pathLength  Distance from the root at the bud tip.
 * @property {number} budType     Semantic bud type (leader/scaffold/lateral/...).
 * @property {number} vigor       1 = trunk-strong; smaller values grow shorter shoots.
 * @property {number} age         Years this bud has been growing.
 * @property {number} start       First year the bud is active.
 * @property {number} life        Years after which a lateral shoot stops growing.
 * @property {number} phyllotaxis Accumulated roll angle (radians) around the shoot axis.
 * @property {boolean} leader     True for the trunk and its co-dominant replacement limbs.
 * @property {number} leaderDepth How many leader bifurcations produced this bud (capped).
 * @property {boolean} dead       True once the bud stops growing.
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
export let fullBounds = { minX: -50, maxX: 50, minY: 0, maxY: 100, minZ: -50, maxZ: 50 };

/* ==========================================================================
   ! 3. RANDOMNESS & 3D VECTOR HELPERS
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

/**
 * Build two unit vectors (u, v) perpendicular to unit vector d = (dx, dy, dz)
 * and to each other. Used to rotate lateral shoots around their parent's axis.
 */
export function perpBasis(dx, dy, dz) {
    // Pick a reference vector not nearly parallel to d.
    const refY = Math.abs(dy) < 0.9 ? 1 : 0;
    const refX = refY ? 0 : 1;
    // u = normalize(d x ref)
    let ux = dy * 0 - dz * refY;
    let uy = dz * refX - dx * 0;
    let uz = dx * refY - dy * refX;
    const um = Math.hypot(ux, uy, uz) || 1;
    ux /= um; uy /= um; uz /= um;
    // v = d x u
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    return { ux, uy, uz, vx, vy, vz };
}

/** Stable perpendicular "up" vector for a segment direction. */
export function stableUp(dx, dy, dz) {
    let rx = 0, ry = 1, rz = 0;
    if (Math.abs(dy) > 0.98) { rx = 1; ry = 0; rz = 0; }
    let ux = ry * dz - rz * dy;
    let uy = rz * dx - rx * dz;
    let uz = rx * dy - ry * dx;
    const m = Math.hypot(ux, uy, uz) || 1;
    return { x: ux / m, y: uy / m, z: uz / m };
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

/** Unit vector from a point toward the sun (3D, +y up). */
export function sunDir() {
    return environmentSunDirection(P, '3d');
}

/** Active obstacle description, or null when disabled. */
export function obstacleSpec() {
    const s = P.obstacleSize;
    switch (P.obstacle) {
        case 1: return { type: 'wall', blocking: true, x: 70, half: 6, height: 420, depth: 320 };
        case 2: return { type: 'sphere', blocking: true, x: 70, y: 35, z: 0, r: s * 0.8 };
        case 3: return { type: 'sphere', blocking: false, x: 0, y: s * 1.2, z: 0, r: s * 1.6 };
        case 4: return { type: 'cone', blocking: false, x: 0, y: 0, z: 0, r: s * 1.8, h: s * 2.2 };
        case 5: return { type: 'wall', hedge: true, blocking: true, x: 70, half: 8, height: 420, depth: 320 };
        case 6: return { type: 'box', blocking: true, x: 70, half: 16, z: 0, depth: 24, height: s * 2.2 };
        default: return null;
    }
}

/** Signed distance to the active obstacle (negative inside). */
export function obstacleSdf(x, y, z) {
    const o = obstacleSpec();
    if (!o) return Infinity;
    if (o.type === 'wall') return Math.abs(x - o.x) - o.half;
    if (o.type === 'box') {
        const dx = Math.abs(x - o.x) - o.half;
        const dy = Math.abs(y - o.height / 2) - o.height / 2;
        const dz = Math.abs(z - o.z) - o.depth / 2;
        return Math.max(dx, dy, dz);
    }
    if (o.type === 'sphere') return Math.hypot(x - o.x, y - o.y, z - o.z) - o.r;
    const height = y;
    const radial = Math.hypot(x - o.x, z - o.z);
    if (height < 0) return Math.max(radial - o.r, height);
    if (height > o.h) return Math.max(radial, height - o.h);
    return radial - o.r * (1 - height / o.h);
}

/** Outward unit normal of the active obstacle (finite-difference gradient). */
export function obstacleNormal(x, y, z) {
    const e = 0.5;
    const gx = obstacleSdf(x + e, y, z) - obstacleSdf(x - e, y, z);
    const gy = obstacleSdf(x, y + e, z) - obstacleSdf(x, y - e, z);
    const gz = obstacleSdf(x, y, z + e) - obstacleSdf(x, y, z - e);
    const m = Math.hypot(gx, gy, gz) || 1;
    return { x: gx / m, y: gy / m, z: gz / m };
}

/** Root positions for the current forest mode. */
export function rootPositions() {
    const count = [1, 3, 5, 7].includes(P.trees) ? P.trees : 1;
    const s = P.spacing || 200;
    const layout = {
        1: [[0, 0]],
        3: [[-s, 0], [0, 0], [s, 0]],
        5: [[-s, 0], [0, 0], [s, 0], [-s * 0.5, s * 0.9], [s * 0.5, s * 0.9]],
        7: [[-s, 0], [0, 0], [s, 0], [-s * 0.5, s * 0.9], [s * 0.5, s * 0.9],
            [-s * 0.5, -s * 0.9], [s * 0.5, -s * 0.9]],
    }[count];
    return layout.map(([x, z], i) => ({
        x: x + (hashRandom(seed, i, 80) - 0.5) * s * 0.12,
        z: z + (hashRandom(seed, i, 81) - 0.5) * s * 0.12,
    }));
}

/* ==========================================================================
   ! 4. SIMULATION
   ========================================================================== */

/**
 * Cheap 3D voxel light model. Live nodes are counted in a coarse 3D grid; the
 * light at a point falls off exponentially with the (weighted) number of nodes
 * in the 3x3 column of voxels above it (+Y).
 */
export class LightField {
    constructor() { this.counts = new Map(); }

    _key(i, j, k) {
        return ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
    }
    _cellKey(node) {
        return this._key(
            Math.floor(node.x / LIGHT_CELL),
            Math.floor(node.y / LIGHT_CELL),
            Math.floor(node.z / LIGHT_CELL)
        );
    }

    add(node) {
        const k = this._cellKey(node);
        this.counts.set(k, (this.counts.get(k) || 0) + 1);
    }

    /** Add static shade (for obstacles) without a skeleton node. */
    addShade(x, y, z, count) {
        const k = this._key(
            Math.floor(x / LIGHT_CELL),
            Math.floor(y / LIGHT_CELL),
            Math.floor(z / LIGHT_CELL)
        );
        this.counts.set(k, (this.counts.get(k) || 0) + count);
    }

    remove(node) {
        const k = this._cellKey(node);
        this.counts.set(k, this.counts.get(k) - 1);
    }

    /** @returns {number} light level in (0, 1]; 1 = full sun. */
    lightAt(x, y, z) {
        const ci = Math.floor(x / LIGHT_CELL);
        const cj = Math.floor(y / LIGHT_CELL);
        const ck = Math.floor(z / LIGHT_CELL);
        const dir = sunDir();
        const { ux, uy, uz, vx, vy, vz } = perpBasis(dir.x, dir.y, dir.z);
        const samples = sunSampleOffsets(P.sunSamples || 3);
        let shade = 0;
        for (const sample of samples) {
            const sx = dir.x + ux * sample * 0.16;
            const sy = dir.y + uy * sample * 0.16;
            const sz = dir.z + uz * sample * 0.16;
            for (let d = 1; d <= LIGHT_ROWS_ABOVE; d++) {
                const rowFalloff = 1 - d / 8;
                const baseI = ci + Math.round(sx * d);
                const baseJ = cj + Math.round(sy * d);
                const baseK = ck + Math.round(sz * d);
                for (let off = -1; off <= 1; off++) {
                    const i = baseI + Math.round(vx * off);
                    const j = baseJ + Math.round(vy * off);
                    const k = baseK + Math.round(vz * off);
                    const count = this.counts.get(this._key(i, j, k));
                    if (count) shade += count * (off === 0 ? 1 : 0.5) * rowFalloff;
                }
            }
        }
        shade /= samples.length;
        const sky = P.skyLight ?? 0.14;
        const direct = Math.exp(-P.shade * 0.34 * shade);
        const intensity = Math.max(0.3, environmentSunIntensity(P, dir));
        const gain = environmentSlopeGain(P, dir.azimuth || 0);
        return Math.max(0.02, Math.min(1,
            (sky + (1 - sky) * direct * intensity) * gain
        ));
    }
}

/** Pre-seed the light field with shade inside the active obstacle volume. */
export function seedObstacleShade(field) {
    const o = obstacleSpec();
    if (!o || !o.blocking) return; // topiary volumes prune, they do not cast shade
    let minX, maxX, minY, maxY, minZ, maxZ;
    if (o.type === 'wall') {
        minX = o.x - o.half - LIGHT_CELL; maxX = o.x + o.half + LIGHT_CELL;
        minY = 0; maxY = o.height;
        minZ = -o.depth / 2; maxZ = o.depth / 2;
    } else if (o.type === 'box') {
        minX = o.x - o.half - LIGHT_CELL; maxX = o.x + o.half + LIGHT_CELL;
        minY = 0; maxY = o.height + LIGHT_CELL;
        minZ = o.z - o.depth / 2 - LIGHT_CELL; maxZ = o.z + o.depth / 2 + LIGHT_CELL;
    } else if (o.type === 'cone') {
        minX = o.x - o.r - LIGHT_CELL; maxX = o.x + o.r + LIGHT_CELL;
        minY = 0; maxY = o.h + LIGHT_CELL;
        minZ = o.z - o.r - LIGHT_CELL; maxZ = o.z + o.r + LIGHT_CELL;
    } else {
        minX = o.x - o.r - LIGHT_CELL; maxX = o.x + o.r + LIGHT_CELL;
        minY = o.y - o.r - LIGHT_CELL; maxY = o.y + o.r + LIGHT_CELL;
        minZ = o.z - o.r - LIGHT_CELL; maxZ = o.z + o.r + LIGHT_CELL;
    }
    for (let x = Math.floor(minX / LIGHT_CELL) * LIGHT_CELL; x <= maxX; x += LIGHT_CELL) {
        for (let y = Math.floor(minY / LIGHT_CELL) * LIGHT_CELL; y <= maxY; y += LIGHT_CELL) {
            for (let z = Math.floor(minZ / LIGHT_CELL) * LIGHT_CELL; z <= maxZ; z += LIGHT_CELL) {
                const sdf = obstacleSdf(x, y, z);
                if (sdf < 0) field.addShade(x, y, z, 3);
                else if (sdf < LIGHT_CELL) field.addShade(x, y, z, 1);
            }
        }
    }
}

/** Grow the whole 3D tree from a seed and store the skeleton in `nodes`. */
export function simulate() {
    const lightField = new LightField();
    const roots = rootPositions();
    for (const root of roots) {
        root.y = environmentGroundHeight(P, root.x, root.z);
    }
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
        x: r.x, y: r.y, z: r.z, parent: -1, birth: 0, order: 0, death: NEVER,
        isBranchRoot: false, mainTip: i, isLeader: true,
        budId: 1 + i * 100003, birthStep: -1,
        axisId: i + 1, axisOrder: 0, parentAxisId: -1, segmentIndex: 0, pathLength: 0,
        dirX: 0, dirY: 1, dirZ: 0, upX: 1, upY: 0, upZ: 0, tortuosity: 0,
        budType: 0, fate: 0, birthLight: 1, birthShade: 0, mechanicalLoad: 0,
        cutType: 0, cutStep: -1, cut: null,
        tree: i, species: treeSpecies[i] || P.speciesMix,
        light: 1, currentLight: 1, vigor: 1, shootAge: 0, preDirX: 0, preDirY: 1, preDirZ: 0,
    }));
    for (const root of nodes) lightField.add(root);
    seedObstacleShade(lightField);

    /** @type {Bud[]} */
    let buds = roots.map((r, i) => {
        let dx = Math.sign(r.x) * (P.edgeLean || 0);
        let dz = Math.sign(r.z) * (P.edgeLean || 0);
        const m = Math.hypot(dx, 1, dz) || 1;
        return {
            id: 1 + i * 100003, tipNode: i, rootNode: i, dirX: dx / m, dirY: 1 / m, dirZ: dz / m,
            order: 0, vigor: 1,
            axisId: i + 1, parentAxisId: -1, segmentIndex: 0, pathLength: 0, budType: 0,
            tree: i, species: treeSpecies[i] || P.speciesMix, traits: treeTraits[i],
            age: 0,
            start: Math.floor(hashRandom(seed, i, 90) * (P.ageMix || 0) * steps * 0.35),
            life: Infinity, phyllotaxis: 0, leader: true, leaderDepth: 0, dead: false,
        };
    });

    for (let step = 0; step < steps; step++) {
        // Buds created this year are appended and must not grow until next year,
        // so only iterate over the buds that existed when the year began.
        const activeCount = buds.length;
        for (let i = 0; i < activeCount; i++) growBud(buds[i], step, lightField, buds);

        const shed = shedShadedBranches(step, lightField);
        buds = buds.filter((b) => !b.dead && !shed[b.tipNode]);
    }

    computeMechanicalLoad();
    computeCurrentLight();
    rootSystem = buildRootSystem();
    fullBounds = survivingBounds();
}

/**
 * Advance one bud by one year: extend its shoot by one 3D segment, then maybe
 * spawn lateral buds rotated around the shoot axis by the golden angle.
 * @param {Bud} bud
 * @param {number} step       Current year (0-based).
 * @param {LightField} lightField
 * @param {Bud[]} buds        Bud list; new lateral buds are appended to it.
 */
export function growBud(bud, step, lightField, buds) {
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
    const t = bud.traits || P;
    const rand = (channel) => hashRandom(bud.id, step, channel);
    const isLateral = bud.order > 0;
    const light = isLateral ? lightField.lightAt(tip.x, tip.y, tip.z) : 1; // trunk is never shaded
    const wind = environmentWind(P, tip.x, tip.y, tip.z, step, treeRoots);

    // Deep shade: lateral buds may die before growing.
    if (isLateral && light < SHADE_KILL_LIGHT && rand(9) < 0.5) { bud.dead = true; return; }

    // Segment length: shorter for higher orders, weaker vigor, shade and age.
    const ageFactor = Math.max(GROWTH_FLOOR, Math.exp(-step / GROWTH_DECAY));
    const orderFactor = isLateral
        ? 0.85 * Math.pow(0.9, bud.order) * (0.5 + 0.5 * bud.vigor) * (0.4 + 0.6 * light)
        : 1;
    const windStress = Math.min(1, wind.speed * (t.windTaper ?? P.windTaper ?? 0));
    const length = BASE * orderFactor * ageFactor
        * environmentWaterGain(P) * (1 - windStress * 0.2);

    // Direction = previous direction + 3D random jitter + wind + phototropism + droop.
    const jitter = (isLateral ? 0.45 : 0.2) * (0.6 + (t.tortuosity || 0) * 0.9);
    let dx = bud.dirX + (rand(1) - 0.5) * jitter;
    let dy = bud.dirY + (rand(2) - 0.5) * jitter;
    let dz = bud.dirZ + (rand(14) - 0.5) * jitter;
    dx += wind.x * (isLateral ? 1 : 0.35);                                          // prevailing wind
    dz += wind.z * (isLateral ? 1 : 0.35);
    if (P.trees > 1 && P.crownShyness > 0) {
        for (let ti = 0; ti < treeRoots.length; ti++) {
            if (ti === bud.tree) continue;
            const ddx = tip.x - treeRoots[ti].x;
            const ddz = tip.z - treeRoots[ti].z;
            const d = Math.hypot(ddx, ddz) || 1;
            if (d < (P.spacing || 200) * 1.2) {
                dx += (ddx / d) * P.crownShyness * 0.02;
                dz += (ddz / d) * P.crownShyness * 0.02;
            }
        }
    }
    const preMag = Math.hypot(dx, dy, dz) || 1;
    const preDirX = dx / preMag, preDirY = dy / preMag, preDirZ = dz / preMag;
    dy += t.photo * (isLateral ? 1 : 1.5);                                          // up (+y)
    dy -= t.droop * Math.min(bud.age, 8) * 0.06 * (isLateral ? 1 : 0.3);            // down (-y)
    const mag = Math.hypot(dx, dy, dz) || 1;
    dx /= mag; dy /= mag; dz /= mag;

    let x = tip.x + dx * length;
    let y = tip.y + dy * length;
    let z = tip.z + dz * length;
    if (isLateral && y < environmentGroundHeight(P, x, z) + 1) { bud.dead = true; return; } // shoots stop at the ground

    // Obstacles: blocking shapes deflect growth, containment shapes prune it.
    const spec = obstacleSpec();
    if (spec) {
        const sdf = obstacleSdf(x, y, z);
        if (spec.blocking) {
            if (sdf < OBSTACLE_MARGIN) {
                const n = obstacleNormal(x, y, z);
                const dot = dx * n.x + dy * n.y + dz * n.z;
                dx -= n.x * dot; dy -= n.y * dot; dz -= n.z * dot;
                const dm = Math.hypot(dx, dy, dz);
                if (dm < 0.05) { bud.dead = true; return; }
                dx /= dm; dy /= dm; dz /= dm;
                x = tip.x + dx * length; y = tip.y + dy * length; z = tip.z + dz * length;
                const after = obstacleSdf(x, y, z);
                if (after < OBSTACLE_MARGIN) {
                    const push = OBSTACLE_MARGIN - after + 0.5;
                    x += n.x * push; y += n.y * push; z += n.z * push;
                }
            }
        } else if (sdf > -OBSTACLE_MARGIN) {
            // Containment: reflect outgoing growth back inside the topiary
            // volume so the clipped shape fills with dense interior shoots.
            const n = obstacleNormal(x, y, z);
            const dot = dx * n.x + dy * n.y + dz * n.z;
            if (dot > 0) { dx -= 2 * n.x * dot; dy -= 2 * n.y * dot; dz -= 2 * n.z * dot; }
            const dm = Math.hypot(dx, dy, dz);
            if (dm < 0.05) { bud.dead = true; return; }
            dx /= dm; dy /= dm; dz /= dm;
            x = tip.x + dx * length; y = tip.y + dy * length; z = tip.z + dz * length;
            const after = obstacleSdf(x, y, z);
            if (after > -OBSTACLE_MARGIN) {
                const push = after + OBSTACLE_MARGIN + 0.5;
                x -= n.x * push; y -= n.y * push; z -= n.z * push;
            }
        }
    }

    if (P.espalier) {
        dz *= 0.12;
        const em = Math.hypot(dx, dy, dz) || 1;
        dx /= em; dy /= em; dz /= em;
        x = tip.x + dx * length;
        y = tip.y + dy * length;
        z = tip.z + dz * length;
        z = Math.max(-4, Math.min(4, z));
    }

    // Add the new node to the skeleton.
    const pathLength = bud.pathLength + length;
    const up = stableUp(dx, dy, dz);
    const nodeTortuosity = (t.tortuosity || 0) * (0.6 + rand(70) * 0.8);
    nodes.push({
        x, y, z, parent: bud.tipNode, birth: step + 1, order: bud.order, death: NEVER,
        isBranchRoot: isLateral && bud.age === 0, mainTip: 0, isLeader: bud.leader,
        budId: bud.id, birthStep: step,
        axisId: bud.axisId, axisOrder: bud.order, parentAxisId: bud.parentAxisId,
        segmentIndex: bud.segmentIndex, pathLength,
        dirX: dx, dirY: dy, dirZ: dz, upX: up.x, upY: up.y, upZ: up.z,
        tortuosity: nodeTortuosity, budType: bud.budType, fate: 0,
        tree: bud.tree, species: bud.species,
        birthLight: light, birthShade: 1 - light, mechanicalLoad: 0, windStress,
        cutType: 0, cutStep: -1, cut: null,
        light, currentLight: 0, vigor: bud.vigor, shootAge: bud.age, preDirX, preDirY, preDirZ,
    });
    const index = nodes.length - 1;
    lightField.add(nodes[index]);
    if (isLateral) {
        if (bud.age === 0) bud.rootNode = index;
        nodes[bud.rootNode].mainTip = index; // lets the shedding pass test the branch's tip light
    }

    bud.tipNode = index;
    bud.dirX = dx; bud.dirY = dy; bud.dirZ = dz;
    bud.segmentIndex++;
    bud.pathLength = pathLength;
    bud.age++;
    if (isLateral && bud.age >= bud.life) bud.dead = true;

    // Sympodial growth: the leader slowly loses dominance and may split into
    // two co-dominant scaffold limbs (broadleaf/decurrent habit).
    if (bud.leader && step >= TRUNK_MIN_AGE) {
        bud.vigor *= 1 - t.sympodial * 0.03;
        if (bud.leaderDepth < 2 && rand(20) < t.sympodial * 0.15) {
            bifurcateLeader(bud, step, index, dx, dy, dz, buds);
            bud.dead = true;
            return;
        }
    }

    spawnLaterals(bud, step, index, dx, dy, dz, light, buds);
}

/**
 * Replace a leader bud with two co-dominant scaffold limbs, ending the single
 * vertical axis and starting a spreading crown.
 */
export function bifurcateLeader(bud, step, index, dx, dy, dz, buds) {
    const t = bud.traits || P;
    const rand = (channel) => hashRandom(bud.id, step, channel);
    const { ux, uy, uz, vx, vy, vz } = perpBasis(dx, dy, dz);
    const roll = bud.phyllotaxis;
    bud.phyllotaxis += GOLDEN_ANGLE;
    const cosR = Math.cos(roll), sinR = Math.sin(roll);
    const rx = ux * cosR + vx * sinR;
    const ry = uy * cosR + vy * sinR;
    const rz = uz * cosR + vz * sinR;

    const halfTilt = (angleForOrder(bud.order + 1, t) * 0.55 + (rand(21) - 0.5) * 12) * Math.PI / 180;
    const cosT = Math.cos(halfTilt), sinT = Math.sin(halfTilt);

    for (let k = 0; k < 2; k++) {
        const sign = k ? -1 : 1;
        let cx = dx * cosT + rx * sinT * sign;
        let cy = dy * cosT + ry * sinT * sign;
        let cz = dz * cosT + rz * sinT * sign;
        const cm = Math.hypot(cx, cy, cz) || 1;
        cx /= cm; cy /= cm; cz /= cm;

        buds.push({
            id: (bud.id * 31 + step * 7 + 41 + k) | 0,
            tipNode: index, rootNode: 0,
            dirX: cx, dirY: cy, dirZ: cz,
            order: bud.order,
            axisId: nextAxisId++,
            parentAxisId: nodes[index].axisId,
            segmentIndex: 0,
            pathLength: nodes[index].pathLength,
            budType: 1,
            vigor: 0.9,
            age: 0,
            start: step + 1,
            life: Infinity,
            phyllotaxis: rand(22 + k) * Math.PI * 2,
            leader: true,
            leaderDepth: bud.leaderDepth + 1,
            dead: false,
        });
    }
}

/** Possibly create lateral buds at the node `index` the bud just produced. */
export function spawnLaterals(bud, step, index, dx, dy, dz, light, buds) {
    const t = bud.traits || P;
    const minAge = bud.order ? LATERAL_MIN_AGE : TRUNK_MIN_AGE;
    if (bud.age < minAge || nodes.length >= MAX_NODES) return;

    // Trunk attempts 2 golden-angle spirals per year; laterals attempt 1.
    const attempts = bud.order === 0 ? 2 : 1;
    const rand = (channel) => hashRandom(bud.id, step, channel);
    const { ux, uy, uz, vx, vy, vz } = perpBasis(dx, dy, dz);
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

    for (let si = 0; si < attempts; si++) {
        const rollBase = bud.phyllotaxis;
        bud.phyllotaxis += GOLDEN_ANGLE;

        // Branching chance is reduced in shade, in old age, and in forests.
        let chance = t.branch * (0.4 + 0.6 * light) * oldAge * forestScale;
        if (bud.order === 1) chance *= scaffoldChance;
        if (bud.order === 2) chance *= twigChance;
        if (rand(3 + si) > chance) continue;

        const vigor = bud.vigor * (1 - t.apical * 0.6) * (0.8 + 0.4 * rand(7 + si));
        if (bud.order >= MAX_ORDER || vigor < MIN_VIGOR) continue;

        // Roll around the parent axis by the phyllotaxis angle, with slight jitter.
        const roll = rollBase + (rand(16 + si) - 0.5) * 0.35;
        const cosR = Math.cos(roll), sinR = Math.sin(roll);
        let rx = ux * cosR + vx * sinR;
        let ry = uy * cosR + vy * sinR;
        let rz = uz * cosR + vz * sinR;

        // Secondary branches fan out horizontally; plagiotropism strengthens it.
        if (bud.order > 0) {
            ry *= Math.max(0.08, 0.65 - (t.plagiotropism || 0) * 0.55);
            const rm = Math.hypot(rx, ry, rz) || 1;
            rx /= rm; ry /= rm; rz /= rm;
        }

        // Tilt away from the parent axis by the order-specific branch angle.
        const tilt = (angleForOrder(bud.order + 1, t) + (rand(5 + si) - 0.5) * 20) * Math.PI / 180;
        const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
        let cx = dx * cosT + rx * sinT;
        let cy = dy * cosT + ry * sinT;
        let cz = dz * cosT + rz * sinT;
        const cm = Math.hypot(cx, cy, cz) || 1;
        cx /= cm; cy /= cm; cz /= cm;

        const baseLife = 2 + Math.floor(vigor * 8 * (0.6 + rand(12 + si) * 0.8));
        const lifeScale = bud.order === 0 ? scaffoldLife : bud.order === 1 ? twigLife : 1;
        buds.push({
            id: (bud.id * 31 + step * 7 + si + 1) | 0,
            tipNode: index, rootNode: 0,
            dirX: cx, dirY: cy, dirZ: cz,
            order: bud.order + 1,
            axisId: nextAxisId++,
            parentAxisId: nodes[index].axisId,
            segmentIndex: 0,
            pathLength: nodes[index].pathLength,
            budType: bud.order === 0 ? 1 : 2,
            tree: bud.tree, species: bud.species, traits: t,
            vigor,
            age: 0,
            start: step + 1 + Math.floor(rand(10 + si) * 2),                       // 0 to 1 year delay
            life: baseLife * lifeScale,
            phyllotaxis: rand(18 + si) * Math.PI * 2,
            leader: false,
            leaderDepth: bud.leaderDepth,
            dead: false,
        });
    }

    // Old-growth reiteration: trunks and scaffolds throw epicormic shoots.
    if (bud.order <= 1 && step > OLD_AGE_START && reiterationCount < 48) {
        const chance = (t.reiteration || 0) * oldAge * (bud.order === 0 ? 0.09 : 0.045);
        if (rand(30) < chance) {
            spawnReiteration(bud, step, index, dx, dy, dz, buds);
            reiterationCount++;
        }
    }
}

/** Spawn an old-growth epicormic/reiteration shoot from a trunk or scaffold. */
export function spawnReiteration(bud, step, index, dx, dy, dz, buds) {
    const rand = (channel) => hashRandom(bud.id, step, channel);
    const { ux, uy, uz, vx, vy, vz } = perpBasis(dx, dy, dz);
    const roll = rand(31) * Math.PI * 2;
    const cosR = Math.cos(roll), sinR = Math.sin(roll);
    let rx = ux * cosR + vx * sinR;
    let ry = uy * cosR + vy * sinR;
    let rz = uz * cosR + vz * sinR;
    ry = ry * 0.2 + 0.25; // bias upward; +y is up in 3D
    let cx = dx * 0.3 + rx * 0.9;
    let cy = dy * 0.3 + ry * 0.9 + 0.25;
    let cz = dz * 0.3 + rz * 0.9;
    const cm = Math.hypot(cx, cy, cz) || 1;
    cx /= cm; cy /= cm; cz /= cm;

    const order = Math.min(MAX_ORDER, bud.order + 1);
    buds.push({
        id: (bud.id * 31 + step * 7 + 77 + Math.floor(rand(34) * 1000)) | 0,
        tipNode: index, rootNode: 0,
        dirX: cx, dirY: cy, dirZ: cz,
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
        phyllotaxis: rand(38) * Math.PI * 2,
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
    const { ux, uy, uz, vx, vy, vz } = perpBasis(bud.dirX, bud.dirY, bud.dirZ);
    for (let k = 0; k < count; k++) {
        const roll = rand(41 + k) * Math.PI * 2;
        const cosR = Math.cos(roll), sinR = Math.sin(roll);
        let rx = ux * cosR + vx * sinR;
        let ry = uy * cosR + vy * sinR;
        let rz = uz * cosR + vz * sinR;
        ry = ry * 0.2 + 0.35;
        let cx = bud.dirX * 0.35 + rx * 0.8;
        let cy = bud.dirY * 0.35 + ry * 0.8 + 0.35;
        let cz = bud.dirZ * 0.35 + rz * 0.8;
        const cm = Math.hypot(cx, cy, cz) || 1;
        cx /= cm; cy /= cm; cz /= cm;
        buds.push({
            id: (bud.id * 31 + step * 7 + 101 + k) | 0,
            tipNode: bud.tipNode, rootNode: 0,
            dirX: cx, dirY: cy, dirZ: cz,
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
            phyllotaxis: rand(70 + k) * Math.PI * 2,
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
export function shedShadedBranches(step, lightField) {
    const shed = new Uint8Array(nodes.length);
    if (P.shed <= 0 || step < SHED_MIN_STEP) return shed;

    for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.death < NEVER) continue;                    // already shed earlier

        let dies = shed[node.parent] === 1;                  // inherits parent's fate
        if (!dies && !node.isLeader && node.isBranchRoot && step + 1 - node.birth >= SHED_MIN_BRANCH_AGE) {
            const tip = nodes[node.mainTip];
            dies = lightField.lightAt(tip.x, tip.y, tip.z) < P.shed * 0.3;
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
        node.mechanicalLoad = subtree[i]
            * (0.25 + Math.hypot(node.dirX, node.dirZ))
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
        node.currentLight = field.lightAt(node.x, node.y, node.z);
    }
}

/**
 * Generate a deterministic coarse root system for each tree. Roots are
 * render-only in this phase; the first segment runs near the surface so the
 * flare is visible, and the second dives into the soil.
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
            const a = Math.PI * 2 * (j + 0.5) / count + (hashRandom(root.budId, j, 10) - 0.5) * 0.5;
            const dirX = Math.cos(a);
            const dirZ = Math.sin(a);
            const len1 = spread * (0.55 + hashRandom(root.budId, j, 11) * 0.75);
            const len2 = len1 * (0.45 + hashRandom(root.budId, j, 12) * 0.45);
            const x0 = root.x;
            const y0 = root.y + 0.5;
            const z0 = root.z;
            const x1 = x0 + dirX * len1;
            const y1 = y0 - (0.18 + hashRandom(root.budId, j, 13) * 0.2) * len1;
            const z1 = z0 + dirZ * len1;
            const x2 = x1 + dirX * len2 * 0.45;
            const y2 = y1 - (0.6 + hashRandom(root.budId, j, 14) * 0.5) * len2;
            const z2 = z1 + dirZ * len2 * 0.45;
            const w0 = (1.1 + flare * 2.6) * (0.75 + hashRandom(root.budId, j, 15) * 0.5);
            const w1 = w0 * (0.45 + hashRandom(root.budId, j, 16) * 0.2);
            const w2 = Math.max(0.35, w0 * 0.12);
            out.push({ x0, y0, z0, x1, y1, z1, w0, w1, tree });
            out.push({ x0: x1, y0: y1, z0: z1, x1: x2, y1: y2, z1: z2, w0: w1, w1: w2, tree });
        }
    }
    return out;
}

/** 3D bounding box of nodes that are never shed. */
export function survivingBounds() {
    let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
    for (const n of nodes) {
        if (n.death < NEVER) continue;
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
        if (n.z < minZ) minZ = n.z;
        if (n.z > maxZ) maxZ = n.z;
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
}


/** Set the deterministic seed from the renderer/UI. */
export function setSeedValue(value) {
    seed = value;
}
