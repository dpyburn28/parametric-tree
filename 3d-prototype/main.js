/**
 * Parametric tree growth: 3D rendering and UI (Three.js)
 * ======================================================
 *
 * RENDER (every frame)
 * --------------------
 * Time is only a render parameter. For a given age we derive, from the 3D
 * skeleton in simulation.js, how far each segment has grown, how thick each
 * segment is (pipe model), and which branches have been shed. Scrubbing the
 * age slider therefore never re-runs the simulation.
 *
 * The simulation is imported as an ES module below.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
    treeSpecies,
    prunedCuts,
    fullBounds,
    hashRandom,
    perpBasis,
    CUT_TYPES,
    addPrune,
    clearPrunes,
    sunDir,
    obstacleSpec,
    obstacleSdf,
    LightField,
    simulate,
    setSeedValue,
} from './simulation.js';

/* ==========================================================================
   ! 1. CONFIGURATION
   ========================================================================== */

/** Rendering constants. */
const LEAF = 5.0;             // full-grown leaf size (world units)
const R0 = 0.4;               // radius of a twig tip (world units)
const PN = 2.2;               // pipe-model exponent: r_parent^n = sum(r_child^n)
const AGE_THICKEN_MAX = 3.2; // maximum extra radius from age (world units)
const AGE_THICKEN_TAU = 55;  // years to approach the maximum age thickness
const AGE_FLOOR_PIPE_RATIO = 1.6; // cap the age floor relative to pipe radius
const TRUNK_THICKEN = 1.6;    // trunk thickens faster than branches

const RADIAL_SEGMENTS = 12;   // sides per tapered branch cylinder (clean root flutes)
const RINGS_PER_SEG = 3;      // rings per internode (spline-smoothed tube)
const LEAVES_PER_NODE = 3;    // leaf cards spawned on eligible twig nodes
const MAX_LEAVES = MAX_NODES * LEAVES_PER_NODE;

const FALL_DURATION = 0.8;    // growth years for a shed branch to fall
const FALL_GRAVITY = 900;     // world units per growth-year squared
const MAX_LITTER = 2000;      // ground litter instance cap

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
let lastHoverPick = 0;
const pruneMarks = [];
const cutHistory = [];
const cutFuture = [];
let analytics = null;
let analyticsBaseline = null;
let analyticsCompare = false;
let analyticsHover = null;
let pointerDownPos = null;
const DIMENSION = '3d';
const APP_BUS = window.__TREE_APP_BUS__ || null;
const LINKED_MODE = new URLSearchParams(window.location.search).has('linked') || !!APP_BUS;
let applyingRemote = false;
let fullscreenActive = false;
let fullscreenUiHidden = false;
let autosaveTimer = 0;
let lodLevel = 'near';
let frameTimeAvg = 16;
let autoDrop = false;
let autoSlowFrames = 0;
let autoFastFrames = 0;
let perfHudVisible = false;
let lastAnimateTs = 0;
let branchMotionActive = false;
let leafMotionActive = false;
let motionFrame = 0;
const perf = {
    simulate: 0,
    analytics: 0,
    branchMesh: 0,
    branchMotion: 0,
    leafMotion: 0,
    render: 0,
    frame: 0,
};

/** Approximate world-space area of one rendered 3D leaf card. */
const LEAF_CARD_AREA_3D = 0.5 * LEAF * LEAF;

// Packed visible-segment -> node mapping for click picking.
let visibleSegmentNodes = [];
let branchSegmentCount = 0;
let leafNodeIndices = [];

/** Visualization state (toggled in the UI). */
const viz = {
    colorMode: 'natural', // 'natural' | 'order' | 'light' | 'vigor' | 'pipe'
    skeleton: false,
    lightGrid: false,
    vectors: false,
    shed: false,
    xray: false,
    wireframe: false,
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


const ORDER_COLORS_HEX = [0x7a4924, 0xd95f02, 0xe6ab02, 0x1b9e77, 0x2b8cbe];
const ORDER_COLORS_CSS = ['#7a4924', '#d95f02', '#e6ab02', '#1b9e77', '#2b8cbe'];

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
const lassoCanvas = $('lassoOverlay');

/** Route linked-view messages either to the parent frame or the in-page bus. */
function postLinkedMessage(message) {
    if (!LINKED_MODE) return;
    if (APP_BUS) APP_BUS.post(DIMENSION, message);
    else window.parent.postMessage(message, '*');
}
const lassoCtx = lassoCanvas ? lassoCanvas.getContext('2d') : null;
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const pickVec = new THREE.Vector3();

/* ==========================================================================
   ! 3. RENDERING HELPERS & PER-FRAME STATE
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
 * Day/night follows sun elevation instead of the OS color scheme. The same
 * colors drive the CSS sky, ground materials and light intensities.
 */
function updateDayNight() {
    const sun = environmentSunDirection(P, '3d');
    const elevationDeg = sun.elevation * 180 / Math.PI;
    const t = smoothstep(0, 30, elevationDeg)
        * Math.max(0.35, environmentSky(P).exposure);
    const root = THEME_ROOT;
    root.dataset.theme = t >= 0.45 ? 'light' : 'dark';

    const low = Math.max(0, 1 - Math.abs(t - 0.25) / 0.25);
    let sky1 = mixRgb([10, 16, 28], [191, 224, 240], t);
    let sky2 = mixRgb([22, 32, 44], [246, 240, 220], t);
    sky1 = mixRgb(sky1, [120, 80, 140], low * 0.25);
    sky2 = mixRgb(sky2, [235, 145, 80], low * 0.65);
    const sky = environmentSky(P);
    sky1 = mixRgb(sky1, [150, 155, 165], sky.overcast * 0.6);
    sky2 = mixRgb(sky2, [165, 170, 178], sky.overcast * 0.5);
    if (sky.warmth > 0) sky2 = mixRgb(sky2, [240, 170, 110], sky.warmth * 0.22);
    const soil = mixRgb([28, 20, 14], [107, 80, 57], t);
    const grass = mixRgb([26, 44, 22], [93, 143, 60], t);

    root.style.setProperty('--sky1', rgb(sky1));
    root.style.setProperty('--sky2', rgb(sky2));
    root.style.setProperty('--soil', rgb(soil));
    root.style.setProperty('--grass', rgb(grass));

    hemiLight.intensity = 0.25 + 0.8 * t;
    hemiLight.color.setRGB(sky1[0] / 255, sky1[1] / 255, sky1[2] / 255, THREE.SRGBColorSpace);
    hemiLight.groundColor.setRGB(soil[0] / 255, soil[1] / 255, soil[2] / 255, THREE.SRGBColorSpace);

    sunLight.intensity = 0.12 + 1.33 * t;
    const sunColor = mixRgb([255, 150, 75], [255, 246, 229], smoothstep(0.05, 0.6, t));
    sunLight.color.setRGB(sunColor[0] / 255, sunColor[1] / 255, sunColor[2] / 255, THREE.SRGBColorSpace);
    sunLight.shadow.radius = 4;
    sunLight.shadow.blurSamples = 8;
    renderer.toneMappingExposure = P.exposure ?? 1;
    if (scene.fog) {
        scene.fog.color.setRGB(sky2[0] / 255, sky2[1] / 255, sky2[2] / 255, THREE.SRGBColorSpace);
        scene.fog.density = P.fogDensity ?? 0.0008;
    }
    updateEnvironmentMap(sky1, sky2, grass);
    syncThemeColors();
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
    const waterScale = 0.75 + 0.25 * environmentWaterGain(P);
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

/** Per-frame buffers (reallocated only when the skeleton size changes). */
const frame = {
    px: null, py: null, pz: null,
    radius: null, childCount: null, pipeSum: null, present: null, ageDominated: null,
};

function ensureFrameBuffers(n) {
    if (frame.px && frame.px.length === n) return;
    frame.px = new Float32Array(n);          // current 3D end point of each segment
    frame.py = new Float32Array(n);
    frame.pz = new Float32Array(n);
    frame.radius = new Float32Array(n);      // pipe-model radius
    frame.childCount = new Int16Array(n);    // visible children (0 = tip)
    frame.pipeSum = new Float32Array(n);     // sum of child radius^PN
    frame.present = new Uint8Array(n);       // 1 if the node is visible at `time`
    frame.ageDominated = new Uint8Array(n);  // 1 if ageMin > pure pipe radius
}

/**
 * Derive everything visible at the current `time` from the 3D skeleton:
 * segment end points (growth + retraction), radii (pipe model) and stats.
 */
function computeFrameState() {
    const n = nodes.length;
    ensureFrameBuffers(n);
    const gt = growthTime(time);
    const { px, py, pz, radius, childCount, pipeSum, present, ageDominated } = frame;
    present.fill(0); childCount.fill(0); pipeSum.fill(0); ageDominated.fill(0);

    // Every root (parent < 0) starts visible at its own position.
    for (let i = 0; i < n; i++) {
        if (nodes[i].parent >= 0) continue;
        present[i] = 1;
        px[i] = nodes[i].x;
        py[i] = nodes[i].y;
        pz[i] = nodes[i].z;
    }

    // Forward pass (parents before children): growth progress and 3D positions.
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
            pz[i] = pz[node.parent] + (node.z - parent.z) * progress;
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

    // 3D extent and tip count of what is currently visible.
    let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0, tips = 0;
    for (let i = 0; i < n; i++) {
        if (!present[i]) continue;
        if (childCount[i] === 0) tips++;
        if (px[i] < minX) minX = px[i];
        if (px[i] > maxX) maxX = px[i];
        if (py[i] < minY) minY = py[i];
        if (py[i] > maxY) maxY = py[i];
        if (pz[i] < minZ) minZ = pz[i];
        if (pz[i] > maxZ) maxZ = pz[i];
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, tips, segments };
}

/* ==========================================================================
   ! 4. THREE.JS SCENE & GEOMETRY
   ========================================================================== */

const TEST_MODE = new URLSearchParams(window.location.search).has('test');
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: TEST_MODE,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = P.exposure ?? 1;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbfe0f0, P.fogDensity ?? 0.0008);
const pmremGenerator = new THREE.PMREMGenerator(renderer);
let environmentRT = null;
let environmentKey = '';

function updateEnvironmentMap(sky1, sky2, grass) {
    const key = `${sky1.join(',')}|${sky2.join(',')}|${grass.join(',')}`;
    if (key === environmentKey) return;
    environmentKey = key;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, `rgb(${sky1[0]},${sky1[1]},${sky1[2]})`);
    grad.addColorStop(0.52, `rgb(${sky2[0]},${sky2[1]},${sky2[2]})`);
    grad.addColorStop(0.53, `rgb(${grass[0]},${grass[1]},${grass[2]})`);
    grad.addColorStop(1, `rgb(${grass[0] * 0.6},${grass[1] * 0.6},${grass[2] * 0.6})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (environmentRT) environmentRT.dispose();
    environmentRT = pmremGenerator.fromEquirectangular(tex);
    scene.environment = environmentRT.texture;
    scene.environmentIntensity = 0.45;
    tex.dispose();
}
const clock = new THREE.Clock();

const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 5000);
camera.position.set(180, 120, 240);
const cameraLookAt = new THREE.Vector3(0, 40, 0);
let autoLookAt = true;
let useLookAtForOrbit = true;
let cameraLimitsEnabled = true;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495; // stay above ground
controls.minDistance = 8;
controls.maxDistance = 1200;
controls.target.set(0, 40, 0);
controls.addEventListener('end', () => scheduleStateAutosave());

/** Toggle the orbit distance and ground/polar safety clamps. */
function applyCameraLimits(enabled) {
    cameraLimitsEnabled = !!enabled;
    controls.minDistance = cameraLimitsEnabled ? 8 : 0.01;
    controls.maxDistance = cameraLimitsEnabled ? 1200 : Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = cameraLimitsEnabled ? Math.PI * 0.495 : Math.PI;
    controls.update();
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.5, 0.86);
bloomPass.enabled = false;
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Lighting: warm sun with shadows + sky/ground hemisphere fill.
const hemiLight = new THREE.HemisphereLight(0xdff0ff, 0x6b5039, 0.85);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff6e5, 1.45);
sunLight.position.set(160, 320, 180);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 20;
sunLight.shadow.camera.far = 900;
const shadowExtent = 220;
sunLight.shadow.camera.left = -shadowExtent;
sunLight.shadow.camera.right = shadowExtent;
sunLight.shadow.camera.top = shadowExtent;
sunLight.shadow.camera.bottom = -shadowExtent;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);
scene.add(sunLight.target);

// Terrain: a gently slopeable grass plane with a soil rim below it.
const groundGroup = new THREE.Group();
const grassMat = new THREE.MeshLambertMaterial({ color: 0x5d8f3c, vertexColors: true });
const terrainGeo = new THREE.PlaneGeometry(2000, 2000, 96, 96);
terrainGeo.rotateX(-Math.PI / 2);
terrainGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(terrainGeo.attributes.position.count * 3), 3));
const terrainMesh = new THREE.Mesh(terrainGeo, grassMat);
terrainMesh.receiveShadow = true;
groundGroup.add(terrainMesh);

const soilGeo = new THREE.CylinderGeometry(450, 440, 14, 64);
const soilMat = new THREE.MeshLambertMaterial({ color: 0x6b5039 });
const soilMesh = new THREE.Mesh(soilGeo, soilMat);
soilMesh.position.y = -14;
soilMesh.visible = false; // the sloping terrain is the visible ground surface
groundGroup.add(soilMesh);
scene.add(groundGroup);

function updateTerrain() {
    const pos = terrainGeo.getAttribute('position');
    const colors = terrainGeo.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        pos.setY(i, environmentGroundHeight(P, x, z));

        // Broad low-frequency mottling keeps the flat plane from reading as
        // a single colour, while the root clearings pull the tint toward soil.
        const broad = groundNoise2D(x, z, 501);
        const fine = groundNoise2D(x * 3.1, z * 3.1, 502);
        let dirt = smoothstep(0.56, 0.84, groundNoise2D(x * 1.35, z * 1.35, 503)) * 0.45;
        for (const root of treeRoots || []) {
            const distance = Math.hypot(x - root.x, z - (root.z || 0));
            dirt = Math.max(dirt, 1 - smoothstep(18, 62, distance));
        }
        const shade = 0.68 + broad * 0.38 + fine * 0.1;
        colors.setXYZ(
            i,
            shade * (1 - 0.18 * dirt),
            shade * (1 - 0.34 * dirt),
            shade * (1 - 0.46 * dirt)
        );
    }
    pos.needsUpdate = true;
    colors.needsUpdate = true;
    terrainGeo.computeVertexNormals();
}
updateTerrain();

// Cheap contact shadows: one radial gradient plane per tree.
const contactShadowCanvas = document.createElement('canvas');
contactShadowCanvas.width = 128;
contactShadowCanvas.height = 128;
{
    const g = contactShadowCanvas.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(20,18,14,0.55)');
    grad.addColorStop(0.5, 'rgba(20,18,14,0.22)');
    grad.addColorStop(1, 'rgba(20,18,14,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
}
const contactShadowTex = new THREE.CanvasTexture(contactShadowCanvas);
contactShadowTex.colorSpace = THREE.SRGBColorSpace;
const contactShadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: 0.55,
});
const contactShadowGeo = new THREE.PlaneGeometry(1, 1);
contactShadowGeo.rotateX(-Math.PI / 2);
const contactShadowMeshes = [];
for (let i = 0; i < 7; i++) {
    const mesh = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    mesh.visible = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    contactShadowMeshes.push(mesh);
}

function updateContactShadows() {
    for (let i = 0; i < contactShadowMeshes.length; i++) {
        const mesh = contactShadowMeshes[i];
        const root = treeRoots && treeRoots[i];
        if (!root) { mesh.visible = false; continue; }
        mesh.visible = true;
        const y = (root.y || environmentGroundHeight(P, root.x, root.z || 0)) + 0.06;
        mesh.position.set(root.x, y, root.z || 0);
        const size = 48 + i * 2;
        mesh.scale.set(size, size, size);
    }
}

/** Cheap deterministic value noise for ground mottling and clump masks. */
function groundNoise2D(x, z, salt) {
    const scale = 0.018;
    const fx = x * scale;
    const fz = z * scale;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);
    const a = hashRandom(x0, z0, salt);
    const b = hashRandom(x0 + 1, z0, salt);
    const c = hashRandom(x0, z0 + 1, salt);
    const d = hashRandom(x0 + 1, z0 + 1, salt);
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sz;
}

/** Layered mask that creates clusters and bare patches rather than white noise. */
function groundPatch(x, z) {
    return groundNoise2D(x, z, 301) * 0.68 + groundNoise2D(x * 2.7, z * 2.7, 302) * 0.32;
}

function groundNearRoot(x, z, clearance) {
    for (const root of treeRoots || []) {
        const dx = x - root.x;
        const dz = z - (root.z || 0);
        if (dx * dx + dz * dz < clearance * clearance) return true;
    }
    return false;
}

function groundNearObstacle(x, z) {
    if (!P.obstacle) return false;
    const y = environmentGroundHeight(P, x, z);
    return obstacleSdf(x, y + 2, z) < 3;
}

function groundScatterBounds() {
    const minX = fullBounds?.minX ?? -100;
    const maxX = fullBounds?.maxX ?? 100;
    const minZ = fullBounds?.minZ ?? -100;
    const maxZ = fullBounds?.maxZ ?? 100;
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    return {
        centerX: (minX + maxX) * 0.5,
        centerZ: (minZ + maxZ) * 0.5,
        radius: Math.min(900, Math.max(520, Math.max(spanX, spanZ) * 0.65 + 320)),
    };
}

/** Low-poly grass clump: merged tapered cones read as a solid meadow tuft. */
function createGrassClumpGeometry() {
    const clumps = [];
    for (let i = 0; i < 4; i++) {
        const height = 1.05 + (i % 3) * 0.28;
        const radius = 0.18 + (i % 2) * 0.08;
        const cone = new THREE.ConeGeometry(radius, height, 4, 1, true);
        const angle = i * 2.399;
        const lean = 0.12 + (i % 3) * 0.07;
        cone.rotateZ(Math.cos(angle) * lean);
        cone.rotateX(Math.sin(angle) * lean);
        cone.translate(Math.cos(angle) * 0.3, height * 0.5, Math.sin(angle) * 0.3);
        clumps.push(cone);
    }
    return mergeGeometries(clumps, false);
}

/** A fuller low-poly shrub silhouette from three merged lobes. */
function createShrubGeometry() {
    const lobes = [
        new THREE.IcosahedronGeometry(0.78, 1).translate(0, 0.58, 0),
        new THREE.IcosahedronGeometry(0.58, 1).translate(0.48, 0.38, 0.14),
        new THREE.IcosahedronGeometry(0.5, 1).translate(-0.38, 0.34, -0.18),
    ];
    return mergeGeometries(lobes, false);
}

const GROUND_DETAIL_COUNTS = {
    low: { grass: 1800, pebble: 180, rock: 60, shrub: 24, litter: 180 },
    medium: { grass: 6000, pebble: 520, rock: 190, shrub: 75, litter: 520 },
    high: { grass: 10000, pebble: 1100, rock: 360, shrub: 150, litter: 1000 },
};
const MAX_GROUND_DETAIL = {
    grass: 10000, pebble: 1100, rock: 360, shrub: 150, litter: 1000,
};
let lastGroundScatter = { centerX: 0, centerZ: 0, radius: 0 };

const groundDetailGroup = new THREE.Group();
groundDetailGroup.visible = P.groundDetail !== false;
scene.add(groundDetailGroup);

const grassTuftMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    flatShading: true,
    emissive: 0x18300f,
    emissiveIntensity: 0.55,
});
const grassTuftMesh = new THREE.InstancedMesh(createGrassClumpGeometry(), grassTuftMat, MAX_GROUND_DETAIL.grass);
grassTuftMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
grassTuftMesh.receiveShadow = true;
grassTuftMesh.frustumCulled = false;
grassTuftMesh.count = 0;
groundDetailGroup.add(grassTuftMesh);

const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, MAX_GROUND_DETAIL.rock);
rockMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
rockMesh.castShadow = true;
rockMesh.receiveShadow = true;
rockMesh.frustumCulled = false;
rockMesh.count = 0;
groundDetailGroup.add(rockMesh);

const pebbleGeo = new THREE.IcosahedronGeometry(1, 0);
const pebbleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const pebbleMesh = new THREE.InstancedMesh(pebbleGeo, pebbleMat, MAX_GROUND_DETAIL.pebble);
pebbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
pebbleMesh.receiveShadow = true;
pebbleMesh.frustumCulled = false;
pebbleMesh.count = 0;
groundDetailGroup.add(pebbleMesh);

const shrubGeo = createShrubGeometry();
const shrubMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
const shrubMesh = new THREE.InstancedMesh(shrubGeo, shrubMat, MAX_GROUND_DETAIL.shrub);
shrubMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
shrubMesh.castShadow = true;
shrubMesh.receiveShadow = true;
shrubMesh.frustumCulled = false;
shrubMesh.count = 0;
groundDetailGroup.add(shrubMesh);

const groundLitterGeo = new THREE.CircleGeometry(0.72, 5);
groundLitterGeo.rotateX(-Math.PI / 2);
const groundLitterMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
const groundLitterMesh = new THREE.InstancedMesh(groundLitterGeo, groundLitterMat, MAX_GROUND_DETAIL.litter);
groundLitterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
groundLitterMesh.receiveShadow = true;
groundLitterMesh.frustumCulled = false;
groundLitterMesh.count = 0;
groundDetailGroup.add(groundLitterMesh);

const GROUND_UP = new THREE.Vector3(0, 1, 0);
const groundEuler = new THREE.Euler();

function scatterGroundLayer(target, salt, clearance, patchThreshold, place) {
    const { centerX, centerZ, radius } = lastGroundScatter;
    let placed = 0;
    let attempt = 0;
    const maxAttempts = target * 5;
    while (placed < target && attempt < maxAttempts) {
        attempt++;
        const u = hashRandom(salt, attempt * 3, 401);
        const v = hashRandom(salt, attempt * 3, 402);
        const angle = u * Math.PI * 2;
        const distance = Math.sqrt(v) * radius;
        const x = centerX + Math.cos(angle) * distance;
        const z = centerZ + Math.sin(angle) * distance;
        if (groundNearRoot(x, z, clearance)) continue;
        if (groundNearObstacle(x, z)) continue;
        if (groundPatch(x, z) < patchThreshold) continue;
        if (hashRandom(salt, attempt * 3, 403) > 1 - 0.34 * (distance / radius)) continue;
        place(x, z, distance, placed);
        placed++;
    }
    return placed;
}

function updateGroundDetail() {
    const enabled = P.groundDetail !== false;
    groundDetailGroup.visible = enabled;
    if (!enabled) return;

    const counts = GROUND_DETAIL_COUNTS[P.groundDensity] || GROUND_DETAIL_COUNTS.medium;
    lastGroundScatter = groundScatterBounds();

    const grassCount = scatterGroundLayer(counts.grass, 601, 8, 0.34, (x, z, distance, i) => {
        const y = environmentGroundHeight(P, x, z);
        const r = hashRandom(601, i, 404);
        const s = 2.8 + r * 4.8;
        dummyPos.set(x, y, z);
        dummyQuat.setFromAxisAngle(GROUND_UP, hashRandom(601, i, 405) * Math.PI * 2);
        dummyScale.set(s * 0.86, s, s * 0.86);
        dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
        grassTuftMesh.setMatrixAt(i, dummyMatrix);
        tempColor.setHSL(0.24 + (r - 0.5) * 0.06, 0.55 + r * 0.25, 0.27 + r * 0.14);
        grassTuftMesh.setColorAt(i, tempColor);
    });

    const pebbleCount = scatterGroundLayer(counts.pebble, 701, 7, 0.46, (x, z, distance, i) => {
        const y = environmentGroundHeight(P, x, z);
        const r = hashRandom(701, i, 404);
        const s = 0.28 + r * 0.9;
        groundEuler.set(r * 1.2, hashRandom(701, i, 405) * Math.PI * 2, r * 0.8);
        dummyPos.set(x, y + s * 0.28, z);
        dummyQuat.setFromEuler(groundEuler);
        dummyScale.set(s * (0.8 + r * 0.5), s * (0.45 + r * 0.35), s * (0.7 + r * 0.5));
        dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
        pebbleMesh.setMatrixAt(i, dummyMatrix);
        tempColor.setHSL(0.09 + r * 0.035, 0.06 + r * 0.1, 0.38 + r * 0.18);
        pebbleMesh.setColorAt(i, tempColor);
    });

    const rockCount = scatterGroundLayer(counts.rock, 801, 16, 0.54, (x, z, distance, i) => {
        const y = environmentGroundHeight(P, x, z);
        const r = hashRandom(801, i, 404);
        const s = 1.4 + r * 6.0;
        groundEuler.set(r * 1.4, hashRandom(801, i, 405) * Math.PI * 2, r * 1.1);
        dummyPos.set(x, y + s * 0.3, z);
        dummyQuat.setFromEuler(groundEuler);
        dummyScale.set(s * (0.8 + r * 0.4), s * (0.42 + r * 0.35), s * (0.7 + r * 0.5));
        dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
        rockMesh.setMatrixAt(i, dummyMatrix);
        tempColor.setHSL(0.09 + r * 0.03, 0.07 + r * 0.09, 0.33 + r * 0.2);
        rockMesh.setColorAt(i, tempColor);
    });

    const shrubCount = scatterGroundLayer(counts.shrub, 901, 28, 0.56, (x, z, distance, i) => {
        const y = environmentGroundHeight(P, x, z);
        const r = hashRandom(901, i, 404);
        const s = 3.2 + r * 6.5;
        dummyPos.set(x, y, z);
        dummyQuat.setFromAxisAngle(GROUND_UP, hashRandom(901, i, 405) * Math.PI * 2);
        dummyScale.set(
            s * (0.8 + r * 0.35),
            s * (0.7 + r * 0.4),
            s * (0.8 + r * 0.35)
        );
        dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
        shrubMesh.setMatrixAt(i, dummyMatrix);
        tempColor.setHSL(0.25 + r * 0.07, 0.32 + r * 0.2, 0.22 + r * 0.16);
        shrubMesh.setColorAt(i, tempColor);
    });

    const litterCount = scatterGroundLayer(counts.litter, 1001, 6, 0.4, (x, z, distance, i) => {
        const y = environmentGroundHeight(P, x, z);
        const r = hashRandom(1001, i, 404);
        const s = 1.15 + r * 2.25;
        dummyPos.set(x, y + 0.045, z);
        dummyQuat.setFromAxisAngle(GROUND_UP, hashRandom(1001, i, 405) * Math.PI * 2);
        dummyScale.set(s * (0.7 + r * 0.5), 1, s * (0.7 + r * 0.5));
        dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
        groundLitterMesh.setMatrixAt(i, dummyMatrix);
        const hue = r > 0.62 ? 0.2 + r * 0.05 : 0.07 + r * 0.08;
        tempColor.setHSL(hue, 0.28 + r * 0.3, 0.22 + r * 0.18);
        groundLitterMesh.setColorAt(i, tempColor);
    });

    for (const [mesh, count] of [
        [grassTuftMesh, grassCount],
        [pebbleMesh, pebbleCount],
        [rockMesh, rockCount],
        [shrubMesh, shrubCount],
        [groundLitterMesh, litterCount],
    ]) {
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
}

// Falling snow: render-only particles, excluded from export.
const SNOW_COUNT = 900;
const snowPositions = new Float32Array(SNOW_COUNT * 3);
const snowBaseX = new Float32Array(SNOW_COUNT);
const snowBaseY = new Float32Array(SNOW_COUNT);
const snowBaseZ = new Float32Array(SNOW_COUNT);
const snowSpeed = new Float32Array(SNOW_COUNT);
const snowPhase = new Float32Array(SNOW_COUNT);
for (let i = 0; i < SNOW_COUNT; i++) {
    snowBaseX[i] = (hashRandom(seed, i, 201) - 0.5) * 520;
    snowBaseY[i] = hashRandom(seed, i, 202) * 430;
    snowBaseZ[i] = (hashRandom(seed, i, 203) - 0.5) * 520;
    snowSpeed[i] = 8 + hashRandom(seed, i, 204) * 18;
    snowPhase[i] = hashRandom(seed, i, 205) * Math.PI * 2;
}
const snowGeo = new THREE.BufferGeometry();
const snowAttr = new THREE.BufferAttribute(snowPositions, 3);
snowAttr.setUsage(THREE.DynamicDrawUsage);
snowGeo.setAttribute('position', snowAttr);
snowGeo.setDrawRange(0, SNOW_COUNT);
const snowPoints = new THREE.Points(
    snowGeo,
    new THREE.PointsMaterial({ color: 0xf2f7fa, size: 1.6, transparent: true, opacity: 0.8, depthWrite: false })
);
snowPoints.frustumCulled = false;
snowPoints.visible = false;
scene.add(snowPoints);

function updateSnow() {
    snowPoints.visible = !!P.snow && !P.reducedMotion;
    if (!P.snow || P.reducedMotion) return;
    const t = clock.getElapsedTime();
    const windRad = (P.windDirection || 0) * Math.PI / 180;
    const drift = (P.wind || 0) * 12;
    for (let i = 0; i < SNOW_COUNT; i++) {
        const off = i * 3;
        const y = ((snowBaseY[i] - t * snowSpeed[i]) % 430 + 430) % 430;
        snowPositions[off] = snowBaseX[i] + Math.sin(t * 0.4 + snowPhase[i]) * 10
            + Math.cos(windRad) * drift * t;
        snowPositions[off + 1] = y;
        snowPositions[off + 2] = snowBaseZ[i] + Math.cos(t * 0.33 + snowPhase[i]) * 8
            + Math.sin(windRad) * drift * t;
    }
    snowAttr.needsUpdate = true;
}

// Environment obstacle preview meshes (one active at a time).
const obstacleGroup = new THREE.Group();
const obstacleMat = new THREE.MeshBasicMaterial({
    color: 0x8a939c,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
});
const hedgeMat = new THREE.MeshBasicMaterial({
    color: 0x4f8a3a,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
});
const obstacleMeshes = {
    wall: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), obstacleMat),
    hedge: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hedgeMat),
    boulder: new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), obstacleMat),
    topiarySphere: new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), obstacleMat),
    topiaryCone: new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32), obstacleMat),
};
const cutCapGeo = new THREE.CircleGeometry(1, 32);
cutCapGeo.rotateX(-Math.PI / 2);
const cutCapMat = new THREE.MeshBasicMaterial({
    color: 0x4e6544,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    depthWrite: false,
});
obstacleMeshes.cutCap = new THREE.Mesh(cutCapGeo, cutCapMat);
const cutRingGeo = new THREE.RingGeometry(0.82, 1.0, 32);
cutRingGeo.rotateX(-Math.PI / 2);
const cutRingMat = new THREE.MeshBasicMaterial({
    color: 0x263d22,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
});
obstacleMeshes.cutRing = new THREE.Mesh(cutRingGeo, cutRingMat);
for (const mesh of Object.values(obstacleMeshes)) {
    mesh.visible = false;
    obstacleGroup.add(mesh);
}
scene.add(obstacleGroup);

const espalierPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 360),
    new THREE.MeshBasicMaterial({
        color: 0x7a8c9a,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false,
    })
);
espalierPlane.position.y = 180;
espalierPlane.visible = false;
scene.add(espalierPlane);

// Seed on the ground: visible before year 1, then fades out.
const seedGeo = new THREE.SphereGeometry(1.3, 16, 12);
seedGeo.scale(1.3, 0.85, 1.0);
const seedMat = new THREE.MeshLambertMaterial({ color: 0x7a5a36, transparent: true });
const seedMeshes = [];
for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(seedGeo, seedMat);
    mesh.castShadow = true;
    mesh.visible = false;
    scene.add(mesh);
    seedMeshes.push(mesh);
}

/**
 * Dynamic tapered-cylinder mesh for all branches (1 draw call).
 * Each internode is swept as a spline with RINGS_PER_SEG rings of
 * RADIAL_SEGMENTS vertices, plus a cap fan at the top to round the joint.
 */
const VERTS_PER_SEG = RINGS_PER_SEG * RADIAL_SEGMENTS + 1; // +1 center vertex for top cap
const INDICES_PER_SEG = (RINGS_PER_SEG - 1) * RADIAL_SEGMENTS * 6 + RADIAL_SEGMENTS * 3;

const branchPositions = new Float32Array(MAX_NODES * VERTS_PER_SEG * 3);
const branchNormals = new Float32Array(MAX_NODES * VERTS_PER_SEG * 3);
const branchRestPositions = new Float32Array(MAX_NODES * VERTS_PER_SEG * 3);
const branchRestNormals = new Float32Array(MAX_NODES * VERTS_PER_SEG * 3);
const motionWorldPivot = Array.from({ length: MAX_NODES }, () => new THREE.Vector3());
const motionWorldQuat = Array.from({ length: MAX_NODES }, () => new THREE.Quaternion());
const motionLocalQuat = new THREE.Quaternion();
const motionVec = new THREE.Vector3();
const motionAxis = new THREE.Vector3();
const motionMatrixTemp = new THREE.Matrix4();
const leafMotionMatrix = new THREE.Matrix4();
const leafFinalMatrix = new THREE.Matrix4();
const branchColors = new Float32Array(MAX_NODES * VERTS_PER_SEG * 3);
const branchBarkUvs = new Float32Array(MAX_NODES * VERTS_PER_SEG * 2);
const branchFlex = new Float32Array(MAX_NODES * VERTS_PER_SEG);
const branchMotion = new Float32Array(MAX_NODES * VERTS_PER_SEG * 4);
const branchBark = new Float32Array(MAX_NODES * VERTS_PER_SEG * 4);
const branchIndices = new Uint32Array(MAX_NODES * INDICES_PER_SEG);

// Pre-populate the index buffer once (topology of each segment slot is fixed).
for (let s = 0; s < MAX_NODES; s++) {
    const vBase = s * VERTS_PER_SEG;
    const iBase = s * INDICES_PER_SEG;
    const lastRing = (RINGS_PER_SEG - 1) * RADIAL_SEGMENTS;
    const capCenter = vBase + lastRing + RADIAL_SEGMENTS;
    for (let r = 0; r < RADIAL_SEGMENTS; r++) {
        const rn = (r + 1) % RADIAL_SEGMENTS;
        for (let ring = 0; ring < RINGS_PER_SEG - 1; ring++) {
            const a0 = vBase + ring * RADIAL_SEGMENTS + r;
            const a1 = vBase + ring * RADIAL_SEGMENTS + rn;
            const b0 = vBase + (ring + 1) * RADIAL_SEGMENTS + r;
            const b1 = vBase + (ring + 1) * RADIAL_SEGMENTS + rn;

            const sideIdx = iBase + (ring * RADIAL_SEGMENTS + r) * 6;
            branchIndices[sideIdx] = a0;
            branchIndices[sideIdx + 1] = a1;
            branchIndices[sideIdx + 2] = b1;
            branchIndices[sideIdx + 3] = a0;
            branchIndices[sideIdx + 4] = b1;
            branchIndices[sideIdx + 5] = b0;
        }

        const capIdx = iBase + lastRing * 6 + r * 3;
        const t0 = vBase + lastRing + r;
        const t1 = vBase + lastRing + rn;
        branchIndices[capIdx] = t0;
        branchIndices[capIdx + 1] = t1;
        branchIndices[capIdx + 2] = capCenter;
    }
}

// Precompute unit circle cos/sin table for radial rings.
const ringCos = new Float32Array(RADIAL_SEGMENTS);
const ringSin = new Float32Array(RADIAL_SEGMENTS);
for (let r = 0; r < RADIAL_SEGMENTS; r++) {
    const a = (r / RADIAL_SEGMENTS) * Math.PI * 2;
    ringCos[r] = Math.cos(a);
    ringSin[r] = Math.sin(a);
}

const branchGeo = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(branchPositions, 3);
const normAttr = new THREE.BufferAttribute(branchNormals, 3);
const colAttr = new THREE.BufferAttribute(branchColors, 3);
const barkUvAttr = new THREE.BufferAttribute(branchBarkUvs, 2);
const flexAttr = new THREE.BufferAttribute(branchFlex, 1);
const motionAttr = new THREE.BufferAttribute(branchMotion, 4);
const barkAttr = new THREE.BufferAttribute(branchBark, 4);
posAttr.setUsage(THREE.DynamicDrawUsage);
normAttr.setUsage(THREE.DynamicDrawUsage);
colAttr.setUsage(THREE.DynamicDrawUsage);
barkUvAttr.setUsage(THREE.DynamicDrawUsage);
flexAttr.setUsage(THREE.DynamicDrawUsage);
motionAttr.setUsage(THREE.DynamicDrawUsage);
barkAttr.setUsage(THREE.DynamicDrawUsage);
branchGeo.setAttribute('position', posAttr);
branchGeo.setAttribute('normal', normAttr);
branchGeo.setAttribute('color', colAttr);
branchGeo.setAttribute('aBarkUv', barkUvAttr);
branchGeo.setAttribute('aFlex', flexAttr);
branchGeo.setAttribute('aMotion', motionAttr);
branchGeo.setAttribute('aBark', barkAttr);
branchGeo.setIndex(new THREE.BufferAttribute(branchIndices, 1));
branchGeo.setDrawRange(0, 0);

const branchMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
});
branchMat.customProgramCacheKey = () => 'tree-branch-bark-sway-v1';
branchMat.onBeforeCompile = (shader) => {
    shader.uniforms.uBarkStrength = { value: 1 };
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSway = { value: 0.6 };
    shader.uniforms.uTreeHeight = { value: 200 };
    shader.uniforms.uWindX = { value: 1 };
    shader.uniforms.uWindZ = { value: 0 };
    shader.uniforms.uWindStrength = { value: 0 };
    shader.uniforms.uGust = { value: 0.18 };
    shader.uniforms.uGustFreq = { value: 0.8 };
    shader.uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
    shader.uniforms.uWetness = { value: 0.3 };
    shader.uniforms.uSnow = { value: 0 };

    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        attribute vec2 aBarkUv;
        attribute float aFlex;
        attribute vec4 aMotion;
        attribute vec4 aBark;
        uniform float uTime;
        uniform float uSway;
        uniform float uTreeHeight;
        uniform float uWindX;
        uniform float uWindZ;
        uniform float uWindStrength;
        uniform float uGust;
        uniform float uGustFreq;
        varying vec2 vBarkUv;
        varying vec3 vBarkWorld;
        varying vec3 vBarkNormal;
        varying vec4 vBarkParams;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vBarkUv = aBarkUv;
        vBarkWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vBarkNormal = normalize(mat3(modelMatrix) * normal);
        vBarkParams = aBark;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 worldPos = modelMatrix * mvPosition;
        float flex = aFlex;
        float motionOrder = aMotion.x;
        float motionPhase = aMotion.y + aMotion.w * 1.4;
        float motionMass = aMotion.z;
        float gustWave = sin(uTime * max(uGustFreq, 0.05) + motionPhase * 0.18) * uGust;
        float branchFreq = 0.58 + motionOrder * 0.75;
        float branchAmp = (uSway * 1.45 + uWindStrength * 1.15)
            * (0.4 + motionOrder * 1.2) * (1.0 - motionMass * 0.45);
        float trunkWave = sin(uTime * 0.48 + motionPhase * 0.12) * (0.55 - motionOrder * 0.18);
        float branchWave = sin(uTime * branchFreq + motionPhase) * branchAmp;
        float twigWave = sin(uTime * (1.25 + motionOrder * 0.8) + motionPhase * 1.15)
            * motionOrder * uSway * 0.34;
        float localSway = (trunkWave * uSway * 0.22 + branchWave + twigWave) * flex;
        worldPos.x += localSway;
        worldPos.z += cos(uTime * branchFreq * 0.82 + motionPhase * 1.05)
            * branchAmp * 0.42 * flex;
        worldPos.x += uWindX * (uWindStrength * 2.1 + gustWave * 1.15) * flex;
        worldPos.z += uWindZ * (uWindStrength * 2.1 + gustWave * 1.15) * flex;
        mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;
    `);

    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uBarkStrength;
        uniform vec3 uSunDir;
        uniform float uWetness;
        uniform float uSnow;
        varying vec2 vBarkUv;
        varying vec3 vBarkWorld;
        varying vec3 vBarkNormal;
        varying vec4 vBarkParams;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if (uBarkStrength > 0.5) {
            vec3 triW = pow(abs(normalize(vBarkNormal)), vec3(2.0));
            triW /= max(0.0001, triW.x + triW.y + triW.z);
            float gx = sin(vBarkWorld.z * 0.37 + vBarkWorld.y * 0.21 + sin(vBarkWorld.x * 0.09) * 3.0);
            float gy = sin(vBarkWorld.x * 0.33 + vBarkWorld.z * 0.27 + sin(vBarkWorld.y * 0.08) * 3.0);
            float gz = sin(vBarkWorld.x * 0.31 + vBarkWorld.y * 0.19 + sin(vBarkWorld.z * 0.1) * 3.0);
            float grain = gx * triW.x + gy * triW.y + gz * triW.z;
            float fissureFreq = 5.0 + vBarkParams.x * 15.0;
            float fissure = smoothstep(0.45, 0.95, abs(grain)) * vBarkParams.x;
            float mossNoise = fract(sin(dot(vBarkWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);
            float moss = smoothstep(0.15, 0.8, vBarkNormal.y)
                * smoothstep(0.3, 0.8, mossNoise)
                * vBarkParams.y * (0.4 + 0.6 * vBarkParams.w);
            float lenticel = smoothstep(0.8, 0.98,
                sin(vBarkWorld.y * 2.7 + vBarkWorld.x * 0.4) * 0.5 + 0.5) * vBarkParams.z;
            float sunFace = max(dot(normalize(vBarkNormal), normalize(uSunDir)), 0.0);
            vec3 bark = diffuseColor.rgb * (1.0 - 0.42 * fissure - 0.09 * (grain * 0.5 + 0.5));
            bark = mix(bark, vec3(0.22, 0.34, 0.16), moss * 0.55);
            bark = mix(bark, bark * 1.13 + vec3(0.02), sunFace * 0.35);
            bark = mix(bark, bark * 0.62 + vec3(0.03, 0.025, 0.02), uWetness * 0.4);
            bark += vec3(0.07, 0.045, 0.02) * lenticel;
            float snowMask = smoothstep(0.18, 0.85, vBarkNormal.y) * uSnow;
            bark = mix(bark, vec3(0.82, 0.87, 0.9), snowMask);
            diffuseColor.rgb = bark;
        }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (uBarkStrength > 0.5) {
            roughnessFactor = clamp(roughnessFactor
                + 0.08 * sin(vBarkWorld.y * 0.6 + vBarkUv.x * 40.0)
                - 0.12 * vBarkParams.y, 0.55, 1.0);
        }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        if (uBarkStrength > 0.5) {
            float bump = sin(vBarkWorld.y * 0.72 + vBarkUv.x * 55.0)
                + 0.5 * sin(vBarkWorld.y * 2.1 + vBarkUv.x * 13.0);
            normal = normalize(normal + vec3(bump * 0.035, 0.0, bump * 0.018));
        }
    `);

    branchMat.userData.shader = shader;
};
const branchMesh = new THREE.Mesh(branchGeo, branchMat);
branchMesh.castShadow = true;
branchMesh.receiveShadow = true;
branchMesh.frustumCulled = false;
scene.add(branchMesh);

/**
 * Instanced leaf mesh (1 draw call for all leaves).
 * Each leaf is a 6-vertex diamond/ellipse card.
 */
function createLeafGeometry(points) {
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array(points);
    const indices = [];
    const count = points.length / 3;
    for (let i = 1; i < count - 1; i++) indices.push(0, i, i + 1);
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

// Species silhouettes share the same fan topology but differ in outline.
const LEAF_GEOMETRY_POINTS = {
    oak: [
        0, 0, 0,
        0.35, 0.08, -0.48,
        0.72, 0.05, -0.66,
        0.92, 0.01, -0.28,
        1.18, 0, 0,
        0.92, 0.01, 0.28,
        0.72, 0.05, 0.66,
        0.35, 0.08, 0.48,
    ],
    pine: [
        0, 0, 0,
        0.12, 0.02, -0.07,
        0.55, 0.02, -0.12,
        1.7, 0, 0,
        0.55, 0.02, 0.12,
        0.12, 0.02, 0.07,
    ],
    willow: [
        0, 0, 0,
        0.28, 0.05, -0.18,
        0.85, 0.03, -0.22,
        1.7, 0, 0,
        0.85, 0.03, 0.22,
        0.28, 0.05, 0.18,
    ],
    cherry: [
        0, 0, 0,
        0.32, 0.06, -0.5,
        0.7, 0.02, -0.58,
        0.92, 0.02, -0.36,
        1.22, 0, 0,
        0.92, 0.02, 0.36,
        0.7, 0.02, 0.58,
        0.32, 0.06, 0.5,
    ],
    poplar: [
        0, 0, 0,
        0.35, 0.06, -0.58,
        0.9, 0.02, -0.5,
        1.2, 0, 0,
        0.9, 0.02, 0.5,
        0.35, 0.06, 0.58,
    ],
};

const LEAF_SPECIES = ['oak', 'pine', 'willow', 'cherry', 'poplar'];
const LEAF_COUNTS = { oak: 4, pine: 5, willow: 3, cherry: 4, poplar: 3 };
function leafCountForShape(shape) {
    return LEAF_COUNTS[shape] || 3;
}
const leafGeos = {};
for (const species of LEAF_SPECIES) {
    leafGeos[species] = createLeafGeometry(LEAF_GEOMETRY_POINTS[species]);
}
const leafGeo = leafGeos.oak;
const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    roughness: 0.65,
    metalness: 0.0,
});
leafMat.customProgramCacheKey = () => 'tree-leaf-glow-sway-v1';
leafMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
    shader.uniforms.uLeafGlow = { value: 0.6 };
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSway = { value: 0.6 };
    shader.uniforms.uTreeHeight = { value: 200 };
    shader.uniforms.uWindX = { value: 1 };
    shader.uniforms.uWindZ = { value: 0 };
    shader.uniforms.uWindStrength = { value: 0 };
    shader.uniforms.uGust = { value: 0.18 };
    shader.uniforms.uFlutter = { value: 0.4 };
    shader.uniforms.uGustFreq = { value: 0.8 };

    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uSway;
        uniform float uTreeHeight;
        uniform float uWindX;
        uniform float uWindZ;
        uniform float uWindStrength;
        uniform float uGust;
        uniform float uGustFreq;
        uniform float uFlutter;
        attribute vec4 aLeafMotion;
        varying vec2 vLeafLocal;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeafLocal = position.xz;
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 worldPos = modelMatrix * mvPosition;
        float motionOrder = aLeafMotion.x;
        float motionPhase = aLeafMotion.y + aLeafMotion.w * 1.4;
        float motionMass = aLeafMotion.z;
        float flex = 0.12 + 0.88 * motionOrder;
        float flutter = sin(uTime * 3.4 + motionPhase * 2.6) * uFlutter * 0.55;
        float gustWave = sin(uTime * max(uGustFreq, 0.05) + motionPhase * 0.18) * uGust;
        float branchFreq = 0.58 + motionOrder * 0.75;
        float branchAmp = (uSway * 1.45 + uWindStrength * 1.15)
            * (0.4 + motionOrder * 1.2) * (1.0 - motionMass * 0.45);
        float trunkWave = sin(uTime * 0.48 + motionPhase * 0.12) * (0.55 - motionOrder * 0.18);
        float branchWave = sin(uTime * branchFreq + motionPhase) * branchAmp;
        float twigWave = sin(uTime * (1.25 + motionOrder * 0.8) + motionPhase * 1.15)
            * motionOrder * uSway * 0.34;
        float localSway = (trunkWave * uSway * 0.22 + branchWave + twigWave) * flex;
        worldPos.x += localSway;
        worldPos.z += cos(uTime * branchFreq * 0.82 + motionPhase * 1.05)
            * branchAmp * 0.42 * flex;
        worldPos.x += uWindX * (uWindStrength * 2.1 + gustWave * 1.15 + flutter) * flex;
        worldPos.z += uWindZ * (uWindStrength * 2.1 + gustWave * 1.15 + flutter) * flex;
        mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;
    `);

    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform vec3 uSunDir;
        uniform float uLeafGlow;
        varying vec2 vLeafLocal;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float leafMidVein = smoothstep(0.045, 0.0, abs(vLeafLocal.y));
        float leafSideVeins = smoothstep(0.028, 0.0,
            abs(vLeafLocal.y - sin(vLeafLocal.x * 9.0) * 0.12));
        float leafVein = max(leafMidVein, leafSideVeins * 0.55);
        diffuseColor.rgb *= 1.0 - 0.16 * leafVein;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(normal + vec3(
            sin(vLeafLocal.x * 31.0 + vLeafLocal.y * 17.0),
            cos(vLeafLocal.y * 27.0),
            0.0
        ) * 0.035);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        vec3 leafSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        vec3 leafView = normalize(vViewPosition);
        float leafBack = pow(max(dot(leafView, -leafSun), 0.0), 2.0);
        float leafThrough = max(dot(normal, -leafSun), 0.0);
        outgoingLight += diffuseColor.rgb * vec3(0.55, 0.78, 0.28) * leafBack * leafThrough * uLeafGlow;
        #include <opaque_fragment>
    `);

    leafMat.userData.shader = shader;
};
const leafMeshes = {};
for (const species of LEAF_SPECIES) {
    const motionArray = new Float32Array(MAX_LEAVES * 4);
    const motionAttribute = new THREE.InstancedBufferAttribute(motionArray, 4);
    motionAttribute.setUsage(THREE.DynamicDrawUsage);
    leafGeos[species].setAttribute('aLeafMotion', motionAttribute);
    const mesh = new THREE.InstancedMesh(leafGeos[species], leafMat, MAX_LEAVES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.userData.nodeIndices = [];
    mesh.userData.motionAttribute = motionAttribute;
    mesh.userData.baseMatrices = [];
    scene.add(mesh);
    leafMeshes[species] = mesh;
}

// Far LOD: branch line impostor and leaf point cloud.
const farBranchPositions = new Float32Array(MAX_NODES * 6);
const farBranchColors = new Float32Array(MAX_NODES * 6);
const farBranchGeo = new THREE.BufferGeometry();
const farBranchPosAttr = new THREE.BufferAttribute(farBranchPositions, 3);
const farBranchColAttr = new THREE.BufferAttribute(farBranchColors, 3);
farBranchPosAttr.setUsage(THREE.DynamicDrawUsage);
farBranchColAttr.setUsage(THREE.DynamicDrawUsage);
farBranchGeo.setAttribute('position', farBranchPosAttr);
farBranchGeo.setAttribute('color', farBranchColAttr);
farBranchGeo.setDrawRange(0, 0);
const farBranchLines = new THREE.LineSegments(
    farBranchGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
);
farBranchLines.frustumCulled = false;
farBranchLines.visible = false;
scene.add(farBranchLines);

const farLeafPositions = new Float32Array(MAX_LEAVES * 3);
const farLeafColors = new Float32Array(MAX_LEAVES * 3);
const farLeafGeo = new THREE.BufferGeometry();
const farLeafPosAttr = new THREE.BufferAttribute(farLeafPositions, 3);
const farLeafColAttr = new THREE.BufferAttribute(farLeafColors, 3);
farLeafPosAttr.setUsage(THREE.DynamicDrawUsage);
farLeafColAttr.setUsage(THREE.DynamicDrawUsage);
farLeafGeo.setAttribute('position', farLeafPosAttr);
farLeafGeo.setAttribute('color', farLeafColAttr);
farLeafGeo.setDrawRange(0, 0);
const farLeafPoints = new THREE.Points(
    farLeafGeo,
    new THREE.PointsMaterial({ vertexColors: true, size: 4.5, sizeAttenuation: true })
);
farLeafPoints.frustumCulled = false;
farLeafPoints.visible = false;
scene.add(farLeafPoints);

// Highlight overlay for branch isolation.
const isolatePositions = new Float32Array(MAX_NODES * 6);
const isolateColors = new Float32Array(MAX_NODES * 6);
const isolateGeo = new THREE.BufferGeometry();
const isolatePosAttr = new THREE.BufferAttribute(isolatePositions, 3);
const isolateColAttr = new THREE.BufferAttribute(isolateColors, 3);
isolatePosAttr.setUsage(THREE.DynamicDrawUsage);
isolateColAttr.setUsage(THREE.DynamicDrawUsage);
isolateGeo.setAttribute('position', isolatePosAttr);
isolateGeo.setAttribute('color', isolateColAttr);
isolateGeo.setDrawRange(0, 0);
const isolateLines = new THREE.LineSegments(
    isolateGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, depthTest: false })
);
isolateLines.frustumCulled = false;
isolateLines.visible = false;
isolateLines.renderOrder = 2;
scene.add(isolateLines);

const comparePositions = new Float32Array(MAX_NODES * 6);
const compareGeo = new THREE.BufferGeometry();
const comparePosAttr = new THREE.BufferAttribute(comparePositions, 3);
comparePosAttr.setUsage(THREE.DynamicDrawUsage);
compareGeo.setAttribute('position', comparePosAttr);
compareGeo.setDrawRange(0, 0);
const compareLines = new THREE.LineSegments(
    compareGeo,
    new THREE.LineBasicMaterial({
        color: 0x81909a,
        transparent: true,
        opacity: 0.28,
        depthTest: false,
    })
);
compareLines.frustumCulled = false;
compareLines.visible = false;
scene.add(compareLines);

// Ground litter: shed twigs/leaves accumulate on the grass.
const litterMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
});
const litterMesh = new THREE.InstancedMesh(leafGeo, litterMat, MAX_LITTER);
litterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
litterMesh.receiveShadow = true;
litterMesh.frustumCulled = false;
litterMesh.count = 0;
groundDetailGroup.add(litterMesh);

// Falling debris: shed subtrees drop together and fade over FALL_DURATION.
const debrisPositions = new Float32Array(MAX_NODES * 2 * 3);
const debrisColors = new Float32Array(MAX_NODES * 2 * 3);
const debrisGeo = new THREE.BufferGeometry();
const debrisPosAttr = new THREE.BufferAttribute(debrisPositions, 3);
const debrisColAttr = new THREE.BufferAttribute(debrisColors, 3);
debrisPosAttr.setUsage(THREE.DynamicDrawUsage);
debrisColAttr.setUsage(THREE.DynamicDrawUsage);
debrisGeo.setAttribute('position', debrisPosAttr);
debrisGeo.setAttribute('color', debrisColAttr);
debrisGeo.setDrawRange(0, 0);
const debrisLines = new THREE.LineSegments(
    debrisGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })
);
debrisLines.frustumCulled = false;
scene.add(debrisLines);

// Red markers at prune cuts.
const MAX_PRUNE_MARKS = 256;
const prunePositions = new Float32Array(MAX_PRUNE_MARKS * 3);
const pruneGeo = new THREE.BufferGeometry();
const prunePosAttr = new THREE.BufferAttribute(prunePositions, 3);
prunePosAttr.setUsage(THREE.DynamicDrawUsage);
pruneGeo.setAttribute('position', prunePosAttr);
pruneGeo.setDrawRange(0, 0);
const prunePoints = new THREE.Points(
    pruneGeo,
    new THREE.PointsMaterial({ color: 0xe14137, size: 9, sizeAttenuation: false, depthTest: false })
);
prunePoints.frustumCulled = false;
scene.add(prunePoints);

// Cyan wireframe marker for the node selected in the inspector.
const selectionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xe6ab02, wireframe: true, depthTest: false })
);
selectionMesh.visible = false;
selectionMesh.renderOrder = 3;
scene.add(selectionMesh);

// Red subtree ghost shown while hovering in Prune mode.
const hoverPositions = new Float32Array(MAX_NODES * 6);
const hoverGeo = new THREE.BufferGeometry();
const hoverPosAttr = new THREE.BufferAttribute(hoverPositions, 3);
hoverPosAttr.setUsage(THREE.DynamicDrawUsage);
hoverGeo.setAttribute('position', hoverPosAttr);
hoverGeo.setDrawRange(0, 0);
const hoverLines = new THREE.LineSegments(
    hoverGeo,
    new THREE.LineBasicMaterial({
        color: 0xe14137,
        transparent: true,
        opacity: 0.75,
        depthTest: false,
        depthWrite: false,
    })
);
hoverLines.frustumCulled = false;
hoverLines.visible = false;
hoverLines.renderOrder = 2;
scene.add(hoverLines);

const hoverMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xe14137, transparent: true, opacity: 0.8, depthTest: false })
);
hoverMarker.visible = false;
hoverMarker.renderOrder = 3;
scene.add(hoverMarker);

function updateSelectionMesh() {
    if (selectedNode < 0 || !frame.present || !frame.present[selectedNode]) {
        selectionMesh.visible = false;
        return;
    }
    selectionMesh.visible = true;
    selectionMesh.position.set(frame.px[selectedNode], frame.py[selectedNode], frame.pz[selectedNode]);
    const r = Math.max(1.8, (frame.radius[selectedNode] || 0.4) * 2.2);
    selectionMesh.scale.setScalar(r);
}

function updatePruneMarks() {
    const gt = growthTime(time);
    let count = 0;
    for (const m of pruneMarks) {
        if (count >= MAX_PRUNE_MARKS) break;
        if (gt < m.birthStep) continue;
        prunePositions[count * 3] = m.x;
        prunePositions[count * 3 + 1] = m.y;
        prunePositions[count * 3 + 2] = m.z;
        count++;
    }
    prunePosAttr.needsUpdate = true;
    pruneGeo.setDrawRange(0, count);
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
    updateHoverPreview();
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

/** Rebuild prune markers from deterministic cut metadata after a simulation. */
function rebuildPruneMarks() {
    pruneMarks.length = 0;
    for (const node of nodes) {
        if (!node.cut || node.cut.step < 0) continue;
        pruneMarks.push({
            x: node.x, y: node.y, z: node.z,
            birthStep: node.cut.step,
            type: node.cut.type,
        });
    }
}

/** Update the red subtree ghost and cut-point marker for the hovered node. */
function updateHoverPreview() {
    if (!pruneMode || hoverNode < 0 || !frame.present || !frame.present[hoverNode]) {
        hoverLines.visible = false;
        hoverMarker.visible = false;
        return;
    }
    const mask = subtreeMask(hoverNode);
    let count = 0;
    for (let i = hoverNode; i < nodes.length; i++) {
        if (!mask[i] || !frame.present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        if (!frame.present[p]) continue;
        const off = count * 6;
        hoverPositions[off] = frame.px[p];
        hoverPositions[off + 1] = frame.py[p];
        hoverPositions[off + 2] = frame.pz[p];
        hoverPositions[off + 3] = frame.px[i];
        hoverPositions[off + 4] = frame.py[i];
        hoverPositions[off + 5] = frame.pz[i];
        count++;
    }
    hoverPosAttr.needsUpdate = true;
    hoverGeo.setDrawRange(0, count * 2);
    hoverLines.visible = count > 0;
    hoverMarker.visible = true;
    hoverMarker.position.set(
        frame.px[hoverNode], frame.py[hoverNode], frame.pz[hoverNode]
    );
    const r = Math.max(1.4, (frame.radius[hoverNode] || 0.4) * 1.5);
    hoverMarker.scale.setScalar(r);
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

// Coarse roots: separate static meshes rebuilt only when the skeleton changes.
const rootGroup = new THREE.Group();
rootGroup.name = 'roots';
scene.add(rootGroup);
const rootMat = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.95 });
const rootMeshes = [];
const ROOT_UP = new THREE.Vector3(0, 1, 0);

function rebuildRootMesh() {
    for (const mesh of rootMeshes) {
        rootGroup.remove(mesh);
        mesh.geometry.dispose();
    }
    rootMeshes.length = 0;
    for (const r of rootSystem) {
        const dx = r.x1 - r.x0;
        const dy = r.y1 - r.y0;
        const dz = r.z1 - r.z0;
        const len = Math.hypot(dx, dy, dz);
        if (len < 0.001) continue;
        const geo = new THREE.CylinderGeometry(
            Math.max(0.05, r.w1), Math.max(0.05, r.w0), len, 8, 1, false
        );
        const mesh = new THREE.Mesh(geo, rootMat);
        mesh.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, (r.z0 + r.z1) / 2);
        mesh.quaternion.setFromUnitVectors(ROOT_UP, new THREE.Vector3(dx / len, dy / len, dz / len));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        rootGroup.add(mesh);
        rootMeshes.push(mesh);
    }
}

// Dark wound discs at cut nodes.
const woundGroup = new THREE.Group();
woundGroup.name = 'wounds';
scene.add(woundGroup);
const woundMat = new THREE.MeshStandardMaterial({ color: 0x2b1a10, roughness: 1 });
const woundGeo = new THREE.SphereGeometry(1, 10, 6);
const woundMeshes = [];

function rebuildWounds() {
    for (const item of woundMeshes) woundGroup.remove(item.mesh);
    woundMeshes.length = 0;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node.cutType || node.cutStep < 0) continue;
        const mesh = new THREE.Mesh(woundGeo, woundMat);
        mesh.position.set(node.x, node.y, node.z);
        const s = 1.2 + Math.min(2.2, (node.order || 0) * 0.45);
        mesh.scale.set(s, s * 0.6, s);
        mesh.castShadow = true;
        woundGroup.add(mesh);
        woundMeshes.push({ mesh, index: i, step: node.cutStep });
    }
}

function updateWounds() {
    const gt = growthTime(time);
    for (const item of woundMeshes) {
        item.mesh.visible = !!(frame.present && frame.present[item.index]) && gt >= item.step;
    }
}

const dummyMatrix = new THREE.Matrix4();
const dummyPos = new THREE.Vector3();
const dummyQuat = new THREE.Quaternion();
const dummyScale = new THREE.Vector3();
const dummyEuler = new THREE.Euler();
const tempColor = new THREE.Color();

/* ==========================================================================
   ! 4B. ALGORITHM VISUALIZATION OVERLAY MESHES
   ========================================================================== */

// 1. Skeleton graph overlay: parent->child lines + coloured node points
const skelLinePositions = new Float32Array(MAX_NODES * 2 * 3);
const skelLineGeo = new THREE.BufferGeometry();
const skelLinePosAttr = new THREE.BufferAttribute(skelLinePositions, 3);
skelLinePosAttr.setUsage(THREE.DynamicDrawUsage);
skelLineGeo.setAttribute('position', skelLinePosAttr);
skelLineGeo.setDrawRange(0, 0);
const skelLines = new THREE.LineSegments(
    skelLineGeo,
    new THREE.LineBasicMaterial({ color: 0x111827, depthTest: false, transparent: true, opacity: 0.75 })
);
skelLines.renderOrder = 2;
skelLines.frustumCulled = false;
skelLines.visible = false;
scene.add(skelLines);

const skelPointPositions = new Float32Array(MAX_NODES * 3);
const skelPointColors = new Float32Array(MAX_NODES * 3);
const skelPointGeo = new THREE.BufferGeometry();
const skelPointPosAttr = new THREE.BufferAttribute(skelPointPositions, 3);
const skelPointColAttr = new THREE.BufferAttribute(skelPointColors, 3);
skelPointPosAttr.setUsage(THREE.DynamicDrawUsage);
skelPointColAttr.setUsage(THREE.DynamicDrawUsage);
skelPointGeo.setAttribute('position', skelPointPosAttr);
skelPointGeo.setAttribute('color', skelPointColAttr);
skelPointGeo.setDrawRange(0, 0);
const skelPoints = new THREE.Points(
    skelPointGeo,
    new THREE.PointsMaterial({ size: 5.5, sizeAttenuation: false, vertexColors: true, depthTest: false })
);
skelPoints.renderOrder = 3;
skelPoints.frustumCulled = false;
skelPoints.visible = false;
scene.add(skelPoints);

// 2. LightField 3D voxel grid overlay
const MAX_VOXELS = 4000;
const voxelBoxGeo = new THREE.BoxGeometry(LIGHT_CELL * 0.94, LIGHT_CELL * 0.94, LIGHT_CELL * 0.94);
const voxelMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    transparent: true,
    opacity: 0.55,
});
const voxelMesh = new THREE.InstancedMesh(voxelBoxGeo, voxelMat, MAX_VOXELS);
voxelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
voxelMesh.frustumCulled = false;
voxelMesh.visible = false;
voxelMesh.count = 0;
scene.add(voxelMesh);

// 3. Tropism & growth vector overlay at active tips (4 vectors per tip: inertia, photo, droop, resultant)
const vecPositions = new Float32Array(MAX_NODES * 8 * 3);
const vecColors = new Float32Array(MAX_NODES * 8 * 3);
const vecGeo = new THREE.BufferGeometry();
const vecPosAttr = new THREE.BufferAttribute(vecPositions, 3);
const vecColAttr = new THREE.BufferAttribute(vecColors, 3);
vecPosAttr.setUsage(THREE.DynamicDrawUsage);
vecColAttr.setUsage(THREE.DynamicDrawUsage);
vecGeo.setAttribute('position', vecPosAttr);
vecGeo.setAttribute('color', vecColAttr);
vecGeo.setDrawRange(0, 0);
const vecLines = new THREE.LineSegments(
    vecGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.92 })
);
vecLines.renderOrder = 4;
vecLines.frustumCulled = false;
vecLines.visible = false;
scene.add(vecLines);

// 4. Shed ghost branches + branchRoot -> mainTip sensor links
const shedPositions = new Float32Array(MAX_NODES * 4 * 3);
const shedColors = new Float32Array(MAX_NODES * 4 * 3);
const shedGeo = new THREE.BufferGeometry();
const shedPosAttr = new THREE.BufferAttribute(shedPositions, 3);
const shedColAttr = new THREE.BufferAttribute(shedColors, 3);
shedPosAttr.setUsage(THREE.DynamicDrawUsage);
shedColAttr.setUsage(THREE.DynamicDrawUsage);
shedGeo.setAttribute('position', shedPosAttr);
shedGeo.setAttribute('color', shedColAttr);
shedGeo.setDrawRange(0, 0);
const shedLines = new THREE.LineSegments(
    shedGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })
);
shedLines.renderOrder = 1;
shedLines.frustumCulled = false;
shedLines.visible = false;
scene.add(shedLines);

/** Set `tempColor` for segment `i` based on the active bark colour mode. */
function setSegmentColor(i) {
    const node = nodes[i];
    const { radius, childCount, ageDominated } = frame;
    switch (viz.colorMode) {
        case 'order':
            tempColor.setHex(ORDER_COLORS_HEX[Math.min(node.order, ORDER_COLORS_HEX.length - 1)]);
            break;
        case 'light': {
            const l = clamp01(node.currentLight ?? node.light ?? 1);
            tempColor.setHSL((265 - l * 210) / 360, 0.8, (26 + l * 38) / 100);
            break;
        }
        case 'vigor': {
            const v = clamp01(node.vigor ?? 1);
            tempColor.setHSL((215 - v * 195) / 360, 0.78, (30 + v * 26) / 100);
            break;
        }
        case 'pipe':
            if (childCount[i] === 0) tempColor.setHex(0x2ca25f);
            else tempColor.setHex(ageDominated[i] ? 0xe66101 : 0x2b8cbe);
            break;
        default: {
            const traits = (treeTraits && treeTraits[node.tree]) || P;
            const thickness = Math.min(radius[i] / 7, 1);
            tempColor.setHSL(
                (traits.barkHue ?? 30) / 360,
                (traits.barkSat ?? 25) / 100,
                ((traits.barkLight ?? 34) - 14 * thickness) / 100
            );
            break;
        }
    }
}

/* ==========================================================================
   ! 5. MESH UPDATES PER FRAME
   ========================================================================== */

function updateSeedMesh() {
    const roots = nodes.filter((n) => n.parent < 0);
    const show = time < 2.6;
    seedMat.opacity = time < 1 ? 1 : Math.max(0, 1 - (time - 1) / 1.6);
    for (let i = 0; i < seedMeshes.length; i++) {
        const mesh = seedMeshes[i];
        const root = roots[i];
        mesh.visible = show && !!root;
        if (root) mesh.position.set(root.x, root.y + 0.6, root.z);
    }
}

/** Continuous motion parameters used by branch and leaf shaders. */
function motionStateForNode(node) {
    return {
        order: Math.min(1, (node.order || 0) / 4),
        phase: (node.pathLength || 0) * 0.02 + (node.axisId || 0) * 0.37,
        mass: Math.min(1, (node.mechanicalLoad || 0) / 600),
        path: Math.min(1, (node.pathLength || 0) / 400),
        flex: 0.12 + 0.88 * Math.min(1, (node.order || 0) / 4),
    };
}

/** Rebuild the spline-smoothed tapered branch buffers for visible segments. */
function updateBranchMesh() {
    const t0 = performance.now();
    const { px, py, pz, radius, present } = frame;
    const seedPhase = ((seed % 1000) / 1000) * Math.PI * 2;
    visibleSegmentNodes.length = 0;
    let segCount = 0;

    for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        const x0 = px[p], y0 = py[p], z0 = pz[p];
        const x1 = px[i], y1 = py[i], z1 = pz[i];
        const r0 = radius[p];
        const r1 = radius[i];

        let dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len; dy /= len; dz /= len;

        // Incoming tangent: the parent segment's direction, so joins stay smooth.
        let t0x = dx, t0y = dy, t0z = dz;
        if (p > 0) {
            const pp = nodes[p].parent;
            const ix = x0 - px[pp], iy = y0 - py[pp], iz = z0 - pz[pp];
            const il = Math.hypot(ix, iy, iz);
            if (il > 1e-6) { t0x = ix / il; t0y = iy / il; t0z = iz / il; }
        }
        const t1x = dx, t1y = dy, t1z = dz;

        // Hermite control magnitudes (a half-length keeps the curve from overshooting).
        const m0 = len * 0.45;
        const b0x = t0x * m0, b0y = t0y * m0, b0z = t0z * m0;
        const b1x = t1x * m0, b1y = t1y * m0, b1z = t1z * m0;

        const pointAt = (t) => {
            const t2 = t * t, t3 = t2 * t;
            const h00 = 2 * t3 - 3 * t2 + 1;
            const h10 = t3 - 2 * t2 + t;
            const h01 = -2 * t3 + 3 * t2;
            const h11 = t3 - t2;
            return {
                x: x0 * h00 + b0x * h10 + x1 * h01 + b1x * h11,
                y: y0 * h00 + b0y * h10 + y1 * h01 + b1y * h11,
                z: z0 * h00 + b0z * h10 + z1 * h01 + b1z * h11,
            };
        };

        const tangentAt = (t) => {
            const a = pointAt(Math.max(0, t - 0.01));
            const b = pointAt(Math.min(1, t + 0.01));
            let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
            const tl = Math.hypot(tx, ty, tz) || 1;
            return { x: tx / tl, y: ty / tl, z: tz / tl };
        };

        setSegmentColor(i);
        const cr = tempColor.r, cg = tempColor.g, cb = tempColor.b;
        const traits = (treeTraits && treeTraits[nodes[i].tree]) || P;
        const barkFissure = traits.barkFissure ?? 0.6;
        const barkMoss = traits.barkMoss ?? 0.35;
        const barkLenticel = traits.barkLenticel ?? 0.2;
        const barkShade = 1 - clamp01(nodes[i].currentLight ?? nodes[i].light ?? 1);
        const parentMotion = motionStateForNode(nodes[p]);
        const currentMotion = motionStateForNode(nodes[i]);
        const barkV = nodes[i].birth * 0.12;
        const vertexBase = segCount * VERTS_PER_SEG;

        const vBase = segCount * VERTS_PER_SEG * 3;
        let prevT = { x: t0x, y: t0y, z: t0z };
        let u = perpBasis(prevT.x, prevT.y, prevT.z);
        let ux = u.ux, uy = u.uy, uz = u.uz;
        let lastCenter = null;
        let lastT = prevT;

        for (let ring = 0; ring < RINGS_PER_SEG; ring++) {
            const t = ring / (RINGS_PER_SEG - 1);
            const center = pointAt(t);
            const tan = tangentAt(t);

            // Parallel transport: rotate the previous u by the minimal rotation
            // that takes the previous tangent to the current one (avoids twist).
            if (ring > 0) {
                const ax = prevT.y * tan.z - prevT.z * tan.y;
                const ay = prevT.z * tan.x - prevT.x * tan.z;
                const az = prevT.x * tan.y - prevT.y * tan.x;
                const sinA = Math.hypot(ax, ay, az);
                if (sinA > 1e-6) {
                    const cosA = Math.max(-1, Math.min(1, prevT.x * tan.x + prevT.y * tan.y + prevT.z * tan.z));
                    const angle = Math.atan2(sinA, cosA);
                    const nx = ax / sinA, ny = ay / sinA, nz = az / sinA;
                    const c = Math.cos(angle), s = Math.sin(angle);
                    const dot = nx * ux + ny * uy + nz * uz;
                    const cx = ny * uz - nz * uy;
                    const cy = nz * ux - nx * uz;
                    const cz = nx * uy - ny * ux;
                    ux = ux * c + cx * s + nx * dot * (1 - c);
                    uy = uy * c + cy * s + ny * dot * (1 - c);
                    uz = uz * c + cz * s + nz * dot * (1 - c);
                }
                const ul = Math.hypot(ux, uy, uz) || 1;
                ux /= ul; uy /= ul; uz /= ul;
            }
            const vx = tan.y * uz - tan.z * uy;
            const vy = tan.z * ux - tan.x * uz;
            const vz = tan.x * uy - tan.y * ux;

            const r = r0 + (r1 - r0) * t;
            const isTrunk = nodes[i].order === 0;
            const ground = isTrunk ? Math.exp(-Math.max(0, center.y) / 8) : 0;
            const collar = nodes[i].isBranchRoot
                ? 1 + 0.18 * Math.exp(-Math.pow((t - 0.07) / 0.075, 2))
                : 1;
            const endCollar = 1 + 0.07 * Math.exp(-Math.pow((t - 0.95) / 0.08, 2));
            const motionOrder = parentMotion.order + (currentMotion.order - parentMotion.order) * t;
            const motionPhase = parentMotion.phase + (currentMotion.phase - parentMotion.phase) * t;
            const motionMass = parentMotion.mass + (currentMotion.mass - parentMotion.mass) * t;
            const motionPath = parentMotion.path + (currentMotion.path - parentMotion.path) * t;
            const flex = parentMotion.flex + (currentMotion.flex - parentMotion.flex) * t;

            for (let ri = 0; ri < RADIAL_SEGMENTS; ri++) {
                const c = ringCos[ri], s = ringSin[ri];
                const nx = ux * c + vx * s;
                const ny = uy * c + vy * s;
                const nz = uz * c + vz * s;
                const angle = (ri / RADIAL_SEGMENTS) * Math.PI * 2;

                // Buttress flare: five flutes that fade out with height.
                let flare = 1;
                if (ground > 0.01) {
                    flare = 1 + 0.55 * ground * (1 + 0.3 * Math.cos(5 * angle + seedPhase));
                }
                const irregular = 1
                    + 0.035 * Math.sin(3 * angle + seedPhase + nodes[i].birth)
                    + 0.018 * Math.sin(7 * angle + nodes[i].axisId);
                const ellipse = 1 + 0.055 * Math.sin(2 * angle + seedPhase * 0.7);
                const knotT = 0.2 + ((nodes[i].axisId * 37) % 100) / 100 * 0.6;
                const knotBump = Math.exp(-Math.pow((t - knotT) / 0.04, 2))
                    * (0.06 + 0.08 * (0.5 + 0.5 * Math.sin(angle * 6 + nodes[i].axisId)));
                const rMod = r * flare * collar * endCollar * irregular * ellipse * (1 + knotBump);

                const off = vBase + (ring * RADIAL_SEGMENTS + ri) * 3;
                branchRestPositions[off] = center.x + nx * rMod;
                branchRestPositions[off + 1] = center.y + ny * rMod;
                branchRestPositions[off + 2] = center.z + nz * rMod;
                branchRestNormals[off] = nx;
                branchRestNormals[off + 1] = ny;
                branchRestNormals[off + 2] = nz;
                branchColors[off] = cr;
                branchColors[off + 1] = cg;
                branchColors[off + 2] = cb;

                const vtx = vertexBase + ring * RADIAL_SEGMENTS + ri;
                branchBarkUvs[vtx * 2] = ri / RADIAL_SEGMENTS;
                branchBarkUvs[vtx * 2 + 1] = barkV + t;
                branchFlex[vtx] = flex;
                const m4 = vtx * 4;
                branchMotion[m4] = motionOrder;
                branchMotion[m4 + 1] = motionPhase;
                branchMotion[m4 + 2] = motionMass;
                branchMotion[m4 + 3] = motionPath;
                const b4 = vtx * 4;
                branchBark[b4] = barkFissure;
                branchBark[b4 + 1] = barkMoss;
                branchBark[b4 + 2] = barkLenticel;
                branchBark[b4 + 3] = barkShade;
            }

            lastCenter = center;
            lastT = tan;
            prevT = tan;
        }

        // Top cap center vertex, slightly raised along the final tangent.
        const capOff = vBase + RINGS_PER_SEG * RADIAL_SEGMENTS * 3;
        branchRestPositions[capOff] = lastCenter.x + lastT.x * r1 * 0.2;
        branchRestPositions[capOff + 1] = lastCenter.y + lastT.y * r1 * 0.2;
        branchRestPositions[capOff + 2] = lastCenter.z + lastT.z * r1 * 0.2;
        branchRestNormals[capOff] = lastT.x;
        branchRestNormals[capOff + 1] = lastT.y;
        branchRestNormals[capOff + 2] = lastT.z;
        branchColors[capOff] = cr;
        branchColors[capOff + 1] = cg;
        branchColors[capOff + 2] = cb;
        const capVtx = vertexBase + RINGS_PER_SEG * RADIAL_SEGMENTS;
        branchBarkUvs[capVtx * 2] = 0.5;
        branchBarkUvs[capVtx * 2 + 1] = barkV + 1;
        branchFlex[capVtx] = currentMotion.flex;
        const capM4 = capVtx * 4;
        branchMotion[capM4] = currentMotion.order;
        branchMotion[capM4 + 1] = currentMotion.phase;
        branchMotion[capM4 + 2] = currentMotion.mass;
        branchMotion[capM4 + 3] = currentMotion.path;
        const capB4 = capVtx * 4;
        branchBark[capB4] = barkFissure;
        branchBark[capB4 + 1] = barkMoss;
        branchBark[capB4 + 2] = barkLenticel;
        branchBark[capB4 + 3] = barkShade;

        visibleSegmentNodes[segCount] = i;
        segCount++;
    }

    branchSegmentCount = segCount;

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    barkUvAttr.needsUpdate = true;
    flexAttr.needsUpdate = true;
    motionAttr.needsUpdate = true;
    barkAttr.needsUpdate = true;
    const shader = branchMat.userData.shader;
    if (shader) shader.uniforms.uBarkStrength.value = viz.colorMode === 'natural' ? 1 : 0;
    branchGeo.setDrawRange(0, segCount * INDICES_PER_SEG);
    perf.branchMesh = performance.now() - t0;
}

/** Populate instanced leaf transforms and colours for the current `time`. */
function leafSpeciesFor(node) {
    if (treeSpecies && treeSpecies[node.tree]) return treeSpecies[node.tree];
    if (activePreset && activePreset !== 'custom' && leafGeos[activePreset]) return activePreset;
    const traits = (treeTraits && treeTraits[node.tree]) || P;
    return leafGeos[traits.leafShape] ? traits.leafShape : 'oak';
}

function computeMotionTransforms() {
    const t = clock.getElapsedTime();
    const windSpeed = Math.abs(P.wind || 0);
    const sway = P.sway || 0;
    const gust = P.gustAmp || 0;
    const active = !P.reducedMotion && (sway > 0.001 || windSpeed > 0.001 || gust > 0.001);
    motionWorldPivot[0].set(frame.px[0], frame.py[0], frame.pz[0]);
    motionWorldQuat[0].identity();
    if (!active) return false;

    const windRad = (P.windDirection || 0) * Math.PI / 180;
    const baseWindX = Math.cos(windRad);
    const baseWindZ = Math.sin(windRad);

    for (let i = 1; i < nodes.length; i++) {
        if (!frame.present[i]) continue;
        const p = nodes[i].parent;
        if (p < 0 || !frame.present[p]) continue;
        const pp = nodes[p].parent;
        if (p === 0) {
            motionWorldPivot[i].copy(motionWorldPivot[0]);
        } else {
            motionVec.set(
                frame.px[p] - frame.px[pp],
                frame.py[p] - frame.py[pp],
                frame.pz[p] - frame.pz[pp]
            ).applyQuaternion(motionWorldQuat[p]);
            motionWorldPivot[i].copy(motionWorldPivot[p]).add(motionVec);
        }

        let dx = frame.px[i] - frame.px[p];
        let dy = frame.py[i] - frame.py[p];
        let dz = frame.pz[i] - frame.pz[p];
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len; dy /= len; dz /= len;

        let wx = baseWindX, wz = baseWindZ;
        if (windSpeed < 0.001) {
            const phase = (nodes[i].pathLength || 0) * 0.02 + (nodes[i].axisId || 0) * 0.37;
            wx = Math.sin(phase * 1.7);
            wz = Math.cos(phase * 1.7);
        }
        motionAxis.set(dy * wz, dz * wx - dx * wz, -dy * wx);
        if (motionAxis.lengthSq() < 1e-8) motionAxis.set(0, 0, 1);
        motionAxis.normalize();

        const order = Math.min(1, (nodes[i].order || 0) / 4);
        const phase = (nodes[i].pathLength || 0) * 0.02 + (nodes[i].axisId || 0) * 0.37;
        const mass = Math.min(1, (nodes[i].mechanicalLoad || 0) / 600);
        const speedFactor = 0.35 + sway * 0.8 + windSpeed * 1.5 + gust * 0.25;
        let angle = (
            Math.sin(t * (0.48 + order * 0.55) + phase) * (0.0014 + order * 0.0032)
            + Math.sin(t * (0.9 + order) + phase * 0.7) * gust * 0.0024
        ) * speedFactor * (1 - mass * 0.5);
        angle = Math.max(-0.03, Math.min(0.03, angle));
        motionLocalQuat.setFromAxisAngle(motionAxis, angle);
        motionWorldQuat[i].multiplyQuaternions(motionWorldQuat[p], motionLocalQuat);
    }
    return true;
}

function applyBranchMotion(force = false) {
    const t0 = performance.now();
    const active = computeMotionTransforms();
    if (!active && !branchMotionActive && !force) return;
    if (lodLevel === 'far') return;
    for (let s = 0; s < branchSegmentCount; s++) {
        const nodeIndex = visibleSegmentNodes[s];
        const parent = nodes[nodeIndex].parent;
        const px0 = frame.px[parent], py0 = frame.py[parent], pz0 = frame.pz[parent];
        const wp = motionWorldPivot[nodeIndex];
        const q = motionWorldQuat[nodeIndex];
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
        const m00 = 1 - 2 * (qy * qy + qz * qz);
        const m01 = 2 * (qx * qy - qw * qz);
        const m02 = 2 * (qx * qz + qw * qy);
        const m10 = 2 * (qx * qy + qw * qz);
        const m11 = 1 - 2 * (qx * qx + qz * qz);
        const m12 = 2 * (qy * qz - qw * qx);
        const m20 = 2 * (qx * qz - qw * qy);
        const m21 = 2 * (qy * qz + qw * qx);
        const m22 = 1 - 2 * (qx * qx + qy * qy);
        const base = s * VERTS_PER_SEG * 3;
        for (let v = 0; v < VERTS_PER_SEG; v++) {
            const idx = base + v * 3;
            const dx = branchRestPositions[idx] - px0;
            const dy = branchRestPositions[idx + 1] - py0;
            const dz = branchRestPositions[idx + 2] - pz0;
            if (!active) {
                branchPositions[idx] = branchRestPositions[idx];
                branchPositions[idx + 1] = branchRestPositions[idx + 1];
                branchPositions[idx + 2] = branchRestPositions[idx + 2];
                branchNormals[idx] = branchRestNormals[idx];
                branchNormals[idx + 1] = branchRestNormals[idx + 1];
                branchNormals[idx + 2] = branchRestNormals[idx + 2];
                continue;
            }
            branchPositions[idx] = wp.x + m00 * dx + m01 * dy + m02 * dz;
            branchPositions[idx + 1] = wp.y + m10 * dx + m11 * dy + m12 * dz;
            branchPositions[idx + 2] = wp.z + m20 * dx + m21 * dy + m22 * dz;

            const nx = branchRestNormals[idx];
            const ny = branchRestNormals[idx + 1];
            const nz = branchRestNormals[idx + 2];
            branchNormals[idx] = m00 * nx + m01 * ny + m02 * nz;
            branchNormals[idx + 1] = m10 * nx + m11 * ny + m12 * nz;
            branchNormals[idx + 2] = m20 * nx + m21 * ny + m22 * nz;
        }
    }
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    branchMotionActive = active;
    perf.branchMotion = performance.now() - t0;
}

function applyLeafMotion(force = false) {
    const t0 = performance.now();
    if (lodLevel === 'far') return;
    if (!branchMotionActive && !leafMotionActive && !force) return;
    const active = branchMotionActive;
    for (const species of LEAF_SPECIES) {
        const mesh = leafMeshes[species];
        const bases = mesh.userData.baseMatrices;
        for (let i = 0; i < mesh.count; i++) {
            const baseMatrix = bases[i];
            if (!baseMatrix) continue;
            if (!active) {
                mesh.setMatrixAt(i, baseMatrix);
                continue;
            }
            const nodeIndex = mesh.userData.nodeIndices[i];
            if (nodeIndex == null) continue;
            const parent = nodes[nodeIndex].parent;
            const px0 = frame.px[parent], py0 = frame.py[parent], pz0 = frame.pz[parent];
            const wp = motionWorldPivot[nodeIndex];
            const q = motionWorldQuat[nodeIndex];
            leafMotionMatrix.makeRotationFromQuaternion(q);
            leafMotionMatrix.setPosition(wp);
            leafMotionMatrix.multiply(
                motionMatrixTemp.makeTranslation(-px0, -py0, -pz0)
            );
            leafFinalMatrix.multiplyMatrices(leafMotionMatrix, baseMatrix);
            mesh.setMatrixAt(i, leafFinalMatrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }
    leafMotionActive = active;
    perf.leafMotion = performance.now() - t0;
}

/** Populate instanced leaf transforms and colours for the current `time`. */
function updateLeafMesh(forceFull = false) {
    const { px, py, pz, radius, childCount, present } = frame;
    const seas = currentSeason();
    const gt = growthTime(time);
    const sun = environmentSunDirection(P, '3d');
    const lightYaw = Math.atan2(sun.x, sun.z);
    const waterDroop = (1 - environmentWaterGain(P)) * 0.25;
    let leafWrite = 0;
    leafNodeIndices = [];
    for (const species of LEAF_SPECIES) {
        const mesh = leafMeshes[species];
        mesh.count = 0;
        mesh.userData.nodeIndices.length = 0;
        mesh.userData.baseMatrices.length = 0;
    }

    for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        const node = nodes[i];
        const age = gt - node.birth;
        const traits = (treeTraits && treeTraits[node.tree]) || P;
        const density = (traits.leaves ?? P.leaves) * (childCount[i] === 0 ? 1.4 : 0.6);
        if (age < 0.8 || gt >= node.death || radius[i] > R0 * 2.4 || noise(i, 1) > density) continue;

        const species = leafSpeciesFor(node);
        const mesh = leafMeshes[species] || leafMeshes.oak;
        const size = Math.min(1, (age - 0.8) / 2) * LEAF;
        const leafCount = leafCountForShape(species);
        for (let k = 0; k < leafCount; k++) {
            if (mesh.count >= MAX_LEAVES) break;
            const style = leafStyle(seas, i, k, node);
            if (!style) continue;
            leafWrite++;
            if (!forceFull && lodLevel === 'mid' && (leafWrite % 2 === 0)) continue;
            const yaw = lightYaw + (noise(i, 2 + k) - 0.5) * 1.4;
            const pitch = (noise(i, 10 + k) - 0.45) * 1.1 + waterDroop;
            const roll = (noise(i, 15 + k) - 0.5) * 0.8;

            // Keep the leaf base on the twig; the card extends from the anchor.
            const offset = LEAF * 0.045;
            dummyPos.set(
                px[i] + Math.cos(yaw) * offset,
                py[i] + (noise(i, 20 + k) - 0.3) * offset,
                pz[i] + Math.sin(yaw) * offset
            );
            dummyEuler.set(pitch, yaw, roll, 'YXZ');
            dummyQuat.setFromEuler(dummyEuler);
            const leafSize = size * style.scale;
            dummyScale.set(leafSize, leafSize, leafSize * 0.65);
            dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
            mesh.setMatrixAt(mesh.count, dummyMatrix);
            mesh.userData.baseMatrices[mesh.count] = dummyMatrix.clone();
            tempColor.setHSL(style.h / 360, style.s / 100, style.l / 100);
            mesh.setColorAt(mesh.count, tempColor);
            const motion = motionStateForNode(node);
            mesh.userData.motionAttribute.setXYZW(
                mesh.count, motion.order, motion.phase, motion.mass, motion.path
            );
            mesh.userData.nodeIndices[mesh.count] = i;
            mesh.count++;
        }
    }

    for (const species of LEAF_SPECIES) {
        const mesh = leafMeshes[species];
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.motionAttribute.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
}

/** Choose and apply the current level of detail. */
function updateLODState() {
    let next;
    if (P.quality === 'high') next = 'near';
    else if (P.quality === 'medium') next = 'mid';
    else if (P.quality === 'low') next = 'far';
    else {
        const dist = camera.position.distanceTo(controls.target);
        next = dist < 430 ? 'near' : dist < 820 ? 'mid' : 'far';
        if (autoDrop) next = 'far';
    }
    if (next !== lodLevel) {
        lodLevel = next;
        applyLODVisibility();
        return true;
    }
    return false;
}

function applyLODVisibility() {
    const far = lodLevel === 'far';
    branchMesh.visible = !far;
    for (const species of LEAF_SPECIES) leafMeshes[species].visible = !far;
    farBranchLines.visible = far;
    farLeafPoints.visible = far;
    sunLight.castShadow = !far;

    // Small ground cover is the first thing to drop at the far LOD; larger
    // rocks and shrubs remain as silhouette cues.
    if (typeof grassTuftMesh !== 'undefined') {
        grassTuftMesh.visible = !far;
        pebbleMesh.visible = !far;
        groundLitterMesh.visible = !far;
    }
}

/** Populate cheap far-LOD branch lines and leaf points. */
function updateFarLOD() {
    if (lodLevel !== 'far') return;
    const { px, py, pz, present } = frame;
    let branchCount = 0;
    for (let i = 1; i < nodes.length && branchCount < MAX_NODES; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        if (!present[p]) continue;
        const off = branchCount * 6;
        farBranchPositions[off] = px[p];
        farBranchPositions[off + 1] = py[p];
        farBranchPositions[off + 2] = pz[p];
        farBranchPositions[off + 3] = px[i];
        farBranchPositions[off + 4] = py[i];
        farBranchPositions[off + 5] = pz[i];
        const shade = 0.22 + Math.min(0.24, (nodes[i].order || 0) * 0.04);
        farBranchColors[off] = shade;
        farBranchColors[off + 1] = shade * 0.78;
        farBranchColors[off + 2] = shade * 0.55;
        farBranchColors[off + 3] = shade;
        farBranchColors[off + 4] = shade * 0.78;
        farBranchColors[off + 5] = shade * 0.55;
        branchCount++;
    }
    farBranchPosAttr.needsUpdate = true;
    farBranchColAttr.needsUpdate = true;
    farBranchGeo.setDrawRange(0, branchCount * 2);

    let leafCount = 0;
    for (const species of LEAF_SPECIES) {
        const mesh = leafMeshes[species];
        const colors = mesh.instanceColor;
        for (let i = 0; i < mesh.count && leafCount < MAX_LEAVES; i++) {
            const nodeIndex = mesh.userData.nodeIndices[i];
            if (nodeIndex == null) continue;
            const off = leafCount * 3;
            farLeafPositions[off] = px[nodeIndex];
            farLeafPositions[off + 1] = py[nodeIndex];
            farLeafPositions[off + 2] = pz[nodeIndex];
            if (colors) {
                farLeafColors[off] = colors.array[i * 3];
                farLeafColors[off + 1] = colors.array[i * 3 + 1];
                farLeafColors[off + 2] = colors.array[i * 3 + 2];
            } else {
                farLeafColors[off] = 0.28;
                farLeafColors[off + 1] = 0.42;
                farLeafColors[off + 2] = 0.18;
            }
            leafCount++;
        }
    }
    farLeafPosAttr.needsUpdate = true;
    farLeafColAttr.needsUpdate = true;
    farLeafGeo.setDrawRange(0, leafCount);
}

/** Draw shed subtrees falling to the ground, and accumulate ground litter. */
function updateDebris() {
    const gt = growthTime(time);
    let seg = 0;
    for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.death >= NEVER) continue;
        const t = (gt - node.death) / FALL_DURATION;
        if (t < 0 || t > 1) continue;
        const parent = nodes[node.parent];
        // Only internal shed segments; the branch root detaches from its living parent.
        if (!parent || parent.death !== node.death) continue;

        const drop = 0.5 * FALL_GRAVITY * t * t;
        const ground0 = environmentGroundHeight(P, parent.x, parent.z);
        const ground1 = environmentGroundHeight(P, node.x, node.z);
        const y0 = Math.max(ground0, parent.y - drop);
        const y1 = Math.max(ground1, node.y - drop);
        const off = seg * 6;
        debrisPositions[off] = parent.x; debrisPositions[off + 1] = y0; debrisPositions[off + 2] = parent.z;
        debrisPositions[off + 3] = node.x; debrisPositions[off + 4] = y1; debrisPositions[off + 5] = node.z;
        const fade = 1 - t * 0.45;
        debrisColors[off] = 0.46 * fade; debrisColors[off + 1] = 0.32 * fade; debrisColors[off + 2] = 0.20 * fade;
        debrisColors[off + 3] = 0.46 * fade; debrisColors[off + 4] = 0.32 * fade; debrisColors[off + 5] = 0.20 * fade;
        seg++;
    }
    debrisPosAttr.needsUpdate = true;
    debrisColAttr.needsUpdate = true;
    debrisGeo.setDrawRange(0, seg * 2);
}

/** Place shed material on the ground as litter after it has fallen. */
function updateLitter() {
    const gt = growthTime(time);
    let count = 0;
    for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.death >= NEVER || gt < node.death + FALL_DURATION) continue;
        if (noise(i, 40) > 0.55) continue;
        if (count >= MAX_LITTER) break;
        const yaw = noise(i, 41) * Math.PI * 2;
        const s = 0.55 + noise(i, 42) * 0.8;
        const ground = environmentGroundHeight(P, node.x, node.z);
        dummyPos.set(node.x, ground + 0.2 + noise(i, 43) * 0.12, node.z);
        dummyEuler.set(0, yaw, 0, 'YXZ');
        dummyQuat.setFromEuler(dummyEuler);
        dummyScale.set(s, s, s);
        dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
        litterMesh.setMatrixAt(count, dummyMatrix);
        tempColor.setHSL(0.07 + noise(i, 44) * 0.06, 0.35, 0.20 + noise(i, 45) * 0.14);
        litterMesh.setColorAt(count, tempColor);
        count++;
    }
    litterMesh.count = count;
    litterMesh.instanceMatrix.needsUpdate = true;
    if (litterMesh.instanceColor) litterMesh.instanceColor.needsUpdate = true;
}

/** Update X-ray transparency on bark and leaves. */
function updateXrayMode() {
    const isolate = isolateNode >= 0;
    const dim = viz.xray || isolate;
    branchMat.transparent = dim;
    branchMat.opacity = viz.xray ? 0.25 : isolate ? 0.08 : 1.0;
    branchMat.depthWrite = !dim;
    leafMat.transparent = dim;
    leafMat.opacity = viz.xray ? 0.14 : isolate ? 0.05 : 1.0;
    leafMat.depthWrite = !dim;
    rootMat.transparent = viz.xray;
    rootMat.opacity = viz.xray ? 0.25 : 1.0;
    rootMat.depthWrite = !viz.xray;
    woundMat.transparent = viz.xray;
    woundMat.opacity = viz.xray ? 0.35 : 1.0;
    woundMat.depthWrite = !viz.xray;
}

/** Update 3D skeleton overlay (parent->child segments + coloured node dots). */
function updateSkeletonOverlay() {
    skelLines.visible = viz.skeleton;
    skelPoints.visible = viz.skeleton;
    if (!viz.skeleton) return;

    const { px, py, pz, childCount, present } = frame;
    let lineCount = 0;
    let ptCount = 0;

    for (let i = 0; i < nodes.length; i++) {
        if (!present[i]) continue;
        const pOff = ptCount * 3;
        skelPointPositions[pOff] = px[i];
        skelPointPositions[pOff + 1] = py[i];
        skelPointPositions[pOff + 2] = pz[i];

        const isTip = childCount[i] === 0;
        if (isTip) tempColor.setHex(0x18b858);
        else if (nodes[i].isBranchRoot) tempColor.setHex(0xf59e0b);
        else tempColor.setHex(0x1f2937);

        skelPointColors[pOff] = tempColor.r;
        skelPointColors[pOff + 1] = tempColor.g;
        skelPointColors[pOff + 2] = tempColor.b;
        ptCount++;

        if (i > 0 && nodes[i].parent >= 0) {
            const p = nodes[i].parent;
            const lOff = lineCount * 6;
            skelLinePositions[lOff] = px[p];
            skelLinePositions[lOff + 1] = py[p];
            skelLinePositions[lOff + 2] = pz[p];
            skelLinePositions[lOff + 3] = px[i];
            skelLinePositions[lOff + 4] = py[i];
            skelLinePositions[lOff + 5] = pz[i];
            lineCount++;
        }
    }

    skelLinePosAttr.needsUpdate = true;
    skelLineGeo.setDrawRange(0, lineCount * 2);
    skelPointPosAttr.needsUpdate = true;
    skelPointColAttr.needsUpdate = true;
    skelPointGeo.setDrawRange(0, ptCount);
}

/** Update 3D LightField voxel grid overlay for currently live nodes. */
function updateLightVoxelOverlay() {
    voxelMesh.visible = viz.lightGrid;
    if (!viz.lightGrid) return;

    const { px, py, pz, present } = frame;
    const gt = growthTime(time);
    const cellCounts = new Map();
    for (let i = 0; i < nodes.length; i++) {
        if (!present[i] || gt >= nodes[i].death) continue;
        const ci = Math.floor(px[i] / LIGHT_CELL);
        const cj = Math.floor(py[i] / LIGHT_CELL);
        const ck = Math.floor(pz[i] / LIGHT_CELL);
        const key = `${ci},${cj},${ck}`;
        cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
    }

    let count = 0;
    dummyQuat.identity();
    dummyScale.set(1, 1, 1);
    for (const [key, nCount] of cellCounts) {
        if (count >= MAX_VOXELS) break;
        const [ci, cj, ck] = key.split(',').map(Number);
        dummyPos.set(
            (ci + 0.5) * LIGHT_CELL,
            (cj + 0.5) * LIGHT_CELL,
            (ck + 0.5) * LIGHT_CELL
        );
        dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);
        voxelMesh.setMatrixAt(count, dummyMatrix);

        const intensity = Math.min(1, nCount / 5);
        tempColor.setHSL((48 - intensity * 35) / 360, 0.9, 0.52);
        voxelMesh.setColorAt(count, tempColor);
        count++;
    }

    voxelMesh.count = count;
    voxelMesh.instanceMatrix.needsUpdate = true;
    if (voxelMesh.instanceColor) voxelMesh.instanceColor.needsUpdate = true;
}

function pushVecSegment(idx, x0, y0, z0, x1, y1, z1, r, g, b) {
    const off = idx * 6;
    vecPositions[off] = x0; vecPositions[off + 1] = y0; vecPositions[off + 2] = z0;
    vecPositions[off + 3] = x1; vecPositions[off + 4] = y1; vecPositions[off + 5] = z1;
    vecColors[off] = r; vecColors[off + 1] = g; vecColors[off + 2] = b;
    vecColors[off + 3] = r; vecColors[off + 4] = g; vecColors[off + 5] = b;
}

/** Update 3D tropism steering vectors at active growing tips. */
function updateTropismOverlay() {
    vecLines.visible = viz.vectors;
    if (!viz.vectors) return;

    const { px, py, pz, childCount, present } = frame;
    const scale = 6.5;
    const gt = growthTime(time);
    let segIdx = 0;

    for (let i = 1; i < nodes.length; i++) {
        if (!present[i] || nodes[i].parent < 0) continue;
        const node = nodes[i];
        const growingNow = gt >= node.birth && gt <= node.birth + 1.05;
        if (!growingNow && childCount[i] !== 0) continue;

        const x = px[i], y = py[i], z = pz[i];
        const isLat = node.order > 0;
        const photoPull = P.photo * (isLat ? 1 : 1.5);
        const droopPull = P.droop * Math.min(node.shootAge ?? 1, 8) * 0.06 * (isLat ? 1 : 0.3);

        // Pre-tropism direction (grey)
        if (node.preDirX !== undefined) {
            pushVecSegment(
                segIdx++, x, y, z,
                x + node.preDirX * scale * 0.75,
                y + node.preDirY * scale * 0.75,
                z + node.preDirZ * scale * 0.75,
                0.45, 0.48, 0.52
            );
        }
        // Phototropism +Y (cyan/blue)
        if (photoPull > 0.005) {
            pushVecSegment(
                segIdx++, x, y, z,
                x, y + Math.min(1.5, photoPull * 2.5) * scale, z,
                0.05, 0.65, 0.92
            );
        }
        // Gravitropism / droop -Y (orange)
        if (droopPull > 0.005) {
            pushVecSegment(
                segIdx++, x, y, z,
                x, y - Math.min(1.5, droopPull * 3.2) * scale, z,
                0.98, 0.45, 0.09
            );
        }
        // Resultant segment direction (green)
        const parent = nodes[node.parent];
        const dx = node.x - parent.x, dy = node.y - parent.y, dz = node.z - parent.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        pushVecSegment(
            segIdx++, x, y, z,
            x + (dx / len) * scale * 0.95,
            y + (dy / len) * scale * 0.95,
            z + (dz / len) * scale * 0.95,
            0.09, 0.68, 0.32
        );
    }

    vecPosAttr.needsUpdate = true;
    vecColAttr.needsUpdate = true;
    vecGeo.setDrawRange(0, segIdx * 2);
}

/** Update 3D shed ghost subtrees (`time >= death`) + branchRoot -> mainTip sensor links. */
function updateShedOverlay() {
    shedLines.visible = viz.shed;
    if (!viz.shed) return;

    let segIdx = 0;
    const gt = growthTime(time);
    for (let i = 1; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.death >= NEVER || gt < node.death) continue;
        const parent = nodes[node.parent];
        const off = segIdx * 6;
        shedPositions[off] = parent.x; shedPositions[off + 1] = parent.y; shedPositions[off + 2] = parent.z;
        shedPositions[off + 3] = node.x; shedPositions[off + 4] = node.y; shedPositions[off + 5] = node.z;
        shedColors[off] = 0.88; shedColors[off + 1] = 0.25; shedColors[off + 2] = 0.22;
        shedColors[off + 3] = 0.88; shedColors[off + 4] = 0.25; shedColors[off + 5] = 0.22;
        segIdx++;

        if (node.isBranchRoot && node.mainTip) {
            const tip = nodes[node.mainTip];
            const sOff = segIdx * 6;
            shedPositions[sOff] = node.x; shedPositions[sOff + 1] = node.y; shedPositions[sOff + 2] = node.z;
            shedPositions[sOff + 3] = tip.x; shedPositions[sOff + 4] = tip.y; shedPositions[sOff + 5] = tip.z;
            shedColors[sOff] = 0.96; shedColors[sOff + 1] = 0.65; shedColors[sOff + 2] = 0.08;
            shedColors[sOff + 3] = 0.96; shedColors[sOff + 4] = 0.65; shedColors[sOff + 5] = 0.08;
            segIdx++;
        }
    }

    shedPosAttr.needsUpdate = true;
    shedColAttr.needsUpdate = true;
    shedGeo.setDrawRange(0, segIdx * 2);
}

/** Update the floating legend pill when any visualization mode or overlay is active. */
function updateLegend() {
    const items = [];
    const item = (color, text) => `<span class="legend-item"><i class="swatch" style="background:${color}"></i>${text}</span>`;

    if (viz.colorMode === 'order') {
        ORDER_COLORS_CSS.forEach((c, idx) => items.push(item(c, idx === 0 ? 'Order 0 (trunk)' : `Order ${idx}`)));
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
        items.push(item('#f5af1e', 'LightField voxel'));
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

function setObstacleCap(x, y, z, sx, sz) {
    obstacleMeshes.cutCap.visible = true;
    obstacleMeshes.cutCap.position.set(x, y, z);
    obstacleMeshes.cutCap.scale.set(sx, 1, sz);
    obstacleMeshes.cutRing.visible = true;
    obstacleMeshes.cutRing.position.set(x, y + 0.03, z);
    obstacleMeshes.cutRing.scale.set(sx, 1, sz);
}

/** Show the active obstacle as a translucent preview mesh. */
function updateObstacleMesh() {
    const o = obstacleSpec();
    for (const mesh of Object.values(obstacleMeshes)) mesh.visible = false;
    if (!o) return;
    if (o.type === 'wall') {
        const mesh = o.hedge ? obstacleMeshes.hedge : obstacleMeshes.wall;
        mesh.visible = true;
        mesh.scale.set(o.half * 2, o.height, o.depth);
        mesh.position.set(o.x, o.height / 2, 0);
        if (o.hedge) setObstacleCap(o.x, o.height + 0.1, 0, o.half, o.depth / 2);
    } else if (o.type === 'box') {
        const mesh = obstacleMeshes.wall;
        mesh.visible = true;
        mesh.scale.set(o.half * 2, o.height, o.depth);
        mesh.position.set(o.x, o.height / 2, o.z);
        setObstacleCap(o.x, o.height + 0.1, o.z, o.half, o.depth / 2);
    } else if (o.type === 'sphere') {
        const mesh = P.obstacle === 2 ? obstacleMeshes.boulder : obstacleMeshes.topiarySphere;
        mesh.visible = true;
        mesh.scale.set(o.r, o.r, o.r);
        mesh.position.set(o.x, o.y, o.z);
        if (P.obstacle === 3) setObstacleCap(o.x, o.y + o.r + 0.1, o.z, o.r * 0.45, o.r * 0.45);
    } else if (o.type === 'cone') {
        const mesh = obstacleMeshes.topiaryCone;
        mesh.visible = true;
        mesh.scale.set(o.r, o.h, o.r);
        mesh.position.set(o.x, o.h / 2, o.z);
        setObstacleCap(o.x, o.h + 0.1, o.z, o.r * 0.35, o.r * 0.35);
    }
}

/** Sync ground colours with CSS theme variables. */
function syncThemeColors() {
    const css = getComputedStyle(THEME_ROOT);
    const soil = css.getPropertyValue('--soil').trim();
    const grass = css.getPropertyValue('--grass').trim();
    if (soil) soilMat.color.set(soil);
    if (grass) grassMat.color.set(grass);
}

/** Fit the sun's shadow frustum to the mature tree so old trees still cast shadows. */
function updateShadowCamera(bounds) {
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const extent = Math.max(260, (bounds.maxY || 0) * 0.6, Math.max(spanX, spanZ) * 0.65) + 40;
    const cam = sunLight.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.far = Math.max(900, extent * 3);
    cam.updateProjectionMatrix();

    const cx = (bounds.minX + bounds.maxX) * 0.5;
    const cy = (bounds.maxY || 0) * 0.45;
    const cz = (bounds.minZ + bounds.maxZ) * 0.5;
    const dir = sunDir();
    const dist = extent * 1.6;
    sunLight.target.position.set(cx, cy, cz);
    sunLight.target.updateMatrixWorld();
    sunLight.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
}

/** Look-at point at the centre of the current tree bounds. */
function treeLookAtFromBounds(bounds) {
    const height = Math.max(bounds.maxY, 24) + 14;
    return {
        x: (bounds.minX + bounds.maxX) * 0.5,
        y: Math.max(height * 0.44, 8),
        z: (bounds.minZ + bounds.maxZ) * 0.5,
    };
}

/** Keep the look-at target on the tree while auto look-at is enabled. */
function updateLookAtForBounds(bounds, smooth = false) {
    if (!autoLookAt) return;
    const center = treeLookAtFromBounds(bounds);
    const alpha = smooth ? 0.15 : 1;
    cameraLookAt.lerp(new THREE.Vector3(center.x, center.y, center.z), alpha);
    if (useLookAtForOrbit) controls.target.copy(cameraLookAt);
}

/**
 * Fit the camera distance to `bounds` while keeping the current orbit
 * direction. The orbit target is owned by the look-at/orbit controls, so this
 * never recentres a manually positioned look-at.
 */
function frameCameraToBounds(bounds, smooth = false) {
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const width = Math.max(spanX, spanZ, 28) + 16;
    const height = Math.max(bounds.maxY, 24) + 14;

    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const aspect = Math.max(0.5, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const distV = (height * 0.62) / Math.tan(fovRad * 0.5);
    const distH = (width * 0.62) / (Math.tan(fovRad * 0.5) * aspect);
    const desiredDist = Math.max(distV, distH, 32);

    // Direction from target to camera (preserve user's orbit orientation).
    const offset = camera.position.clone().sub(controls.target);
    const currentDist = offset.length() || 1;
    offset.divideScalar(currentDist);

    const alpha = smooth ? 0.15 : 1.0;
    const nextDist = THREE.MathUtils.lerp(currentDist, desiredDist, alpha);
    camera.position.copy(controls.target).addScaledVector(offset, nextDist);
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
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (let i = n - 1; i >= 0; i--) {
            if (!present[i]) continue;
            const node = nodes[i];
            const pipe = pipeSum[i] > 0 ? Math.pow(pipeSum[i], 1 / PN) : R0;
            if (node.x < minX) minX = node.x;
            if (node.x > maxX) maxX = node.x;
            if (node.y < minY) minY = node.y;
            if (node.y > maxY) maxY = node.y;
            if (node.z < minZ) minZ = node.z;
            if (node.z > maxZ) maxZ = node.z;
            if (i > 0 && node.parent >= 0) {
                const parent = nodes[node.parent];
                const progress = clamp01(step - node.birth) * (1 - clamp01(step - node.death));
                const length = Math.hypot(node.x - parent.x, node.y - parent.y, node.z - parent.z) * progress;
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
            height: Number.isFinite(maxY) ? maxY : 0,
            crownWidth: Number.isFinite(minX) ? Math.max(maxX - minX, maxZ - minZ) : 0,
            leafArea: leafCount * LEAF_CARD_AREA_3D,
            leafLight: leafCount ? leafLightSum / leafCount : 0,
            crownRatio: (Number.isFinite(maxY) ? maxY : 0) > 0
                ? (Number.isFinite(minX) ? Math.max(maxX - minX, maxZ - minZ) : 0) / Math.max(1, maxY)
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
    $('st1').textContent = `height ${(state.maxY / 10).toFixed(1)} m · ${state.segments} segments · ${state.tips} tips${cap}`;
}

/** Recompute skeleton state at `time` and update the 3D meshes. */
function updateSceneFromTime(smoothZoom = false) {
    const state = computeFrameState();
    updateXrayMode();
    updateIsolation();
    updateLODState();
    updateObstacleMesh();
    espalierPlane.visible = !!P.espalier;
    updateSeedMesh();
    if (lodLevel !== 'far') {
        updateBranchMesh();
    }
    updateLeafMesh();
    updateFarLOD();
    if (lodLevel !== 'far') {
        applyBranchMotion(true);
        applyLeafMotion(true);
    }
    updateDebris();
    updateLitter();
    updatePruneMarks();
    updateWounds();
    updateHoverPreview();
    updateSelectionMesh();
    updateSkeletonOverlay();
    updateLightVoxelOverlay();
    updateTropismOverlay();
    updateShedOverlay();
    updateStats(state);
    updateLegend();
    updateSeasonLabel();
    drawAnalytics();
    scheduleStateAutosave();

    updateLookAtForBounds(state, smoothZoom);
    if ($('zoom').checked) {
        frameCameraToBounds(state, smoothZoom);
    }
}

function renderFrame() {
    controls.update();
    camera.lookAt(cameraLookAt);
    if (bloomPass.enabled) composer.render();
    else renderer.render(scene, camera);
}

/** Push time, sway, sun and bark state into the custom shader uniforms. */
function updateShaderUniforms() {
    const t = clock.getElapsedTime();
    const sun = environmentSunDirection(P, '3d');
    const windScale = P.swayWithWind ? 1 + Math.abs(P.wind) * 2.5 : 1;
    const sway = P.sway * windScale;
    const height = Math.max(fullBounds.maxY, 80);
    const day = smoothstep(0, 30, sun.elevation * 180 / Math.PI)
        * Math.max(0.35, environmentSky(P).exposure);
    const dir = sun;
    const windDir = P.windDirection * Math.PI / 180;
    const windSign = P.wind < 0 ? -1 : 1;
    const windX = Math.cos(windDir) * windSign;
    const windZ = Math.sin(windDir) * windSign;
    const windStrength = Math.abs(P.wind) + (P.gustAmp || 0) * 0.35;

    for (const mat of [branchMat, leafMat]) {
        const shader = mat.userData.shader;
        if (!shader) continue;
        if (shader.uniforms.uTime) shader.uniforms.uTime.value = t;
        if (shader.uniforms.uSway) shader.uniforms.uSway.value = 0;
        if (shader.uniforms.uTreeHeight) shader.uniforms.uTreeHeight.value = height;
        if (shader.uniforms.uSunDir) shader.uniforms.uSunDir.value.set(dir.x, dir.y, dir.z);
        if (shader.uniforms.uWetness) shader.uniforms.uWetness.value = clamp01(
            (P.soilMoisture ?? 0.6) * (0.5 + environmentSky(P).overcast * 0.6)
        );
        if (shader.uniforms.uSnow) shader.uniforms.uSnow.value = P.snow ? 0.78 : 0;
        if (shader.uniforms.uLeafGlow) shader.uniforms.uLeafGlow.value = 0.06 + 0.94 * day;
        if (shader.uniforms.uWindX) shader.uniforms.uWindX.value = windX;
        if (shader.uniforms.uWindZ) shader.uniforms.uWindZ.value = windZ;
        if (shader.uniforms.uWindStrength) shader.uniforms.uWindStrength.value = 0;
        if (shader.uniforms.uGust) shader.uniforms.uGust.value = 0;
        if (shader.uniforms.uGustFreq) shader.uniforms.uGustFreq.value = P.gustFreq || 0.8;
        if (shader.uniforms.uFlutter) shader.uniforms.uFlutter.value = mat === leafMat ? sway * 0.35 : 0;
    }
    const branchShader = branchMat.userData.shader;
    if (branchShader) branchShader.uniforms.uBarkStrength.value = viz.colorMode === 'natural' ? 1 : 0;
}

/** Match the WebGL viewport to the canvas CSS size. */
function resizeCanvas() {
    const width = canvas.clientWidth || 800;
    const height = canvas.clientHeight || 480;
    renderer.setSize(width, height, false);
    if (lassoCanvas) { lassoCanvas.width = width; lassoCanvas.height = height; }
    composer.setSize(width, height);
    bloomPass.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!$('zoom').checked) frameCameraToBounds(fullBounds, false);
    else updateSceneFromTime(false);
    renderFrame();
}

/* ==========================================================================
   ! 6. PLAYBACK AND UI
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
    clearPrunes();
    pruneMarks.length = 0;
    clearHover();
    resetCutHistory();
    updateLifespanUI();
    scheduleRegenerate();
}

function setTime(v) {
    time = v;
    $('time').value = v;
    updateSceneFromTime(false);
    postLinkedPatch({ time, season, seasonAuto });
}

/** Backward-compatible simulation progress events for the studio dock. */
function notifySimulateStart() {
    window.dispatchEvent(new CustomEvent('tree-simulate-start', { detail: { dimension: '3d' } }));
}

function notifySimulateEnd() {
    window.dispatchEvent(new CustomEvent('tree-simulate-end', { detail: { dimension: '3d' } }));
}

/** Re-run the 3D simulation (after a parameter or seed change) and update meshes. */
function regenerate() {
    let t0 = performance.now();
    notifySimulateStart();
    try {
        simulate();
    } finally {
        notifySimulateEnd();
    }
    perf.simulate = performance.now() - t0;
    updateTerrain();
    updateContactShadows();
    updateGroundDetail();
    selectedNode = -1;
    clearHover();
    rebuildPruneMarks();
    updateCutButtons();
    const inspector = $('inspector');
    if (inspector) inspector.textContent = 'Click the tree to inspect a node.';
    updateSelectionMesh();
    rebuildRootMesh();
    rebuildWounds();
    $('seedv').textContent = 'seed ' + seed;
    t0 = performance.now();
    computeAnalytics();
    perf.analytics = performance.now() - t0;
    updateShadowCamera(fullBounds);
    updateSceneFromTime(false);
    if (!$('zoom').checked) frameCameraToBounds(fullBounds, false);
}

function setPlaying(on) {
    playing = on;
    $('play').textContent = on ? 'Pause' : 'Play';
    if (LINKED_MODE && !applyingRemote) {
        postLinkedMessage({ type: 'tree-play', playing: on });
    }
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
}

function updatePerfHud() {
    const el = $('perfHud');
    if (!el) return;
    el.hidden = !perfHudVisible;
    if (!perfHudVisible) return;
    const fps = frameTimeAvg > 0 ? 1000 / frameTimeAvg : 0;
    el.textContent = [
        `frame ${frameTimeAvg.toFixed(1)} ms / ${fps.toFixed(0)} fps`,
        `lod ${lodLevel}${P.quality === 'auto' ? (autoDrop ? ' (auto-down)' : ' (auto)') : ''}`,
        `sim ${perf.simulate.toFixed(1)} · analytics ${perf.analytics.toFixed(1)}`,
        `mesh ${perf.branchMesh.toFixed(1)} · motion ${(perf.branchMotion + perf.leafMotion).toFixed(1)}`,
        `render ${perf.render.toFixed(1)} ms`,
        `nodes ${nodes.length}`,
        `segments ${branchSegmentCount}`,
        `leaves ${LEAF_SPECIES.reduce((sum, s) => sum + leafMeshes[s].count, 0)}`,
    ].join('\n');
}

/** Main animation loop (handles both playback and damped orbit camera controls). */
function animate(ts) {
    requestAnimationFrame(animate);
    if (lastAnimateTs) {
        const frameMs = Math.min(150, ts - lastAnimateTs);
        frameTimeAvg = frameTimeAvg * 0.94 + frameMs * 0.06;
        if (P.quality === 'auto') {
            if (frameMs > 22) {
                autoSlowFrames++;
                if (autoSlowFrames > 90) { autoDrop = true; autoSlowFrames = 0; }
            } else {
                autoSlowFrames = 0;
            }
            if (frameMs < 14) {
                autoFastFrames++;
                if (autoFastFrames > 180) { autoDrop = false; autoFastFrames = 0; }
            } else {
                autoFastFrames = 0;
            }
        }
    }
    lastAnimateTs = ts;
    if (updateLODState()) updateSceneFromTime(false);
    if (playing) {
        const dt = Math.min(0.1, (ts - lastFrameTs) / 1000);
        lastFrameTs = ts;
        time += dt * P.speed;
        if (time >= timeEnd()) { time = timeEnd(); setPlaying(false); }
        $('time').value = time;
        updateSceneFromTime(true);
        postLinkedPatch({ time });
    }
    motionFrame++;
    const shouldUpdateMotion = lodLevel === 'near'
        || (lodLevel === 'mid' && motionFrame % 2 === 0);
    if (shouldUpdateMotion) {
        applyBranchMotion();
        applyLeafMotion();
    }
    updateSnow();
    if (!P.reducedMotion && $('spin') && $('spin').checked) {
        const angle = 0.004;
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        camera.position.copy(controls.target).add(offset);
    }
    updateShaderUniforms();
    const renderStart = performance.now();
    renderFrame();
    perf.render = performance.now() - renderStart;
    perf.frame = frameTimeAvg;
    updatePerfHud();
}

/** Slider DOM references, so presets can push values back into the UI. */
const paramInputs = {};

/** Build one labelled slider per entry in PARAM_DEFS. */
function buildParamControls() {
    for (const def of PARAM_DEFS) {
        if (def.scope && def.scope !== 'both' && def.scope !== '3d') continue;
        const { key, label, min, max, step } = def;
        const wrapper = document.createElement('label');
        wrapper.dataset.paramKey = key;
        wrapper.innerHTML =
            `${label}<span>${P[key]}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${P[key]}">`;
        const input = wrapper.querySelector('input');
        const valueSpan = wrapper.querySelector('span');
        paramInputs[key] = { input, valueSpan };
        input.oninput = (e) => {
            P[key] = +e.target.value;
            valueSpan.textContent = P[key];
            if (key !== 'speed' && key !== 'leaves') {
                clearPrunes();
                pruneMarks.length = 0;
                clearHover();
                resetCutHistory();
                setActivePreset('custom');
            }
            if (key === 'speed') return;          // playback only
            if (key === 'leaves') updateLeafMesh(); // leaf instancing only
            else scheduleRegenerate();            // affects 3D growth
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
    clearPrunes();
    pruneMarks.length = 0;
    clearHover();
    resetCutHistory();
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
    if ($('sunAzimuth')) $('sunAzimuth').value = P.sunAzimuth;
    if ($('sunAzimuthLabel')) $('sunAzimuthLabel').textContent = P.sunAzimuth + '°';
    if ($('sunElevation')) $('sunElevation').value = P.sunElevation;
    if ($('sunElevationLabel')) $('sunElevationLabel').textContent = P.sunElevation + '°';
    if ($('wind')) $('wind').value = P.wind;
    if ($('windLabel')) $('windLabel').textContent = P.wind.toFixed(2);
    if ($('sway')) $('sway').value = P.sway;
    if ($('swayLabel')) $('swayLabel').textContent = P.sway.toFixed(2);
    if ($('swayWind')) $('swayWind').checked = P.swayWithWind;
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
    if ($('snow')) $('snow').checked = !!P.snow;
    if ($('bloom')) $('bloom').checked = !!P.bloom;
    if ($('espalier')) $('espalier').checked = !!P.espalier;
    if ($('groundDetail')) $('groundDetail').checked = P.groundDetail !== false;
    if ($('groundDensity')) {
        $('groundDensity').value = P.groundDensity || 'medium';
        $('groundDensity').disabled = P.groundDetail === false;
    }
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
            <span>position</span><b>${n.x.toFixed(1)}, ${n.y.toFixed(1)}, ${n.z.toFixed(1)}</b>
        </div>`;
    updateSelectionMesh();
}

/** Clear the inspected node and any isolation tied to it. */
function clearSelection() {
    const hadSelection = selectedNode >= 0 || isolateNode >= 0;
    selectedNode = -1;
    isolateNode = -1;
    const el = $('inspector');
    if (el) el.textContent = 'Click the tree to inspect a node.';
    clearHover();
    if (hadSelection) {
        updateSelectionMesh();
        updateIsolation();
        updateSceneFromTime(false);
    }
}

/** Prune the node's whole subtree by its stable bud/step identity. */
function pruneNodeAt(index) {
    const node = nodes[index];
    if (!node || node.parent < 0) return;
    const pruneType = $('pruneType') ? $('pruneType').value : 'thinning';
    recordCutAction();
    addPrune(node.budId, node.birthStep, pruneType);
    selectedNode = -1;
    clearHover();
    regenerate();
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

function localCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function beginLasso3D(event) {
    if (!lassoMode || event.button !== 0) return;
    lassoActive = true;
    lassoPoints = [localCanvasPoint(event)];
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
}

function updateLasso3D(event) {
    if (!lassoActive) return;
    const p = localCanvasPoint(event);
    const last = lassoPoints[lassoPoints.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 2) lassoPoints.push(p);
    drawLassoOverlay3D();
}

function finishLasso3D(event) {
    if (!lassoActive) return;
    lassoActive = false;
    const points = lassoPoints.slice();
    lassoPoints = [];
    drawLassoOverlay3D();
    if (points.length < 4) return;
    const rect = canvas.getBoundingClientRect();
    const projected = new THREE.Vector3();
    const selected = [];
    for (let i = 1; i < nodes.length; i++) {
        if (!frame.present[i] || !nodes[i].isBranchRoot) continue;
        projected.set(frame.px[i], frame.py[i], frame.pz[i]).project(camera);
        if (projected.z < -1 || projected.z > 1) continue;
        const x = (projected.x + 1) * 0.5 * rect.width;
        const y = (-projected.y + 1) * 0.5 * rect.height;
        if (pointInPolygon(x, y, points)) selected.push(i);
    }
    if (selected.length) {
        const pruneType = $('pruneType') ? $('pruneType').value : 'thinning';
        recordCutAction();
        for (const i of selected) addPrune(nodes[i].budId, nodes[i].birthStep, pruneType);
        regenerate();
    }
}

function drawLassoOverlay3D() {
    if (!lassoCtx) return;
    const rect = canvas.getBoundingClientRect();
    lassoCtx.clearRect(0, 0, lassoCanvas.width, lassoCanvas.height);
    if (!lassoActive || lassoPoints.length < 2) return;
    lassoCtx.save();
    lassoCtx.strokeStyle = '#e6ab02';
    lassoCtx.fillStyle = 'rgba(230,171,2,0.12)';
    lassoCtx.lineWidth = 2;
    lassoCtx.setLineDash([5, 4]);
    lassoCtx.beginPath();
    lassoCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
    for (let i = 1; i < lassoPoints.length; i++) lassoCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
    lassoCtx.closePath();
    lassoCtx.fill();
    lassoCtx.stroke();
    lassoCtx.restore();
}

function takeSnapshot3D() {
    computeFrameState();
    let count = 0;
    for (let i = 1; i < nodes.length && count < MAX_NODES; i++) {
        if (!frame.present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        if (!frame.present[p]) continue;
        const off = count * 6;
        comparePositions[off] = frame.px[p];
        comparePositions[off + 1] = frame.py[p];
        comparePositions[off + 2] = frame.pz[p];
        comparePositions[off + 3] = frame.px[i];
        comparePositions[off + 4] = frame.py[i];
        comparePositions[off + 5] = frame.pz[i];
        count++;
    }
    compareSnapshot = { count, time, nodes: nodes.length, cuts: prunedCuts.size };
    comparePosAttr.needsUpdate = true;
    compareGeo.setDrawRange(0, count * 2);
    compareMode = true;
    compareLines.visible = true;
    updateSceneFromTime(false);
}

function toggleCompare3D() {
    if (!compareSnapshot) takeSnapshot3D();
    else {
        compareMode = !compareMode;
        compareLines.visible = compareMode;
        updateSceneFromTime(false);
    }
}

function toggleIsolation() {
    if (selectedNode < 0) return;
    isolateNode = isolateNode === selectedNode ? -1 : selectedNode;
    updateIsolation();
    updateSceneFromTime(false);
}

function updateIsolation() {
    if (isolateNode < 0 || !frame.present || !frame.present[isolateNode]) {
        isolateLines.visible = false;
        return;
    }
    const mask = subtreeMask(isolateNode);
    let count = 0;
    for (let i = isolateNode; i < nodes.length && count < MAX_NODES; i++) {
        if (!mask[i] || !frame.present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        if (!frame.present[p]) continue;
        const off = count * 6;
        isolatePositions[off] = frame.px[p];
        isolatePositions[off + 1] = frame.py[p];
        isolatePositions[off + 2] = frame.pz[p];
        isolatePositions[off + 3] = frame.px[i];
        isolatePositions[off + 4] = frame.py[i];
        isolatePositions[off + 5] = frame.pz[i];
        isolateColors[off] = 0.92;
        isolateColors[off + 1] = 0.63;
        isolateColors[off + 2] = 0.05;
        isolateColors[off + 3] = 0.92;
        isolateColors[off + 4] = 0.63;
        isolateColors[off + 5] = 0.05;
        count++;
    }
    isolatePosAttr.needsUpdate = true;
    isolateColAttr.needsUpdate = true;
    isolateGeo.setDrawRange(0, count * 2);
    isolateLines.visible = count > 0;
}

/** Pick the branch or leaf node under the pointer, with a screen-space fallback. */
function pickNodeAt(event) {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);

    const branchHits = raycaster.intersectObject(branchMesh, false);
    const triPerSeg = INDICES_PER_SEG / 3;
    for (const hit of branchHits) {
        const seg = Math.floor(hit.faceIndex / triPerSeg);
        if (seg >= 0 && seg < branchSegmentCount) {
            const nodeIndex = visibleSegmentNodes[seg];
            if (nodeIndex != null) return nodeIndex;
        }
    }

    const leafHits = raycaster.intersectObjects(Object.values(leafMeshes), false);
    if (leafHits.length && leafHits[0].instanceId != null) {
        const nodeIndex = leafHits[0].object.userData.nodeIndices[leafHits[0].instanceId];
        if (nodeIndex != null) return nodeIndex;
    }

    // Fallback: nearest visible segment in screen space, so thin twigs are
    // still easy to hit even when the ray slips past their triangles.
    let best = -1;
    let bestDist = 14;
    for (let i = 1; i < nodes.length; i++) {
        if (!frame.present[i] || nodes[i].parent < 0) continue;
        const p = nodes[i].parent;
        pickVec.set(frame.px[p], frame.py[p], frame.pz[p]).project(camera);
        if (pickVec.z < -1 || pickVec.z > 1) continue;
        const x1 = rect.left + (pickVec.x + 1) * 0.5 * rect.width;
        const y1 = rect.top + (-pickVec.y + 1) * 0.5 * rect.height;
        pickVec.set(frame.px[i], frame.py[i], frame.pz[i]).project(camera);
        if (pickVec.z < -1 || pickVec.z > 1) continue;
        const x2 = rect.left + (pickVec.x + 1) * 0.5 * rect.width;
        const y2 = rect.top + (-pickVec.y + 1) * 0.5 * rect.height;
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((event.clientX - x1) * dx + (event.clientY - y1) * dy) / len2));
        const d = Math.hypot(event.clientX - (x1 + t * dx), event.clientY - (y1 + t * dy));
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

/** Raycast a click and prune the branch or leaf node under the pointer. */
function handleCanvasPrune(event) {
    if (!pruneMode) return;
    const index = pickNodeAt(event);
    if (index >= 0) pruneNodeAt(index);
}

/** Update the red subtree ghost while hovering in Prune mode. */
function handleCanvasHover(event) {
    if (!pruneMode || lassoMode) return;
    const now = performance.now();
    if (now - lastHoverPick < 40) return;
    lastHoverPick = now;
    const index = pickNodeAt(event);
    if (index === hoverNode) return;
    hoverNode = index;
    hoverSubtree = null;
    hoverSubtreeFor = -1;
    updateHoverPreview();
}

function handleCanvasLeave() {
    if (hoverNode < 0 && !hoverLines.visible) return;
    clearHover();
}

/** Build the current visible tree (branches + leaves) as a binary GLB blob. */
function buildGlbBlob() {
    return new Promise((resolve, reject) => {
        const savedLod = lodLevel;
        const requestedLod = ['near', 'mid', 'far'].includes(exportSettings.glbLod)
            ? exportSettings.glbLod
            : 'near';
        lodLevel = requestedLod;
        updateBranchMesh();
        applyBranchMotion(true);
        updateLeafMesh(true);
        lodLevel = savedLod;
        applyLODVisibility();

        const geo = new THREE.BufferGeometry();
        const vertexCount = branchSegmentCount * VERTS_PER_SEG;
        if (vertexCount > 0) {
            for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3]]) {
                const src = branchGeo.getAttribute(name);
                geo.setAttribute(name, new THREE.BufferAttribute(src.array.slice(0, vertexCount * size), size));
            }
            const indexCount = branchSegmentCount * INDICES_PER_SEG;
            geo.setIndex(new THREE.BufferAttribute(branchGeo.index.array.slice(0, indexCount), 1));

            const normals = geo.getAttribute('normal');
            if (normals) {
                const a = normals.array;
                for (let i = 0; i < a.length; i += 3) {
                    const len = Math.hypot(a[i], a[i + 1], a[i + 2]);
                    if (len < 1e-6) { a[i] = 0; a[i + 1] = 1; a[i + 2] = 0; }
                    else { a[i] /= len; a[i + 1] /= len; a[i + 2] /= len; }
                }
                normals.needsUpdate = true;
            }
        }

        const branchOut = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.9,
            metalness: 0.0,
        }));

        const leafOuts = [];
        for (const species of LEAF_SPECIES) {
            const mesh = leafMeshes[species];
            if (!mesh.count) continue;
            const leafExportGeo = leafGeos[species].clone();
            const leafNormals = leafExportGeo.getAttribute('normal');
            if (leafNormals) {
                const a = leafNormals.array;
                for (let i = 0; i < a.length; i += 3) {
                    const len = Math.hypot(a[i], a[i + 1], a[i + 2]);
                    if (len < 1e-6) { a[i] = 0; a[i + 1] = 1; a[i + 2] = 0; }
                    else { a[i] /= len; a[i + 1] /= len; a[i + 2] /= len; }
                }
                leafNormals.needsUpdate = true;
            }
            const leafOut = new THREE.InstancedMesh(
                leafExportGeo,
                new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.65 }),
                Math.max(1, mesh.count)
            );
            leafOut.name = `leaves-${species}`;
            leafOut.count = mesh.count;
            leafOut.instanceMatrix.copy(mesh.instanceMatrix);
            if (mesh.instanceColor) leafOut.instanceColor = mesh.instanceColor.clone();
            leafOut.instanceMatrix.needsUpdate = true;
            leafOuts.push(leafOut);
        }

        const includeLeaves = exportSettings.glbLeaves !== false && requestedLod !== 'far';
        const includeRoots = exportSettings.glbRoots !== false;
        const includeMetadata = exportSettings.glbMetadata !== false;
        const axis = exportSettings.glbAxis || 'y';
        const units = exportSettings.glbUnits || 'm';
        const group = new THREE.Group();
        group.name = 'parametric-tree';
        group.add(branchOut);
        if (includeLeaves) for (const leafOut of leafOuts) group.add(leafOut);
        if (includeRoots && rootGroup.children.length) {
            const rootsOut = rootGroup.clone(true);
            rootsOut.name = 'roots';
            group.add(rootsOut);
        }
        if (axis === 'z') group.rotation.x = Math.PI / 2;
        group.scale.setScalar(units === 'm' ? 0.1 : 1);
        if (includeMetadata) {
            group.userData = {
                seed,
                dimension: '3d',
                units,
                axis,
                time,
                lod: requestedLod,
                cuts: Array.from(prunedCuts.keys()),
            };
        }

        const exporter = new GLTFExporter();
        exporter.parse(group, (result) => {
            resolve(new Blob([result], { type: 'model/gltf-binary' }));
        }, reject, { binary: true });
    });
}

/** Export the current visible tree (branches + leaves) as a binary GLB. */
async function exportGlb() {
    try {
        const blob = await buildGlbBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `parametric-tree-${Math.round(time)}y.glb`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error('GLB export failed', error);
        showToast(`GLB export failed: ${error.message || error}`);
    }
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
    if (playing) setPlaying(false);
    try {
        const stateJson = stateToJson(captureAppState());
        const glb = await buildGlbBlob();
        const files = [
            { name: 'current.glb', data: new Uint8Array(await glb.arrayBuffer()) },
        ];
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
        setTime(liveTime);
        if (wasPlaying) setPlaying(true);
    }
}

/** Normalise an [x,y,z] or {x,y,z} camera value. */
function cameraVector(value) {
    if (Array.isArray(value) && value.length >= 3
        && value.slice(0, 3).every((n) => Number.isFinite(Number(n)))) {
        return [Number(value[0]), Number(value[1]), Number(value[2])];
    }
    if (value && ['x', 'y', 'z'].every((key) => Number.isFinite(Number(value[key])))) {
        return [Number(value.x), Number(value.y), Number(value.z)];
    }
    return null;
}

function cameraSettings() {
    return {
        position: camera.position.toArray(),
        lookAt: cameraLookAt.toArray(),
        orbitTarget: controls.target.toArray(),
        fov: camera.fov,
        autoLookAt,
        useLookAtForOrbit,
        orbitEnabled: !!$('spin')?.checked,
        autoZoom: !!$('zoom')?.checked,
        limitsEnabled: cameraLimitsEnabled,
    };
}

/** Apply a partial camera update from the View menu or bridge. */
function setCameraSettings(patch = {}) {
    if (!patch || typeof patch !== 'object') return cameraSettings();
    const position = cameraVector(patch.position);
    const lookAt = cameraVector(patch.lookAt);
    const orbitTarget = cameraVector(patch.orbitTarget);
    let nextAutoLookAt = 'autoLookAt' in patch ? !!patch.autoLookAt : autoLookAt;
    let nextUseLookAtForOrbit = 'useLookAtForOrbit' in patch
        ? !!patch.useLookAtForOrbit
        : useLookAtForOrbit;

    if ('limitsEnabled' in patch) applyCameraLimits(!!patch.limitsEnabled);

    if (position) {
        camera.position.set(...position);
        // A manual camera position is an explicit override of auto-framing.
        if ($('zoom')) $('zoom').checked = false;
    }
    if (lookAt) {
        cameraLookAt.set(...lookAt);
        if (!('autoLookAt' in patch)) nextAutoLookAt = false;
    }
    if ('autoLookAt' in patch && nextAutoLookAt) {
        const center = treeLookAtFromBounds(computeFrameState());
        cameraLookAt.set(center.x, center.y, center.z);
    }
    if (orbitTarget) {
        controls.target.set(...orbitTarget);
        if (!('useLookAtForOrbit' in patch)) nextUseLookAtForOrbit = false;
    }

    autoLookAt = nextAutoLookAt;
    useLookAtForOrbit = nextUseLookAtForOrbit;
    if (useLookAtForOrbit) controls.target.copy(cameraLookAt);

    if ('fov' in patch) {
        const fov = Math.min(120, Math.max(15, Number(patch.fov) || camera.fov));
        camera.fov = fov;
        camera.updateProjectionMatrix();
        if ($('zoom')?.checked) frameCameraToBounds(computeFrameState(), false);
    }
    if ('orbitEnabled' in patch && $('spin')) {
        $('spin').checked = !!patch.orbitEnabled;
    }

    controls.update();
    camera.lookAt(cameraLookAt);
    scheduleStateAutosave();
    return cameraSettings();
}

/** Restore the default three-quarter camera and auto framing. */
function resetCamera() {
    autoLookAt = true;
    useLookAtForOrbit = true;
    applyCameraLimits(true);
    camera.fov = 42;
    camera.updateProjectionMatrix();
    camera.position.set(180, 120, 240);
    if ($('zoom')) $('zoom').checked = true;
    const state = computeFrameState();
    const center = treeLookAtFromBounds(state);
    cameraLookAt.set(center.x, center.y, center.z);
    controls.target.copy(cameraLookAt);
    frameCameraToBounds(state, false);
    controls.update();
    camera.lookAt(cameraLookAt);
    scheduleStateAutosave();
    return cameraSettings();
}

/** Apply a camera object from saved state or a record snapshot. */
function applyCameraState(state) {
    if (!state) return;
    const position = cameraVector(state.position);
    const target = cameraVector(state.target);
    const lookAt = cameraVector(state.lookAt);
    applyCameraLimits(state.limitsEnabled !== undefined ? !!state.limitsEnabled : true);
    if (position) camera.position.set(...position);
    if (target) controls.target.set(...target);
    if (lookAt) cameraLookAt.set(...lookAt);
    else if (target) cameraLookAt.set(...target);
    autoLookAt = state.autoLookAt !== undefined ? !!state.autoLookAt : true;
    useLookAtForOrbit = state.useLookAtForOrbit !== undefined ? !!state.useLookAtForOrbit : true;
    if (state.fov !== undefined) {
        const fov = Number(state.fov);
        if (Number.isFinite(fov)) {
            camera.fov = Math.min(120, Math.max(15, fov));
            camera.updateProjectionMatrix();
        }
    }
    if (state.orbitEnabled !== undefined && $('spin')) {
        $('spin').checked = !!state.orbitEnabled;
    }
    if (useLookAtForOrbit) controls.target.copy(cameraLookAt);
    controls.update();
    camera.lookAt(cameraLookAt);
}

function captureAppState() {
    return captureTreeState({
        dimension: DIMENSION,
        seed,
        P,
        prunedCuts,
        time,
        season,
        seasonAuto,
        activePreset,
        viz,
        compare: analyticsBaseline ? {
            enabled: analyticsCompare,
            baseline: analyticsBaseline,
        } : null,
        exportSettings: Object.assign({}, exportSettings),
        camera: {
            position: camera.position,
            target: controls.target,
            fov: camera.fov,
            lookAt: cameraLookAt,
            autoLookAt,
            useLookAtForOrbit,
            orbitEnabled: !!$('spin')?.checked,
            limitsEnabled: cameraLimitsEnabled,
        },
    });
}

function scheduleStateAutosave() {
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
    const previousSelection = selectedNode >= 0 ? nodes[selectedNode] : null;
    const previousSelectionId = previousSelection
        ? `${previousSelection.budId}:${previousSelection.birthStep}`
        : null;
    if (state.dimension && state.dimension !== DIMENSION && !LINKED_MODE) {
        const url = new URL(window.location.href);
        url.searchParams.set('state', encodeTreeState(state));
        window.location.href = `../prototype/2d-prototype.html${url.search}`;
        return;
    }
    applyTreeStateParams(state, P);
    setSeedValue(state.seed ?? seed);
    time = Math.min(timeEnd(), Math.max(0, state.time ?? time));
    season = state.season ?? season;
    seasonAuto = !!state.seasonAuto;
    if ($('seasonAuto')) $('seasonAuto').checked = seasonAuto;
    activePreset = state.activePreset || 'custom';
    if (state.viz) Object.assign(viz, state.viz);
    P.bloom = !!P.bloom;
    P.snow = !!P.snow;

    prunedCuts.clear();
    for (const [key, type] of (state.cuts || [])) {
        prunedCuts.set(key, { type: CUT_TYPES[type] ? type : 'thinning' });
    }
    clearHover();
    resetCutHistory();

    if (state.camera && state.camera.position && state.camera.target) {
        applyCameraState(state.camera);
    }

    syncParamInputs();
    updateEnvUI();
    updateLifespanUI();
    updateSeasonLabel();
    setActivePreset(activePreset);
    if (bloomPass) bloomPass.enabled = !!P.bloom;
    branchMat.wireframe = !!viz.wireframe;
    if ($('vizColor')) $('vizColor').value = viz.colorMode;
    if ($('vizSkeleton')) $('vizSkeleton').checked = !!viz.skeleton;
    if ($('vizLight')) $('vizLight').checked = !!viz.lightGrid;
    if ($('vizVectors')) $('vizVectors').checked = !!viz.vectors;
    if ($('vizShed')) $('vizShed').checked = !!viz.shed;
    if ($('vizXray')) $('vizXray').checked = !!viz.xray;
    if ($('vizWire')) $('vizWire').checked = !!viz.wireframe;

    if (state.compare && state.compare.baseline) {
        analyticsBaseline = Object.assign({}, state.compare.baseline, {
            points: (state.compare.baseline.points || []).map((point) => Object.assign({}, point)),
        });
        analyticsCompare = !!state.compare.enabled;
    } else {
        analyticsBaseline = null;
        analyticsCompare = false;
    }
    analyticsHover = null;
    updateAnalyticsUI();
    if (state.exportSettings) Object.assign(exportSettings, state.exportSettings);
    syncExportSettingsUI();

    $('seedv').textContent = 'seed ' + seed;
    regenerate();
    if (state.camera && state.camera.position && state.camera.target) {
        if (!LINKED_MODE && $('zoom')) $('zoom').checked = false;
        applyCameraState(state.camera);
    }
    if (options.preserveSelection && previousSelectionId && selectionEnabled) {
        const restoredIndex = nodes.findIndex((node) => `${node.budId}:${node.birthStep}` === previousSelectionId);
        if (restoredIndex >= 0) selectNode(restoredIndex);
        else clearSelection();
    }
    if (!options.skipAutosave) scheduleStateAutosave();
}

function exportStateJson() {
    downloadTextFile(
        `parametric-tree-3d-seed-${seed}.json`,
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
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    const target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(previous);
    target.dispose();

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const g = out.getContext('2d');
    const image = g.createImageData(width, height);
    for (let y = 0; y < height; y++) {
        const src = (height - 1 - y) * width * 4;
        image.data.set(pixels.subarray(src, src + width * 4), y * width * 4);
    }
    g.putImageData(image, 0, 0);
    out.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `parametric-tree-3d-${Math.round(time)}y.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
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
            else updateSceneFromTime(false);
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
        clearPrunes();
        pruneMarks.length = 0;
        clearHover();
        resetCutHistory();
        regenerate();
    };
    $('reset').onclick = () => { setPlaying(false); setTime(0); };
    if ($('prune')) $('prune').onclick = () => {
        pruneMode = !pruneMode;
        if (pruneMode) lassoMode = false;
        $('prune').classList.toggle('active', pruneMode);
        if ($('lasso')) $('lasso').classList.toggle('active', lassoMode);
        canvas.style.cursor = (pruneMode || lassoMode) ? 'crosshair' : '';
        if (!pruneMode) clearHover();
    };
    if ($('lasso')) $('lasso').onclick = () => {
        lassoMode = !lassoMode;
        if (lassoMode) pruneMode = false;
        $('lasso').classList.toggle('active', lassoMode);
        if ($('prune')) $('prune').classList.toggle('active', pruneMode);
        canvas.style.cursor = (pruneMode || lassoMode) ? 'crosshair' : '';
        clearHover();
    };
    if ($('isolate')) $('isolate').onclick = toggleIsolation;
    if ($('snapshot')) $('snapshot').onclick = takeSnapshot3D;
    if ($('compare')) $('compare').onclick = toggleCompare3D;
    if ($('clearCuts')) $('clearCuts').onclick = () => {
        if (!prunedCuts.size) return;
        recordCutAction();
        clearPrunes();
        pruneMarks.length = 0;
        clearHover();
        regenerate();
    };
    if ($('undoCut')) $('undoCut').onclick = undoCut;
    if ($('redoCut')) $('redoCut').onclick = redoCut;
    if ($('exportGlb')) $('exportGlb').onclick = exportGlb;
    if ($('exportCsv')) $('exportCsv').onclick = exportAnalyticsCsv;
    if ($('exportBatch')) $('exportBatch').onclick = exportBatchZip;
    if ($('exportJson')) $('exportJson').onclick = () => downloadTextFile(
        `parametric-tree-analytics-seed-${seed}${analyticsBaseline ? '-compare' : ''}.json`,
        JSON.stringify(analyticsBaseline ? {
            current: analytics,
            baseline: analyticsBaseline,
            comparison: analyticsComparisonRows(),
        } : analytics, null, 2)
    );
    if ($('analyticsPin')) $('analyticsPin').onclick = pinAnalyticsBaseline;
    if ($('analyticsCompare')) $('analyticsCompare').onclick = toggleAnalyticsCompare;
    if ($('analyticsClear')) $('analyticsClear').onclick = clearAnalyticsBaseline;
    bindAnalyticsChart();
    updateAnalyticsUI();
    if ($('exportPng')) $('exportPng').onclick = exportPng;
    if ($('saveState')) $('saveState').onclick = exportStateJson;
    if ($('loadState')) $('loadState').onclick = () => $('loadStateFile').click();
    if ($('loadStateFile')) $('loadStateFile').onchange = (e) => {
        loadStateFile(e.target.files && e.target.files[0]);
        e.target.value = '';
    };
    if ($('shareState')) $('shareState').onclick = copyShareLink;
    canvas.addEventListener('pointerdown', (e) => {
        pointerDownPos = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
        beginLasso3D(e);
    });
    canvas.addEventListener('pointermove', (e) => {
        if (lassoActive) updateLasso3D(e);
        else handleCanvasHover(e);
    });
    canvas.addEventListener('pointerleave', () => { handleCanvasLeave(); drawLassoOverlay3D(); });
    canvas.addEventListener('pointercancel', () => { lassoActive = false; lassoPoints = []; drawLassoOverlay3D(); });
    canvas.addEventListener('pointerup', (e) => {
        if (lassoActive) {
            finishLasso3D(e);
            pointerDownPos = null;
            return;
        }
        if (!pointerDownPos || e.button !== 0) {
            pointerDownPos = null;
            return;
        }
        const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        pointerDownPos = null;
        if (moved >= 5) return;
        if (pruneMode) {
            handleCanvasPrune(e);
        } else if (selectionEnabled) {
            const index = pickNodeAt(e);
            if (index >= 0) selectNode(index);
            else clearSelection();
        }
    });
    canvas.addEventListener('pointercancel', () => { pointerDownPos = null; });
    $('zoom').onchange = () => {
        if ($('zoom').checked) updateSceneFromTime(false);
        else frameCameraToBounds(fullBounds, false);
    };
    if ($('lifespan')) $('lifespan').oninput = (e) => setLifespan(+e.target.value);
    if ($('sunAzimuth')) $('sunAzimuth').oninput = (e) => {
        P.sunAzimuth = +e.target.value;
        $('sunAzimuthLabel').textContent = P.sunAzimuth + '°';
        scheduleRegenerate();
    };
    if ($('sunElevation')) $('sunElevation').oninput = (e) => {
        P.sunElevation = +e.target.value;
        $('sunElevationLabel').textContent = P.sunElevation + '°';
        updateDayNight();
        scheduleRegenerate();
    };
    if ($('wind')) $('wind').oninput = (e) => {
        P.wind = +e.target.value;
        $('windLabel').textContent = P.wind.toFixed(2);
        scheduleRegenerate();
    };
    if ($('sway')) $('sway').oninput = (e) => {
        P.sway = +e.target.value;
        $('swayLabel').textContent = P.sway.toFixed(2);
    };
    if ($('swayWind')) $('swayWind').onchange = (e) => {
        P.swayWithWind = e.target.checked;
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
    if ($('groundDetail')) $('groundDetail').onchange = (e) => {
        P.groundDetail = e.target.checked;
        if ($('groundDensity')) $('groundDensity').disabled = !P.groundDetail;
        updateGroundDetail();
    };
    if ($('groundDensity')) $('groundDensity').onchange = (e) => {
        P.groundDensity = e.target.value;
        updateGroundDetail();
    };
    if ($('snow')) $('snow').onchange = (e) => {
        P.snow = e.target.checked;
        updateSnow();
    };
    if ($('bloom')) $('bloom').onchange = (e) => {
        P.bloom = e.target.checked;
        bloomPass.enabled = P.bloom;
    };
    if ($('espalier')) $('espalier').onchange = (e) => {
        P.espalier = e.target.checked;
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
        updateSceneFromTime(false);
        postLinkedPatch({ season, seasonAuto: false });
    };
    if ($('seasonAuto')) $('seasonAuto').onchange = (e) => {
        seasonAuto = e.target.checked;
        updateSeasonLabel();
        updateSceneFromTime(false);
        postLinkedPatch({ season, seasonAuto });
    };
    if ($('vizColor')) $('vizColor').onchange = (e) => { viz.colorMode = e.target.value; updateSceneFromTime(false); };
    if ($('vizSkeleton')) $('vizSkeleton').onchange = (e) => { viz.skeleton = e.target.checked; updateSceneFromTime(false); };
    if ($('vizLight')) $('vizLight').onchange = (e) => { viz.lightGrid = e.target.checked; updateSceneFromTime(false); };
    if ($('vizVectors')) $('vizVectors').onchange = (e) => { viz.vectors = e.target.checked; updateSceneFromTime(false); };
    if ($('vizShed')) $('vizShed').onchange = (e) => { viz.shed = e.target.checked; updateSceneFromTime(false); };
    if ($('vizWire')) $('vizWire').onchange = (e) => {
        viz.wireframe = e.target.checked;
        branchMat.wireframe = viz.wireframe;
        updateSceneFromTime(false);
    };
    if ($('vizPerf')) $('vizPerf').onchange = (e) => {
        perfHudVisible = e.target.checked;
        updatePerfHud();
    };
    if ($('vizXray')) $('vizXray').onchange = (e) => { viz.xray = e.target.checked; updateSceneFromTime(false); };
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
        if (e.metaKey || e.ctrlKey) {
            if (key === 'z') {
                e.preventDefault();
                if (e.shiftKey) redoCut(); else undoCut();
            } else if (key === 'y') {
                e.preventDefault();
                redoCut();
            }
            return;
        }
        if (key === 'p') {
            e.preventDefault();
            if ($('prune')) $('prune').click();
        } else if (key === 'l') {
            e.preventDefault();
            if ($('lasso')) $('lasso').click();
        } else if (key === 'i') {
            e.preventDefault();
            toggleIsolation();
        } else if (key === 'escape') {
            lassoActive = false;
            lassoPoints = [];
            isolateNode = -1;
            compareMode = false;
            compareLines.visible = false;
            clearHover();
            clearSelection();
            updateIsolation();
            updateSceneFromTime(false);
        }
    });
    window.addEventListener('resize', resizeCanvas);
}

/* ==========================================================================
   ! 7. STARTUP
   ========================================================================== */

// Small read-only debug surface for tests and the node inspector workflow.
window.__tree3d = {
    get nodes() { return nodes; },
    get rootSystem() { return rootSystem; },
    get time() { return time; },
    get season() { return season; },
    get seed() { return seed; },
    get canvas() { return canvas; },
    get leafCount() { return LEAF_SPECIES.reduce((sum, species) => sum + leafMeshes[species].count, 0); },
    get branchSegments() { return branchSegmentCount; },
    get rootMeshes() { return rootMeshes.length; },
    get analytics() { return analytics; },
    get groundDetail() {
        return {
            visible: groundDetailGroup.visible,
            density: P.groundDensity || 'medium',
            grass: grassTuftMesh.count,
            pebbles: pebbleMesh.count,
            rocks: rockMesh.count,
            shrubs: shrubMesh.count,
            litter: groundLitterMesh.count,
            centerX: lastGroundScatter.centerX,
            centerZ: lastGroundScatter.centerZ,
            radius: lastGroundScatter.radius,
        };
    },
    get perf() { return perf; },
    get lodLevel() { return lodLevel; },
    captureState() { return captureAppState(); },
    restoreState(state) { restoreAppState(state, { skipAutosave: true }); },
    get frameTimeAvg() { return frameTimeAvg; },
    get hoverNode() { return hoverNode; },
    get undoDepth() { return cutHistory.length; },
    get redoDepth() { return cutFuture.length; },
    setSeed(v) {
        setSeedValue(v);
        clearPrunes();
        pruneMarks.length = 0;
        clearHover();
        resetCutHistory();
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
        updateSceneFromTime(false);
    },
    setSeasonSilent(v) {
        season = v;
        seasonAuto = false;
        updateSeasonLabel();
        updateSceneFromTime(false);
    },
    captureGrid(width = 80, height = 50) {
        renderer.render(scene, camera);
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const g = c.getContext('2d');
        g.drawImage(renderer.domElement, 0, 0, width, height);
        return Array.from(g.getImageData(0, 0, width, height).data);
    },
    get selectedNode() { return selectedNode; },
    get selectionEnabled() { return selectionEnabled; },
    clearSelection,
    setSelectionEnabled(enabled) {
        selectionEnabled = !!enabled;
        if (!selectionEnabled) clearSelection();
    },
    /** Screen position of a node inside the pane canvas, for the anchored inspector. */
    nodeScreenPosition(index = selectedNode) {
        if (index < 0 || !frame.present || !frame.present[index]) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const projected = new THREE.Vector3(frame.px[index], frame.py[index], frame.pz[index]).project(camera);
        if (projected.z < -1 || projected.z > 1) return null;
        return {
            x: (projected.x + 1) * 0.5 * rect.width,
            y: (-projected.y + 1) * 0.5 * rect.height,
            width: rect.width,
            height: rect.height,
        };
    },
    captureCamera() {
        return cameraSettings();
    },
    getCameraSettings() {
        return cameraSettings();
    },
    setCameraSettings(patch) {
        return setCameraSettings(patch);
    },
    resetCamera() {
        return resetCamera();
    },
    setCameraPose(pose) {
        applyCameraState(pose);
    },
    resize() { resizeCanvas(); },
    selectNode,
    pruneSelected() {
        if (selectedNode < 0) return false;
        pruneNodeAt(selectedNode);
        return true;
    },
    leafStyleAt(i, k = 0) { return leafStyle(currentSeason(), i, k, nodes[i]); },
};

// Standalone pages keep the legacy parameter global used by the visual test
// harness. The split-view app does not need or expose it.
if (!APP_BUS) {
    Object.defineProperty(window, 'P', { get: () => P, configurable: true });
}

syncThemeColors();
buildPresetControls();
buildParamControls();
bindControls();
updateDayNight();
notifySimulateStart();
simulate();
notifySimulateEnd();
updateTerrain();
updateContactShadows();
updateGroundDetail();
rebuildPruneMarks();
updateCutButtons();
rebuildRootMesh();
rebuildWounds();
$('seedv').textContent = 'seed ' + seed;
computeAnalytics();
updateShadowCamera(fullBounds);
updateLifespanUI();
updateEnvUI();
updateSeasonLabel();
resizeCanvas();
updateSceneFromTime(false);

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

requestAnimationFrame(animate);
