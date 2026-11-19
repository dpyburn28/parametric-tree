/**
 * Phase 5 parity, determinism, metadata, roots, phenology and prune checks.
 *
 * Run from the project root:
 *   node tests/phase5.js
 *
 * This uses Node's built-in `vm` and `assert`; it does not need a browser.
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

function load(dimension) {
    const ctx = { console, window: {} };
    vm.createContext(ctx);
    const files = [
        'shared/params.js',
        'shared/presets.js',
        'shared/grammar.js',
        'shared/environment.js',
        'shared/automation.js',
        dimension === '2d' ? 'prototype/simulation.js' : '3d-prototype/simulation.js',
    ];
    for (const file of files) {
        vm.runInContext(scriptSource(file), ctx, { filename: file });
    }
    return ctx;
}

const run = (ctx, expr) => vm.runInContext(expr, ctx);
const json = (ctx, expr) => JSON.parse(run(ctx, `JSON.stringify(${expr})`));

function applyPreset(ctx, name) {
    const dim = ctx === ctx2d ? 'DIMENSION_PARAMS_2D' : 'DIMENSION_PARAMS_3D';
    return run(ctx, `
        (function () {
            Object.assign(P, BASE_PARAMS, ${dim}, {
                angleOrderBias: BASE_PARAMS.angleOrderBias.slice(),
                phenology: Object.assign({}, BASE_PARAMS.phenology),
            });
            const preset = SPECIES_PRESETS[${JSON.stringify(name)}];
            for (const [key, value] of Object.entries(preset)) {
                if (key === 'label' || key === 'palette') continue;
                if (key === 'phenology') {
                    P.phenology = Object.assign({}, BASE_PARAMS.phenology, value);
                    continue;
                }
                if (key === 'angleOrderBias') { P.angleOrderBias = value.slice(); continue; }
                if (key in P) P[key] = value;
            }
            simulate();
            return nodes.length;
        })();
    `);
}

const ctx2d = load('2d');
const ctx3d = load('3d');

// Shared schema parity: same parameter keys, metadata and species presets.
const meta2d = json(ctx2d, 'PARAM_META.map(({ key, label, group, min, max, step, default: d }) => ({ key, label, group, min, max, step, default: d }))');
const meta3d = json(ctx3d, 'PARAM_META.map(({ key, label, group, min, max, step, default: d }) => ({ key, label, group, min, max, step, default: d }))');
assert.deepStrictEqual(meta2d, meta3d, 'PARAM_META must match across dimensions');

const presets2d = json(ctx2d, 'SPECIES_PRESETS');
const presets3d = json(ctx3d, 'SPECIES_PRESETS');
assert.deepStrictEqual(presets2d, presets3d, 'species presets must match across dimensions');
assert.deepStrictEqual(json(ctx2d, 'SPECIES_PRESETS_V2'), presets2d, 'SPECIES_PRESETS_V2 alias must point at the presets');
assert.ok(meta2d.length >= 14, 'shared schema should expose all growth controls');

// Both dimensions must expose every shared parameter even where defaults differ.
const baseKeys = json(ctx2d, 'Object.keys(BASE_PARAMS)');
for (const ctx of [ctx2d, ctx3d]) {
    const pKeys = json(ctx, 'Object.keys(P)');
    for (const key of baseKeys) assert.ok(pKeys.includes(key), `missing shared parameter ${key}`);
}

// Determinism: the same seed/parameters must produce the same skeleton and roots.
function determinism(ctx, label) {
    run(ctx, 'simulate();');
    const a = run(ctx, 'JSON.stringify({ n: nodes.length, last: nodes[nodes.length - 1], roots: rootSystem, axes: nextAxisId })');
    run(ctx, 'simulate();');
    const b = run(ctx, 'JSON.stringify({ n: nodes.length, last: nodes[nodes.length - 1], roots: rootSystem, axes: nextAxisId })');
    assert.strictEqual(a, b, `${label} simulation must be deterministic`);
}
determinism(ctx2d, '2D');
determinism(ctx3d, '3D');

// Metadata and roots.
for (const [ctx, label] of [[ctx2d, '2D'], [ctx3d, '3D']]) {
    run(ctx, 'simulate();');
    const node = json(ctx, 'nodes.find((n, i) => i > 50 && n.birthStep >= 0)');
    for (const field of [
        'axisId', 'axisOrder', 'parentAxisId', 'segmentIndex', 'pathLength',
        'dirX', 'dirY', 'dirZ', 'upX', 'upY', 'upZ', 'tortuosity',
        'budType', 'fate', 'birthLight', 'birthShade', 'mechanicalLoad',
    ]) {
        assert.ok(field in node, `${label} node missing ${field}`);
    }
    const roots = json(ctx, 'rootSystem');
    assert.ok(roots.length >= 8, `${label} should have a coarse root system`);
    for (const r of roots) {
        for (const field of ['x0', 'y0', 'x1', 'y1', 'w0', 'w1']) assert.ok(field in r, `${label} root missing ${field}`);
        if (label === '3D') for (const field of ['z0', 'z1']) assert.ok(field in r, `${label} root missing ${field}`);
    }
}

// Angle grammar and phenology helpers.
assert.strictEqual(
    run(ctx2d, 'angleForOrder(2)'),
    run(ctx2d, 'P.angle * P.angleOrderBias[2]'),
    'order-specific angle must scale the base angle'
);
const cherrySpring = json(ctx2d, `
    (function () {
        P.phenology = Object.assign({}, BASE_PARAMS.phenology, SPECIES_PRESETS.cherry.phenology);
        return phenologyAt(0.1);
    })()
`);
assert.ok(cherrySpring.flower > 0.5, 'cherry should flower in early spring');
const pineWinter = json(ctx3d, `
    (function () {
        P.phenology = Object.assign({}, BASE_PARAMS.phenology, SPECIES_PRESETS.pine.phenology);
        return phenologyAt(0.95);
    })()
`);
assert.strictEqual(pineWinter.evergreen, true, 'pine must stay evergreen');
assert.ok(pineWinter.leafScale > 0.99, 'pine should retain foliage in winter');

// Presets produce bounded, non-trivial trees in both dimensions.
for (const [ctx, label] of [[ctx2d, '2D'], [ctx3d, '3D']]) {
    for (const name of Object.keys(presets2d)) {
        const count = applyPreset(ctx, name);
        assert.ok(count > 100, `${label} ${name} produced too few nodes (${count})`);
        assert.ok(count < 24000, `${label} ${name} hit the node cap (${count})`);
    }
}

for (const [ctx, dim] of [[ctx2d, 'DIMENSION_PARAMS_2D'], [ctx3d, 'DIMENSION_PARAMS_3D']]) {
    run(ctx, `Object.assign(P, BASE_PARAMS, ${dim}, { angleOrderBias: BASE_PARAMS.angleOrderBias.slice(), phenology: Object.assign({}, BASE_PARAMS.phenology) }); simulate();`);
}

console.log('Phase 5 checks passed.');
console.log(`2D default nodes: ${run(ctx2d, 'nodes.length')}`);
console.log(`3D default nodes: ${run(ctx3d, 'nodes.length')}`);
console.log(`Shared parameters: ${meta2d.length}`);
console.log(`Species presets: ${Object.keys(presets2d).join(', ')}`);
