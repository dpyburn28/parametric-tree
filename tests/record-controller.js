/**
 * Deterministic take-controller unit tests.
 *
 * Run from the project root:
 *   node tests/record-controller.js
 */

import assert from 'assert';
import {
    EASINGS,
    TAKE_PRESETS,
    easing,
    normalizeSettings,
    sampleTake,
    takeDuration,
    orbitPose,
} from '../studio/record-controller.js';

const close = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;

// Easing curves.
assert.strictEqual(EASINGS.linear(0.25), 0.25);
assert.ok(close(EASINGS['ease-out'](0.5), 0.75));
assert.ok(close(EASINGS['ease-in-out'](0.25), 0.125));
assert.ok(close(EASINGS['ease-in-out'](0.75), 0.875));
assert.strictEqual(easing('missing')(0.4), 0.4);
assert.strictEqual(typeof TAKE_PRESETS.timelapse.values.duration, 'number');

// Settings normalization.
const normalized = normalizeSettings({
    startAge: 10, endAge: 90, duration: 8, easing: 'linear',
    holdStart: 2, holdEnd: 4, loop: 'once', seasonMode: 'lock',
}, 100);
assert.strictEqual(normalized.startAge, 10);
assert.strictEqual(normalized.endAge, 90);
assert.strictEqual(normalized.duration, 8);
assert.ok(close(normalized.holdStart, 2));
assert.ok(close(normalized.holdEnd, 4));
assert.strictEqual(normalized.segment, undefined);
const nullable = normalizeSettings({ startAge: null, endAge: null, duration: 1 }, 100);
assert.strictEqual(nullable.startAge, 0);
assert.strictEqual(nullable.endAge, 100);

// Holds, run, completion and time mapping.
const settings = {
    startAge: 0, endAge: 100, duration: 10, easing: 'linear',
    holdStart: 1, holdEnd: 2, loop: 'once', camera: 'fixed',
    seasonMode: 'lock', seasonLock: 0.33,
};
assert.ok(close(takeDuration(settings), 13));
let sample = sampleTake(settings, 0);
assert.strictEqual(sample.phase, 'start-hold');
assert.strictEqual(sample.time, 0);
sample = sampleTake(settings, 1.5);
assert.strictEqual(sample.phase, 'run');
assert.ok(close(sample.progress, 0.05));
assert.ok(close(sample.time, 5));
sample = sampleTake(settings, 11.5);
assert.strictEqual(sample.phase, 'end-hold');
assert.ok(close(sample.time, 100));
sample = sampleTake(settings, 13);
assert.strictEqual(sample.phase, 'complete');
assert.ok(close(sample.time, 100));

// Ease-out changes the sampled time.
const eased = sampleTake({ ...settings, easing: 'ease-out' }, 1 + 5);
assert.ok(close(eased.eased, 0.75));
assert.ok(close(eased.time, 75));

// Looping repeats the segment.
sample = sampleTake({ ...settings, loop: 'loop' }, 13 + 1.5);
assert.strictEqual(sample.loopCount, 1);
assert.strictEqual(sample.phase, 'run');
assert.ok(close(sample.time, 5));

// Ping-pong reverses progress on the return pass.
const ping = sampleTake({ ...settings, loop: 'ping-pong' }, 13 + 1.5);
assert.strictEqual(ping.loopCount, 1);
assert.ok(close(ping.progress, 0.95));
assert.ok(close(ping.eased, 0.95));
assert.ok(close(ping.time, 95));

// Season modes.
sample = sampleTake({ ...settings, seasonMode: 'phenology' }, 1.5);
assert.ok(close(sample.season, 0.25));
sample = sampleTake({ ...settings, seasonMode: 'sweep', seasonSweep: 16 }, 4);
assert.ok(close(sample.season, 0.25));
sample = sampleTake({ ...settings, seasonMode: 'lock', seasonLock: 0.8 }, 4);
assert.ok(close(sample.season, 0.8));

// Turntable angle is derived from elapsed time.
sample = sampleTake({ ...settings, camera: 'turntable', turntableSpeed: 24 }, 5);
assert.ok(close(sample.cameraAngle, 120));

// Camera orbit rotates the position around the target without changing Y.
const pose = { position: [10, 5, 0], target: [0, 0, 0] };
const rotated = orbitPose(pose, 90);
assert.ok(close(rotated.position[0], 0, 1e-9));
assert.ok(close(rotated.position[1], 5));
assert.ok(close(rotated.position[2], 10, 1e-9));
assert.deepStrictEqual(rotated.target, [0, 0, 0]);
assert.deepStrictEqual(orbitPose(null, 30), null);

// Determinism: identical settings and elapsed time give identical samples.
const a = sampleTake(settings, 4.2);
const b = sampleTake(settings, 4.2);
assert.deepStrictEqual(a, b);

console.log('Record controller checks passed.');
console.log(`Presets: ${Object.keys(TAKE_PRESETS).join(', ')}`);
