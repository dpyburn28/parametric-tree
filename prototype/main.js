/**
 * Parametric tree growth: rendering and UI
 * ========================================
 *
 * RENDER (every frame)
 * --------------------
 * Time is only a render parameter. For a given age we derive, from the
 * skeleton in simulation.js, how far each segment has grown, how thick each
 * segment is (pipe model), and which branches have been shed. Scrubbing the
 * age slider therefore never re-runs the simulation.
 *
 * The simulation is imported as an ES module so the 2D and 3D engines can run
 * side by side in the split-view app without sharing global bindings.
 */

import {
    MAX_NODES,
    GROWTH_HORIZON,
    JUVENILE_YEARS,
    growthSteps,
    growthTime,
    LIGHT_CELL,
    NEVER,
    P,
    seed,
    nodes,
    rootSystem,
    treeRoots,
    treeTraits,
    fullBounds,
    hashRandom,
    obstacleSpec,
    LightField,
    simulate,
    setSeedValue,
    setSimulationAutomation,
} from './simulation.js';

'use strict';

/* ==========================================================================
   ! 1. CONFIGURATION
   ========================================================================== */

/** Rendering constants. */
const LEAF = 4.5;       // full-grown leaf size (world units)
const R0 = 0.4;         // radius of a twig tip (world units)
const PN = 2.2;         // pipe-model exponent: r_parent^n = sum(r_child^n)
const AGE_THICKEN_MAX = 3.2; // maximum extra radius from age (world units)
const AGE_THICKEN_TAU = 55;  // years to approach the maximum age thickness
const AGE_FLOOR_PIPE_RATIO = 1.6; // cap the age floor relative to pipe radius
const TRUNK_THICKEN = 1.6; // trunk thickens faster than branches

/** End of the time slider (the last year finishes growing). */
function timeEnd() {
    return P.lifespan + 1;
}

/** Slider definitions are shared; see ../shared/params.js. */

/* ==========================================================================
   ! 2. STATE AND DOM
   ========================================================================== */

let time = 0;        // current age in years (render parameter)
let playing = false;
let lastFrameTs = 0;

let automation = createAutomation();
let RP = P;

/** Species & season render state. */
let leafPalette = 'green';   // 'green' | 'blossom'
let season = 0.33;           // 0 = spring, 0.33 = summer, 0.66 = autumn, 1 = winter
let seasonAuto = false;      // cycle one full season every 4 simulated years
let activePreset = 'custom';
let pruneMode = false;
let lassoMode = false;
let lassoActive = false;
let lassoPoints = [];
let isolateNode = -1;
let compareSnapshot = null;
let compareMode = false;
let selectedNode = -1;
let selectionEnabled = true;
let hoverNode = -1;
let hoverSubtree = null;
let hoverSubtreeFor = -1;
const pruneMarks = [];
const cutHistory = [];
const cutFuture = [];
let lastCamera = null;
let analytics = null;
let analyticsBaseline = null;
let analyticsCompare = false;
let analyticsHover = null;
const DIMENSION = '2d';
const APP_BUS = window.__TREE_APP_BUS__ || null;
const LINKED_MODE = new URLSearchParams(window.location.search).has('linked') || !!APP_BUS;
let applyingRemote = false;
let fullscreenActive = false;
let fullscreenUiHidden = false;
let autosaveTimer = 0;
let appVisible = true;
let pendingRegenerate = false;
let suppressAutosave = false;

/** Approximate world-space area of one rendered 2D leaf card. */
const LEAF_CARD_AREA_2D = 8;

/** Visualization state (toggled in the UI). */
const viz = {
    colorMode: 'natural', // 'natural' | 'order' | 'light' | 'vigor' | 'pipe'
    skeleton: false,
    lightGrid: false,
    vectors: false,
    shed: false,
    xray: false,
};
/** Export preferences are persisted with the tree state and shared across views. */
const exportSettings = (() => {
    const defaults = {
        svgWidth: 1200,
        svgHeight: 800,
        svgDpi: 96,
        svgRoots: true,
        svgBranches: true,
        svgLeaves: true,
        svgBackground: false,
        svgLineArt: false,
        svgAnnotations: false,
        svgScaleBar: false,
        pngScale: 2,
        glbRoots: true,
        glbLeaves: true,
        glbMetadata: true,
        glbAxis: 'y',
        glbUnits: 'm',
        glbLod: 'near',
    };
    // The studio mounts both engines in one window. Sharing this object keeps a
    // panel edit made in one pane from being overwritten by the other pane's autosave.
    const shared = window.__TREE_EXPORT_SETTINGS__ || (window.__TREE_EXPORT_SETTINGS__ = {});
    for (const [key, value] of Object.entries(defaults)) {
        if (shared[key] === undefined) shared[key] = value;
    }
    return shared;
})();


const ORDER_COLORS = ['#7a4924', '#d95f02', '#e6ab02', '#1b9e77', '#2b8cbe'];

const VIEW_ROOT = window.__TREE_VIEW_ROOT__ || document;
const THEME_ROOT = VIEW_ROOT.host || document.documentElement;
const $ = (id) => (VIEW_ROOT.getElementById ? VIEW_ROOT.getElementById(id) : VIEW_ROOT.querySelector('#' + id));
const canvas = $('c');
let toastTimer = 0;

function showToast(message, timeout = 5000) {
    if (APP_BUS && typeof window.__TREE_APP_STATUS__ === 'function') {
        window.__TREE_APP_STATUS__(message);
        return;
    }
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastTimer = 0;
        el.hidden = true;
    }, timeout);
}
const ctx = canvas.getContext('2d');

/** Route linked-view messages either to the parent frame or the in-page bus. */
function postLinkedMessage(message) {
    if (!LINKED_MODE) return;
    if (APP_BUS) APP_BUS.post(DIMENSION, message);
    else window.parent.postMessage(message, '*');
}

/* ==========================================================================
   ! 3. RENDERING HELPERS
   ========================================================================== */

/** Cheap per-node noise in [0, 1) for rendering only (leaf placement and colour). */
function noise(i, k) {
    const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function smoothstep(a, b, x) {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
}

function mixRgb(a, b, t) {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}

const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/**
 * Day/night follows the sun tilt instead of the OS color scheme. A steep sun
 * angle (near vertical) is day; a large tilt lowers the sun into twilight and
 * then night. The same colors feed the sky, soil and grass.
 */
function refreshRenderParams() {
    RP = resolveRenderParams(P, automation, time);
}
function updateDayNight() {
    refreshRenderParams();
    const sun = environmentSunDirection(RP, '2d');
    const height = sun.elevation * 180 / Math.PI;
    const t = smoothstep(0, 30, height)
        * Math.max(0.35, environmentSky(RP).exposure);
    const root = THEME_ROOT;
    root.dataset.theme = t >= 0.45 ? 'light' : 'dark';

    const low = Math.max(0, 1 - Math.abs(t - 0.25) / 0.25);
    let sky1 = mixRgb([10, 16, 28], [191, 224, 240], t);
    let sky2 = mixRgb([22, 32, 44], [246, 240, 220], t);
    sky1 = mixRgb(sky1, [120, 80, 140], low * 0.25);
    sky2 = mixRgb(sky2, [235, 145, 80], low * 0.65);
    const sky = environmentSky(RP);
    sky1 = mixRgb(sky1, [150, 155, 165], sky.overcast * 0.6);
    sky2 = mixRgb(sky2, [165, 170, 178], sky.overcast * 0.5);
    if (sky.warmth > 0) sky2 = mixRgb(sky2, [240, 170, 110], sky.warmth * 0.22);
    const soil = mixRgb([28, 20, 14], [107, 80, 57], t);
    const grass = mixRgb([26, 44, 22], [93, 143, 60], t);

    root.style.setProperty('--sky1', rgb(sky1));
    root.style.setProperty('--sky2', rgb(sky2));
    root.style.setProperty('--soil', rgb(soil));
    root.style.setProperty('--grass', rgb(grass));
}

/** Season currently displayed, either manual or derived from `time`. */
function currentSeason() {
    return seasonAuto ? (time % 4) / 4 : season;
}

function seasonName(s) {
    if (s < 0.15) return 'Spring';
    if (s < 0.5) return 'Summer';
    if (s < 0.8) return 'Autumn';
    return 'Winter';
}

/**
 * Leaf/flower colour and size for one card. Species phenology supplies the
 * leaf-out/drop windows, autumn palette, and flowering window; the season
 * slider remains the manual override.
 */
function leafStyle(seas, i, k, node) {
    const traits = (treeTraits && treeTraits[node.tree]) || P;
    const ph = phenologyAt(seas, traits.phenology);
    const n1 = noise(i, 5 + k);
    const n2 = noise(i, 7 + k);
    const lightBias = clamp01(node.currentLight ?? node.light ?? 1);

    if (ph.flower > 0.02 && noise(i, 60 + k) < ph.flower * 0.75) {
        return {
            h: ph.flowerHue + (n1 - 0.5) * 12,
            s: 55,
            l: 70 + n2 * 10,
            scale: Math.max(0.32, ph.flower) * 0.62,
            alpha: 0.92,
            flower: true,
            shape: 'flower',
        };
    }

    if (ph.fruit > 0.02 && noise(i, 70 + k) < ph.fruit * 0.28) {
        return {
            h: ph.fruitHue + (n1 - 0.5) * 8,
            s: 65,
            l: 42 + n2 * 10,
            scale: Math.max(0.3, ph.fruit) * 0.38,
            alpha: 0.92,
            fruit: true,
            shape: 'fruit',
        };
    }

    if (ph.leafScale <= 0.02) return null;
    if (!ph.evergreen && ph.leafScale < 0.55 && noise(i, 31 + k) > ph.leafScale * 1.6) return null;
    const waterScale = 0.75 + 0.25 * environmentWaterGain(RP);
    const ageBias = clamp01((time - node.birth) / 40);
    return {
        h: ph.hue + (n1 - 0.5) * 10 + (lightBias - 0.5) * 4 + (ageBias - 0.5) * 5,
        s: ph.sat,
        l: ph.light + (n2 - 0.5) * 9 + (1 - ageBias) * 2,
        scale: ph.leafScale * waterScale,
        alpha: 0.86,
        flower: false,
        shape: traits.leafShape || 'oak',
    };
}

/* ==========================================================================
   ! 4. RENDERING
   ========================================================================== */

/** Per-frame buffers (reallocated only when the skeleton size changes). */
const frame = {
    px: null, py: null, radius: null, childCount: null,
    pipeSum: null, present: null, ageDominated: null,
};

function ensureFrameBuffers(n) {
    if (frame.px && frame.px.length === n) return;
    frame.px = new Float32Array(n);          // current end point of each segment
    frame.py = new Float32Array(n);
    frame.radius = new Float32Array(n);      // pipe-model radius
    frame.childCount = new Int16Array(n);    // visible children (0 = tip)
    frame.pipeSum = new Float32Array(n);     // sum of child radius^PN
    frame.present = new Uint8Array(n);       // 1 if the node is visible at `time`
    frame.ageDominated = new Uint8Array(n);  // 1 if ageMin > pure pipe radius
}

/**
 * Derive everything visible at the current `time` from the skeleton:
 * segment end points (growth + retraction), radii (pipe model) and stats.
 * @returns {{minX:number,maxX:number,minY:number,tips:number,segments:number}}
 */
function computeFrameState() {
    const n = nodes.length;
    ensureFrameBuffers(n);
    const gt = growthTime(time);
    const { px, py, radius, childCount, pipeSum, present, ageDominated } = frame;
    present.fill(0); childCount.fill(0); pipeSum.fill(0); ageDominated.fill(0);

    // Every root (parent < 0) starts visible at its own position.
    for (let i = 0; i < n; i++) {
        if (nodes[i].parent >= 0) continue;
        present[i] = 1;
        px[i] = nodes[i].x;
        py[i] = nodes[i].y;
    }

    // Forward pass (parents before children): growth progress and positions.
    // A segment grows over the year after its birth and retracts over the
    // year after its death; both scale its length from its parent's end point.
    for (let i = 1; i < n; i++) {
        if (nodes[i].parent < 0) continue;
        const node = nodes[i], parent = nodes[node.parent];
        const grown = clamp01(gt - node.birth);
        const retracted = clamp01(gt - node.death);
        const progress = grown * (1 - retracted);
        if (progress > 0 && present[node.parent]) {
            present[i] = 1;
            px[i] = px[node.parent] + (node.x - parent.x) * progress;
            py[i] = py[node.parent] + (node.y - parent.y) * progress;
        }
    }

    // Backward pass (children before parents): pipe-model radii. A segment
    // with children is at least as thick as its supported tips combined, and
    // never thinner than an age-based minimum, so old limbs stay thick.
    // Crucially, pipeSum accumulates pure tip cross-section (not ageMin), so
    // the age floor never compounds exponentially at forks down to the root.
    const tipPipe = Math.pow(R0, PN);
    let segments = 0;
    for (let i = n - 1; i >= 0; i--) {
        if (!present[i]) continue;
        const node = nodes[i];
        if (pipeSum[i] > 0) {
            const pipe = Math.pow(pipeSum[i], 1 / PN);
            const orderScale = node.order ? Math.pow(0.5, node.order) : TRUNK_THICKEN;
            const ageMin = R0
                + AGE_THICKEN_MAX * (1 - Math.exp(-(time - node.birth) / AGE_THICKEN_TAU)) * orderScale;
            ageDominated[i] = ageMin > pipe ? 1 : 0;
            radius[i] = Math.max(pipe, Math.min(ageMin, pipe * AGE_FLOOR_PIPE_RATIO));
        } else {
            radius[i] = R0; // tip
        }
        if (i > 0 && node.parent >= 0) {
            pipeSum[node.parent] += pipeSum[i] > 0 ? pipeSum[i] : tipPipe;
            childCount[node.parent]++;
            segments++;
        }
    }

    // Extent and tip count of what is currently visible.
    let minX = 0, maxX = 0, minY = 0, tips = 0;
    for (let i = 0; i < n; i++) {
        if (!present[i]) continue;
        if (childCount[i] === 0) tips++;
        minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minY = Math.min(minY, py[i]);
    }
    return { minX, maxX, minY, tips, segments };
}

/**
 * Fit the view: world-to-screen scale and offsets so the tree (current
 * extent if auto-zoom is on, otherwise the final extent) fills the canvas.
 */
function computeCamera(bounds, width, height) {
    const w = Math.max(bounds.maxX - bounds.minX + 14, 40);
    const h = Math.max(-bounds.minY + 14, 40);
    const scale = Math.min(width * 0.94 / w, height * 0.8 / h);
    const groundY = height * 0.88;
    const centerX = width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale;
    return { scale, groundY, originX: centerX, originY: groundY, toX: (x) => centerX + x * scale, toY: (y) => groundY + y * scale };
}

function drawBackground(cam, width, height) {
    const css = getComputedStyle(THEME_ROOT);
    const sky = ctx.createLinearGradient(0, 0, 0, cam.groundY);
    sky.addColorStop(0, css.getPropertyValue('--sky1'));
    sky.addColorStop(1, css.getPropertyValue('--sky2'));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);

    // Horizon haze from the active sky preset.
    const haze = environmentSky(RP).haze;
    const fog = clamp01((RP.fogDensity || 0) / 0.003);
    const hazeGrad = ctx.createLinearGradient(0, cam.groundY - 90, 0, cam.groundY);
    hazeGrad.addColorStop(0, 'rgba(235,242,245,0)');
    hazeGrad.addColorStop(1, `rgba(225,235,240,${0.08 + haze * 0.45 + fog * 0.25})`);
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, cam.groundY - 90, width, 90);

    ctx.fillStyle = css.getPropertyValue('--soil'); ctx.fillRect(0, cam.groundY, width, height - cam.groundY);
    // Shallow soil strata for a simple 2D profile.
    ctx.fillStyle = 'rgba(35, 24, 16, 0.12)';
    ctx.fillRect(0, cam.groundY + 18, width, 5);
    ctx.fillStyle = 'rgba(35, 24, 16, 0.08)';
    ctx.fillRect(0, cam.groundY + 38, width, 3);
    ctx.fillStyle = css.getPropertyValue('--grass'); ctx.fillRect(0, cam.groundY - 2, width, 4);
}

/** Soft contact shadows under the tree roots. */
function drawContactShadows2D(cam) {
    if (!treeRoots || !treeRoots.length) return;
    ctx.save();
    for (const root of treeRoots) {
        const x = cam.toX(root.x);
        const y = cam.toY(0) + 1;
        const rx = Math.max(10, 26 * cam.scale);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rx);
        grad.addColorStop(0, 'rgba(25, 22, 16, 0.28)');
        grad.addColorStop(0.55, 'rgba(25, 22, 16, 0.12)');
        grad.addColorStop(1, 'rgba(25, 22, 16, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, rx * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Deterministic 2D grass tufts and leaf litter. */
function drawGroundDetail(cam) {
    if (!treeRoots || !treeRoots.length) return;
    ctx.save();
    for (let ti = 0; ti < treeRoots.length; ti++) {
        const root = treeRoots[ti];
        const baseX = cam.toX(root.x);
        const baseY = cam.toY(0);
        for (let i = 0; i < 24; i++) {
            const hx = hashRandom(seed, ti * 31 + i, 121);
            const hz = hashRandom(seed, ti * 31 + i, 122);
            const x = baseX + (hx - 0.5) * 70 * cam.scale;
            const y = baseY + (hz - 0.5) * 4 * cam.scale;
            const h = (2 + hashRandom(seed, ti * 31 + i, 123) * 5) * cam.scale;
            ctx.strokeStyle = `rgba(62, 112, 45, ${0.35 + hx * 0.3})`;
            ctx.lineWidth = Math.max(0.6, cam.scale * 0.45);
            for (let b = -1; b <= 1; b++) {
                ctx.beginPath();
                ctx.moveTo(x + b * 0.8, y);
                ctx.lineTo(x + b * 1.5, y - h);
                ctx.stroke();
            }
        }
        for (let i = 0; i < 18; i++) {
            const hx = hashRandom(seed, ti * 47 + i, 124);
            const hz = hashRandom(seed, ti * 47 + i, 125);
            const x = baseX + (hx - 0.5) * 80 * cam.scale;
            const y = baseY + (hz - 0.5) * 5 * cam.scale;
            ctx.fillStyle = `rgba(${120 + hx * 70},${70 + hz * 45},${35 + hx * 20},0.5)`;
            ctx.beginPath();
            ctx.ellipse(x, y, Math.max(0.6, 1.6 * cam.scale), Math.max(0.4, 0.7 * cam.scale), hx * 3, 0, Math.PI * 2);
            ctx.fill();
        }
        if (P.trees > 1) {
            const shrubs = 5;
            for (let i = 0; i < shrubs; i++) {
                const a = hashRandom(seed, ti * 71 + i, 126) * Math.PI * 2;
                const radius = (55 + hashRandom(seed, ti * 71 + i, 127) * 55) * cam.scale;
                const x = baseX + Math.cos(a) * radius;
                const y = baseY - Math.max(2, 5 * cam.scale);
                const r = Math.max(3, 7 * cam.scale);
                ctx.fillStyle = `rgba(48, 92, 42, ${0.35 + hashRandom(seed, ti * 71 + i, 128) * 0.3})`;
                ctx.beginPath();
                ctx.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    ctx.restore();
}

/** Coarse roots, drawn into the soil profile behind the trunk. */
function drawRoots(cam) {
    if (!rootSystem.length) return;
    ctx.save();
    ctx.fillStyle = 'rgba(67, 45, 28, 0.92)';
    for (const r of rootSystem) {
        const x0 = cam.toX(r.x0), y0 = cam.toY(r.y0);
        const x1 = cam.toX(r.x1), y1 = cam.toY(r.y1);
        const w0 = Math.max(0.4, r.w0 * cam.scale);
        const w1 = Math.max(0.3, r.w1 * cam.scale);
        let dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        ctx.beginPath();
        ctx.moveTo(x0 - dy * w0, y0 + dx * w0);
        ctx.lineTo(x0 + dy * w0, y0 - dx * w0);
        ctx.lineTo(x1 + dy * w1, y1 - dx * w1);
        ctx.lineTo(x1 - dy * w1, y1 + dx * w1);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

/** The seed on the ground: fully visible before year 1, then fades out. */
function drawSeed(cam) {
    if (time >= 2.6) return;
    ctx.globalAlpha = time < 1 ? 1 : Math.max(0, 1 - (time - 1) / 1.6);
    ctx.fillStyle = '#7a5a36';
    for (const root of nodes) {
        if (root.parent >= 0) continue;
        ctx.beginPath();
        ctx.ellipse(cam.toX(root.x), cam.toY(root.y) + 2,
            Math.max(3, 1.3 * cam.scale), Math.max(2, 0.8 * cam.scale), 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/** Draw the active obstacle behind the tree. */
function drawObstacle(cam) {
    const o = obstacleSpec();
    if (!o) return;
    ctx.save();
    ctx.fillStyle = 'rgba(115, 125, 135, 0.20)';
    ctx.strokeStyle = 'rgba(80, 90, 100, 0.55)';
    ctx.lineWidth = 1.5;
    if (o.type === 'wall') {
        const x = cam.toX(o.x - o.half);
        const w = 2 * o.half * cam.scale;
        if (o.hedge) {
            ctx.fillStyle = 'rgba(70, 120, 55, 0.35)';
            ctx.strokeStyle = 'rgba(45, 85, 35, 0.65)';
        }
        ctx.fillRect(x, 0, w, cam.groundY);
        ctx.strokeRect(x, 0, w, cam.groundY);
    } else if (o.type === 'box') {
        const x = cam.toX(o.x - o.half);
        const y = cam.toY(-o.height);
        const w = 2 * o.half * cam.scale;
        const h = o.height * cam.scale;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
    } else if (o.type === 'sphere') {
        ctx.beginPath();
        ctx.arc(cam.toX(o.x), cam.toY(o.y), o.r * cam.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    } else if (o.type === 'cone') {
        const baseY = cam.toY(0);
        const apexY = cam.toY(-o.h);
        const r = o.r * cam.scale;
        ctx.beginPath();
        ctx.moveTo(cam.toX(o.x) - r, baseY);
        ctx.lineTo(cam.toX(o.x) + r, baseY);
        ctx.lineTo(cam.toX(o.x), apexY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();
}

/** Colour of segment `i` under the active bark visualization mode. */
function segmentColor(i) {
    const node = nodes[i];
    const { radius, childCount, ageDominated } = frame;
    switch (viz.colorMode) {
        case 'order':
            return ORDER_COLORS[Math.min(node.order, ORDER_COLORS.length - 1)];
        case 'light': {
            const l = clamp01(node.currentLight ?? node.light ?? 1);
            return `hsl(${265 - l * 210} 80% ${26 + l * 38}%)`;
        }
        case 'vigor': {
            const v = clamp01(node.vigor ?? 1);
            return `hsl(${215 - v * 195} 78% ${30 + v * 26}%)`;
        }
        case 'pipe':
            if (childCount[i] === 0) return '#2ca25f';
            return ageDominated[i] ? '#e66101' : '#2b8cbe';
        default: {
            const traits = (treeTraits && treeTraits[node.tree]) || P;
            const thickness = Math.min(radius[i] / 7, 1);              // thicker = darker bark
            return `hsl(${traits.barkHue} ${traits.barkSat}% ${traits.barkLight - 14 * thickness}%)`;
        }
    }
}

const LEAF_COUNTS = { oak: 4, pine: 5, willow: 3, cherry: 4, poplar: 3 };
function leafCountForShape(shape) {
    return LEAF_COUNTS[shape] || 3;
}

/** Render-only leaf density multiplier for 2D quality tiers. */
function qualityLeafFactor() {
    if (P.quality === 'low') return 0.55;
    if (P.quality === 'medium') return 0.8;
    return 1;
}

/** Subtle render-only wind offset for 2D branches and leaves. */
function windOffset2D(node) {
    if (P.reducedMotion) return 0;
    const speed = Math.abs(RP.wind || 0) + (RP.gustAmp || 0) * 0.35;
    if (speed < 0.001) return 0;
    const phase = (node.pathLength || 0) * 0.02 + (node.axisId || 0) * 0.37;
    const height = Math.min(1, Math.abs(node.y || 0) / 120);
    return Math.sin(time * 1.1 + phase) * speed * (0.6 + height * 2.2);
}

/** Each segment is a tapered quad (parent width to own width) plus a round joint. */
function drawBranches(cam) {
    const { px, py, radius, present } = frame;
    const isolateMask = isolateNode >= 0 ? subtreeMask(isolateNode) : null;
    const baseAlpha = viz.xray ? 0.24 : 1;
    for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        ctx.globalAlpha = baseAlpha * (isolateMask && !isolateMask[i] ? 0.12 : 1);
        const p = nodes[i].parent;
        const x0 = cam.toX(px[p] + windOffset2D(nodes[p])), y0 = cam.toY(py[p]);
        const x1 = cam.toX(px[i] + windOffset2D(nodes[i])), y1 = cam.toY(py[i]);
        // Root flare: the trunk widens and gains a lobed buttress near the soil.
        const traits = (treeTraits && treeTraits[nodes[i].tree]) || P;
        const flare = nodes[i].order === 0
            ? 1 + (traits.rootFlare || 0.6) * Math.exp(Math.min(0, py[i]) / 8)
            : 1;
        const w0 = Math.max(0.5, radius[p] * cam.scale * flare);
        const w1 = Math.max(0.5, radius[i] * cam.scale);

        // Unit direction of the segment; (-dy, dx) is its perpendicular.
        let dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;

        ctx.fillStyle = segmentColor(i);
        ctx.beginPath();
        ctx.moveTo(x0 - dy * w0, y0 + dx * w0);
        ctx.lineTo(x0 + dy * w0, y0 - dx * w0);
        ctx.lineTo(x1 + dy * w1, y1 - dx * w1);
        ctx.lineTo(x1 - dy * w1, y1 + dx * w1);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x1, y1, w1, 0, Math.PI * 2);                       // smooth the joint
        ctx.fill();

        // Bark hatching on thicker wood, plus a dark shadow-side accent.
        if (viz.colorMode === 'natural' && P.quality !== 'low' && radius[i] > 1.4) {
            const lines = Math.min(4, 1 + Math.floor(radius[i] / 1.5));
            ctx.strokeStyle = 'rgba(32, 20, 12, 0.20)';
            ctx.lineWidth = Math.max(0.5, 0.45 * cam.scale);
            for (let h = 0; h < lines; h++) {
                const f = (h + 1) / (lines + 1) - 0.5;
                const jitter = (noise(i, 80 + h) - 0.5) * 0.22;
                ctx.beginPath();
                ctx.moveTo(x0 + dy * w0 * (f + jitter) * 1.5, y0 - dx * w0 * (f + jitter) * 1.5);
                ctx.lineTo(x1 + dy * w1 * (f + jitter) * 1.5, y1 - dx * w1 * (f + jitter) * 1.5);
                ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(20, 14, 10, 0.24)';
            ctx.lineWidth = Math.max(0.6, w0 * 0.35);
            ctx.beginPath();
            ctx.moveTo(x0 + dy * w0 * 0.62, y0 - dx * w0 * 0.62);
            ctx.lineTo(x1 + dy * w1 * 0.62, y1 - dx * w1 * 0.62);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;
}

/** Dark wound rings at cut nodes after a prune. */
function drawCutWounds(cam) {
    const gt = growthTime(time);
    const { px, py, radius, present } = frame;
    ctx.save();
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node.cutType || node.cutStep < 0 || gt < node.cutStep || !present[i]) continue;
        const x = cam.toX(px[i]), y = cam.toY(py[i]);
        const r = Math.max(2.2, (radius[i] || 0.4) * cam.scale * 0.9);
        ctx.fillStyle = 'rgba(44, 25, 13, 0.92)';
        ctx.beginPath();
        ctx.ellipse(x, y, r, Math.max(1.2, r * 0.55), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(178, 118, 68, 0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.25, Math.max(1.5, r * 0.7), 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

/** Draw one species-shaped leaf card in 2D. */
function drawLeafCard2D(x, y, rx, ry, angle, style) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = `hsla(${style.h},${style.s}%,${style.l}%,${style.alpha ?? 0.86})`;
    if (style.shape === 'pine') {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = Math.max(0.8, ry * 1.5);
        for (let k = -1; k <= 1; k++) {
            ctx.beginPath();
            ctx.moveTo(0, k * ry * 0.65);
            ctx.lineTo(rx * 1.45, k * ry * 0.2);
            ctx.stroke();
        }
    } else if (style.shape === 'willow') {
        ctx.beginPath();
        ctx.ellipse(rx * 0.55, 0, rx * 1.35, Math.max(0.8, ry * 0.28), 0, 0, Math.PI * 2);
        ctx.fill();
    } else if (style.shape === 'oak') {
        ctx.beginPath();
        ctx.ellipse(rx * 0.5, 0, rx * 0.75, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(rx * 0.2, -ry * 0.55, rx * 0.55, ry * 0.55, -0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(rx * 0.2, ry * 0.55, rx * 0.55, ry * 0.55, 0.45, 0, Math.PI * 2);
        ctx.fill();
    } else if (style.shape === 'cherry') {
        ctx.beginPath();
        ctx.ellipse(rx * 0.55, 0, rx * 0.95, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rx * 1.35, 0, Math.max(0.7, ry * 0.18), 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.ellipse(rx * 0.55, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Two small leaves on thin twig nodes; tips are favoured. Leaves grow in with age and fall when their node is shed. */
function drawLeaves(cam) {
    const { px, py, radius, childCount, present } = frame;
    const alpha = viz.xray ? 0.14 : 0.85;
    const isolateMask = isolateNode >= 0 ? subtreeMask(isolateNode) : null;
    const seas = currentSeason();
    const gt = growthTime(time);
    for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        ctx.globalAlpha = alpha * (isolateMask && !isolateMask[i] ? 0.1 : 1);
        const node = nodes[i];
        const age = gt - node.birth;
        const traits = (treeTraits && treeTraits[node.tree]) || P;
        const density = (traits.leaves ?? RP.leaves) * (childCount[i] === 0 ? 1.4 : 0.6) * qualityLeafFactor();
        if (age < 0.8 || gt >= node.death || radius[i] > R0 * 2.4 || noise(i, 1) > density) continue;

        const size = Math.min(1, (age - 0.8) / 2) * LEAF;
        const rx = Math.max(1.2, size * cam.scale);
        const leafCount = leafCountForShape(traits.leafShape);
        for (let k = 0; k < leafCount; k++) {
            const style = leafStyle(seas, i, k, node);
            if (!style) continue;
            const a = noise(i, 2 + k) * Math.PI * 2;
            const x = cam.toX(px[i] + windOffset2D(node) + Math.cos(a) * LEAF * 0.08);
            const y = cam.toY(py[i] + Math.sin(a) * LEAF * 0.08);
            const r = Math.max(1, rx * style.scale);
            const ry = style.flower ? Math.max(0.9, r * 0.85) : Math.max(0.6, r * 0.55);
            ctx.save();
            ctx.globalAlpha = alpha;
            drawLeafCard2D(x, y, r, ry, a, style);
            ctx.restore();
        }
    }
    ctx.globalAlpha = 1;
}

/* ==========================================================================
   ! 5. ALGORITHM OVERLAYS
   ========================================================================== */

/** Draw occupied LightField grid cells (LIGHT_CELL x LIGHT_CELL) for currently live nodes. */
function drawLightGridOverlay(cam) {
    if (!viz.lightGrid) return;
    const { px, py, present } = frame;
    const gt = growthTime(time);
    const cellCounts = new Map();
    for (let i = 0; i < nodes.length; i++) {
        if (!present[i] || gt >= nodes[i].death) continue;
        const ci = Math.floor(px[i] / LIGHT_CELL);
        const cj = Math.floor(py[i] / LIGHT_CELL);
        const key = `${ci},${cj}`;
        cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
    }

    const sizePx = LIGHT_CELL * cam.scale;
    ctx.lineWidth = 1;
    for (const [key, count] of cellCounts) {
        const [ci, cj] = key.split(',').map(Number);
        const sx = cam.toX(ci * LIGHT_CELL);
        const sy = cam.toY(cj * LIGHT_CELL);
        const intensity = Math.min(1, count / 5);
        ctx.fillStyle = `rgba(245, 175, 30, ${0.12 + intensity * 0.32})`;
        ctx.strokeStyle = `rgba(215, 130, 10, ${0.35 + intensity * 0.45})`;
        ctx.fillRect(sx, sy, sizePx, sizePx);
        ctx.strokeRect(sx, sy, sizePx, sizePx);
    }
}

/** Draw shed branches (`time >= death`) as dashed red ghosts plus branchRoot -> mainTip sensor links. */
function drawShedOverlay(cam) {
    if (!viz.shed) return;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(225, 65, 55, 0.72)';
    const gt = growthTime(time);
    ctx.beginPath();
    for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.death >= NEVER || gt < node.death) continue;
        const parent = nodes[node.parent];
        ctx.moveTo(cam.toX(parent.x), cam.toY(parent.y));
        ctx.lineTo(cam.toX(node.x), cam.toY(node.y));
    }
    ctx.stroke();

    // Sensor link from each shed branchRoot to the mainTip whose light level triggered shedding.
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = 'rgba(245, 165, 20, 0.85)';
    for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node.isBranchRoot || node.death >= NEVER || gt < node.death || !node.mainTip) continue;
        const tip = nodes[node.mainTip];
        const rx = cam.toX(node.x), ry = cam.toY(node.y);
        const tx = cam.toX(tip.x), ty = cam.toY(tip.y);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.fillStyle = '#e14137';
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Draw skeleton graph: parent-child links, joints, branch roots and active tips. */
function drawSkeletonOverlay(cam) {
    if (!viz.skeleton) return;
    const { px, py, childCount, present } = frame;
    ctx.save();
    ctx.strokeStyle = 'rgba(25, 35, 30, 0.65)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        ctx.moveTo(cam.toX(px[p]), cam.toY(py[p]));
        ctx.lineTo(cam.toX(px[i]), cam.toY(py[i]));
    }
    ctx.stroke();

    for (let i = 0; i < nodes.length; i++) {
        if (!present[i]) continue;
        const x = cam.toX(px[i]), y = cam.toY(py[i]);
        const isTip = childCount[i] === 0;
        ctx.fillStyle = isTip ? '#18b858' : (nodes[i].isBranchRoot ? '#f59e0b' : '#1f2937');
        ctx.beginPath();
        ctx.arc(x, y, isTip ? 3.1 : (nodes[i].isBranchRoot ? 2.8 : 1.7), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawArrow(x0, y0, x1, y1, color) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const ux = dx / len, uy = dy / len;
    const head = Math.min(5, len * 0.4);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55);
    ctx.stroke();
}

/** Draw steering vectors (inertia, phototropism up, droop down, resultant) at active tips. */
function drawTropismOverlay(cam) {
    if (!viz.vectors) return;
    const { px, py, childCount, present } = frame;
    ctx.save();
    ctx.lineWidth = 1.4;
    const vecScale = Math.max(12, 5.5 * cam.scale);
    const gt = growthTime(time);

    for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        const node = nodes[i];
        const growingNow = gt >= node.birth && gt <= node.birth + 1.05;
        if (!growingNow && childCount[i] !== 0) continue;

        const sx = cam.toX(px[i]), sy = cam.toY(py[i]);
        const isLat = node.order > 0;
        const photoPull = P.photo * (isLat ? 1 : 1.5);
        const droopPull = P.droop * Math.min(node.shootAge ?? 1, 8) * 0.06 * (isLat ? 1 : 0.3);

        // Pre-tropism direction (inertia + jitter)
        if (node.preDirX !== undefined) {
            drawArrow(sx, sy, sx + node.preDirX * vecScale * 0.75, sy + node.preDirY * vecScale * 0.75, '#6b7280');
        }
        // Phototropism (-y is up in 2D)
        if (photoPull > 0.005) {
            drawArrow(sx, sy, sx, sy - Math.min(1.4, photoPull * 2.5) * vecScale, '#0ea5e9');
        }
        // Gravitropism / droop (+y is down in 2D)
        if (droopPull > 0.005) {
            drawArrow(sx, sy, sx, sy + Math.min(1.4, droopPull * 3.2) * vecScale, '#f97316');
        }
        // Resultant growth direction
        const parent = nodes[node.parent];
        const segDx = node.x - parent.x, segDy = node.y - parent.y;
        const segLen = Math.hypot(segDx, segDy) || 1;
        drawArrow(sx, sy, sx + (segDx / segLen) * vecScale * 0.9, sy + (segDy / segLen) * vecScale * 0.9, '#16a34a');
    }
    ctx.restore();
}

/** Update the floating legend pill when any visualization mode or overlay is active. */
function updateLegend() {
    const items = [];
    const item = (color, text) => `<span class="legend-item"><i class="swatch" style="background:${color}"></i>${text}</span>`;

    if (viz.colorMode === 'order') {
        ORDER_COLORS.forEach((c, idx) => items.push(item(c, idx === 0 ? 'Order 0 (trunk)' : `Order ${idx}`)));
    } else if (viz.colorMode === 'light') {
        items.push(item('hsl(265 80% 28%)', 'Shade (0)'), item('hsl(160 80% 45%)', 'Mid'), item('hsl(55 80% 60%)', 'Full sun (1)'));
    } else if (viz.colorMode === 'vigor') {
        items.push(item('hsl(215 78% 34%)', 'Low vigor'), item('hsl(20 78% 54%)', 'High vigor (1)'));
    } else if (viz.colorMode === 'pipe') {
        items.push(item('#2b8cbe', 'Pipe-model radius'), item('#e66101', 'Age-floor radius'), item('#2ca25f', 'Twig tip (R0)'));
    }

    if (viz.skeleton) {
        items.push(item('#18b858', 'Active tip'), item('#f59e0b', 'Branch root'));
    }
    if (viz.lightGrid) {
        items.push(item('#f5af1e', 'LightField cell'));
    }
    if (viz.vectors) {
        items.push(item('#0ea5e9', 'Phototropism ↑'), item('#f97316', 'Droop ↓'), item('#16a34a', 'Resultant'));
    }
    if (viz.shed) {
        items.push(item('#e14137', 'Shed branch'), item('#f5a514', 'Root→tip sensor'));
    }

    const el = $('legend');
    if (!el) return;
    if (items.length === 0) {
        el.hidden = true;
    } else {
        el.hidden = false;
        el.innerHTML = items.join('');
    }
}

/** Display year corresponding to a structural growth step. */
function displayYearForStep(step) {
    const steps = growthSteps();
    if (P.lifespan <= GROWTH_HORIZON || steps <= JUVENILE_YEARS) return step;
    if (step <= JUVENILE_YEARS) return step;
    return JUVENILE_YEARS + (step - JUVENILE_YEARS) / (steps - JUVENILE_YEARS) * (P.lifespan - JUVENILE_YEARS);
}

/** Precompute biomass / tips / shed / light for the analytics strip. */
function computeAnalytics() {
    const steps = growthSteps();
    const n = nodes.length;
    const present = new Uint8Array(n);
    const childCount = new Int16Array(n);
    const pipeSum = new Float32Array(n);
    const points = [];

    for (let step = 0; step <= steps; step++) {
        present.fill(0); childCount.fill(0); pipeSum.fill(0);
        for (let i = 0; i < n; i++) {
            const node = nodes[i];
            if (node.parent < 0) { present[i] = 1; continue; }
            if (step >= node.birth && step < node.death && present[node.parent]) present[i] = 1;
        }

        let biomass = 0;
        let trunkVolume = 0;
        let branchVolume = 0;
        let lightSum = 0;
        let visible = 0;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = n - 1; i >= 0; i--) {
            if (!present[i]) continue;
            const node = nodes[i];
            const pipe = pipeSum[i] > 0 ? Math.pow(pipeSum[i], 1 / PN) : R0;
            if (node.x < minX) minX = node.x;
            if (node.x > maxX) maxX = node.x;
            if (node.y < minY) minY = node.y;
            if (node.y > maxY) maxY = node.y;
            if (i > 0 && node.parent >= 0) {
                const parent = nodes[node.parent];
                const progress = clamp01(step - node.birth) * (1 - clamp01(step - node.death));
                const length = Math.hypot(node.x - parent.x, node.y - parent.y) * progress;
                const volume = Math.PI * pipe * pipe * length;
                biomass += volume;
                if (node.order === 0) trunkVolume += volume; else branchVolume += volume;
                pipeSum[node.parent] += pipeSum[i] > 0 ? pipeSum[i] : Math.pow(R0, PN);
                childCount[node.parent]++;
            }
            lightSum += node.currentLight ?? node.light ?? 1;
            visible++;
        }

        let tips = 0;
        for (let i = 0; i < n; i++) {
            if (present[i] && childCount[i] === 0) tips++;
        }
        let shed = 0;
        for (let i = 0; i < n; i++) {
            if (nodes[i].death === step) shed++;
        }

        let leafCount = 0;
        let leafLightSum = 0;
        for (let i = 1; i < n; i++) {
            if (!present[i]) continue;
            const node = nodes[i];
            const pipe = pipeSum[i] > 0 ? Math.pow(pipeSum[i], 1 / PN) : R0;
            if (step - node.birth < 0.8 || pipe > R0 * 2.4) continue;
            const traits = (treeTraits && treeTraits[node.tree]) || P;
            const density = (traits.leaves ?? P.leaves) * (childCount[i] === 0 ? 1.4 : 0.6);
            if (noise(i, 1) > density) continue;
            leafCount += leafCountForShape(traits.leafShape || P.leafShape);
            leafLightSum += node.currentLight ?? node.light ?? 1;
        }

        points.push({
            year: displayYearForStep(step),
            biomass,
            tips,
            shed,
            light: visible ? lightSum / visible : 1,
            height: Number.isFinite(minY) ? -minY : 0,
            crownWidth: Number.isFinite(minX) ? maxX - minX : 0,
            leafArea: leafCount * LEAF_CARD_AREA_2D,
            leafLight: leafCount ? leafLightSum / leafCount : 0,
            crownRatio: (Number.isFinite(minY) ? -minY : 0) > 0
                ? (Number.isFinite(minX) ? maxX - minX : 0) / Math.max(1, -minY)
                : 0,
            trunkVolume,
            branchVolume,
            canopyClosure: 1 - (visible ? lightSum / visible : 1),
            carbon: biomass * 0.5,
        });
    }

    analytics = { points, lifespan: Math.max(1, P.lifespan), leafLightModel: 'final-canopy' };
}


const ANALYTICS_COMPARE_KEYS = [
    'biomass', 'height', 'crownWidth', 'leafArea', 'light', 'canopyClosure', 'carbon',
];

function analyticsPointNear(points, year) {
    if (!points || !points.length) return null;
    let best = points[0];
    let bestDistance = Math.abs(best.year - year);
    for (let i = 1; i < points.length; i++) {
        const distance = Math.abs(points[i].year - year);
        if (distance < bestDistance) {
            best = points[i];
            bestDistance = distance;
        }
    }
    return best;
}

function formatAnalyticsValue(key, value) {
    if (!Number.isFinite(value)) return '—';
    if (key === 'light' || key === 'canopyClosure') return `${(value * 100).toFixed(1)}%`;
    if (key === 'height' || key === 'crownWidth' || key === 'leafArea') return value.toFixed(1);
    return value.toFixed(2);
}

function formatAnalyticsDelta(current, baseline) {
    if (!Number.isFinite(current) || !Number.isFinite(baseline)) return '—';
    if (Math.abs(baseline) < 1e-6) return current === 0 ? '0%' : 'n/a';
    const percent = ((current - baseline) / Math.abs(baseline)) * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function updateAnalyticsSummary() {
    const el = $('analyticsSummary');
    if (!el) return;
    if (!analyticsBaseline) {
        el.textContent = 'Pin a run to compare metrics.';
        return;
    }
    if (!analyticsCompare) {
        el.textContent = 'Baseline pinned; enable Compare to overlay it.';
        return;
    }
    const current = analyticsPointNear(analytics?.points, time);
    const baseline = analyticsPointNear(analyticsBaseline.points, time);
    if (!current || !baseline) {
        el.textContent = 'No comparison point at this year.';
        return;
    }
    const parts = ['biomass', 'height', 'crownWidth', 'leafArea']
        .map((key) => `${key} ${formatAnalyticsDelta(current[key], baseline[key])}`);
    el.textContent = `Year ${current.year.toFixed(1)} vs baseline: ${parts.join(' · ')}`;
}

function updateAnalyticsUI() {
    const label = $('analyticsBaselineLabel');
    if (label) {
        label.textContent = analyticsBaseline
            ? `Baseline: seed ${analyticsBaseline.seed} · ${analyticsBaseline.preset || 'custom'} · ${Math.round(analyticsBaseline.time)}y`
            : 'No baseline';
    }
    const compare = $('analyticsCompare');
    if (compare) {
        const active = !!(analyticsBaseline && analyticsCompare);
        compare.classList.toggle('active', active);
        compare.setAttribute('aria-pressed', String(active));
        compare.disabled = !analyticsBaseline;
    }
    const clear = $('analyticsClear');
    if (clear) clear.disabled = !analyticsBaseline;
    updateAnalyticsSummary();
}

function pinAnalyticsBaseline() {
    if (!analytics) return;
    analyticsBaseline = {
        points: analytics.points.map((point) => Object.assign({}, point)),
        lifespan: analytics.lifespan,
        leafLightModel: analytics.leafLightModel,
        seed,
        preset: activePreset || 'custom',
        time,
    };
    analyticsCompare = true;
    updateAnalyticsUI();
    drawAnalytics();
    scheduleStateAutosave();
    showToast('Analytics baseline pinned');
}

function clearAnalyticsBaseline() {
    if (!analyticsBaseline) return;
    analyticsBaseline = null;
    analyticsCompare = false;
    analyticsHover = null;
    updateAnalyticsUI();
    drawAnalytics();
    scheduleStateAutosave();
    showToast('Analytics baseline cleared');
}

function toggleAnalyticsCompare() {
    if (!analyticsBaseline) return;
    analyticsCompare = !analyticsCompare;
    updateAnalyticsUI();
    drawAnalytics();
    scheduleStateAutosave();
}

function analyticsComparisonRows() {
    const current = analytics?.points || [];
    const baseline = analyticsBaseline?.points || [];
    return current.map((point) => {
        const match = analyticsPointNear(baseline, point.year);
        const row = { year: point.year };
        for (const key of ANALYTICS_COMPARE_KEYS) {
            row[key] = point[key];
            row[`baseline_${key}`] = match ? match[key] : null;
            row[`delta_${key}`] = match ? point[key] - match[key] : null;
        }
        return row;
    });
}

function bindAnalyticsChart() {
    const el = $('analytics');
    if (!el || el._analyticsBound) return;
    el._analyticsBound = true;
    const yearAt = (event) => {
        const rect = el.getBoundingClientRect();
        const left = 50;
        const right = 8;
        const width = el.clientWidth || 600;
        const chartWidth = Math.max(1, width - left - right);
        const lifespan = Math.max(analytics?.lifespan || 1, analyticsBaseline?.lifespan || 1);
        return Math.max(0, Math.min(lifespan, ((event.clientX - rect.left - left) / chartWidth) * lifespan));
    };
    el.addEventListener('mousemove', (event) => {
        const rect = el.getBoundingClientRect();
        analyticsHover = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        drawAnalytics();
    });
    el.addEventListener('mouseleave', () => {
        analyticsHover = null;
        drawAnalytics();
    });
    el.addEventListener('click', (event) => {
        if (!analytics) return;
        setTime(yearAt(event));
        drawAnalytics();
    });
    el.addEventListener('keydown', (event) => {
        if (!analytics || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const next = time + (event.key === 'ArrowRight' ? step : -step);
        setTime(Math.max(0, Math.min(analytics.lifespan, next)));
        drawAnalytics();
    });
    el.tabIndex = 0;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Growth analytics. Click to seek; use arrow keys to step through years.');
}

/** Draw the analytics sparklines, baseline overlay, and current-time playhead. */
function drawAnalytics() {
    const el = $('analytics');
    if (!el || !analytics) return;
    bindAnalyticsChart();
    el.title = analyticsBaseline
        ? 'Dashed lines show the pinned baseline. Click to seek; arrow keys step one year.'
        : 'Click to seek. Pin a baseline to compare two runs.';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 72;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
    }
    const g = el.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const left = 50;
    const right = 8;
    const chartW = Math.max(1, w - left - right);
    const rows = 7;
    const rowH = h / rows;
    const currentPoints = analytics.points;
    const baseline = analyticsBaseline && analyticsCompare ? analyticsBaseline : null;
    const baselinePoints = baseline?.points || [];
    const lifespan = Math.max(1, analytics.lifespan || 1, baseline?.lifespan || 1);
    const maxOf = (key, fallback = 1) => Math.max(
        fallback,
        ...currentPoints.map((point) => point[key] || 0),
        ...baselinePoints.map((point) => point[key] || 0)
    );
    const maxB = maxOf('biomass');
    const maxT = Math.max(1, ...currentPoints.map((p) => Math.max(p.tips, p.shed)),
        ...baselinePoints.map((p) => Math.max(p.tips, p.shed)));
    const maxL = maxOf('light', 0.01);
    const maxH = maxOf('height');
    const maxW = maxOf('crownWidth');
    const maxA = maxOf('leafArea');
    const maxLL = maxOf('leafLight', 0.01);
    const xAt = (point) => left + (point.year / lifespan) * chartW;
    const darkChart = THEME_ROOT.dataset.theme === 'dark';
    const gridColor = darkChart ? 'rgba(220,225,215,0.20)' : 'rgba(55,65,55,0.20)';
    const labelColor = darkChart ? 'rgba(230,235,225,0.90)' : 'rgba(45,55,45,0.90)';
    const accent = '#0072B2';

    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'middle';

    const line = (points, valueAt, color, { dashed = false, alpha = 1 } = {}) => {
        if (!points.length) return;
        g.save();
        g.globalAlpha = alpha;
        g.strokeStyle = color;
        g.lineWidth = dashed ? 1.1 : 1.4;
        if (dashed) g.setLineDash([4, 3]);
        g.beginPath();
        points.forEach((point, index) => {
            const x = xAt(point);
            const y = rowY(index, valueAt(point));
            if (index === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.stroke();
        g.restore();
    };

    let activeRow = 0;
    let activeMax = 1;
    const rowY = (index, value) => {
        const y0 = activeRow * rowH + 4;
        const y1 = (activeRow + 1) * rowH - 4;
        return y1 - (value / activeMax) * (y1 - y0);
    };

    const row = (index, label, color, valueAt, maxValue, fill) => {
        activeRow = index;
        activeMax = Math.max(0.0001, maxValue);
        const y0 = index * rowH + 4;
        const y1 = (index + 1) * rowH - 4;
        g.strokeStyle = gridColor;
        g.beginPath(); g.moveTo(left, y1); g.lineTo(left + chartW, y1); g.stroke();
        g.fillStyle = labelColor;
        g.fillText(label, 4, (y0 + y1) / 2);
        if (fill && currentPoints.length) {
            g.beginPath();
            g.moveTo(left, y1);
            for (const point of currentPoints) g.lineTo(xAt(point), rowY(index, valueAt(point)));
            g.lineTo(left + chartW, y1);
            g.closePath();
            g.fillStyle = fill;
            g.fill();
        }
        if (baseline) line(baselinePoints, valueAt, color, { dashed: true, alpha: 0.48 });
        line(currentPoints, valueAt, color);
    };

    row(0, 'biomass', accent, (p) => p.biomass, maxB, 'rgba(0,114,178,0.10)');
    row(1, 'tips/shed', '#009E73', (p) => p.tips, maxT, null);
    activeRow = 1;
    activeMax = Math.max(0.0001, maxT);
    line(currentPoints, (p) => p.shed, '#D55E00');
    if (baseline) line(baselinePoints, (p) => p.shed, '#D55E00', { dashed: true, alpha: 0.48 });
    row(2, 'light', '#E69F00', (p) => p.light, maxL, null);
    row(3, 'height', '#56B4E9', (p) => p.height, maxH, null);
    row(4, 'crown', '#CC79A7', (p) => p.crownWidth, maxW, null);
    row(5, 'leaf area', '#009E73', (p) => p.leafArea, maxA, null);
    row(6, 'leaf light*', '#AA3377', (p) => p.leafLight, maxLL, null);

    const px = left + (Math.min(time, lifespan) / lifespan) * chartW;
    g.strokeStyle = 'rgba(60,120,220,0.75)';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke();

    if (analyticsHover && analyticsHover.x >= left && analyticsHover.x <= left + chartW) {
        const hoverYear = ((analyticsHover.x - left) / chartW) * lifespan;
        const hoverRow = Math.max(0, Math.min(rows - 1, Math.floor(analyticsHover.y / rowH)));
        const labels = ['biomass', 'tips/shed', 'light', 'height', 'crown', 'leaf area', 'leaf light*'];
        const keys = ['biomass', 'tips', 'light', 'height', 'crownWidth', 'leafArea', 'leafLight'];
        const current = analyticsPointNear(currentPoints, hoverYear);
        const base = baseline ? analyticsPointNear(baselinePoints, hoverYear) : null;
        const key = keys[hoverRow];
        const currentValue = current?.[key];
        const baseValue = base?.[key];
        const lines = [`Year ${hoverYear.toFixed(1)} · ${labels[hoverRow]}`, `current ${formatAnalyticsValue(key, currentValue)}`];
        if (baseline) lines.push(`baseline ${formatAnalyticsValue(key, baseValue)} · ${formatAnalyticsDelta(currentValue, baseValue)}`);
        g.strokeStyle = 'rgba(60,120,220,0.55)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(xAt({ year: hoverYear }), 0); g.lineTo(xAt({ year: hoverYear }), h); g.stroke();
        const boxW = Math.max(...lines.map((text) => g.measureText(text).width)) + 16;
        const boxH = lines.length * 13 + 10;
        let bx = analyticsHover.x + 12;
        if (bx + boxW > w - 6) bx = analyticsHover.x - boxW - 12;
        bx = Math.max(6, bx);
        let by = Math.max(6, analyticsHover.y - boxH - 8);
        if (by + boxH > h - 6) by = h - boxH - 6;
        g.fillStyle = darkChart ? 'rgba(20,24,20,0.94)' : 'rgba(255,253,248,0.97)';
        g.strokeStyle = gridColor;
        g.lineWidth = 1;
        g.fillRect(bx, by, boxW, boxH);
        g.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
        g.fillStyle = labelColor;
        lines.forEach((text, index) => g.fillText(text, bx + 8, by + 11 + index * 13));
    }

    if (baseline) {
        g.fillStyle = labelColor;
        g.fillText('solid current · dashed baseline', left + 4, 9);
    }
    updateAnalyticsSummary();
}


/** Highlight the node selected for inspection. */
function drawSelection(cam) {
    if (selectedNode < 0 || !frame.present[selectedNode]) return;
    const x = cam.toX(frame.px[selectedNode]);
    const y = cam.toY(frame.py[selectedNode]);
    const r = Math.max(5, (frame.radius[selectedNode] || 0.4) * cam.scale * 1.6);
    ctx.save();
    ctx.strokeStyle = '#e6ab02';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
}

/** Draw the subtree that a prune click would remove. */
function drawPruneHover(cam) {
    if (!pruneMode || hoverNode < 0 || !frame.present[hoverNode]) return;
    const mask = subtreeMask(hoverNode);
    if (!mask) return;
    const { px, py, present } = frame;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(225, 65, 55, 0.32)';
    ctx.lineWidth = 5;
    for (let i = hoverNode; i < nodes.length; i++) {
        if (!mask[i] || !present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        if (!present[p]) continue;
        ctx.beginPath();
        ctx.moveTo(cam.toX(px[p]), cam.toY(py[p]));
        ctx.lineTo(cam.toX(px[i]), cam.toY(py[i]));
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(225, 65, 55, 0.9)';
    ctx.lineWidth = 1.5;
    for (let i = hoverNode; i < nodes.length; i++) {
        if (!mask[i] || !present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        if (!present[p]) continue;
        ctx.beginPath();
        ctx.moveTo(cam.toX(px[p]), cam.toY(py[p]));
        ctx.lineTo(cam.toX(px[i]), cam.toY(py[i]));
        ctx.stroke();
    }
    const x = cam.toX(px[hoverNode]);
    const y = cam.toY(py[hoverNode]);
    ctx.fillStyle = '#e14137';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

/** Draw prune markers. */
function drawPruneMarks(cam) {
    if (!pruneMarks.length) return;
    const gt = growthTime(time);
    ctx.save();
    ctx.strokeStyle = '#e14137';
    ctx.lineWidth = 2;
    for (const m of pruneMarks) {
        if (gt < m.birthStep) continue;
        const x = cam.toX(m.x), y = cam.toY(m.y);
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5);
        ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5);
        ctx.stroke();
    }
    ctx.restore();
}

/** Pick the nearest visible segment in screen space. */
function pickNearestNode(e) {
    if (!lastCamera) return -1;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    let best = -1;
    let bestDist = 12;
    const { px, py, present } = frame;
    for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        const x1 = lastCamera.toX(px[p]), y1 = lastCamera.toY(py[p]);
        const x2 = lastCamera.toX(px[i]), y2 = lastCamera.toY(py[i]);
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((sx - x1) * dx + (sy - y1) * dy) / len2));
        const d = Math.hypot(sx - (x1 + t * dx), sy - (y1 + t * dy));
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

/** Snapshot the current cut map so undo/redo can restore an exact set. */
function snapshotCuts() {
    return Array.from(prunedCuts.entries()).map(([key, value]) => [key, Object.assign({}, value)]);
}

function restoreCuts(snapshot) {
    prunedCuts.clear();
    for (const [key, value] of snapshot) prunedCuts.set(key, Object.assign({}, value));
}

function updateCutButtons() {
    if ($('undoCut')) $('undoCut').disabled = cutHistory.length === 0;
    if ($('redoCut')) $('redoCut').disabled = cutFuture.length === 0;
}

function recordCutAction() {
    cutHistory.push(snapshotCuts());
    cutFuture.length = 0;
    updateCutButtons();
}

function resetCutHistory() {
    cutHistory.length = 0;
    cutFuture.length = 0;
    updateCutButtons();
}

function clearHover() {
    hoverNode = -1;
    hoverSubtree = null;
    hoverSubtreeFor = -1;
}

/** Cached forward pass: every node in the hovered node's subtree. */
function subtreeMask(index) {
    if (index < 0 || index >= nodes.length) return null;
    if (hoverSubtree && hoverSubtreeFor === index) return hoverSubtree;
    const mask = new Uint8Array(nodes.length);
    mask[index] = 1;
    for (let i = index + 1; i < nodes.length; i++) {
        if (mask[nodes[i].parent]) mask[i] = 1;
    }
    hoverSubtree = mask;
    hoverSubtreeFor = index;
    return mask;
}

/** Rebuild cut markers from deterministic cut metadata after a simulation. */
function rebuildPruneMarks() {
    pruneMarks.length = 0;
    for (const node of nodes) {
        if (!node.cut || node.cut.step < 0) continue;
        pruneMarks.push({
            x: node.x, y: node.y, z: 0,
            birthStep: node.cut.step,
            type: node.cut.type,
        });
    }
}

function undoCut() {
    if (!cutHistory.length) return;
    cutFuture.push(snapshotCuts());
    restoreCuts(cutHistory.pop());
    clearHover();
    regenerate();
    updateCutButtons();
}

function redoCut() {
    if (!cutFuture.length) return;
    cutHistory.push(snapshotCuts());
    restoreCuts(cutFuture.pop());
    clearHover();
    regenerate();
    updateCutButtons();
}

const BUD_TYPE_NAMES = ['leader', 'scaffold', 'lateral', 'cut regrowth', 'reiteration'];
const FATE_NAMES = ['live', 'shed', 'pruned', 'broken'];

/** Show deterministic node/axis metadata for a picked node. */
function selectNode(index) {
    if (index < 0 || index >= nodes.length) return;
    selectedNode = index;
    const n = nodes[index];
    const el = $('inspector');
    if (!el) return;
    const cut = n.cut ? `${n.cut.type} @ step ${n.cut.step}` : 'none';
    el.innerHTML = `
        <div class="inspect-title">Node ${index} · axis ${n.axisId}</div>
        <div class="inspect-grid">
            <span>order</span><b>${n.axisOrder}</b>
            <span>parent axis</span><b>${n.parentAxisId}</b>
            <span>segment</span><b>${n.segmentIndex}</b>
            <span>path length</span><b>${n.pathLength.toFixed(1)}</b>
            <span>bud / step</span><b>${n.budId} / ${n.birthStep}</b>
            <span>bud type</span><b>${BUD_TYPE_NAMES[n.budType] || n.budType}</b>
            <span>fate</span><b>${FATE_NAMES[n.fate] || n.fate}</b>
            <span>birth light</span><b>${n.birthLight.toFixed(2)}</b>
            <span>current light</span><b>${(n.currentLight ?? n.light).toFixed(2)}</b>
            <span>tortuosity</span><b>${n.tortuosity.toFixed(2)}</b>
            <span>load</span><b>${n.mechanicalLoad.toFixed(1)}</b>
            <span>cut</span><b>${cut}</b>
            <span>position</span><b>${n.x.toFixed(1)}, ${n.y.toFixed(1)}</b>
        </div>`;
    draw();
}

/** Clear the inspected node and any isolation tied to it. */
function clearSelection() {
    const hadSelection = selectedNode >= 0 || isolateNode >= 0;
    selectedNode = -1;
    isolateNode = -1;
    const el = $('inspector');
    if (el) el.textContent = 'Click the tree to inspect a node.';
    clearHover();
    if (hadSelection) draw();
}

function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function beginLasso(event) {
    if (!lassoMode || event.button !== 0) return;
    lassoActive = true;
    lassoPoints = [canvasPoint(event)];
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
}

function updateLasso(event) {
    if (!lassoActive) return;
    const p = canvasPoint(event);
    const last = lassoPoints[lassoPoints.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 2) lassoPoints.push(p);
    draw();
}

function finishLasso(event) {
    if (!lassoActive) return;
    lassoActive = false;
    const points = lassoPoints.slice();
    lassoPoints = [];
    if (points.length < 4 || !lastCamera) { draw(); return; }
    const selected = [];
    for (let i = 1; i < nodes.length; i++) {
        if (!frame.present[i] || !nodes[i].isBranchRoot) continue;
        const x = lastCamera.toX(frame.px[i]);
        const y = lastCamera.toY(frame.py[i]);
        if (pointInPolygon(x, y, points)) selected.push(i);
    }
    if (selected.length) {
        const pruneType = $('pruneType') ? $('pruneType').value : 'thinning';
        recordCutAction();
        for (const i of selected) addPrune(nodes[i].budId, nodes[i].birthStep, pruneType);
        regenerate();
    } else {
        draw();
    }
}

function drawLassoOverlay() {
    if (!lassoActive || lassoPoints.length < 2) return;
    ctx.save();
    ctx.strokeStyle = '#e6ab02';
    ctx.fillStyle = 'rgba(230,171,2,0.12)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
    for (let i = 1; i < lassoPoints.length; i++) ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}


function takeSnapshot2D() {
    computeFrameState();
    const segs = [];
    for (let i = 1; i < nodes.length; i++) {
        if (!frame.present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        segs.push([frame.px[p], frame.py[p], frame.px[i], frame.py[i]]);
    }
    compareSnapshot = { segs, time, nodes: nodes.length, cuts: prunedCuts.size };
    compareMode = true;
    draw();
}

function toggleCompare2D() {
    if (!compareSnapshot) takeSnapshot2D();
    else {
        compareMode = !compareMode;
        draw();
    }
}

function drawCompareGhost2D(cam) {
    if (!compareMode || !compareSnapshot) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(80, 95, 105, 0.32)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (const s of compareSnapshot.segs) {
        ctx.moveTo(cam.toX(s[0]), cam.toY(s[1]));
        ctx.lineTo(cam.toX(s[2]), cam.toY(s[3]));
    }
    ctx.stroke();
    ctx.restore();
}

function toggleIsolation() {
    if (selectedNode < 0) return;
    isolateNode = isolateNode === selectedNode ? -1 : selectedNode;
    draw();
}

function handleCanvasClick(e) {
    if (!lastCamera || lassoMode) return;
    const best = pickNearestNode(e);
    if (!pruneMode) {
        if (!selectionEnabled) return;
        if (best >= 0) selectNode(best);
        else clearSelection();
        return;
    }
    if (best < 0) return;
    const node = nodes[best];
    const pruneType = $('pruneType') ? $('pruneType').value : 'thinning';
    recordCutAction();
    addPrune(node.budId, node.birthStep, pruneType);
    selectedNode = -1;
    clearHover();
    regenerate();
}

/** Update the red subtree ghost while hovering in Prune mode. */
function handleCanvasHover(e) {
    if (!pruneMode) return;
    const best = pickNearestNode(e);
    if (best === hoverNode) return;
    hoverNode = best;
    hoverSubtree = null;
    hoverSubtreeFor = -1;
    draw();
}

function handleCanvasLeave() {
    if (hoverNode < 0) return;
    clearHover();
    draw();
}

function buildSvgMarkupNow(options = {}) {
    const width = Math.max(200, Math.round(options.width || exportSettings.svgWidth || canvas.clientWidth));
    const height = Math.max(200, Math.round(options.height || exportSettings.svgHeight || canvas.clientHeight));
    const state = computeFrameState();
    const bounds = $('zoom').checked ? state : fullBounds;
    const cam = computeCamera(bounds, width, height);
    const seas = currentSeason();
    const gt = growthTime(time);
    const parts = [];
    const includeRoots = exportSettings.svgRoots !== false;
    const includeBranches = exportSettings.svgBranches !== false;
    const includeLeaves = exportSettings.svgLeaves !== false;
    const includeBackground = !!exportSettings.svgBackground;
    const lineArt = !!exportSettings.svgLineArt;
    const fg = THEME_ROOT.dataset.theme === 'dark' ? '#e7e9e2' : '#2f352e';
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-dpi="${exportSettings.svgDpi || 96}" role="img" aria-label="Parametric tree at ${Math.round(time)} years">`);
    parts.push(`<title>Parametric tree — ${Math.round(time)} years</title>`);
    parts.push(`<desc>Seed ${seed}, ${P.trees} tree(s), ${activePreset}, ${Math.round(time)} years.</desc>`);
    parts.push(`<metadata>${escapeXml(JSON.stringify({
        seed,
        age: time,
        season,
        preset: activePreset,
        dimension: '2d',
        settings: exportSettings,
    }))}</metadata>`);
    if (includeBackground) {
        const css = getComputedStyle(THEME_ROOT);
        parts.push(`<rect width="100%" height="100%" fill="${css.getPropertyValue('--bg')}"/>`);
    }

    const { px, py, radius, childCount, present } = frame;

    // Roots are part of the tree; overlays, ground, and prune markers are not.
    if (includeRoots) for (const r of rootSystem) {
        const x0 = cam.toX(r.x0), y0 = cam.toY(r.y0);
        const x1 = cam.toX(r.x1), y1 = cam.toY(r.y1);
        const w0 = Math.max(0.4, r.w0 * cam.scale);
        const w1 = Math.max(0.3, r.w1 * cam.scale);
        let dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const pts = [
            `${x0 - dy * w0},${y0 + dx * w0}`,
            `${x0 + dy * w0},${y0 - dx * w0}`,
            `${x1 + dy * w1},${y1 - dx * w1}`,
            `${x1 - dy * w1},${y1 + dx * w1}`,
        ].join(' ');
        parts.push(`<polygon points="${pts}" fill="rgba(67,45,28,0.92)"/>`);
    }

    if (includeBranches) for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        const x0 = cam.toX(px[p] + windOffset2D(nodes[p])), y0 = cam.toY(py[p]);
        const x1 = cam.toX(px[i] + windOffset2D(nodes[i])), y1 = cam.toY(py[i]);
        const traits = (treeTraits && treeTraits[nodes[i].tree]) || P;
        const flare = nodes[i].order === 0 ? 1 + (traits.rootFlare || 0.6) * Math.exp(Math.min(0, py[i]) / 8) : 1;
        const w0 = Math.max(0.5, radius[p] * cam.scale * flare);
        const w1 = Math.max(0.5, radius[i] * cam.scale);
        let dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const color = segmentColor(i);
        const pts = [
            `${x0 - dy * w0},${y0 + dx * w0}`,
            `${x0 + dy * w0},${y0 - dx * w0}`,
            `${x1 + dy * w1},${y1 - dx * w1}`,
            `${x1 - dy * w1},${y1 + dx * w1}`,
        ].join(' ');
        if (lineArt) {
            parts.push(`<polygon points="${pts}" fill="none" stroke="#3a2a1d" stroke-width="1"/>`);
        } else {
            parts.push(`<polygon points="${pts}" fill="${color}"/>`);
            parts.push(`<circle cx="${x1}" cy="${y1}" r="${w1}" fill="${color}"/>`);
        }
    }

    if (includeLeaves) for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        const node = nodes[i];
        const age = gt - node.birth;
        const traits = (treeTraits && treeTraits[node.tree]) || P;
        const density = (traits.leaves ?? RP.leaves) * (childCount[i] === 0 ? 1.4 : 0.6) * qualityLeafFactor();
        if (age < 0.8 || gt >= node.death || radius[i] > R0 * 2.4 || noise(i, 1) > density) continue;
        const size = Math.min(1, (age - 0.8) / 2) * LEAF;
        const rx = Math.max(1.2, size * cam.scale);
        const leafCount = leafCountForShape(traits.leafShape);
        for (let k = 0; k < leafCount; k++) {
            const style = leafStyle(seas, i, k, node);
            if (!style) continue;
            const a = noise(i, 2 + k) * Math.PI * 2;
            const x = cam.toX(px[i] + windOffset2D(node) + Math.cos(a) * LEAF * 0.08);
            const y = cam.toY(py[i] + Math.sin(a) * LEAF * 0.08);
            const r = Math.max(1, rx * style.scale);
            const ry = style.flower ? Math.max(0.9, r * 0.85) : Math.max(0.6, r * 0.55);
            const fill = `hsla(${style.h},${style.s}%,${style.l}%,${style.alpha ?? 0.86})`;
            const rotate = `rotate(${a * 180 / Math.PI} ${x} ${y})`;
            if (style.shape === 'pine') {
                for (let needle = -1; needle <= 1; needle++) {
                    const y0 = y + needle * ry * 0.65, y1 = y + needle * ry * 0.2;
                    parts.push(`<line x1="${x}" y1="${y0}" x2="${x + Math.cos(a) * r * 1.45}" y2="${y1 + Math.sin(a) * r * 1.45}" stroke="${fill}" stroke-width="${Math.max(0.8, ry * 1.5)}"/>`);
                }
            } else if (style.shape === 'willow') {
                parts.push(`<ellipse cx="${x + Math.cos(a) * r * 0.55}" cy="${y + Math.sin(a) * r * 0.55}" rx="${r * 1.35}" ry="${Math.max(0.8, ry * 0.28)}" transform="${rotate}" fill="${fill}"/>`);
            } else if (style.shape === 'oak') {
                parts.push(`<ellipse cx="${x}" cy="${y}" rx="${r * 0.75}" ry="${ry}" transform="${rotate}" fill="${fill}"/>`);
                parts.push(`<circle cx="${x + Math.cos(a) * r * 0.2 - Math.sin(a) * ry * 0.55}" cy="${y + Math.sin(a) * r * 0.2 + Math.cos(a) * ry * 0.55}" r="${r * 0.55}" fill="${fill}"/>`);
                parts.push(`<circle cx="${x + Math.cos(a) * r * 0.2 + Math.sin(a) * ry * 0.55}" cy="${y + Math.sin(a) * r * 0.2 - Math.cos(a) * ry * 0.55}" r="${r * 0.55}" fill="${fill}"/>`);
            } else if (style.shape === 'cherry') {
                parts.push(`<ellipse cx="${x}" cy="${y}" rx="${r * 0.95}" ry="${ry}" transform="${rotate}" fill="${fill}"/>`);
                parts.push(`<circle cx="${x + Math.cos(a) * r * 1.35}" cy="${y + Math.sin(a) * r * 1.35}" r="${Math.max(0.7, ry * 0.18)}" fill="${fill}"/>`);
            } else {
                parts.push(`<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${ry}" transform="${rotate}" fill="${fill}"/>`);
            }
        }
    }

    if (exportSettings.svgAnnotations) {
        parts.push(`<g font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="12" fill="${fg}">`);
        parts.push(`<text x="14" y="22">Seed ${seed} · ${Math.round(time)} years · ${escapeXml(activePreset || 'custom')}</text>`);
        parts.push(`<text x="14" y="39">${P.trees} tree${P.trees === 1 ? '' : 's'} · season ${season.toFixed(2)}</text>`);
        parts.push('</g>');
    }
    if (exportSettings.svgScaleBar) {
        const candidates = [1, 2, 5, 10, 20, 50, 100];
        const target = Math.min(160, Math.max(48, width * 0.16));
        let metres = candidates[candidates.length - 1];
        for (const candidate of candidates) {
            if (candidate * cam.scale >= target) { metres = candidate; break; }
        }
        const bar = metres * cam.scale;
        const x0 = 16;
        const y0 = height - 18;
        parts.push(`<g font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" font-size="11" fill="${fg}">`);
        parts.push(`<line x1="${x0}" y1="${y0}" x2="${x0 + bar}" y2="${y0}" stroke="${fg}" stroke-width="2"/>`);
        parts.push(`<line x1="${x0}" y1="${y0 - 4}" x2="${x0}" y2="${y0 + 4}" stroke="${fg}" stroke-width="1"/>`);
        parts.push(`<line x1="${x0 + bar}" y1="${y0 - 4}" x2="${x0 + bar}" y2="${y0 + 4}" stroke="${fg}" stroke-width="1"/>`);
        parts.push(`<text x="${x0}" y="${y0 - 8}">${metres} m</text>`);
        parts.push('</g>');
    }
    parts.push('</svg>');
    return parts.join('');
}

function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    }[character]));
}

function buildSvgMarkup(options = {}) {
    const previousTime = time;
    try {
        if (options.age != null) {
            time = options.age;
            computeFrameState();
        }
        return buildSvgMarkupNow(options);
    } finally {
        if (options.age != null) {
            time = previousTime;
            computeFrameState();
        }
    }
}

/** Export the current visible tree as a vector SVG. */
function exportSvg() {
    const markup = buildSvgMarkup({ age: time });
    const blob = new Blob([markup], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parametric-tree-${Math.round(time)}y.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Build the per-step analytics table as CSV, including baseline deltas when pinned. */
function buildAnalyticsCsv() {
    if (!analytics) return '';
    const baseHeader = 'year,biomass,tips,shed,light,height,crownWidth,leafArea,leafLight,crownRatio,trunkVolume,branchVolume,canopyClosure,carbon';
    const formatPoint = (p) => [
        p.year.toFixed(2),
        p.biomass.toFixed(3),
        p.tips,
        p.shed,
        p.light.toFixed(4),
        p.height.toFixed(2),
        p.crownWidth.toFixed(2),
        p.leafArea.toFixed(2),
        p.leafLight.toFixed(4),
        p.crownRatio.toFixed(4),
        p.trunkVolume.toFixed(3),
        p.branchVolume.toFixed(3),
        p.canopyClosure.toFixed(4),
        p.carbon.toFixed(3),
    ];
    const baselinePoints = analyticsBaseline?.points || [];
    const compareHeader = ANALYTICS_COMPARE_KEYS
        .flatMap((key) => [`baseline_${key}`, `delta_${key}`])
        .join(',');
    const header = baselinePoints.length ? `${baseHeader},${compareHeader}` : baseHeader;
    const rows = analytics.points.map((point) => {
        const base = analyticsPointNear(baselinePoints, point.year);
        const values = formatPoint(point);
        if (!base) return values.join(',');
        for (const key of ANALYTICS_COMPARE_KEYS) {
            values.push(Number.isFinite(base[key]) ? base[key] : '');
            values.push(Number.isFinite(point[key]) && Number.isFinite(base[key])
                ? point[key] - base[key]
                : '');
        }
        return values.join(',');
    });
    return [header, ...rows].join('\n');
}

/** Export the per-step analytics table as CSV. */
function exportAnalyticsCsv() {
    const csv = buildAnalyticsCsv();
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parametric-tree-analytics-seed-${seed}${analyticsBaseline?.points?.length ? '-compare' : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBatchZip() {
    const wasPlaying = playing;
    const liveTime = time;
    if (playing) {
        playing = false;
        if ($('play')) $('play').textContent = 'Play';
    }
    try {
        const stateJson = stateToJson(captureAppState());
        const ages = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(fraction * timeEnd()));
        const files = [];
        for (const age of ages) {
            files.push({
                name: `frames/tree-${age}y.svg`,
                data: buildSvgMarkup({
                    age,
                    width: exportSettings.svgWidth,
                    height: exportSettings.svgHeight,
                }),
            });
        }
        files.push({ name: 'current.svg', data: buildSvgMarkup({ age: liveTime }) });
        const csv = buildAnalyticsCsv();
        if (csv) files.push({ name: 'analytics.csv', data: csv });
        files.push({ name: 'state.json', data: stateJson });
        const manifest = {
            format: 'parametric-tree-batch',
            version: 1,
            generated: new Date().toISOString(),
            dimension: DIMENSION,
            seed,
            preset: activePreset,
            age: liveTime,
            season,
            lifespan: timeEnd(),
            settings: Object.assign({}, exportSettings),
            files: files.map((file) => file.name),
        };
        files.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
        downloadBlob(`parametric-tree-batch-${seed}.zip`, createZipBlob(files));
        showToast(`Batch ZIP exported (${files.length} files)`);
    } catch (error) {
        showToast(`Batch export failed: ${error.message || error}`);
    } finally {
        time = liveTime;
        if ($('time')) $('time').value = liveTime;
        draw();
        if (wasPlaying) setPlaying(true);
    }
}

function captureAppState() {
    return captureTreeState({
        dimension: DIMENSION,
        seed,
        P,
        time,
        season,
        seasonAuto,
        automation,
        activePreset,
        exportSettings: Object.assign({}, exportSettings),
        camera: null,
    });
}

function scheduleStateAutosave() {
    if (!appVisible || suppressAutosave) return;
    if (applyingRemote) return;
    if (APP_BUS && window.__TREE_APP_BOOTING__) return;
    if (APP_BUS) APP_BUS.noteLocalChange(DIMENSION);
    if (LINKED_MODE) {
        if (applyingRemote) return;
        if (autosaveTimer) clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
            autosaveTimer = 0;
            if (!applyingRemote && !playing) {
                const state = captureAppState();
                if (APP_BUS && !window.__TREE_APP_BOOTING__) saveTreeStateLocal(DIMENSION, state);
                postLinkedMessage({ type: 'tree-state', state });
            }
        }, 400);
        return;
    }
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        autosaveTimer = 0;
        saveTreeStateLocal(DIMENSION, captureAppState());
    }, 400);
}

function postLinkedPatch(patch) {
    if (LINKED_MODE && !applyingRemote) {
        postLinkedMessage({ type: 'tree-patch', patch });
    }
}

function restoreAppState(state, options = {}) {
    if (!state) return;
    if (state.dimension && state.dimension !== DIMENSION && !LINKED_MODE) {
        const url = new URL(window.location.href);
        url.searchParams.set('state', encodeTreeState(state));
        window.location.href = `../3d-prototype/3d-prototype.html${url.search}`;
        return;
    }
    applyTreeStateParams(state, P);
    setSeedValue(state.seed ?? seed);
    time = Math.min(timeEnd(), Math.max(0, state.time ?? time));
    season = state.season ?? season;
    seasonAuto = !!state.seasonAuto;
    automation = normalizeAutomation(state.automation);
    setSimulationAutomation(automation);
    if ($('seasonAuto')) $('seasonAuto').checked = seasonAuto;
    activePreset = state.activePreset || 'custom';

    if (state.exportSettings) Object.assign(exportSettings, state.exportSettings);
    syncExportSettingsUI();

    clearHover();

    syncParamInputs();
    updateEnvUI();
    updateLifespanUI();
    updateSeasonLabel();
    setActivePreset(activePreset);
    $('seedv').textContent = 'seed ' + seed;
    regenerate();
    if (!options.skipAutosave) scheduleStateAutosave();
}

function exportStateJson() {
    downloadTextFile(
        `parametric-tree-2d-seed-${seed}.json`,
        stateToJson(captureAppState())
    );
}

async function loadStateFile(file) {
    if (!file) return;
    try {
        const text = await readTextFile(file);
        restoreAppState(stateFromJson(text));
    } catch (error) {
        showToast(`Could not load state: ${error.message}`);
    }
}

async function copyShareLink() {
    const link = treeShareUrl(window.location, captureAppState());
    try {
        await navigator.clipboard.writeText(link);
        showToast('Share link copied');
    } catch {
        prompt('Copy this share link:', link);
    }
}

function exportPng() {
    const scale = exportSettings.pngScale || 2;
    const out = document.createElement('canvas');
    out.width = Math.max(1, canvas.width * scale);
    out.height = Math.max(1, canvas.height * scale);
    const g = out.getContext('2d');
    g.drawImage(canvas, 0, 0, out.width, out.height);
    out.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `parametric-tree-2d-${Math.round(time)}y.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
}

function stageName(t) {
    if (t < 1) return 'Seed';
    if (t < 5) return 'Seedling';
    if (t < 20) return 'Sapling';
    if (t < 80) return 'Young tree';
    return 'Mature tree';
}

function updateStats(state) {
    $('stage').innerHTML = `<b>${stageName(time)}</b> · year ${Math.min(P.lifespan, time).toFixed(1)}`;
    const cap = nodes.length >= MAX_NODES ? ' · node cap' : '';
    $('st1').textContent = `height ${(-state.minY / 10).toFixed(1)} m · ${state.segments} segments · ${state.tips} tips${cap}`;
}

/** Render one frame at the current `time`. */
function draw() {
    if (!appVisible) return;
    refreshRenderParams();
    updateDayNight();
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const state = computeFrameState();
    const bounds = $('zoom').checked ? state : fullBounds;
    const cam = computeCamera(bounds, width, height);
    lastCamera = cam;

    drawBackground(cam, width, height);
    drawContactShadows2D(cam);
    drawCompareGhost2D(cam);
    drawObstacle(cam);
    drawRoots(cam);
    drawGroundDetail(cam);
    drawLightGridOverlay(cam);
    drawShedOverlay(cam);
    drawSeed(cam);
    drawBranches(cam);
    drawCutWounds(cam);
    drawLeaves(cam);   // after branches so leaves sit on top
    drawPruneHover(cam);
    drawPruneMarks(cam);
    drawSelection(cam);
    drawLassoOverlay();
    drawSkeletonOverlay(cam);
    drawTropismOverlay(cam);
    updateStats(state);
    updateLegend();
    updateSeasonLabel();
    drawAnalytics();
    scheduleStateAutosave();
}

/** Match the canvas backing store to its CSS size and device pixel ratio. */
function resizeCanvas() {
    if (!appVisible) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const previousSuppress = suppressAutosave;
    suppressAutosave = true;
    try {
        draw();
    } finally {
        suppressAutosave = previousSuppress;
    }
}

/** Suspend hidden panes and catch them up when they are shown again. */
function setVisible(visible) {
    const next = !!visible;
    if (next === appVisible) {
        if (next && pendingRegenerate) regenerate();
        return;
    }
    appVisible = next;
    if (!appVisible) {
        if (playing) setPlaying(false);
        if (autosaveTimer) {
            clearTimeout(autosaveTimer);
            autosaveTimer = 0;
        }
        return;
    }
    const previousSuppress = suppressAutosave;
    suppressAutosave = true;
    try {
        if (pendingRegenerate) regenerate();
        else resizeCanvas();
    } finally {
        suppressAutosave = previousSuppress;
    }
}

/* ==========================================================================
   ! 5. PLAYBACK AND UI
   ========================================================================== */

/** Debounced regeneration so long simulations stay responsive while dragging. */
let regenTimer = 0;
function scheduleRegenerate() {
    if (regenTimer) clearTimeout(regenTimer);
    regenTimer = setTimeout(() => {
        regenTimer = 0;
        regenerate();
    }, 50);
}

/** Sync the lifespan control, time slider range and clamped time. */
function updateLifespanUI() {
    if ($('lifespan')) $('lifespan').value = P.lifespan;
    if ($('lifespanLabel')) $('lifespanLabel').textContent = P.lifespan + ' years';
    const slider = $('time');
    if (slider) {
        slider.max = String(timeEnd());
        if (time > timeEnd()) time = timeEnd();
        slider.value = time;
    }
}

/** Change the simulated lifespan and schedule a rebuild. */
function setLifespan(v) {
    P.lifespan = Math.max(10, Math.round(+v || 300));
    if (time > timeEnd()) time = timeEnd();
    clearHover();
    updateLifespanUI();
    scheduleRegenerate();
}

function setTime(v) {
    time = v;
    $('time').value = v;
    draw();
    postLinkedPatch({ time, season, seasonAuto });
}

/** Backward-compatible simulation progress events for the studio dock. */
function notifySimulateStart() {
    window.dispatchEvent(new CustomEvent('tree-simulate-start', { detail: { dimension: DIMENSION } }));
}

function notifySimulateEnd() {
    window.dispatchEvent(new CustomEvent('tree-simulate-end', { detail: { dimension: DIMENSION } }));
}

/** Re-run the simulation (after a parameter or seed change) and redraw. */
function regenerate() {
    setSimulationAutomation(automation);
    if (!appVisible) {
        pendingRegenerate = true;
        return;
    }
    pendingRegenerate = false;
    notifySimulateStart();
    try {
        simulate();
    } finally {
        notifySimulateEnd();
    }
    $('seedv').textContent = 'seed ' + seed;
    draw();
}

function setPlaying(on) {
    playing = on;
    $('play').textContent = on ? 'Pause' : 'Play';
    if (LINKED_MODE && !applyingRemote) {
        postLinkedMessage({ type: 'tree-play', playing: on });
    }
}

function tick(ts) {
    if (!playing || !appVisible) return;
    const dt = Math.min(0.1, (ts - lastFrameTs) / 1000); // clamp to survive tab switches
    lastFrameTs = ts;
    time += dt * P.speed;
    if (time >= timeEnd()) { time = timeEnd(); setPlaying(false); }
    $('time').value = time;
    draw();
    postLinkedPatch({ time });
    if (playing) requestAnimationFrame(tick);
}

function restartTimeline() {
    setTime(0);
    if (playing) {
        lastFrameTs = performance.now();
    } else {
        togglePlay();
    }
}

function togglePlay() {
    if (playing) { setPlaying(false); return; }
    if (time >= timeEnd()) time = 0;       // replay from the start
    setPlaying(true);
    lastFrameTs = performance.now();
    requestAnimationFrame(tick);
}

/** Slider DOM references, so presets can push values back into the UI. */
const paramInputs = {};

function automationKeyForControl(id, node) {
    if (id && AUTOMATION_META[id]) return id;
    const pk = node?.closest?.('[data-param-key]')?.dataset?.paramKey;
    if (pk && AUTOMATION_META[pk]) return pk;
    return null;
}

function upsertAutomationKey(key, year, value) {
    if (!AUTOMATION_META[key]) return;
    const tr = automation.tracks[key];
    if (tr && tr.type === 'sine') return;
    if (!automation.tracks[key]) {
        automation.tracks[key] = normalizeTrack(key, { keys: [[year, value]], interp: 'smooth', loop: 'none' });
    } else {
        const track = automation.tracks[key];
        const idx = track.keys.findIndex((k) => Math.abs(k[0] - year) < 0.5);
        if (idx >= 0) track.keys[idx] = [year, value];
        else track.keys.push([year, value]);
        track.keys.sort((a, b) => a[0] - b[0]);
    }
}

function applyAutomationChange({ regenerate = null } = {}) {
    setSimulationAutomation(automation);
    scheduleStateAutosave();
    // Keep the base slider in sync with a sine track's center value.
    for (const [k, track] of Object.entries(automation.tracks || {})) {
        if (track && track.type === 'sine' && Number.isFinite(track.offset) && (k in P)) {
            P[k] = track.offset;
        }
    }
    syncParamInputs();
    try { updateEnvUI(); } catch (e) {}
    try { window.__paramInputsWind = !!paramInputs.wind; } catch (e) {}
    const needsRegen = regenerate !== null ? regenerate : hasGrowthTracks(automation);
    if (needsRegen) scheduleRegenerate(); else draw();
}

function automationOptions(key, input) {
    return {
        meta: AUTOMATION_META[key],
        getTrack: () => automation.tracks[key] || null,
        getTime: () => time,
        getLifespan: () => P.lifespan,
        getValue: () => {
            const track = automation.tracks[key];
            return (track && automation.enabled) ? evaluateTrack(track, time, P[key], P.lifespan) : P[key];
        },
        onToggleTrack: (on) => {
            if (on) {
                automation.tracks[key] = normalizeTrack(key, { keys: [[time, P[key]]], interp: 'smooth', loop: 'none' });
            } else {
                delete automation.tracks[key];
            }
            applyAutomationChange();
        },
        onSetSine: (amp, offset, period) => {
            const meta = AUTOMATION_META[key];
            const range = (Number.isFinite(meta.max) && Number.isFinite(meta.min)) ? (meta.max - meta.min) : 1;
            const a = Number.isFinite(amp) ? amp : range * 0.1;
            const o = Number.isFinite(offset) ? offset : P[key];
            const p = Number.isFinite(period) && period > 0 ? period : null;
            automation.tracks[key] = normalizeTrack(key, { type: 'sine', amp: a, offset: o, period: p });
            if (automation.tracks[key]) {
                P[key] = automation.tracks[key].offset;
                syncParamInputs();
            }
            applyAutomationChange();
        },
        onAddKey: (year, value) => {
            upsertAutomationKey(key, year, value);
            applyAutomationChange({ regenerate: hasGrowthTracks(automation) });
        },
        onUpdateKey: (index, year, value) => {
            const track = automation.tracks[key];
            if (!track) return;
            track.keys[index] = [year, value];
            track.keys.sort((a, b) => a[0] - b[0]);
            applyAutomationChange({ regenerate: hasGrowthTracks(automation) });
        },
        onDeleteKey: (index) => {
            const track = automation.tracks[key];
            if (!track) return;
            track.keys.splice(index, 1);
            if (!track.keys.length) delete automation.tracks[key];
            applyAutomationChange();
        },
        onOptions: (opts) => {
            const track = automation.tracks[key];
            if (!track) return;
            if (opts.interp) track.interp = opts.interp;
            if (opts.loop) track.loop = opts.loop;
            applyAutomationChange();
        },
        onSeek: (year) => { setTime(year); },
        onClear: () => { delete automation.tracks[key]; applyAutomationChange(); },
    };
}

/** Build one labelled slider per entry in PARAM_DEFS. */
function buildParamControls() {
    for (const def of PARAM_DEFS) {
        if (def.scope && def.scope !== 'both' && def.scope !== '2d') continue;
        const { key, label, min, max, step } = def;
        const wrapper = document.createElement('label');
        wrapper.dataset.paramKey = key;
        wrapper.innerHTML =
            `${label}<span>${P[key]}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${P[key]}">`;
        const input = wrapper.querySelector('input');
        const valueSpan = wrapper.querySelector('span');
        paramInputs[key] = { input, valueSpan };
        if (AUTOMATION_META[key]) {
            wrapper.classList.add('has-auto');
            const btn = (typeof AutomationUI !== 'undefined' && AutomationUI.createButton)
                ? AutomationUI.createButton(document, '◆')
                : document.createElement('button');
            btn.className = 'auto-btn';
            btn.type = 'button';
            btn.textContent = '◆';
            btn.title = 'Animate this parameter over time';
            wrapper.appendChild(btn);
            const opts = automationOptions(key, input);
            if (typeof AutomationUI !== 'undefined' && AutomationUI.attach) {
                AutomationUI.attach(btn, key, opts);
            }
        }
        input.oninput = (e) => {
            P[key] = +e.target.value;
            valueSpan.textContent = P[key];
            if (automation.enabled && automation.tracks[key]) {
                const tr = automation.tracks[key];
                if (tr && tr.type === 'sine') {
                    tr.offset = P[key];
                    if (tr.offset != null) {
                        // keep normalized/clamped via re-normalize
                    }
                    automation.tracks[key] = normalizeTrack(key, tr);
                    applyAutomationChange();
                } else {
                    upsertAutomationKey(key, time, P[key]);
                    scheduleStateAutosave();
                }
            }
            if (key !== 'speed' && key !== 'leaves') {
                setActivePreset('custom');
            }
            if (key === 'speed') return;          // playback only
            if (key === 'leaves') draw();         // rendering only
            else scheduleRegenerate();            // affects growth
        };
        $('params').appendChild(wrapper);
    }
}

/** Push current `P` values back into the slider DOM (used by species presets). */
function syncParamInputs() {
    for (const { key } of PARAM_DEFS) {
        const ref = paramInputs[key];
        if (!ref) continue;
        ref.input.value = P[key];
        ref.valueSpan.textContent = P[key];
    }
}

/** Highlight the active species preset button (or Custom). */
function setActivePreset(name) {
    activePreset = name;
    const bar = $('presets');
    if (!bar) return;
    for (const btn of bar.querySelectorAll('button')) {
        btn.classList.toggle('active', btn.dataset.preset === name);
    }
}

/** Apply a species preset: growth params + leaf palette, then regenerate. */
function applyPreset(name) {
    const preset = SPECIES_PRESETS[name];
    if (!preset) return;
    for (const [key, value] of Object.entries(preset)) {
        if (key === 'label') continue;
        if (key === 'palette') { leafPalette = value; continue; }
        if (key === 'phenology') {
            P.phenology = Object.assign({}, BASE_PARAMS.phenology, value);
            continue;
        }
        if (key === 'angleOrderBias') {
            P.angleOrderBias = value.slice();
            continue;
        }
        if (key in P) P[key] = value;
    }
    P.speciesMix = 'current';
    if ($('speciesMix')) $('speciesMix').value = 'current';
    syncParamInputs();
    setActivePreset(name);
    clearHover();
    regenerate();
    updateSeasonLabel();
}

/** Build the species preset buttons from SPECIES_PRESETS. */
function buildPresetControls() {
    const bar = $('presets');
    if (!bar) return;
    for (const [name, preset] of Object.entries(SPECIES_PRESETS)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.preset = name;
        btn.textContent = preset.label;
        btn.onclick = () => applyPreset(name);
        bar.appendChild(btn);
    }
    const custom = document.createElement('button');
    custom.type = 'button';
    custom.dataset.preset = 'custom';
    custom.textContent = 'Custom';
    custom.onclick = () => setActivePreset('custom');
    bar.appendChild(custom);
    setActivePreset(activePreset);
}

function updateSeasonLabel() {
    const label = $('seasonLabel');
    if (label) label.textContent = seasonName(currentSeason());
    if ($('season') && !seasonAuto) $('season').value = season;
}

/** Sync the environment controls with `P`. */
function updateEnvUI() {
    if ($('sunAngle')) $('sunAngle').value = P.sunAngle;
    if ($('sunLabel')) $('sunLabel').textContent = P.sunAngle + '°';
    if ($('wind')) $('wind').value = P.wind;
    if ($('windLabel')) $('windLabel').textContent = P.wind.toFixed(2);
    if ($('obstacle')) $('obstacle').value = String(P.obstacle);
    if ($('obstacleSize')) $('obstacleSize').value = P.obstacleSize;
    if ($('obstacleLabel')) $('obstacleLabel').textContent = P.obstacleSize;
    if ($('trees')) $('trees').value = String(P.trees);
    if ($('solarModel')) $('solarModel').checked = P.solarModel;
    if ($('latitude')) $('latitude').value = P.latitude;
    if ($('latitudeLabel')) $('latitudeLabel').textContent = P.latitude + '°';
    if ($('dayOfYear')) $('dayOfYear').value = P.dayOfYear;
    if ($('dayLabel')) $('dayLabel').textContent = P.dayOfYear;
    if ($('hour')) $('hour').value = P.hour;
    if ($('hourLabel')) $('hourLabel').textContent = P.hour.toFixed(1);
    if ($('skyPreset')) $('skyPreset').value = P.skyPreset;
    if ($('sunSamples')) $('sunSamples').value = String(P.sunSamples);
    if ($('windDirection')) $('windDirection').value = P.windDirection;
    if ($('windDirLabel')) $('windDirLabel').textContent = P.windDirection + '°';
    if ($('gustAmp')) $('gustAmp').value = P.gustAmp;
    if ($('gustLabel')) $('gustLabel').textContent = P.gustAmp.toFixed(2);
    if ($('speciesMix')) $('speciesMix').value = P.speciesMix;
    if ($('spacing')) $('spacing').value = P.spacing;
    if ($('spacingLabel')) $('spacingLabel').textContent = P.spacing;
    if ($('ageMix')) $('ageMix').value = P.ageMix;
    if ($('ageMixLabel')) $('ageMixLabel').textContent = P.ageMix.toFixed(2);
    if ($('crownShyness')) $('crownShyness').value = P.crownShyness;
    if ($('crownShyLabel')) $('crownShyLabel').textContent = P.crownShyness.toFixed(2);
    if ($('slope')) $('slope').value = P.slope;
    if ($('slopeLabel')) $('slopeLabel').textContent = P.slope + '°';
    if ($('aspect')) $('aspect').value = P.aspect;
    if ($('aspectLabel')) $('aspectLabel').textContent = P.aspect + '°';
    if ($('soilMoisture')) $('soilMoisture').value = P.soilMoisture;
    if ($('soilLabel')) $('soilLabel').textContent = P.soilMoisture.toFixed(2);
    if ($('exposure')) $('exposure').value = P.exposure;
    if ($('exposureLabel')) $('exposureLabel').textContent = P.exposure.toFixed(2);
    if ($('fogDensity')) $('fogDensity').value = P.fogDensity;
    if ($('fogLabel')) $('fogLabel').textContent = P.fogDensity.toFixed(4);
    if ($('quality')) $('quality').value = P.quality;
    if ($('reducedMotion')) $('reducedMotion').checked = !!P.reducedMotion;
}


function bindLinkedMode() {
    if (!LINKED_MODE) return;
    const handleMessage = (data) => {
        if (!data || typeof data !== 'object') return;
        if (data.type === 'tree-apply-state' && data.state) {
            applyingRemote = true;
            restoreAppState(data.state, { skipAutosave: true, preserveSelection: true });
            applyingRemote = false;
        } else if (data.type === 'tree-patch' && data.patch) {
            applyingRemote = true;
            if ('season' in data.patch) {
                season = data.patch.season;
                seasonAuto = !!data.patch.seasonAuto;
                updateSeasonLabel();
            }
            if ('time' in data.patch) setTime(data.patch.time);
            else draw();
            applyingRemote = false;
        } else if (data.type === 'tree-play') {
            applyingRemote = true;
            setPlaying(!!data.playing);
            applyingRemote = false;
        } else if (data.type === 'tree-request-state') {
            postLinkedMessage({ type: 'tree-state', state: captureAppState() });
        }
    };
    if (APP_BUS) APP_BUS.subscribe(DIMENSION, (event) => handleMessage(event.data));
    else window.addEventListener('message', (event) => handleMessage(event.data));
    postLinkedMessage({ type: 'tree-ready', state: captureAppState() });
}

function decorateEnvAutomation() {
    const ids = ['sunAngle', 'wind', 'windDirection', 'gustAmp', 'soilMoisture', 'exposure', 'fogDensity', 'hour', 'dayOfYear'];
    for (const id of ids) {
        const input = $(id);
        if (!input) continue;
        const row = input.closest('label');
        if (!row) continue;
        const key = id;
        if (!AUTOMATION_META[key]) continue;
        row.classList.add('has-auto');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'auto-btn';
        btn.textContent = '◆';
        btn.title = 'Animate this parameter over time';
        row.appendChild(btn);
        const opts = automationOptions(key, input);
        if (typeof AutomationUI !== 'undefined' && AutomationUI.attach) {
            AutomationUI.attach(btn, key, opts);
        }
    }
}

/** Expand the standalone canvas to fill the viewport. */
function setCanvasFullscreen(on) {
    if (APP_BUS) return;
    fullscreenActive = !!on;
    document.body.classList.toggle('canvas-fullscreen', fullscreenActive);
    fullscreenUiHidden = false;
    document.body.classList.remove('canvas-ui-hidden');
    if (fullscreenActive && document.activeElement) document.activeElement.blur();
    if ($('fullscreen')) $('fullscreen').setAttribute('aria-pressed', String(fullscreenActive));
    if ($('fullscreenExit')) {
        $('fullscreenExit').textContent = fullscreenActive
            ? `Exit ${DIMENSION.toUpperCase()} fullscreen`
            : 'Exit fullscreen';
    }
    requestAnimationFrame(() => {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
}

function toggleCanvasFullscreen() {
    setCanvasFullscreen(!fullscreenActive);
}

const EXPORT_SETTING_IDS = [
    'svgWidth', 'svgHeight', 'svgDpi', 'svgRoots', 'svgBranches', 'svgLeaves',
    'svgBackground', 'svgLineArt', 'svgAnnotations', 'svgScaleBar', 'pngScale',
    'glbRoots', 'glbLeaves', 'glbMetadata', 'glbAxis', 'glbUnits', 'glbLod',
];
const EXPORT_NUMERIC_KEYS = new Set(['svgWidth', 'svgHeight', 'svgDpi', 'pngScale']);

function syncExportSettingsUI() {
    for (const id of EXPORT_SETTING_IDS) {
        const el = $(id);
        if (!el) continue;
        const value = exportSettings[id];
        if (el.type === 'checkbox') el.checked = !!value;
        else if (el.value !== String(value)) el.value = value;
    }
}

function bindExportControl(id) {
    const el = $(id);
    if (!el || el._exportBound) return;
    el._exportBound = true;
    const eventName = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventName, () => {
        exportSettings[id] = el.type === 'checkbox'
            ? el.checked
            : (EXPORT_NUMERIC_KEYS.has(id) ? +el.value : el.value);
        scheduleStateAutosave();
    });
}

function bindExportSettings() {
    for (const id of EXPORT_SETTING_IDS) bindExportControl(id);
    syncExportSettingsUI();
}

function bindControls() {
    bindExportSettings();
    $('play').onclick = togglePlay;
    $('time').oninput = (e) => setTime(+e.target.value);
    if (!APP_BUS && $('fullscreen')) $('fullscreen').onclick = toggleCanvasFullscreen;
    if (!APP_BUS && $('fullscreenExit')) $('fullscreenExit').onclick = () => setCanvasFullscreen(false);
    $('reseed').onclick = () => {
        setSeedValue(Math.floor(Math.random() * 1e9));
        regenerate();
    };
    $('reset').onclick = () => { setPlaying(false); setTime(0); };
    if ($('exportSvg')) $('exportSvg').onclick = exportSvg;
    if ($('exportPng')) $('exportPng').onclick = exportPng;
    if ($('saveState')) $('saveState').onclick = exportStateJson;
    if ($('loadState')) $('loadState').onclick = () => $('loadStateFile').click();
    if ($('loadStateFile')) $('loadStateFile').onchange = (e) => {
        loadStateFile(e.target.files && e.target.files[0]);
        e.target.value = '';
    };
    if ($('shareState')) $('shareState').onclick = copyShareLink;
    $('zoom').onchange = draw;
    if ($('lifespan')) $('lifespan').oninput = (e) => setLifespan(+e.target.value);
    if ($('sunAngle')) $('sunAngle').oninput = (e) => {
        P.sunAngle = +e.target.value;
        $('sunLabel').textContent = P.sunAngle + '°';
        updateDayNight();
        scheduleRegenerate();
    };
    if ($('wind')) $('wind').oninput = (e) => {
        P.wind = +e.target.value;
        $('windLabel').textContent = P.wind.toFixed(2);
        scheduleRegenerate();
    };
    if ($('obstacle')) $('obstacle').onchange = (e) => {
        P.obstacle = +e.target.value;
        scheduleRegenerate();
    };
    if ($('obstacleSize')) $('obstacleSize').oninput = (e) => {
        P.obstacleSize = +e.target.value;
        $('obstacleLabel').textContent = P.obstacleSize;
        scheduleRegenerate();
    };
    if ($('trees')) $('trees').onchange = (e) => {
        P.trees = +e.target.value;
        scheduleRegenerate();
    };
    if ($('solarModel')) $('solarModel').onchange = (e) => {
        P.solarModel = e.target.checked;
        updateDayNight();
        scheduleRegenerate();
    };
    const bindAdvancedRange = (id, key, labelId, digits = 0, suffix = '') => {
        if (!$(id)) return;
        $(id).oninput = (e) => {
            P[key] = +e.target.value;
            if (labelId && $(labelId)) $(labelId).textContent = P[key].toFixed(digits) + suffix;
            if (key === 'latitude' || key === 'dayOfYear' || key === 'hour') {
                P.solarModel = true;
                if ($('solarModel')) $('solarModel').checked = true;
            }
            updateDayNight();
            scheduleRegenerate();
        };
    };
    bindAdvancedRange('latitude', 'latitude', 'latitudeLabel', 0, '°');
    bindAdvancedRange('dayOfYear', 'dayOfYear', 'dayLabel', 0);
    bindAdvancedRange('hour', 'hour', 'hourLabel', 1);
    bindAdvancedRange('windDirection', 'windDirection', 'windDirLabel', 0, '°');
    bindAdvancedRange('gustAmp', 'gustAmp', 'gustLabel', 2);
    bindAdvancedRange('spacing', 'spacing', 'spacingLabel', 0);
    bindAdvancedRange('ageMix', 'ageMix', 'ageMixLabel', 2);
    bindAdvancedRange('crownShyness', 'crownShyness', 'crownShyLabel', 2);
    bindAdvancedRange('slope', 'slope', 'slopeLabel', 0, '°');
    bindAdvancedRange('aspect', 'aspect', 'aspectLabel', 0, '°');
    bindAdvancedRange('soilMoisture', 'soilMoisture', 'soilLabel', 2);
    bindAdvancedRange('exposure', 'exposure', 'exposureLabel', 2);
    bindAdvancedRange('fogDensity', 'fogDensity', 'fogLabel', 4);
    if ($('quality')) $('quality').onchange = (e) => {
        P.quality = e.target.value;
        scheduleRegenerate();
    };
    if ($('reducedMotion')) $('reducedMotion').onchange = (e) => {
        P.reducedMotion = e.target.checked;
        scheduleRegenerate();
    };
    if ($('skyPreset')) $('skyPreset').onchange = (e) => {
        P.skyPreset = e.target.value;
        updateDayNight();
        scheduleRegenerate();
    };
    if ($('sunSamples')) $('sunSamples').onchange = (e) => {
        P.sunSamples = +e.target.value;
        scheduleRegenerate();
    };
    if ($('speciesMix')) $('speciesMix').onchange = (e) => {
        P.speciesMix = e.target.value;
        scheduleRegenerate();
    };
    if ($('season')) $('season').oninput = (e) => {
        season = +e.target.value;
        seasonAuto = false;
        if ($('seasonAuto')) $('seasonAuto').checked = false;
        updateSeasonLabel();
        draw();
        postLinkedPatch({ season, seasonAuto: false });
    };
    if ($('seasonAuto')) $('seasonAuto').onchange = (e) => {
        seasonAuto = e.target.checked;
        updateSeasonLabel();
        draw();
        postLinkedPatch({ season, seasonAuto });
    };
    window.addEventListener('keydown', (e) => {
        if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
        if (window.__TREE_APP_BUS__) {
            if (window.__TREE_ACTIVE_PANE__ && window.__TREE_ACTIVE_PANE__ !== DIMENSION) return;
            if (e.composedPath().some((node) => node?.id === 'controlHost')) return;
        }
        const key = e.key.toLowerCase();
        if (!APP_BUS && key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            toggleCanvasFullscreen();
            return;
        }
        if (!APP_BUS && fullscreenActive && key === 'escape') {
            setCanvasFullscreen(false);
            return;
        }
        if (!APP_BUS && e.code === 'Space'
            && !e.metaKey && !e.ctrlKey && !e.altKey
            && !(e.target && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName))) {
            e.preventDefault();
            togglePlay();
            return;
        }
        if (!APP_BUS && key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            restartTimeline();
            return;
        }
        if (!APP_BUS && fullscreenActive && key === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            fullscreenUiHidden = !fullscreenUiHidden;
            document.body.classList.toggle('canvas-ui-hidden', fullscreenUiHidden);
            return;
        }
    });
    window.addEventListener('resize', resizeCanvas);
    decorateEnvAutomation();
    window.addEventListener('input', (e) => {
        const el = e.target;
        if (!el || !el.id) return;
        const key = automationKeyForControl(el.id, el);
        if (!key) return;
        if (!automation.enabled || !automation.tracks[key]) return;
        const value = (el.type === 'checkbox') ? (el.checked ? 1 : 0) : +el.value;
        if (!Number.isFinite(value)) return;
        upsertAutomationKey(key, time, value);
        scheduleStateAutosave();
    }, true);
}

/* ==========================================================================
   ! 5b. APP / TEST BRIDGE
   ========================================================================== */

// Read/write surface used by the split-view shell and browser tests.
// Standalone pages keep a small legacy surface for the visual-regression
// harness, which drives the prototype through globals.
if (!APP_BUS) {
    Object.defineProperties(window, {
        P: { get: () => P, configurable: true },
        nodes: { get: () => nodes, configurable: true },
        seed: { get: () => seed, set: (value) => setSeedValue(value), configurable: true },
        time: { get: () => time, set: (value) => { time = value; }, configurable: true },
        season: { get: () => season, set: (value) => { season = value; }, configurable: true },
        seasonAuto: { get: () => seasonAuto, set: (value) => { seasonAuto = !!value; }, configurable: true },
    });
    Object.assign(window, { applyPreset, regenerate, draw });
}

window.__tree2d = {
    get nodes() { return nodes; },
    get rootSystem() { return rootSystem; },
    get time() { return time; },
    get season() { return season; },
    get seed() { return seed; },
    captureState() { return captureAppState(); },
    restoreState(state) { restoreAppState(state, { skipAutosave: true }); },
    setSeed(v) {
        setSeedValue(v);
        regenerate();
    },
    setPreset(name) { applyPreset(name); },
    regenerate() { regenerate(); },
    setTime(v) { setTime(v); },
    setSeason(v) {
        season = v;
        seasonAuto = false;
        if ($('seasonAuto')) $('seasonAuto').checked = false;
        updateSeasonLabel();
        draw();
        postLinkedPatch({ season, seasonAuto: false });
    },
    setSeasonSilent(v) {
        season = v;
        seasonAuto = false;
        updateSeasonLabel();
        draw();
    },
    getAutomation() { return normalizeAutomation(automation); },
    setAutomation(next) {
        automation = normalizeAutomation(next);
        setSimulationAutomation(automation);
        applyAutomationChange({ regenerate: false });
        draw();
    },
    applyAutomation(next) {
        automation = normalizeAutomation(next);
        setSimulationAutomation(automation);
        applyAutomationChange({ regenerate: hasGrowthTracks(automation) });
    },
    resize() { resizeCanvas(); },
    get visible() { return appVisible; },
    setVisible,
    flushState() {
        if (autosaveTimer) {
            clearTimeout(autosaveTimer);
            autosaveTimer = 0;
        }
        const state = captureAppState();
        if (LINKED_MODE && !applyingRemote) {
            saveTreeStateLocal(DIMENSION, state);
            postLinkedMessage({ type: 'tree-state', state });
        }
        return state;
    },
};

/* ==========================================================================
   ! 6. STARTUP
   ========================================================================== */

buildPresetControls();
buildParamControls();
bindControls();
setSimulationAutomation(automation);
updateDayNight();
notifySimulateStart();
simulate();
notifySimulateEnd();
$('seedv').textContent = 'seed ' + seed;
updateLifespanUI();
updateEnvUI();
updateSeasonLabel();
resizeCanvas();

if (!window.__TREE_APP_SKIP_RESTORE__) {
    try {
        const shared = treeStateFromUrl(window.location);
        if (shared) restoreAppState(shared, { skipAutosave: true });
        else {
            const saved = loadTreeStateLocal(DIMENSION);
            if (saved) restoreAppState(saved, { skipAutosave: true });
        }
    } catch (error) {
        console.warn('Could not restore saved tree state:', error);
    }
}
bindLinkedMode();
