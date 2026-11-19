/*
 * Grow-only studio UI smoke test.
 *
 * Run from the project root:
 *   node tests/app-ui.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = 9335;
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer() {
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const file = path.join(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
        if (!file.startsWith(ROOT)) {
            response.writeHead(403);
            response.end('Forbidden');
            return;
        }
        fs.readFile(file, (error, data) => {
            if (error) {
                response.writeHead(404);
                response.end('Not found');
                return;
            }
            response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            response.end(data);
        });
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function launchChrome() {
    const userDataDir = `/tmp/parametric-tree-app-${process.pid}`;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    const processHandle = spawn(CHROME, [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        '--no-sandbox',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        `--user-data-dir=${userDataDir}`,
        'about:blank',
    ], { stdio: 'ignore' });

    for (let attempt = 0; attempt < 120; attempt++) {
        try {
            const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
            if (response.ok) return { processHandle, userDataDir };
        } catch {
            // Chrome is still starting.
        }
        await sleep(250);
    }
    processHandle.kill('SIGTERM');
    throw new Error('Chrome did not start on the DevTools port');
}

class CdpSession {
    constructor(webSocket) {
        this.webSocket = webSocket;
        this.nextId = 0;
        this.pending = new Map();
        this.errors = [];
        webSocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.method === 'Runtime.exceptionThrown') {
                this.errors.push(message.params.exceptionDetails.exception?.description
                    || message.params.exceptionDetails.text || 'runtime exception');
            } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
                this.errors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
            }
            if (!message.id || !this.pending.has(message.id)) return;
            const { resolve, reject } = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result);
        };
    }

    static async open(target) {
        const webSocket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            webSocket.onopen = resolve;
            webSocket.onerror = reject;
        });
        return new CdpSession(webSocket);
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.nextId;
            this.pending.set(id, { resolve, reject });
            this.webSocket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const response = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (response.exceptionDetails) {
            throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
        }
        return response.result.value;
    }

    close() {
        this.webSocket.close();
    }
}

async function waitReady(session, timeout = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        if (await session.evaluate(`typeof window.__TREE_STUDIO__ !== 'undefined'
            && typeof window.__tree2d !== 'undefined'
            && typeof window.__tree3d !== 'undefined'
            && !!document.getElementById('controlHost')?.shadowRoot
            && !document.body.classList.contains('booting')`)) return true;
        await sleep(200);
    }
    return false;
}

function assertStandaloneHtml(htmlPath, retainedIds) {
    const html = fs.readFileSync(path.join(ROOT, htmlPath), 'utf8');
    for (const id of retainedIds) assert.ok(html.includes(`id="${id}"`), `${htmlPath} should retain #${id}`);
    for (const id of [
        'analytics', 'analyticsPin', 'analyticsCompare', 'analyticsClear',
        'prune', 'lasso', 'pruneType', 'clearCuts', 'undoCut', 'redoCut',
        'isolate', 'snapshot', 'compare', 'exportCsv', 'exportJson', 'exportBatch',
        'inspector', 'vizSkeleton', 'vizLight', 'vizVectors', 'vizShed', 'vizXray',
    ]) {
        assert.ok(!html.includes(`id="${id}"`), `${htmlPath} should remove #${id}`);
    }
}

async function main() {
    if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);

    assertStandaloneHtml('prototype/2d-prototype.html', [
        'presets', 'params', 'time', 'lifespan', 'season', 'reseed', 'exportSvg',
        'exportPng', 'saveState', 'loadState', 'shareState',
    ]);
    assertStandaloneHtml('3d-prototype/3d-prototype.html', [
        'presets', 'params', 'time', 'lifespan', 'season', 'reseed', 'exportGlb',
        'exportPng', 'saveState', 'loadState', 'shareState', 'spin',
    ]);
    for (const enginePath of ['prototype/simulation.js', '3d-prototype/simulation.js']) {
        const source = fs.readFileSync(path.join(ROOT, enginePath), 'utf8');
        for (const symbol of ['prunedCuts', 'addPrune', 'clearPrunes', 'spawnCutRegrowth']) {
            assert.ok(!source.includes(symbol), `${enginePath} should not expose ${symbol}`);
        }
    }

    const server = await startServer();
    const { processHandle, userDataDir } = await launchChrome();
    let session;
    try {
        const page = `http://127.0.0.1:${server.address().port}/index.html?test=1`;
        const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(page)}`, {
            method: 'PUT',
        })).json();
        session = await CdpSession.open(target);
        await session.send('Runtime.enable');
        await session.send('Page.enable');
        await session.send('Emulation.setDeviceMetricsOverride', {
            width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
        });
        await session.send('Page.navigate', { url: page });
        const ready = await waitReady(session);
        if (!ready) {
            const status = await session.evaluate(`document.getElementById('status')?.textContent`);
            assert.fail(`Grow studio should finish booting: ${status}; ${session.errors.join(' | ')}`);
        }

        const initial = await session.evaluate(`(() => {
            const studio = window.__TREE_STUDIO__;
            const panel = document.getElementById('controlHost')?.shadowRoot;
            const legacyIds = [
                'modeRail', 'studyDrawer', 'sculptToolbar', 'anchoredInspector',
                'recordChrome', 'recordOverlay', 'recordGuides', 'tour',
            ];
            const absentLegacyUi = legacyIds.every((id) => !document.getElementById(id));
            const absentLegacyViews = [window.__tree2d, window.__tree3d].every((engine) =>
                !('analytics' in engine) && !('pruneSelected' in engine) && !('selectedNode' in engine)
            );
            const retainedKeys = [
                'preset:oak', 'lifespan', 'season', 'param:speed', 'saveState', 'loadState',
                'shareState', 'exportSvg', 'exportPng', 'exportGlb',
            ];
            return {
                mode: studio.mode,
                modes: [...new Set(studio.manifest.map((entry) => entry.mode))],
                nodes2d: window.__tree2d.nodes.length,
                nodes3d: window.__tree3d.nodes.length,
                hasTimeline: !!document.getElementById('transportDock')
                    && !!document.getElementById('time') && !!document.getElementById('play'),
                hasBothViews: !!document.getElementById('view2d') && !!document.getElementById('view3d'),
                absentLegacyUi,
                absentLegacyViews,
                retained: retainedKeys.every((key) => studio.getMounted(key)),
                missing: retainedKeys.filter((key) => !studio.getMounted(key)),
                oldControlsAbsent: !panel.querySelector('#prune, #analytics, #exportCsv, #exportBatch'),
            };
        })()`);

        assert.strictEqual(initial.mode, 'grow');
        assert.deepStrictEqual(initial.modes, ['dock', 'grow', 'project', 'stage']);
        assert.ok(initial.nodes2d > 100 && initial.nodes3d > 100, 'both engines should generate trees');
        assert.ok(initial.hasTimeline && initial.hasBothViews, 'timeline and both viewports should remain');
        assert.ok(initial.absentLegacyUi && initial.absentLegacyViews, 'removed workflows should be absent');
        assert.ok(initial.retained && initial.oldControlsAbsent,
            `Grow and Project controls should remain; missing ${initial.missing.join(', ')}`);

        const layouts = await session.evaluate(`(() => {
            const studio = window.__TREE_STUDIO__;
            studio.setLayout('2d');
            const focus2d = studio.layout === '2d' && studio.activePane === '2d';
            studio.setLayout('3d');
            const focus3d = studio.layout === '3d' && studio.activePane === '3d';
            studio.setLayout('split');
            studio.setActivePane('3d');
            const split = studio.layout === 'split' && studio.activePane === '3d';
            return { focus2d, focus3d, split, mode: studio.mode };
        })()`);
        assert.deepStrictEqual(layouts, { focus2d: true, focus3d: true, split: true, mode: 'grow' });
        assert.deepStrictEqual(session.errors, [], `browser runtime errors: ${session.errors.join(' | ')}`);

        console.log('Grow-only app UI checks passed.');
        console.log(`2D nodes: ${initial.nodes2d}; 3D nodes: ${initial.nodes3d}`);
    } finally {
        session?.close();
        processHandle.kill('SIGTERM');
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        server.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
