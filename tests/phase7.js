/**
 * Phase 7A render-trait checks: species bark and leaf metadata.
 *
 * Run from the project root:
 *   node tests/phase7.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/** Simulation files are ES modules in the browser; tests evaluate them as scripts. */
function scriptSource(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^export\s+/gm, '');
}
const ctx = { console, window: {} };
vm.createContext(ctx);
for (const file of [
    'shared/params.js',
    'shared/presets.js',
    'shared/grammar.js',
    'shared/environment.js',
    'shared/automation.js',
    'prototype/simulation.js',
]) {
    vm.runInContext(scriptSource(file), ctx, { filename: file });
}

const run = (expr) => vm.runInContext(expr, ctx);
const json = (expr) => JSON.parse(run(`JSON.stringify(${expr})`));
const presets = json('SPECIES_PRESETS');
const shapes = new Set(['oak', 'pine', 'willow', 'cherry', 'poplar']);

for (const [name, preset] of Object.entries(presets)) {
    assert.ok(Number.isFinite(preset.barkHue), `${name}: barkHue`);
    assert.ok(Number.isFinite(preset.barkSat), `${name}: barkSat`);
    assert.ok(Number.isFinite(preset.barkLight), `${name}: barkLight`);
    assert.ok(Number.isFinite(preset.barkFissure), `${name}: barkFissure`);
    assert.ok(Number.isFinite(preset.barkMoss), `${name}: barkMoss`);
    assert.ok(Number.isFinite(preset.barkLenticel), `${name}: barkLenticel`);
    assert.ok(shapes.has(preset.leafShape), `${name}: leafShape`);
}

// Every species preset should survive trait merging into a forest tree.
for (const name of Object.keys(presets)) {
    const traits = json(`traitsForPreset(${JSON.stringify(name)}, P)`);
    assert.strictEqual(traits.leafShape, presets[name].leafShape, `${name}: merged leaf shape`);
    assert.strictEqual(traits.barkFissure, presets[name].barkFissure, `${name}: merged bark fissure`);
    assert.ok(traits.phenology, `${name}: merged phenology`);
}

// A mixed forest should expose per-tree render traits.
run(`
    Object.assign(P, BASE_PARAMS, DIMENSION_PARAMS_2D, {
        angleOrderBias: BASE_PARAMS.angleOrderBias.slice(),
        phenology: Object.assign({}, BASE_PARAMS.phenology),
        trees: 5, speciesMix: 'auto'
    });
    simulate();
`);
assert.strictEqual(run('treeTraits.length'), 5, 'mixed forest trait count');
assert.ok(run(`treeTraits.every((t) => t && t.leafShape && t.barkHue != null)`), 'mixed forest render traits');

console.log('Phase 7A checks passed.');
console.log(`Species render presets: ${Object.keys(presets).join(', ')}`);
console.log(`Leaf shapes: ${[...new Set(Object.values(presets).map((p) => p.leafShape))].join(', ')}`);
