/**
 * Phase 8 state round-trip checks.
 *
 * Run from the project root:
 *   node tests/phase8.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = { console, TextEncoder, TextDecoder, btoa, atob, URL };
vm.createContext(ctx);
for (const file of ['shared/params.js', 'shared/state.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

const P = vm.runInContext('Object.assign({}, BASE_PARAMS, DIMENSION_PARAMS_2D)', ctx);
const cuts = new Map([
    ['123:10', { type: 'thinning' }],
    ['456:22', { type: 'pollard' }],
]);
const state = vm.runInContext('captureTreeState', ctx)({
    dimension: '2d',
    seed: 1234,
    P,
    prunedCuts: cuts,
    time: 80,
    season: 0.4,
    seasonAuto: false,
    activePreset: 'oak',
    viz: { colorMode: 'natural', skeleton: false },
    camera: null,
});

assert.strictEqual(state.version, 3);
assert.strictEqual(state.dimension, '2d');
assert.strictEqual(state.seed, 1234);
assert.strictEqual(state.time, 80);
assert.strictEqual(state.cuts.length, 2);
assert.deepStrictEqual(JSON.parse(JSON.stringify(state.ui)), { theme: 'auto' });
assert.strictEqual(state.exportSettings, null);
assert.strictEqual(state.compare, null);

const v1 = Object.assign({}, state, { version: 1 });
delete v1.ui;
delete v1.exportSettings;
delete v1.compare;
const migrated = vm.runInContext('migrateTreeState', ctx)(v1);
assert.strictEqual(migrated.version, 3);
assert.deepStrictEqual(JSON.parse(JSON.stringify(migrated.ui)), { theme: 'auto' });
assert.strictEqual(migrated.exportSettings, null);
assert.strictEqual(migrated.compare, null);
assert.deepStrictEqual(migrated.cuts, state.cuts);

const migratedFromJson = vm.runInContext('stateFromJson', ctx)(JSON.stringify(v1));
assert.strictEqual(migratedFromJson.version, 3);

const encoded = vm.runInContext('encodeTreeState', ctx)(state);
const decoded = vm.runInContext('decodeTreeState', ctx)(encoded);
assert.deepStrictEqual(decoded, state);

// Export preferences and analytics comparison state must survive the same
// encode/decode path used by save files and share links.
const extended = vm.runInContext(`(() => {
    const next = ${JSON.stringify(state)};
    next.exportSettings = {
        svgWidth: 1400,
        svgHeight: 900,
        svgDpi: 300,
        svgAnnotations: true,
        svgScaleBar: true,
        pngScale: 4,
        glbLod: 'mid',
    };
    next.compare = {
        enabled: true,
        baseline: {
            seed: 1234,
            preset: 'oak',
            time: 80,
            points: [
                { year: 0, biomass: 1, height: 2 },
                { year: 80, biomass: 10, height: 12 },
            ],
        },
    };
    return next;
})()`, ctx);
const extendedDecoded = vm.runInContext('decodeTreeState', ctx)(vm.runInContext('encodeTreeState', ctx)(extended));
assert.deepStrictEqual(extendedDecoded, extended, 'export settings and comparison should round-trip');
assert.strictEqual(extendedDecoded.exportSettings.glbLod, 'mid');
assert.strictEqual(extendedDecoded.compare.baseline.points.length, 2);

const P2 = vm.runInContext('Object.assign({}, BASE_PARAMS, DIMENSION_PARAMS_2D)', ctx);
vm.runInContext('applyTreeStateParams', ctx)(state, P2);
assert.strictEqual(P2.trees, state.params.trees);
assert.strictEqual(P2.angleOrderBias.length, state.params.angleOrderBias.length);

assert.throws(
    () => vm.runInContext('stateFromJson', ctx)('{"version":999}'),
    /newer than the supported version/
);
assert.throws(
    () => vm.runInContext('stateFromJson', ctx)('{"version":1'),
    /Could not parse tree state JSON/
);
assert.throws(
    () => vm.runInContext('stateFromJson', ctx)('{"seed":1}'),
    /missing a version/
);

const url = vm.runInContext('treeShareUrl', ctx)({ href: 'http://localhost:8000/prototype/2d-prototype.html' }, state);
assert.ok(url.includes('?state='), 'share URL must include state');
const parsed = vm.runInContext('treeStateFromUrl', ctx)({ href: url });
assert.deepStrictEqual(parsed, state);

console.log('Phase 8 state checks passed.');
console.log(`Encoded state length: ${encoded.length}`);
console.log(`Cuts round-tripped: ${state.cuts.length}`);
