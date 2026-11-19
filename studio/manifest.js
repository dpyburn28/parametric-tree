/**
 * Studio control manifest.
 *
 * Every retained Grow, timeline, view, and Project control gets one entry here.
 * The studio builds its panel from this manifest and re-parents the cloned
 * DOM nodes into the matching slots. `tests/app-ui.js` verifies retained mounts.
 *
 * `kind` is one of:
 *   id      — an element with that id in the cloned 2D panel or injected 3D set
 *   param   — a growth slider rendered by PARAM_DEFS (`data-param-key`)
 *   preset  — a species preset button (`data-preset`)
 *
 * `scope` is both | 2d | 3d | active. `level` is essential | advanced | expert.
 */

export const STUDIO_MODES = [
    { id: 'grow', label: 'Grow', question: 'What tree am I making?', icon: 'grow' },
];

const P = (key, label, group, level, scope, help, order) => ({
    key: `param:${key}`, kind: 'param', id: key, label, mode: 'grow',
    group, level, scope, help, order,
});

const C = (key, label, mode, group, level, scope, order, extra = {}) => ({
    key, kind: 'id', id: key, label, mode, group, level, scope, order, ...extra,
});

export const MANIFEST = [
    /* ---- Dock ---------------------------------------------------------- */
    C('lifespan', 'Lifespan', 'dock', ['Timeline'], 'essential', 'both', 10, {
        mount: 'dock-lifespan',
        help: 'How many years this tree can grow. Changing lifespan clears cuts.',
    }),
    C('season', 'Season', 'dock', ['Timeline'], 'essential', 'both', 20, {
        mount: 'dock-season',
        help: 'Manual season override: spring, summer, autumn or winter.',
    }),
    C('seasonAuto', 'Follow phenology', 'dock', ['Timeline'], 'essential', 'both', 30, {
        mount: 'dock-season',
        help: 'Cycle one full season every four simulated years, using the species phenology.',
    }),
    { ...P('speed', 'Play speed', ['Timeline'], 'essential', 'both',
        'Playback speed in years per second; render-only.', 40), mode: 'dock', mount: 'dock-speed' },
    C('reset', 'Rewind', 'dock', ['Timeline'], 'essential', 'both', 50, {
        mount: 'dock-actions',
        help: 'Stop playback and return to year 0. The tree and its cuts are unchanged.',
    }),

    /* ---- Grow › Species ------------------------------------------------ */
    { key: 'preset:poplar', kind: 'preset', id: 'poplar', label: 'Poplar', mode: 'grow', group: ['Species'], level: 'essential', scope: 'both', order: 100 },
    { key: 'preset:oak', kind: 'preset', id: 'oak', label: 'Oak', mode: 'grow', group: ['Species'], level: 'essential', scope: 'both', order: 101 },
    { key: 'preset:willow', kind: 'preset', id: 'willow', label: 'Willow', mode: 'grow', group: ['Species'], level: 'essential', scope: 'both', order: 102 },
    { key: 'preset:pine', kind: 'preset', id: 'pine', label: 'Pine', mode: 'grow', group: ['Species'], level: 'essential', scope: 'both', order: 103 },
    { key: 'preset:cherry', kind: 'preset', id: 'cherry', label: 'Cherry', mode: 'grow', group: ['Species'], level: 'essential', scope: 'both', order: 104 },
    { key: 'preset:custom', kind: 'preset', id: 'custom', label: 'Custom', mode: 'grow', group: ['Species'], level: 'essential', scope: 'both', order: 105 },

    /* ---- Grow › Essentials -------------------------------------------- */
    { ...P('angle', 'Spread', ['Essentials'], 'essential', 'both', 'Branch angle: base angle away from the parent axis. Species order biases scale it.', 200), technical: 'Branch angle' },
    { ...P('branch', 'Bushiness', ['Essentials'], 'essential', 'both', 'Branching: probability of spawning a lateral bud each growth step.', 201), technical: 'Branching' },
    { ...P('leaves', 'Leafiness', ['Essentials'], 'essential', 'both', 'Leaf density: leaf-card density. Render-only.', 202), technical: 'Leaf density' },
    C('reseed', 'New seed', 'grow', ['Essentials'], 'essential', 'active', 210, {
        help: 'Starts a new tree and clears cuts. Targets the acting view.',
    }),

    /* ---- Grow › Shape -------------------------------------------------- */
    P('apical', 'Apical dominance', ['Shape', 'Form'], 'advanced', 'both',
        'How much weaker lateral shoots are than their parent axis.', 300),
    P('sympodial', 'Crown forking', ['Shape', 'Form'], 'advanced', 'both',
        'Leader decay and co-dominant limb bifurcation; 0 = single leader.', 301),
    P('plagiotropism', 'Plagiotropism', ['Shape', 'Form'], 'advanced', 'both',
        'Flatten lateral axes toward horizontal; leaders stay upright.', 302),
    P('droop', 'Droop', ['Shape', 'Form'], 'advanced', 'both',
        'Gravity droop, which builds up as a shoot ages.', 303),
    P('photo', 'Phototropism', ['Shape', 'Response to light'], 'advanced', 'both',
        'Upward steering strength.', 310),
    P('shade', 'Shade sensitivity', ['Shape', 'Response to light'], 'advanced', 'both',
        'How strongly nearby crowns slow and cull shaded buds.', 311),
    P('shed', 'Branch shedding', ['Shape', 'Response to light'], 'advanced', 'both',
        'Light threshold below which branches are shed; 0 = off.', 312),
    P('tortuosity', 'Tortuosity', ['Shape', 'Character'], 'advanced', 'both',
        'Deterministic bend and wobble, stronger in old wood.', 320),
    P('reiteration', 'Reiteration', ['Shape', 'Character'], 'advanced', 'both',
        'Old-growth epicormic shoots from trunks and scaffolds.', 321),
    P('rootFlare', 'Root flare', ['Shape', 'Character'], 'advanced', 'both',
        'Trunk-to-root taper and buttress strength.', 322),

    /* ---- Grow › Environment › Sun and sky ----------------------------- */
    C('sunAngle', '2D sun angle', 'grow', ['Environment'], 'essential', '2d', 400, {
        help: 'Sun angle in the 2D silhouette. Affects the 2D render only.',
    }),
    C('sunAzimuth', '3D sun azimuth', 'grow', ['Environment'], 'essential', '3d', 401, {
        help: 'Compass direction of the sun in the 3D scene.',
    }),
    C('sunElevation', '3D sun elevation', 'grow', ['Environment'], 'essential', '3d', 402, {
        help: 'Height of the sun above the horizon in the 3D scene.',
    }),
    C('solarModel', 'Solar model', 'grow', ['Environment', 'Sun and sky'], 'advanced', 'both', 410, {
        help: 'Use latitude/day/hour instead of the basic sun sliders.',
    }),
    C('latitude', 'Latitude', 'grow', ['Environment', 'Sun and sky'], 'advanced', 'both', 411, {
        help: 'Solar latitude in degrees.',
    }),
    C('dayOfYear', 'Day', 'grow', ['Environment', 'Sun and sky'], 'advanced', 'both', 412, {
        help: 'Solar date, 1–365.',
    }),
    C('hour', 'Hour', 'grow', ['Environment', 'Sun and sky'], 'advanced', 'both', 413, {
        help: 'Solar time of day, 0–24.',
    }),
    C('skyPreset', 'Sky preset', 'grow', ['Environment', 'Sun and sky'], 'advanced', 'both', 414, {
        help: 'Clear, golden hour, overcast, or winter exposure.',
    }),
    C('sunSamples', 'Sun samples', 'grow', ['Environment', 'Sun and sky'], 'advanced', 'both', 415, {
        help: 'Number of sun-disk samples in the light field.',
    }),
    C('exposure', 'Exposure', 'grow', ['Environment', 'Sun and sky'], 'advanced', 'both', 416, {
        help: 'Tone-mapping exposure.',
    }),

    /* ---- Grow › Environment › Wind ------------------------------------ */
    C('wind', 'Wind', 'grow', ['Environment'], 'essential', 'both', 430, {
        help: 'Prevailing wind strength. Negative and positive values lean opposite ways.',
    }),
    C('windDirection', 'Wind direction', 'grow', ['Environment', 'Wind'], 'advanced', 'both', 431, {
        help: 'Wind direction in degrees; 0 is +x.',
    }),
    C('gustAmp', 'Gust', 'grow', ['Environment', 'Wind'], 'advanced', 'both', 432, {
        help: 'Wind-field gust strength.',
    }),
    C('sway', '3D sway', 'grow', ['Environment', 'Wind'], 'advanced', '3d', 433, {
        help: 'Amount of branch and leaf motion in the 3D scene.',
    }),
    C('swayWind', 'Scale sway with wind', 'grow', ['Environment', 'Wind'], 'advanced', '3d', 434, {
        help: 'Multiply 3D sway by the wind strength.',
    }),

    /* ---- Grow › Environment › Ground and terrain ---------------------- */
    C('slope', 'Slope', 'grow', ['Environment', 'Ground and terrain'], 'advanced', 'both', 440, {
        help: 'Ground slope in degrees.',
    }),
    C('aspect', 'Aspect', 'grow', ['Environment', 'Ground and terrain'], 'advanced', 'both', 441, {
        help: 'Slope aspect in degrees.',
    }),
    C('soilMoisture', 'Soil moisture', 'grow', ['Environment', 'Ground and terrain'], 'advanced', 'both', 442, {
        help: 'Water availability; low values shorten growth and leaves.',
    }),
    C('groundDetail', 'Ground detail', 'grow', ['Environment', 'Ground and terrain'], 'advanced', '3d', 443, {
        help: 'Draw instanced grass, rocks, shrubs and litter in the 3D scene.',
    }),
    C('groundDensity', 'Ground density', 'grow', ['Environment', 'Ground and terrain'], 'advanced', '3d', 444, {
        help: 'Density of 3D ground detail.',
    }),
    C('snow', 'Snowfall', 'grow', ['Environment', 'Ground and terrain'], 'advanced', '3d', 445, {
        help: 'Add falling snow and snow cover to the 3D scene.',
    }),

    /* ---- Grow › Environment › Obstacle -------------------------------- */
    C('obstacle', 'Obstacle', 'grow', ['Environment'], 'essential', 'both', 450, {
        help: 'A wall, boulder, hedge or topiary shape that constrains growth.',
    }),
    C('obstacleSize', 'Obstacle size', 'grow', ['Environment'], 'essential', 'both', 451, {
        help: 'Scale of the obstacle in world units.',
    }),

    /* ---- Grow › Environment › Look ------------------------------------ */
    C('fogDensity', 'Fog', 'grow', ['Environment', 'Look'], 'advanced', 'both', 460, {
        help: 'Exponential scene fog density.',
    }),
    C('bloom', 'Bloom', 'grow', ['Environment', 'Look'], 'advanced', '3d', 461, {
        help: 'Add an atmospheric bloom pass to the 3D render.',
    }),
    C('espalier', 'Espalier plane', 'grow', ['Environment', 'Look'], 'advanced', '3d', 462, {
        help: 'Constrain growth to a flat espalier plane.',
    }),

    /* ---- Grow › Environment › Performance ----------------------------- */
    C('quality', 'Quality', 'grow', ['Environment', 'Performance'], 'expert', '3d', 470, {
        help: 'Render quality tier: auto, high, medium, or low.',
    }),
    C('reducedMotion', 'Reduce motion', 'grow', ['Environment', 'Performance'], 'expert', 'both', 471, {
        help: 'Disable sway, turntable, snowfall and UI motion.',
    }),

    /* ---- Grow › Planting ---------------------------------------------- */
    C('trees', 'Trees', 'grow', ['Planting'], 'advanced', 'both', 500, {
        help: 'Plant a small forest of 1, 3, 5 or 7 trees.',
    }),
    C('speciesMix', 'Species mix', 'grow', ['Planting'], 'advanced', 'both', 501, {
        help: 'Current preset, auto mix, or one species for all trees.',
    }),
    C('spacing', 'Spacing', 'grow', ['Planting'], 'advanced', 'both', 502, {
        help: 'Tree spacing in world units.',
    }),
    C('ageMix', 'Age mix', 'grow', ['Planting'], 'advanced', 'both', 503, {
        help: 'Planting-time variation between trees.',
    }),
    C('crownShyness', 'Crown shyness', 'grow', ['Planting'], 'advanced', 'both', 504, {
        help: 'Lateral repulsion between neighboring crowns.',
    }),
    C('seedv', 'Seed', 'grow', ['Essentials'], 'essential', 'both', 211, { kind: 'display' }),

    /* ---- Direct exports ----------------------------------------------- */
    C('exportSvg', 'Export SVG', 'project', ['Project'], 'essential', '2d', 910, {
        mount: 'project-menu',
        help: 'Export the current 2D tree as a vector SVG.',
    }),
    C('exportPng', 'Export PNG', 'project', ['Project'], 'essential', 'active', 911, {
        mount: 'project-menu',
        help: 'Export the active tree view as a PNG image.',
    }),
    C('exportGlb', 'Export GLB', 'project', ['Project'], 'essential', '3d', 912, {
        mount: 'project-menu',
        help: 'Export the current 3D tree as a GLB model.',
    }),
    C('shareState', 'Copy link', 'project', ['Project'], 'essential', 'both', 913, {
        mount: 'project-menu',
        help: 'Copy a share link that restores this tree.',
    }),

    /* ---- Project menu -------------------------------------------------- */
    C('saveState', 'Save state', 'project', ['Project'], 'essential', 'active', 1000, {
        mount: 'project-menu',
        help: 'Save the acting view state as a versioned JSON file.',
    }),
    C('loadState', 'Load state', 'project', ['Project'], 'essential', 'active', 1001, {
        mount: 'project-menu',
        help: 'Load a saved state file into the acting view.',
    }),
    { key: 'loadStateFile', kind: 'id', id: 'loadStateFile', label: 'Load state file', mode: 'project', group: ['Project'], level: 'expert', scope: 'active', order: 1002, mount: 'project-menu', hidden: true },

    /* ---- Pane view menus ---------------------------------------------- */
    C('zoom', 'Auto-zoom (2D)', 'stage', ['View'], 'essential', '2d', 1100, {
        mount: 'view-2d',
        help: 'Fit the visible 2D tree in the pane as time changes.',
    }),
    C('spin', 'Turntable', 'stage', ['View'], 'essential', '3d', 1101, {
        mount: 'view-3d',
        help: 'Slowly orbit the 3D camera.',
    }),
];

export const MANIFEST_BY_KEY = new Map(MANIFEST.map((entry) => [entry.key, entry]));

export const SCOPE_LABEL = {
    both: 'Both',
    '2d': '2D',
    '3d': '3D',
    active: 'Acting view',
};

export const CONTROL_HELP = Object.fromEntries(
    MANIFEST.filter((entry) => entry.help).map((entry) => [entry.key, entry.help])
);
