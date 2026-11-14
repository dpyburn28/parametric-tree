/**
 * Phase 9 export handoff checks.
 *
 * Run from the project root:
 *   node tests/phase9.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = {
    console,
    TextEncoder,
    TextDecoder,
    Blob,
    DataView,
    Uint8Array,
    ArrayBuffer,
    btoa,
    atob,
    URL,
    window: {},
};
vm.createContext(ctx);
for (const file of ['shared/params.js', 'shared/state.js', 'shared/zip.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}

async function main() {
    const crc = vm.runInContext('window.zipCrc32', ctx)(new TextEncoder().encode('hello'));
    assert.strictEqual(crc, 0x3610a686, 'CRC32 should match the standard check value');

    const zip = vm.runInContext('window.createZipBlob', ctx)([
        { name: 'manifest.json', data: '{"format":"test"}' },
        { name: 'frames/tree-0y.svg', data: '<svg></svg>' },
        { name: 'current.glb', data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    assert.strictEqual(bytes[0], 0x50, 'ZIP should start with the local-file signature');
    assert.strictEqual(bytes[1], 0x4b, 'ZIP should start with the local-file signature');
    assert.strictEqual(bytes[2], 0x03, 'ZIP should start with the local-file signature');
    assert.strictEqual(bytes[3], 0x04, 'ZIP should start with the local-file signature');

    const text = Buffer.from(bytes).toString('latin1');
    assert.ok(text.includes('manifest.json'), 'ZIP should contain the manifest name');
    assert.ok(text.includes('frames/tree-0y.svg'), 'ZIP should contain frame names');
    assert.ok(text.includes('current.glb'), 'ZIP should contain the GLB name');
    assert.ok(bytes.length > 120, 'ZIP should contain headers and payloads');

    const endSignature = Buffer.from(bytes.slice(-22, -18)).readUInt32LE(0);
    assert.strictEqual(endSignature, 0x06054b50, 'ZIP should end with the central-directory signature');
    const entries = Buffer.from(bytes.slice(-22, -18 + 10)).readUInt16LE(8);
    assert.strictEqual(entries, 3, 'ZIP central directory should list all files');

    console.log('Phase 9 export checks passed.');
    console.log(`ZIP size: ${bytes.length} bytes`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
