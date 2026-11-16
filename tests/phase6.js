/**
 * Phase 6 checks: solar parity, light/wind determinism, forest budgets, and
 * environmental obstacle/soil smoke tests.
 *
 * Run from the project root:
 *   node tests/phase6.js
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
    for (const file of [
        'shared/params.js',
        'shared/presets.js',
        'shared/grammar.js',
        'shared/environment.js',
        'shared/automation.js',
        dimension === '2d' ? 'prototype/simulation.js' : '3d-prototype/simulation.js',
    ]) {
        vm.runInContext(scriptSource(file), ctx, { filename: file });
    }
    return ctx;
}

const run = (ctx, expr) => vm.runInContext(expr, ctx);
const json = (ctx, expr) => JSON.parse(run(ctx, `JSON.stringify(${expr})`));

function reset(ctx, dim) {
    const params = dim === '2d' ? 'DIMENSION_PARAMS_2D' : 'DIMENSION_PARAMS_3D';
    run(ctx, `
        Object.assign(P, BASE_PARAMS, ${params}, {
            angleOrderBias: BASE_PARAMS.angleOrderBias.slice(),
            phenology: Object.assign({}, BASE_PARAMS.phenology),
        });
    `);
}

const ctx2d = load('2d');
const ctx3d = load('3d');

// The 2D and 3D solar directions must agree on elevation, azimuth, and x.
for (const hour of [6, 9, 12, 15, 18]) {
    const params = `Object.assign({}, BASE_PARAMS, {
        solarModel: true, latitude: 40, dayOfYear: 172, hour: ${hour}
    })`;
    const a = json(ctx2d, `environmentSunDirection(${params}, '2d')`);
    const b = json(ctx3d, `environmentSunDirection(${params}, '3d')`);
    assert.ok(Math.abs(a.elevation - b.elevation) < 1e-9, `solar elevation parity at ${hour}:00`);
    assert.ok(Math.abs(a.azimuth - b.azimuth) < 1e-9, `solar azimuth parity at ${hour}:00`);
    assert.ok(Math.abs(a.x - b.x) < 1e-9, `solar x parity at ${hour}:00`);
    assert.ok(Math.abs(a.y + b.y) < 1e-9, `2D/3D up-axis parity at ${hour}:00`);
}

// Basic mode still reproduces the original one-slider behaviour.
const basic2d = json(ctx2d, `environmentSunDirection(Object.assign({}, BASE_PARAMS, { sunAngle: 0 }), '2d')`);
assert.ok(Math.abs(basic2d.x) < 1e-9 && Math.abs(basic2d.y + 1) < 1e-9, 'basic 2D sun angle');
const basic3d = json(ctx3d, `environmentSunDirection(Object.assign({}, BASE_PARAMS, { sunAzimuth: 0, sunElevation: 90 }), '3d')`);
assert.ok(Math.abs(basic3d.x) < 1e-9 && Math.abs(basic3d.y - 1) < 1e-9, 'basic 3D sun angle');

// Wind is deterministic and shelter reduces speed downwind of a root.
const windA = json(ctx3d, `environmentWind(Object.assign({}, BASE_PARAMS, { wind: 0.4, gustAmp: 0 }), 0, 0, 0, 10, [])`);
const windB = json(ctx3d, `environmentWind(Object.assign({}, BASE_PARAMS, { wind: 0.4, gustAmp: 0 }), 0, 0, 0, 10, [])`);
assert.deepStrictEqual(windA, windB, 'wind must be deterministic');
const sheltered = json(ctx3d, `
    environmentWind(Object.assign({}, BASE_PARAMS, { wind: 0.4, gustAmp: 0, spacing: 100 }),
        100, 0, 0, 10, [{ x: 0, z: 0 }])
`);
assert.ok(sheltered.speed < windA.speed, 'wind shelter should reduce downwind speed');

// Forest sizes stay within the node cap for both current and auto mixes.
for (const [ctx, dim] of [[ctx2d, '2d'], [ctx3d, '3d']]) {
    for (const trees of [1, 3, 5, 7]) {
        for (const mix of ['current', 'auto']) {
            reset(ctx, dim);
            run(ctx, `P.trees = ${trees}; P.speciesMix = ${JSON.stringify(mix)}; P.spacing = 160; simulate();`);
            const count = run(ctx, 'nodes.length');
            assert.ok(count > 100, `${dim} ${trees} ${mix}: too few nodes`);
            assert.ok(count < 24000, `${dim} ${trees} ${mix}: hit node cap`);
            assert.strictEqual(run(ctx, 'treeSpecies.length'), trees, `${dim} ${trees}: species table size`);
            assert.ok(run(ctx, 'rootSystem.length') > 0, `${dim} ${trees}: missing roots`);
            const light = json(ctx, 'nodes.find((n) => n.currentLight != null)');
            assert.ok(light.currentLight >= 0 && light.currentLight <= 1, `${dim}: currentLight out of range`);
        }
    }
}

// Profile the heaviest supported forest at the full 300-year lifespan. This is
// a coarse regression guard, not a frame-time budget: simulation is intentionally
// CPU-heavy and the UI can show a progress state while it runs.
const forestProfile = {};
for (const [ctx, dim] of [[ctx2d, '2d'], [ctx3d, '3d']]) {
    reset(ctx, dim);
    run(ctx, `P.trees = 7; P.lifespan = 300; P.speciesMix = 'auto'; P.spacing = 160; simulate();`);
    const timings = [];
    for (let i = 0; i < 3; i++) {
        const start = performance.now();
        run(ctx, 'simulate();');
        timings.push(performance.now() - start);
    }
    const average = timings.reduce((sum, value) => sum + value, 0) / timings.length;
    const nodes = run(ctx, 'nodes.length');
    assert.ok(nodes > 5000 && nodes < 24000, `${dim} 7-tree/300-year node count (${nodes})`);
    assert.ok(run(ctx, 'rootSystem.length') > 0, `${dim} 7-tree/300-year roots`);
    assert.ok(average < 3000, `${dim} 7-tree/300-year simulate should stay under 3 s (got ${average.toFixed(0)} ms)`);
    forestProfile[dim] = { average, nodes };
}

// All obstacle modes simulate without errors, including hedge and box.
for (const [ctx, dim] of [[ctx2d, '2d'], [ctx3d, '3d']]) {
    for (let obstacle = 0; obstacle <= 6; obstacle++) {
        reset(ctx, dim);
        run(ctx, `P.obstacle = ${obstacle}; P.obstacleSize = 60; simulate();`);
        assert.ok(run(ctx, 'nodes.length') > 50, `${dim}: obstacle ${obstacle} produced no tree`);
    }
}

// Slope/aspect changes the direct-light environment.
for (const [ctx, dim] of [[ctx2d, '2d'], [ctx3d, '3d']]) {
    reset(ctx, dim);
    run(ctx, 'P.skyLight = 0.08; simulate();');
    const flat = run(ctx, 'nodes.reduce((a, n) => a + (n.currentLight || 0), 0)');
    reset(ctx, dim);
    run(ctx, 'P.skyLight = 0.08; P.slope = 25; P.aspect = 180; P.solarModel = true; P.hour = 9; simulate();');
    const sloped = run(ctx, 'nodes.reduce((a, n) => a + (n.currentLight || 0), 0)');
    assert.ok(Math.abs(flat - sloped) > 0.01, `${dim}: slope/aspect should change light`);
}

console.log('Phase 6 checks passed.');
console.log(`2D forest nodes: ${run(ctx2d, 'nodes.length')}`);
console.log(`3D forest nodes: ${run(ctx3d, 'nodes.length')}`);
console.log(`7-tree/300-year simulate: 2D ${forestProfile['2d'].average.toFixed(0)} ms (${forestProfile['2d'].nodes} nodes), 3D ${forestProfile['3d'].average.toFixed(0)} ms (${forestProfile['3d'].nodes} nodes)`);
