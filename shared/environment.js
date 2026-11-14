/**
 * Shared environment helpers: solar position, sky presets, wind, and soil
 * exposure. Both prototypes load this before simulation.js.
 */

'use strict';

const SKY_PRESETS = {
    clear: { exposure: 1.0, haze: 0.15, overcast: 0.0, warmth: 0.1 },
    golden: { exposure: 0.88, haze: 0.35, overcast: 0.1, warmth: 0.7 },
    overcast: { exposure: 0.62, haze: 0.55, overcast: 0.75, warmth: 0.05 },
    winter: { exposure: 0.72, haze: 0.3, overcast: 0.25, warmth: -0.1 },
};

function envClamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

/** Solar declination in radians for a day of year (1-365). */
function solarDeclination(dayOfYear) {
    return (23.44 * Math.PI / 180) * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365);
}

/**
 * Solar position for a latitude/day/hour. Azimuth is measured from north
 * toward east; elevation is above the horizon. Both are in radians.
 */
function solarPosition(latitudeDeg, dayOfYear, hour) {
    const lat = latitudeDeg * Math.PI / 180;
    const decl = solarDeclination(dayOfYear);
    const H = (15 * (hour - 12)) * Math.PI / 180;
    const sinEl = Math.sin(lat) * Math.sin(decl)
        + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    const elevation = Math.asin(envClamp(sinEl, -1, 1));

    // Local east/north/up components, using north = +z in world space.
    const east = -Math.cos(decl) * Math.sin(H);
    const north = Math.sin(decl) * Math.cos(lat)
        - Math.cos(decl) * Math.cos(H) * Math.sin(lat);
    const azimuth = Math.atan2(east, north);
    return { azimuth, elevation, declination: decl, belowHorizon: elevation < 0 };
}

/**
 * World-space sun direction for a dimension. Basic mode preserves the original
 * one-slider controls; solar mode uses the shared solar model.
 */
function environmentSunDirection(params, dimension) {
    if (params.solarModel) {
        const solar = solarPosition(params.latitude, params.dayOfYear, params.hour);
        const el = Math.max(0.03, solar.elevation);
        const az = solar.azimuth;
        const cosEl = Math.cos(el);
        if (dimension === '2d') {
            return {
                x: cosEl * Math.sin(az),
                y: -Math.sin(el),
                z: 0,
                elevation: el,
                azimuth: az,
                belowHorizon: solar.belowHorizon,
            };
        }
        return {
            x: cosEl * Math.sin(az),
            y: Math.sin(el),
            z: cosEl * Math.cos(az),
            elevation: el,
            azimuth: az,
            belowHorizon: solar.belowHorizon,
        };
    }

    if (dimension === '2d') {
        const a = params.sunAngle * Math.PI / 180;
        return {
            x: Math.sin(a),
            y: -Math.cos(a),
            z: 0,
            elevation: Math.PI / 2 - Math.abs(a),
            azimuth: 0,
            belowHorizon: false,
        };
    }

    const az = params.sunAzimuth * Math.PI / 180;
    const el = params.sunElevation * Math.PI / 180;
    return {
        x: Math.cos(el) * Math.sin(az),
        y: Math.sin(el),
        z: Math.cos(el) * Math.cos(az),
        elevation: el,
        azimuth: az,
        belowHorizon: false,
    };
}

/** 0..1 sun intensity from elevation and the selected sky preset. */
function environmentSunIntensity(params, sun) {
    const sky = SKY_PRESETS[params.skyPreset] || SKY_PRESETS.clear;
    const horizon = envClamp(sun.elevation / (Math.PI / 2), 0, 1);
    return envClamp((0.08 + 0.92 * horizon) * sky.exposure, 0.04, 1.2);
}

/** Sky preset values for renderers. */
function environmentSky(params) {
    return SKY_PRESETS[params.skyPreset] || SKY_PRESETS.clear;
}

/** Small sun-disk offsets used by the light field. */
function sunSampleOffsets(count) {
    if (count <= 1) return [0];
    if (count <= 3) return [-1, 0, 1];
    return [-1, -0.5, 0, 0.5, 1];
}

/**
 * Local wind vector. `roots` is the forest layout; upwind neighbors reduce the
 * speed to create a simple shelter effect. `time` is in structural steps.
 */
function environmentWind(params, x, y, z, time, roots) {
    const signedWind = params.windSpeed ?? params.wind ?? 0;
    const dir = (params.windDirection || 0) * Math.PI / 180
        + (signedWind < 0 ? Math.PI : 0);
    const base = Math.abs(signedWind);
    const gust = (params.gustAmp || 0)
        * Math.sin(time * (params.gustFreq || 0.8) + x * 0.025 + z * 0.03);
    let speed = base * (1 + gust);

    const wx = Math.cos(dir);
    const wz = Math.sin(dir);
    let shelter = 1;
    if (roots && roots.length > 0 && (params.windShelter ?? 1) > 0) {
        for (let i = 0; i < roots.length; i++) {
            const r = roots[i];
            const dx = x - r.x;
            const dz = z - (r.z || 0);
            const along = dx * wx + dz * wz;
            const across = Math.abs(dx * wz - dz * wx);
            if (along > 0 && along < (params.spacing || 200) * 1.6
                && across < (params.spacing || 200) * 0.9) {
                shelter *= 1 - 0.22 * (params.windShelter ?? 1) * (1 - along / ((params.spacing || 200) * 1.6));
            }
        }
    }
    speed *= envClamp(shelter, 0.35, 1);

    const lean = (params.windLean ?? 0.12) * speed;
    return {
        x: wx * speed,
        z: wz * speed,
        lean,
        speed,
    };
}

/** Ground height for a slope/aspect plane. Aspect is the uphill direction. */
function environmentGroundHeight(params, x, z) {
    const slope = (params.slope || 0) * Math.PI / 180;
    if (slope <= 0) return 0;
    const aspect = (params.aspect || 0) * Math.PI / 180;
    const distance = x * Math.sin(aspect) + z * Math.cos(aspect);
    return Math.tan(slope) * distance;
}

/** Slope/aspect gain applied to direct sun. */
function environmentSlopeGain(params, sunAzimuth) {
    const slope = (params.slope || 0) * Math.PI / 180;
    const aspect = (params.aspect || 0) * Math.PI / 180;
    if (slope <= 0) return 1;
    return envClamp(1 + 0.35 * Math.sin(slope) * Math.cos(aspect - sunAzimuth), 0.55, 1.35);
}

/** Growth multiplier from soil moisture and water stress. */
function environmentWaterGain(params) {
    const moisture = envClamp(params.soilMoisture ?? 0.6, 0, 1);
    const stress = envClamp(params.waterStress ?? 0.2, 0, 1);
    return envClamp(1 - stress * (1 - moisture) * 1.75, 0.35, 1);
}

/** Species names available for deterministic forest mixes. */
const FOREST_SPECIES = ['oak', 'pine', 'willow', 'cherry', 'poplar'];

/** Pick a species for a forest tree; deterministic from the global seed. */
function environmentSpeciesFor(seedValue, index, mix) {
    if (mix && mix !== 'auto' && mix !== 'current') return mix;
    if (mix === 'auto') return FOREST_SPECIES[(seedValue + index * 7) % FOREST_SPECIES.length];
    return null;
}
