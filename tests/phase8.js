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
const state = vm.runInContext('captureTreeState', ctx)({
    dimension: '2d',
    seed: 1234,
    P,
    time: 80,
    season: 0.4,
    seasonAuto: false,
    activePreset: 'oak',
    viz: { colorMode: 'natural', skeleton: false },
    camera: null,
});

assert.strictEqual(state.version, 4);
assert.strictEqual(state.dimension, '2d');
assert.strictEqual(state.seed, 1234);
assert.strictEqual(state.time, 80);
assert.ok(!Object.hasOwn(state, 'cuts'));
assert.deepStrictEqual(JSON.parse(JSON.stringify(state.ui)), { theme: 'auto' });
assert.strictEqual(state.exportSettings, null);
assert.ok(!Object.hasOwn(state, 'compare'));
assert.ok(!Object.hasOwn(state, 'viz'));

const v1 = Object.assign({}, state, { version: 1 });
delete v1.ui;
delete v1.exportSettings;
delete v1.compare;
const migrated = vm.runInContext('migrateTreeState', ctx)(v1);
assert.strictEqual(migrated.version, 4);
assert.deepStrictEqual(JSON.parse(JSON.stringify(migrated.ui)), { theme: 'auto' });
assert.strictEqual(migrated.exportSettings, null);
assert.ok(!Object.hasOwn(migrated, 'compare'));
assert.ok(!Object.hasOwn(migrated, 'cuts'));

const v3 = Object.assign({}, state, {
    version: 3,
    cuts: [['123:10', 'thinning']],
    compare: { enabled: true, baseline: { points: [{ year: 10, biomass: 4 }] } },
    viz: { skeleton: true, lightGrid: true },
});
const migratedV3 = vm.runInContext('migrateTreeState', ctx)(v3);
assert.strictEqual(migratedV3.version, 4);
assert.ok(!Object.hasOwn(migratedV3, 'cuts'));
assert.ok(!Object.hasOwn(migratedV3, 'compare'));
assert.ok(!Object.hasOwn(migratedV3, 'viz'));
assert.strictEqual(migratedV3.seed, state.seed);
assert.strictEqual(migratedV3.time, state.time);

const migratedFromJson = vm.runInContext('stateFromJson', ctx)(JSON.stringify(v1));
assert.strictEqual(migratedFromJson.version, 4);

const encoded = vm.runInContext('encodeTreeState', ctx)(state);
const decoded = vm.runInContext('decodeTreeState', ctx)(encoded);
assert.deepStrictEqual(decoded, state);

// Direct export preferences must survive the same encode/decode path used by
// save files and share links, without persisting removed analysis state.
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
    return next;
})()`, ctx);
const extendedDecoded = vm.runInContext('decodeTreeState', ctx)(vm.runInContext('encodeTreeState', ctx)(extended));
assert.deepStrictEqual(extendedDecoded, extended, 'export settings and comparison should round-trip');
assert.strictEqual(extendedDecoded.exportSettings.glbLod, 'mid');
assert.ok(!Object.hasOwn(extendedDecoded, 'compare'));

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
console.log(`State version: ${state.version}`);
