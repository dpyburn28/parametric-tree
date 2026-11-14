/**
 * Tiny store-only ZIP writer.
 *
 * The studio and standalone pages need a dependency-free batch export. Files
 * are stored (method 0) rather than deflated, which keeps the implementation
 * small while producing a standards-compliant archive for handoff tools.
 */
(function () {
    'use strict';

    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) {
            crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    function asBytes(data) {
        if (typeof data === 'string') return new TextEncoder().encode(data);
        if (data instanceof Uint8Array) return data;
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return new TextEncoder().encode(String(data));
    }

    function createZipBlob(files) {
        const encoder = new TextEncoder();
        const localChunks = [];
        const centralChunks = [];
        let offset = 0;

        for (const file of files || []) {
            const name = encoder.encode(String(file.name || 'file'));
            const data = asBytes(file.data == null ? '' : file.data);
            const checksum = crc32(data);

            const local = new Uint8Array(30 + name.length);
            const localView = new DataView(local.buffer);
            localView.setUint32(0, 0x04034b50, true);
            localView.setUint16(4, 20, true);
            localView.setUint16(6, 0, true);
            localView.setUint16(8, 0, true);
            localView.setUint16(10, 0, true);
            localView.setUint16(12, 0, true);
            localView.setUint32(14, checksum, true);
            localView.setUint32(18, data.length, true);
            localView.setUint32(22, data.length, true);
            localView.setUint16(26, name.length, true);
            localView.setUint16(28, 0, true);
            local.set(name, 30);

            localChunks.push(local, data);

            const central = new Uint8Array(46 + name.length);
            const centralView = new DataView(central.buffer);
            centralView.setUint32(0, 0x02014b50, true);
            centralView.setUint16(4, 20, true);
            centralView.setUint16(6, 20, true);
            centralView.setUint16(8, 0, true);
            centralView.setUint16(10, 0, true);
            centralView.setUint16(12, 0, true);
            centralView.setUint16(14, 0, true);
            centralView.setUint32(16, checksum, true);
            centralView.setUint32(20, data.length, true);
            centralView.setUint32(24, data.length, true);
            centralView.setUint16(28, name.length, true);
            centralView.setUint16(30, 0, true);
            centralView.setUint16(32, 0, true);
            centralView.setUint16(34, 0, true);
            centralView.setUint16(36, 0, true);
            centralView.setUint32(38, 0, true);
            centralView.setUint32(42, offset, true);
            central.set(name, 46);
            centralChunks.push(central);

            offset += local.length + data.length;
        }

        const centralOffset = offset;
        let centralSize = 0;
        for (const chunk of centralChunks) {
            centralSize += chunk.length;
            offset += chunk.length;
        }

        const end = new Uint8Array(22);
        const endView = new DataView(end.buffer);
        endView.setUint32(0, 0x06054b50, true);
        endView.setUint16(4, 0, true);
        endView.setUint16(6, 0, true);
        endView.setUint16(8, centralChunks.length, true);
        endView.setUint16(10, centralChunks.length, true);
        endView.setUint32(12, centralSize, true);
        endView.setUint32(16, centralOffset, true);
        endView.setUint16(20, 0, true);

        return new Blob([...localChunks, ...centralChunks, end], { type: 'application/zip' });
    }

    window.createZipBlob = createZipBlob;
    window.zipCrc32 = crc32;
})();
