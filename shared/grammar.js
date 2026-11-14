/**
 * Shared botanical grammar helpers.
 *
 * These functions read the active `P` object. They are deliberately pure so
 * both the 2D and 3D simulation/render loops can call them without duplicating
 * species rules.
 */

'use strict';

/** Branch angle for a given axis order, preserving the base angle slider. */
function angleForOrder(order, traits) {
    const source = traits || P;
    const bias = (source.angleOrderBias && source.angleOrderBias[order]) || 1;
    return source.angle * bias;
}

/** Merge a species preset over a base trait object, used by forest mixes. */
function traitsForPreset(name, base) {
    const preset = SPECIES_PRESETS[name];
    if (!preset) return base || P;
    const traits = Object.assign({}, base || P);
    for (const [key, value] of Object.entries(preset)) {
        if (key === 'label' || key === 'palette') continue;
        if (key === 'phenology') {
            traits.phenology = Object.assign({}, BASE_PARAMS.phenology, value);
            continue;
        }
        if (key === 'angleOrderBias') {
            traits.angleOrderBias = value.slice();
            continue;
        }
        if (key in traits) traits[key] = value;
    }
    return traits;
}

/** Smooth 0..1 ramp with clamped edges. */
function grammarSmoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
    return t * t * (3 - 2 * t);
}

/**
 * Species phenology at a season value (0 spring, 0.33 summer, 0.66 autumn,
 * 1 winter). Returns leaf scale/colour and a flower strength. The season slider
 * remains the manual override; this only changes how a species interprets it.
 */
function phenologyAt(season, phenology) {
    const ph = phenology || P.phenology || {};
    const s = Math.min(1, Math.max(0, season));

    let leafScale = 1;
    if (!ph.evergreen) {
        const out = ph.leafOut ?? 0.02;
        const full = ph.leafFull ?? 0.16;
        const drop = ph.leafDrop ?? 0.78;
        const end = ph.leafDropEnd ?? 1.0;
        leafScale = grammarSmoothstep(out, full, s) * (1 - grammarSmoothstep(drop, end, s));
    }

    let hue = ph.leafHue ?? 100;
    let sat = ph.leafSat ?? 50;
    let light = ph.leafLight ?? 34;

    if (!ph.evergreen) {
        const t = grammarSmoothstep(ph.autumnStart ?? 0.5, ph.autumnEnd ?? 0.8, s);
        hue += ((ph.autumnHue ?? 45) - hue) * t;
        sat += (62 - sat) * t;
        light += (36 - light) * t;
    }

    let flower = 0;
    const fs = ph.flowerStart ?? -1;
    const fe = ph.flowerEnd ?? -1;
    if (fs >= 0 && fe > fs) {
        flower = grammarSmoothstep(fs, fs + 0.025, s)
            * (1 - grammarSmoothstep(fe - 0.025, fe, s));
    }

    let fruit = 0;
    const rs = ph.fruitStart ?? -1;
    const re = ph.fruitEnd ?? -1;
    if (rs >= 0 && re > rs) {
        fruit = grammarSmoothstep(rs, rs + 0.03, s)
            * (1 - grammarSmoothstep(re - 0.03, re, s));
    }

    return {
        leafScale,
        hue,
        sat,
        light,
        flower,
        flowerHue: ph.flowerHue ?? 330,
        fruit,
        fruitHue: ph.fruitHue ?? 15,
        evergreen: !!ph.evergreen,
    };
}
