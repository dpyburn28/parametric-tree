/**
 * Shared growth parameters and UI definitions.
 *
 * Loaded as a classic script before simulation.js in both prototypes. The
 * common defaults live here; each prototype applies its own dimension-specific
 * defaults so the 2D and 3D models keep their established character while
 * sharing the same parameter vocabulary.
 */

'use strict';

/** Default phenology: a generic deciduous broadleaf. */
const DEFAULT_PHENOLOGY = {
    leafOut: 0.02,
    leafFull: 0.16,
    leafDrop: 0.78,
    leafDropEnd: 1.0,
    autumnStart: 0.5,
    autumnEnd: 0.8,
    autumnHue: 45,
    leafHue: 100,
    leafSat: 50,
    leafLight: 34,
    evergreen: false,
    flowerStart: -1,
    flowerEnd: -1,
    flowerHue: 330,
    fruitStart: -1,
    fruitEnd: -1,
    fruitHue: 15,
};

/**
 * Parameters shared by both dimensions. Anything that changes growth or the
 * species grammar belongs here; render-only values stay in the dimension
 * defaults below.
 */
const BASE_PARAMS = {
    lifespan: 300,

    // Core growth
    angle: 40,
    branch: 0.55,
    apical: 0.35,
    sympodial: 0.2,
    photo: 0.15,
    droop: 0.2,
    shade: 0.5,
    shed: 0.4,

    // Botanical grammar
    angleOrderBias: [1, 1, 0.9, 0.8, 0.7],
    plagiotropism: 0.35,
    tortuosity: 0.25,
    reiteration: 0.2,
    rootFlare: 0.6,
    rootCount: 6,
    rootSpread: 28,
    phenology: Object.assign({}, DEFAULT_PHENOLOGY),

    // Environment
    wind: 0,
    obstacle: 0,
    obstacleSize: 60,
    trees: 1,

    // Solar / sky
    solarModel: false,
    latitude: 40,
    dayOfYear: 172,
    hour: 12,
    skyPreset: 'clear',
    sunSamples: 3,
    skyLight: 0.08,
    exposure: 1.0,
    fogDensity: 0.0008,
    quality: 'auto',
    snow: false,
    bloom: false,
    reducedMotion: false,
    espalier: false,
    groundDetail: true,
    groundDensity: 'medium',

    // Wind field
    windDirection: 0,
    gustAmp: 0.18,
    gustFreq: 0.8,
    windShelter: 1,
    windLean: 0.12,
    windTaper: 0.18,

    // Forest ecology
    spacing: 200,
    speciesMix: 'current',
    ageMix: 0,
    edgeLean: 0.12,
    crownShyness: 0.2,

    // Soil / water / slope
    slope: 0,
    aspect: 0,
    soilMoisture: 0.6,
    waterStress: 0.2,

    // Species render traits
    barkHue: 30,
    barkSat: 25,
    barkLight: 34,
    barkFissure: 0.6,
    barkMoss: 0.35,
    barkLenticel: 0.2,
    leafShape: 'oak',

    // Render/playback
    leaves: 0.6,
    speed: 2.5,
};

/** 2D keeps its existing side-alternating silhouette. */
const DIMENSION_PARAMS_2D = {
    angle: 40,
    branch: 0.55,
    apical: 0.35,
    sympodial: 0.2,
    photo: 0.15,
    droop: 0.2,
    shade: 0.5,
    shed: 0.4,
    leaves: 0.6,
    sunAngle: 0,
};

/** 3D keeps its golden-angle, volume-aware defaults. */
const DIMENSION_PARAMS_3D = {
    angle: 42,
    branch: 0.65,
    apical: 0.32,
    sympodial: 0.2,
    photo: 0.15,
    droop: 0.22,
    shade: 0.55,
    shed: 0.4,
    leaves: 0.65,
    sunAzimuth: 0,
    sunElevation: 90,
    sway: 0.6,
    swayWithWind: false,
};

/**
 * Parameter metadata used by both UIs. `group` reserves the structure for an
 * Advanced panel; `default` and `help` keep the shared schema self-documenting.
 */
const PARAM_DEFS = [
    {
        key: 'angle', label: 'Branch angle', group: 'Structure',
        min: 15, max: 85, step: 1, default: 40,
        help: 'Base angle away from the parent axis. Species order biases scale it.',
        scope: 'both',
    },
    {
        key: 'branch', label: 'Branching', group: 'Structure',
        min: 0.1, max: 1, step: 0.01, default: 0.55,
        help: 'Probability of spawning a lateral bud each growth step.',
        scope: 'both',
    },
    {
        key: 'apical', label: 'Apical dominance', group: 'Structure',
        min: 0, max: 0.9, step: 0.01, default: 0.35,
        help: 'How much weaker lateral shoots are than their parent axis.',
        scope: 'both',
    },
    {
        key: 'sympodial', label: 'Crown forking', group: 'Structure',
        min: 0, max: 1, step: 0.01, default: 0.2,
        help: 'Leader decay and co-dominant limb bifurcation; 0 = single leader.',
        scope: 'both',
    },
    {
        key: 'photo', label: 'Phototropism', group: 'Structure',
        min: 0, max: 0.6, step: 0.01, default: 0.15,
        help: 'Upward steering strength.',
        scope: 'both',
    },
    {
        key: 'droop', label: 'Droop', group: 'Structure',
        min: 0, max: 0.6, step: 0.01, default: 0.2,
        help: 'Gravity droop, which builds up as a shoot ages.',
        scope: 'both',
    },
    {
        key: 'plagiotropism', label: 'Plagiotropism', group: 'Structure',
        min: 0, max: 1, step: 0.01, default: 0.35,
        help: 'Flatten lateral axes toward horizontal; leaders stay upright.',
        scope: 'both',
    },
    {
        key: 'tortuosity', label: 'Tortuosity', group: 'Structure',
        min: 0, max: 1, step: 0.01, default: 0.25,
        help: 'Deterministic bend and wobble, stronger in old wood.',
        scope: 'both',
    },
    {
        key: 'reiteration', label: 'Reiteration', group: 'Structure',
        min: 0, max: 1, step: 0.01, default: 0.2,
        help: 'Old-growth epicormic shoots from trunks and scaffolds.',
        scope: 'both',
    },
    {
        key: 'rootFlare', label: 'Root flare', group: 'Structure',
        min: 0, max: 1.5, step: 0.05, default: 0.6,
        help: 'Trunk-to-root taper and buttress strength.',
        scope: 'both',
    },
    {
        key: 'shade', label: 'Shade sensitivity', group: 'Light',
        min: 0, max: 1.5, step: 0.01, default: 0.5,
        help: 'How strongly nearby crowns slow and cull shaded buds.',
        scope: 'both',
    },
    {
        key: 'shed', label: 'Branch shedding', group: 'Light',
        min: 0, max: 1, step: 0.01, default: 0.4,
        help: 'Light threshold below which branches are shed; 0 = off.',
        scope: 'both',
    },
    {
        key: 'leaves', label: 'Leaf density', group: 'Render',
        min: 0, max: 1, step: 0.01, default: 0.6,
        help: 'Leaf-card density; render-only.',
        scope: 'both',
    },
    {
        key: 'speed', label: 'Play speed', group: 'Render',
        min: 0.5, max: 8, step: 0.1, default: 2.5,
        help: 'Playback speed in years per second; render-only.',
        scope: 'both',
    },
];

/** Explicit alias for consumers that use the roadmap's name. */
const PARAM_META = PARAM_DEFS;

/** Metadata for the Advanced environment controls. */
const ENV_META = [
    { key: 'solarModel', label: 'Solar model', default: false, help: 'Use latitude/day/hour instead of the basic sun sliders.' },
    { key: 'latitude', label: 'Latitude', default: 40, help: 'Solar latitude in degrees.' },
    { key: 'dayOfYear', label: 'Day of year', default: 172, help: 'Solar date, 1-365.' },
    { key: 'hour', label: 'Hour', default: 12, help: 'Solar time of day, 0-24.' },
    { key: 'skyPreset', label: 'Sky preset', default: 'clear', help: 'Clear, golden hour, overcast, or winter exposure.' },
    { key: 'sunSamples', label: 'Sun samples', default: 3, help: 'Number of sun-disk samples in the light field.' },
    { key: 'windDirection', label: 'Wind direction', default: 0, help: 'Wind direction in degrees; 0 is +x.' },
    { key: 'gustAmp', label: 'Gust amplitude', default: 0.18, help: 'Wind-field gust strength.' },
    { key: 'speciesMix', label: 'Species mix', default: 'current', help: 'Current preset, auto mix, or one species for all trees.' },
    { key: 'spacing', label: 'Forest spacing', default: 200, help: 'Tree spacing in world units.' },
    { key: 'ageMix', label: 'Age mix', default: 0, help: 'Planting-time variation between trees.' },
    { key: 'crownShyness', label: 'Crown shyness', default: 0.2, help: 'Lateral repulsion between neighboring crowns.' },
    { key: 'slope', label: 'Slope', default: 0, help: 'Ground slope in degrees.' },
    { key: 'aspect', label: 'Aspect', default: 0, help: 'Slope aspect in degrees.' },
    { key: 'soilMoisture', label: 'Soil moisture', default: 0.6, help: 'Water availability; low values shorten growth and leaves.' },
    { key: 'exposure', label: 'Exposure', default: 1.0, help: 'Tone-mapping exposure.' },
    { key: 'fogDensity', label: 'Fog density', default: 0.0008, help: 'Exponential scene fog density.' },
    { key: 'quality', label: 'Quality', default: 'auto', help: 'Render quality tier: auto, high, medium, or low.' },
];
