/**
 * Shared parameter automation (keyframes) for both prototypes.
 *
 * Loaded as a classic script before simulation.js. Provides the evaluation
 * core plus metadata describing which parameters can be animated and their
 * allowed ranges. Time is always the tree age in display years.
 */
'use strict';

const AUTOMATION_VERSION = 1;
const AUTOMATION_INTERP = ['linear', 'smooth', 'step'];
const AUTOMATION_LOOP = ['none', 'loop', 'pingpong'];

const AUTOMATION_META = {
    // Growth parameters (baked into the skeleton during simulation).
    angle: { scope: 'growth', min: 15, max: 85 },
    branch: { scope: 'growth', min: 0.1, max: 1 },
    apical: { scope: 'growth', min: 0, max: 0.9 },
    sympodial: { scope: 'growth', min: 0, max: 1 },
    photo: { scope: 'growth', min: 0, max: 0.6 },
    droop: { scope: 'growth', min: 0, max: 0.6 },
    plagiotropism: { scope: 'growth', min: 0, max: 1 },
    tortuosity: { scope: 'growth', min: 0, max: 1 },
    reiteration: { scope: 'growth', min: 0, max: 1 },
    rootFlare: { scope: 'growth', min: 0, max: 1.5 },
    shade: { scope: 'growth', min: 0, max: 1.5 },
    shed: { scope: 'growth', min: 0, max: 1 },
    soilMoisture: { scope: 'both', min: 0, max: 1 },
    waterStress: { scope: 'growth', min: 0, max: 1 },
    windTaper: { scope: 'growth', min: 0, max: 1 },
    edgeLean: { scope: 'growth', min: 0, max: 1 },
    wind: { scope: 'both', min: -0.5, max: 0.5 },
    windDirection: { scope: 'both', min: 0, max: 360, wrap: 360 },
    windLean: { scope: 'growth', min: 0, max: 1 },
    // Render / environment parameters.
    sunAngle: { scope: 'both', min: -75, max: 75 },
    sunAzimuth: { scope: 'render', min: 0, max: 360, wrap: 360 },
    sunElevation: { scope: 'render', min: 10, max: 90 },
    hour: { scope: 'render', min: 0, max: 24 },
    dayOfYear: { scope: 'render', min: 1, max: 365 },
    exposure: { scope: 'render', min: 0.5, max: 1.5 },
    fogDensity: { scope: 'render', min: 0, max: 0.003 },
    leaves: { scope: 'render', min: 0, max: 1 },
    sway: { scope: 'render', min: 0, max: 1.5 },
    gustAmp: { scope: 'render', min: 0, max: 1 },
};

function createAutomation() {
    return { version: AUTOMATION_VERSION, enabled: true, tracks: {} };
}

function normalizeTrack(key, track) {
    if (!track || typeof track !== 'object') return null;
    const meta = AUTOMATION_META[key];
    if (!meta) return null;
    const rawKeys = Array.isArray(track.keys) ? track.keys : [];
    const keys = [];
    for (const entry of rawKeys) {
        let t, v;
        if (Array.isArray(entry)) { t = Number(entry[0]); v = Number(entry[1]); }
        else if (entry && typeof entry === 'object') { t = Number(entry.t); v = Number(entry.v); }
        else continue;
        if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
        keys.push([t, v]);
    }
    if (!keys.length) return null;
    keys.sort((a, b) => a[0] - b[0]);
    const interp = AUTOMATION_INTERP.indexOf(track.interp) >= 0 ? track.interp : 'smooth';
    const loop = AUTOMATION_LOOP.indexOf(track.loop) >= 0 ? track.loop : 'none';
    const wrap = meta.wrap || 0;
    return {
        keys,
        interp,
        loop,
        wrap,
        min: meta.min,
        max: meta.max,
    };
}

function normalizeAutomation(input) {
    const out = createAutomation();
    if (!input || typeof input !== 'object') return out;
    out.enabled = input.enabled !== false;
    const tracks = input.tracks && typeof input.tracks === 'object' ? input.tracks : {};
    for (const [key, track] of Object.entries(tracks)) {
        const normalized = normalizeTrack(key, track);
        if (normalized) out.tracks[key] = normalized;
    }
    return out;
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function angleDelta(a, b, span) {
    if (!span) return b - a;
    let d = b - a;
    while (d > span / 2) d -= span;
    while (d < -span / 2) d += span;
    return d;
}

function trackTime(track, t) {
    if (track.loop === 'none' || track.keys.length < 2) return t;
    const first = track.keys[0][0];
    const last = track.keys[track.keys.length - 1][0];
    const span = last - first;
    if (span <= 0) return t;
    if (t < first) return first;
    const rel = t - first;
    if (track.loop === 'loop') return first + (rel % span);
    const cycle = rel % (span * 2);
    return first + (cycle <= span ? cycle : span * 2 - cycle);
}

function evaluateTrack(track, t, fallback) {
    if (!track || !Array.isArray(track.keys) || !track.keys.length) return fallback;
    const tt = trackTime(track, t);
    const keys = track.keys;
    if (tt <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (tt >= last[0]) return last[1];
    // binary search
    let lo = 0, hi = keys.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (keys[mid][0] <= tt) lo = mid; else hi = mid;
    }
    const a = keys[lo], b = keys[hi];
    const dt = b[0] - a[0];
    if (dt <= 0) return a[1];
    const u = (tt - a[0]) / dt;
    const frac = track.interp === 'step' ? 0
        : track.interp === 'smooth' ? smoothstep(u) : u;
    let delta = angleDelta(a[1], b[1], track.wrap);
    let value = a[1] + delta * frac;
    if (track.wrap) {
        const span = track.wrap;
        value = ((value % span) + span) % span;
        if (track.min === 0 && track.max === span) value = value;
    }
    if (Number.isFinite(track.min) && Number.isFinite(track.max)) {
        value = clamp(value, track.min, track.max);
    }
    return value;
}

function resolveRenderParams(P, automation, t) {
    if (!automation || automation.enabled === false || !automation.tracks) return P;
    let out = null;
    for (const [key, track] of Object.entries(automation.tracks)) {
        const meta = AUTOMATION_META[key];
        if (!meta || (meta.scope !== 'render' && meta.scope !== 'both')) continue;
        if (!out) out = Object.create(P);
        out[key] = evaluateTrack(track, t, P[key]);
    }
    return out || P;
}

function growthOverlay(automation, t) {
    if (!automation || automation.enabled === false || !automation.tracks) return null;
    let result = null;
    for (const [key, track] of Object.entries(automation.tracks)) {
        const meta = AUTOMATION_META[key];
        if (!meta || (meta.scope !== 'growth' && meta.scope !== 'both')) continue;
        if (!result) result = {};
        result[key] = evaluateTrack(track, t, null);
    }
    return result;
}

function hasAutomation(automation, scope) {
    if (!automation || automation.enabled === false || !automation.tracks) return false;
    for (const [key] of Object.entries(automation.tracks)) {
        const meta = AUTOMATION_META[key];
        if (!meta) continue;
        if (!scope || meta.scope === scope || meta.scope === 'both') return true;
    }
    return false;
}

function hasGrowthTracks(automation) { return hasAutomation(automation, 'growth'); }
function hasRenderTracks(automation) { return hasAutomation(automation, 'render'); }

function mergeParams(base, overlay) {
    if (!overlay) return base;
    const out = Object.create(base);
    for (const key of Object.keys(overlay)) out[key] = overlay[key];
    return out;
}

function displayYearForStep(step, lifespan) {
    const ls = Number(lifespan) || 300;
    const GROWTH_HORIZON = (typeof window !== 'undefined' && window.GROWTH_HORIZON) ? window.GROWTH_HORIZON : 80;
    const JUVENILE_YEARS = (typeof window !== 'undefined' && window.JUVENILE_YEARS) ? window.JUVENILE_YEARS : 40;
    const steps = Math.min(ls, GROWTH_HORIZON);
    if (ls <= GROWTH_HORIZON || steps <= JUVENILE_YEARS) return Math.min(step, ls);
    if (step <= JUVENILE_YEARS) return step;
    const spanTail = ls - JUVENILE_YEARS;
    const growthTail = steps - JUVENILE_YEARS;
    return JUVENILE_YEARS + (step - JUVENILE_YEARS) / growthTail * spanTail;
}

window.createAutomation = createAutomation;
window.normalizeAutomation = normalizeAutomation;
window.normalizeTrack = normalizeTrack;
window.evaluateTrack = evaluateTrack;
window.resolveRenderParams = resolveRenderParams;
window.growthOverlay = growthOverlay;
window.hasAutomation = hasAutomation;
window.hasGrowthTracks = hasGrowthTracks;
window.hasRenderTracks = hasRenderTracks;
window.mergeParams = mergeParams;
window.displayYearForStep = displayYearForStep;
window.AUTOMATION_META = AUTOMATION_META;
window.AUTOMATION_INTERP = AUTOMATION_INTERP;
window.AUTOMATION_LOOP = AUTOMATION_LOOP;
window.AUTOMATION_VERSION = AUTOMATION_VERSION;
