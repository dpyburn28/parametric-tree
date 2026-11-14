/**
 * Lightweight visual-regression harness for the 2D and 3D prototypes.
 *
 * It uses the installed Chrome binary and the DevTools protocol only; there are
 * no npm dependencies. Each baseline is a compact 80x50 luminance grid sampled
 * from the render canvas, so GPU/font antialiasing differences do not require
 * binary image tooling.
 *
 * Usage:
 *   node tests/visual-regression.js
 *   node tests/visual-regression.js --update
 *
 * Set CHROME_PATH if Chrome is not in the default macOS location.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASELINE_DIR = path.join(__dirname, 'baselines');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UPDATE = process.argv.includes('--update');
const SERVER_PORT = 8766;
const CDP_PORT = 9334;
const GRID_W = 80;
const GRID_H = 50;
const MAE_LIMIT = 8;

const CASES = [
    { name: 'oak-80', preset: 'oak', seed: 1234, year: 80, season: 0.33 },
    { name: 'pine-150', preset: 'pine', seed: 42, year: 150, season: 0.33 },
    { name: 'cherry-60', preset: 'cherry', seed: 7, year: 60, season: 0.10 },
    {
        name: 'forest-auto-80', preset: 'oak', seed: 99, year: 80, season: 0.33, limit: 12,
        options: { trees: 5, speciesMix: 'auto', spacing: 160, ageMix: 0.4, wind: 0.2, windDirection: 90 },
    },
    {
        name: 'golden-120', preset: 'oak', seed: 5, year: 120, season: 0.33,
        options: { solarModel: true, latitude: 40, dayOfYear: 172, hour: 18, skyPreset: 'golden', wind: 0.15, windDirection: 60 },
    },
    {
        name: 'slope-80', preset: 'oak', seed: 11, year: 80, season: 0.33, limit: 15,
        options: { trees: 3, slope: 16, aspect: 90, fogDensity: 0.0012 },
    },
    {
        name: 'topiary-80', preset: 'cherry', seed: 13, year: 80, season: 0.33, limit: 12,
        options: { obstacle: 4, obstacleSize: 55 },
    },
];

const STUDIO_CASE = {
    name: 'oak-80', preset: 'oak', seed: 1234, year: 80, season: 0.33, limit: 12,
};

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${SERVER_PORT}`);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') pathname = '/prototype/2d-prototype.html';
        const file = path.join(ROOT, pathname.replace(/^\/+/, ''));
        if (!file.startsWith(ROOT)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            res.end(data);
        });
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(SERVER_PORT, '127.0.0.1', () => resolve(server));
    });
}

async function launchChrome() {
    const userDataDir = `/tmp/parametric-tree-vr-${process.pid}`;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    const proc = spawn(CHROME, [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        '--no-sandbox',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        `--user-data-dir=${userDataDir}`,
        'about:blank',
    ], { stdio: 'ignore' });

    for (let i = 0; i < 60; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
            if (res.ok) return { proc, userDataDir };
        } catch {
            // Chrome is still starting.
        }
        await sleep(250);
    }
    proc.kill('SIGTERM');
    throw new Error('Chrome did not start on the DevTools port');
}

class CdpSession {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 0;
        this.pending = new Map();
        this.errors = [];
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.method === 'Runtime.exceptionThrown') {
                this.errors.push(msg.params.exceptionDetails.text || 'runtime exception');
            } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                this.errors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
            }
            if (!msg.id || !this.pending.has(msg.id)) return;
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result);
        };
    }

    static async open(target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
        });
        return new CdpSession(ws);
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.nextId;
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
        }
        return result.result?.value;
    }

    close() {
        this.ws.close();
    }
}

function sampleExpression(dimension, testCase) {
    const options = JSON.stringify(testCase.options || {});
    if (dimension === '2d') {
        return `
            (async () => {
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                seed = ${testCase.seed};
                applyPreset(${JSON.stringify(testCase.preset)});
                Object.assign(P, ${options});
                regenerate();
                time = ${testCase.year};
                season = ${testCase.season};
                seasonAuto = false;
                draw();
                await sleep(250);
                const src = document.getElementById('c');
                const out = document.createElement('canvas');
                out.width = ${GRID_W}; out.height = ${GRID_H};
                const g = out.getContext('2d');
                g.drawImage(src, 0, 0, ${GRID_W}, ${GRID_H});
                const data = g.getImageData(0, 0, ${GRID_W}, ${GRID_H}).data;
                const gray = [];
                for (let i = 0; i < data.length; i += 4) {
                    gray.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
                }
                return gray;
            })()
        `;
    }
    return `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            __tree3d.setSeed(${testCase.seed});
            __tree3d.setPreset(${JSON.stringify(testCase.preset)});
            Object.assign(P, ${options}, { sway: 0, gustAmp: 0, wind: 0, quality: 'high' });
            __tree3d.regenerate();
            __tree3d.setTime(${testCase.year});
            __tree3d.setSeason(${testCase.season});
            // The orbit spin toggle is on by default; turn it off so the
            // sampled grid does not depend on how long the page has been open.
            const spin = document.getElementById('spin');
            if (spin) spin.checked = false;
            await sleep(800);
            const data = __tree3d.captureGrid(${GRID_W}, ${GRID_H});
            const gray = [];
            for (let i = 0; i < data.length; i += 4) {
                gray.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
            }
            return gray;
        })()
    `;
}

function sampleStudioExpression(testCase) {
    const options = JSON.stringify(testCase.options || {});
    return `
        (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const shadow2d = document.querySelector('.app-pane[data-view="2d"] .view-host').shadowRoot;
            const shadow3d = document.querySelector('.app-pane[data-view="3d"] .view-host').shadowRoot;
            const state = __tree2d.captureState();
            state.seed = ${testCase.seed};
            state.activePreset = ${JSON.stringify(testCase.preset)};
            state.params = Object.assign({}, state.params, ${options}, {
                trees: 1,
                quality: 'high',
                sway: 0,
                gustAmp: 0,
                wind: 0,
                reducedMotion: true,
            });
            state.time = ${testCase.year};
            state.season = ${testCase.season};
            state.seasonAuto = false;
            state.viz = Object.assign({}, state.viz, { colorMode: 'natural' });
            state.compare = null;
            state.camera = { position: [180, 120, 240], target: [0, 40, 0] };
            document.body.classList.add('panel-open');
            const spin = shadow3d.querySelector('#spin');
            if (spin) spin.checked = false;
            __tree2d.restoreState(state);
            __tree3d.restoreState(state);
            await sleep(1600);

            const source = shadow2d.querySelector('#c');
            const half = document.createElement('canvas');
            half.width = ${GRID_W / 2}; half.height = ${GRID_H};
            const g = half.getContext('2d');
            g.drawImage(source, 0, 0, half.width, half.height);
            const data = g.getImageData(0, 0, half.width, half.height).data;
            const gray = [];
            for (let i = 0; i < data.length; i += 4) {
                gray.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
            }
            const right = __tree3d.captureGrid(${GRID_W / 2}, ${GRID_H});
            for (let i = 0; i < right.length; i += 4) {
                gray.push(Math.round(0.299 * right[i] + 0.587 * right[i + 1] + 0.114 * right[i + 2]));
            }
            return gray;
        })()
    `;
}

function meanAbsoluteError(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
    let total = 0;
    for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
    return total / a.length;
}

async function capture(dimension, testCase) {
    const page = dimension === '2d'
        ? `http://127.0.0.1:${SERVER_PORT}/prototype/2d-prototype.html`
        : `http://127.0.0.1:${SERVER_PORT}/3d-prototype/3d-prototype.html?test=1`;
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(page)}`, { method: 'PUT' });
    const target = await res.json();
    const session = await CdpSession.open(target);
    try {
        await session.send('Runtime.enable');
        await session.send('Page.enable');
        await session.send('Page.bringToFront');
        await session.send('Emulation.setDeviceMetricsOverride', {
            width: 1000, height: 800, deviceScaleFactor: 1, mobile: false,
        });
        await session.send('Page.navigate', { url: page });
        await sleep(dimension === '3d' ? 5500 : 3000);
        const readyExpr = dimension === '3d'
            ? `typeof __tree3d !== 'undefined'`
            : `typeof nodes !== 'undefined' && typeof analytics !== 'undefined'`;
        let ready = false;
        for (let i = 0; i < 40; i++) {
            ready = await session.evaluate(readyExpr);
            if (ready) break;
            await sleep(250);
        }
        if (!ready) {
            const href = await session.evaluate('location.href');
            const detail = session.errors.length ? `: ${session.errors.slice(0, 3).join(' | ')}` : '';
            throw new Error(`${dimension} ${testCase.name}: page did not initialize (${href})${detail}`);
        }
        return await session.evaluate(sampleExpression(dimension, testCase));
    } finally {
        session.close();
        await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`).catch(() => {});
    }
}

async function captureStudio(testCase) {
    const page = `http://127.0.0.1:${SERVER_PORT}/linked.html?test=1`;
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(page)}`, { method: 'PUT' });
    const target = await res.json();
    const session = await CdpSession.open(target);
    try {
        await session.send('Runtime.enable');
        await session.send('Page.enable');
        await session.send('Page.bringToFront');
        await session.send('Emulation.setDeviceMetricsOverride', {
            width: 1200, height: 800, deviceScaleFactor: 1, mobile: false,
        });
        await session.send('Page.navigate', { url: page });
        await sleep(7000);
        const readyExpr = `typeof __tree2d !== 'undefined' && typeof __tree3d !== 'undefined' && !document.body.classList.contains('booting')`;
        let ready = false;
        for (let i = 0; i < 60; i++) {
            ready = await session.evaluate(readyExpr);
            if (ready) break;
            await sleep(250);
        }
        if (!ready) {
            const href = await session.evaluate('location.href');
            const detail = session.errors.length ? `: ${session.errors.slice(0, 3).join(' | ')}` : '';
            throw new Error(`studio ${testCase.name}: page did not initialize (${href})${detail}`);
        }
        return await session.evaluate(sampleStudioExpression(testCase));
    } finally {
        session.close();
        await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${target.id}`).catch(() => {});
    }
}

async function main() {
    if (!fs.existsSync(CHROME)) {
        throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH to run visual regression.`);
    }
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    const server = await startServer();
    const { proc, userDataDir } = await launchChrome();
    let failures = 0;

    try {
        for (const dimension of ['2d', '3d']) {
            for (const testCase of CASES) {
                const values = await capture(dimension, testCase);
                const baselinePath = path.join(BASELINE_DIR, `${dimension}-${testCase.name}.json`);
                if (UPDATE || !fs.existsSync(baselinePath)) {
                    fs.writeFileSync(baselinePath, JSON.stringify({ width: GRID_W, height: GRID_H, values }));
                    console.log(`wrote ${path.relative(ROOT, baselinePath)}`);
                    continue;
                }
                const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
                const mae = meanAbsoluteError(values, baseline.values);
                const limit = testCase.limit ?? MAE_LIMIT;
                if (mae > limit) {
                    failures++;
                    console.error(`${dimension} ${testCase.name}: FAIL (MAE ${mae.toFixed(2)} > ${limit})`);
                } else {
                    console.log(`${dimension} ${testCase.name}: ok (MAE ${mae.toFixed(2)})`);
                }
            }
        }
        {
            const values = await captureStudio(STUDIO_CASE);
            const baselinePath = path.join(BASELINE_DIR, `studio-${STUDIO_CASE.name}.json`);
            if (UPDATE || !fs.existsSync(baselinePath)) {
                fs.writeFileSync(baselinePath, JSON.stringify({ width: GRID_W, height: GRID_H, values }));
                console.log(`wrote ${path.relative(ROOT, baselinePath)}`);
            } else {
                const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
                const mae = meanAbsoluteError(values, baseline.values);
                const limit = STUDIO_CASE.limit ?? MAE_LIMIT;
                if (mae > limit) {
                    failures++;
                    console.error(`studio ${STUDIO_CASE.name}: FAIL (MAE ${mae.toFixed(2)} > ${limit})`);
                } else {
                    console.log(`studio ${STUDIO_CASE.name}: ok (MAE ${mae.toFixed(2)})`);
                }
            }
        }
    } finally {
        proc.kill('SIGTERM');
        server.close();
        await sleep(500);
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }

    if (failures) {
        console.error(`${failures} visual regression case(s) failed`);
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
