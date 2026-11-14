/**
 * Single-page split studio UI smoke test.
 *
 * Run from the project root:
 *   node tests/app-ui.js
 *
 * Checks the universal control rail, pane isolation, shared state, active-pane
 * switching, and panel collapse behavior in headless Chrome.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SERVER_PORT = 8767;
const CDP_PORT = 9335;
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${SERVER_PORT}`);
        const pathname = decodeURIComponent(url.pathname);
        const file = path.join(ROOT, pathname.replace(/^\/+/, ''));
        if (!file.startsWith(ROOT)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        fs.readFile(file, (error, data) => {
            if (error) {
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
    const userDataDir = `/tmp/parametric-tree-app-${process.pid}`;
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
                this.errors.push(msg.params.args.map((arg) => arg.value || arg.description || '').join(' '));
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
            const detail = result.exceptionDetails.exception?.description
                || result.exceptionDetails.exception?.value
                || result.exceptionDetails.text
                || 'Runtime evaluation failed';
            throw new Error(detail);
        }
        return result.result?.value;
    }

    close() {
        this.ws.close();
    }
}

async function main() {
    if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);

    const server = await startServer();
    const { proc, userDataDir } = await launchChrome();
    const page = `http://127.0.0.1:${SERVER_PORT}/linked.html?test=1`;
    const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(page)}`, { method: 'PUT' })).json();
    const session = await CdpSession.open(target);

    try {
        await session.send('Runtime.enable');
        await session.send('Page.enable');
        await session.send('Emulation.setDeviceMetricsOverride', {
            width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
        });
        await session.send('Page.navigate', { url: page });

        let ready = false;
        for (let i = 0; i < 100; i++) {
            ready = await session.evaluate(`typeof __tree3d !== 'undefined' && !document.body.classList.contains('booting')`);
            if (ready) break;
            await sleep(250);
        }
        assert.ok(ready, 'studio should finish booting');

        const result = await session.evaluate(`(async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const panel = document.getElementById('controlHost').shadowRoot;
            const set = (id, value, type = 'input') => {
                const input = panel.getElementById(id);
                input.value = value;
                input.dispatchEvent(new Event(type, { bubbles: true }));
            };
            const setParam = (key, value) => {
                const input = panel.querySelector('#params [data-param-key="' + key + '"] input');
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            };
            const out = {};
            out.panes = document.querySelectorAll('.app-pane').length;
            out.panelControls = panel.querySelectorAll('input, select, button').length;
            out.visibleWraps = [...document.querySelectorAll('.view-host')].filter((host) => {
                const wrap = host.shadowRoot.querySelector('.wrap');
                return wrap && getComputedStyle(wrap).display !== 'none';
            }).length;
            set('lifespan', '140');
            set('season', '0.6');
            setParam('angle', '52');
            await sleep(1200);
            out.paramState = {
                angle2: __tree2d.captureState().params.angle,
                angle3: __tree3d.captureState().params.angle,
                preset2: __tree2d.captureState().activePreset,
                preset3: __tree3d.captureState().activePreset,
            };
            panel.querySelector('#presets button[data-preset="pine"]').click();
            await sleep(1200);
            out.state = {
                lifespan2: __tree2d.captureState().params.lifespan,
                lifespan3: __tree3d.captureState().params.lifespan,
                season2: +__tree2d.season.toFixed(2),
                season3: +__tree3d.season.toFixed(2),
                angle2: __tree2d.captureState().params.angle,
                angle3: __tree3d.captureState().params.angle,
                preset2: __tree2d.captureState().activePreset,
                preset3: __tree3d.captureState().activePreset,
                uiPreset: panel.querySelector('#presets button.active')?.dataset.preset,
            };
            document.querySelector('.app-pane[data-view="3d"]').click();
            out.active = document.getElementById('activeView').textContent;
            out.activePane = document.querySelector('.app-pane.active')?.dataset.view;
            panel.getElementById('prune').click();
            out.prune = {
                two: document.getElementById('view2d').shadowRoot.getElementById('prune').classList.contains('active'),
                three: document.getElementById('view3d').shadowRoot.getElementById('prune').classList.contains('active'),
            };
            panel.getElementById('prune').click();
            document.getElementById('togglePanel').click();
            out.collapsed = document.body.classList.contains('panel-collapsed');
            document.getElementById('togglePanel').click();
            out.reopened = document.body.classList.contains('panel-open');
            document.getElementById('fullscreen').click();
            await sleep(600);
            const focusedPane = document.querySelector('.app-pane.focused');
            const fullscreenHost = focusedPane.querySelector('.view-host');
            const fullscreenShadow = fullscreenHost.shadowRoot;
            const fullscreenCanvas = fullscreenShadow.querySelector('#c');
            out.fullscreen = {
                body: document.body.classList.contains('canvas-fullscreen'),
                focus: document.body.dataset.focusView,
                pane: focusedPane.dataset.view,
                header: getComputedStyle(document.querySelector('.app-header')).display,
                panel: getComputedStyle(document.getElementById('controlPanel')).display,
                analytics: getComputedStyle(fullscreenShadow.querySelector('#analytics')).display,
                exit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                width: fullscreenCanvas.clientWidth,
                height: fullscreenCanvas.clientHeight,
            };
            const appPlay = document.getElementById('play');
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
            await sleep(300);
            const started = { playing: appPlay.textContent === 'Pause', time: __tree3d.time };
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
            await sleep(100);
            const paused = { playing: appPlay.textContent === 'Play', time: __tree3d.time };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
            await sleep(300);
            const restarted = { playing: appPlay.textContent === 'Pause', time: __tree3d.time };
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
            await sleep(100);
            out.fullscreenKeys = {
                started,
                paused,
                restarted,
                stopped: appPlay.textContent === 'Play',
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
            await sleep(150);
            out.fullscreenUiHidden = {
                body: document.body.classList.contains('canvas-ui-hidden'),
                exit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                hint: getComputedStyle(document.getElementById('fullscreenHint')).display,
                canvasHint: getComputedStyle(fullscreenShadow.querySelector('.hint')).display,
                host: fullscreenHost.classList.contains('ui-hidden'),
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
            await sleep(150);
            out.fullscreenUiShown = {
                body: document.body.classList.contains('canvas-ui-hidden'),
                exit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                host: fullscreenHost.classList.contains('ui-hidden'),
            };
            document.getElementById('fullscreenExit').click();
            await sleep(600);
            out.exitFullscreen = {
                body: document.body.classList.contains('canvas-fullscreen'),
                focus: document.body.dataset.focusView || '',
                focused: document.querySelectorAll('.app-pane.focused').length,
                fullscreenHosts: [...document.querySelectorAll('.view-host')].filter((host) => host.classList.contains('fullscreen')).length,
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
            await sleep(300);
            out.keyFullscreen = document.body.classList.contains('canvas-fullscreen');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(300);
            out.keyExit = document.body.classList.contains('canvas-fullscreen');
            document.querySelector('.app-pane[data-view="2d"]').click();
            document.getElementById('fullscreen').click();
            await sleep(600);
            const pane2d = document.querySelector('.app-pane.focused');
            const canvas2d = pane2d.querySelector('.view-host').shadowRoot.querySelector('#c');
            out.fullscreen2d = {
                focus: document.body.dataset.focusView,
                width: canvas2d.clientWidth,
                height: canvas2d.clientHeight,
            };
            document.getElementById('fullscreenExit').click();
            await sleep(300);
            const groundToggle = panel.getElementById('groundDetail');
            const groundDensity = panel.getElementById('groundDensity');
            groundToggle.checked = false;
            groundToggle.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(400);
            out.groundOff = {
                visible: __tree3d.groundDetail.visible,
                checked: groundToggle.checked,
                disabled: groundDensity.disabled,
            };
            groundToggle.checked = true;
            groundToggle.dispatchEvent(new Event('change', { bubbles: true }));
            groundDensity.value = 'high';
            groundDensity.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(600);
            out.groundHigh = {
                visible: __tree3d.groundDetail.visible,
                density: __tree3d.groundDetail.density,
                grass: __tree3d.groundDetail.grass,
                rocks: __tree3d.groundDetail.rocks,
                shrubs: __tree3d.groundDetail.shrubs,
                radius: __tree3d.groundDetail.radius,
            };
            panel.getElementById('analyticsPin').click();
            await sleep(400);
            const pinned2 = __tree2d.captureState();
            const pinned3 = __tree3d.captureState();
            out.analyticsPinned = {
                two: !!pinned2.compare?.baseline?.points?.length,
                three: !!pinned3.compare?.baseline?.points?.length,
                compareTwo: pinned2.compare?.enabled,
                compareThree: pinned3.compare?.enabled,
                label: panel.getElementById('analyticsBaselineLabel').textContent,
                summary: panel.getElementById('analyticsSummary').textContent,
                compareDisabled: panel.getElementById('analyticsCompare').disabled,
                clearDisabled: panel.getElementById('analyticsClear').disabled,
            };
            panel.getElementById('analyticsCompare').click();
            await sleep(250);
            out.analyticsToggled = {
                two: __tree2d.captureState().compare?.enabled,
                three: __tree3d.captureState().compare?.enabled,
            };
            panel.getElementById('analyticsClear').click();
            await sleep(250);
            out.analyticsCleared = {
                two: __tree2d.captureState().compare,
                three: __tree3d.captureState().compare,
                label: panel.getElementById('analyticsBaselineLabel').textContent,
                clearDisabled: panel.getElementById('analyticsClear').disabled,
            };
            const panelSvgWidth = panel.getElementById('svgWidth');
            const panelSvgAnnotations = panel.getElementById('svgAnnotations');
            const panelGlbLod = panel.getElementById('glbLod');
            panelSvgWidth.value = '1400';
            panelSvgWidth.dispatchEvent(new Event('input', { bubbles: true }));
            panelSvgAnnotations.checked = true;
            panelSvgAnnotations.dispatchEvent(new Event('change', { bubbles: true }));
            panelGlbLod.value = 'mid';
            panelGlbLod.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(700);
            const export2d = __tree2d.captureState().exportSettings;
            const export3d = __tree3d.captureState().exportSettings;
            out.exportSettings = {
                two: export2d,
                three: export3d,
                panelSvgWidth: panelSvgWidth.value,
                panelSvgAnnotations: panelSvgAnnotations.checked,
                panelGlbLod: panelGlbLod.value,
            };
            const analyticsCanvas = document.querySelector('.app-pane[data-view="2d"] .view-host').shadowRoot.querySelector('#analytics');
            const analyticsRect = analyticsCanvas.getBoundingClientRect();
            const chartLifespan = __tree2d.captureState().params.lifespan;
            const targetYear = Math.min(60, chartLifespan);
            const chartLeft = 50;
            const chartWidth = Math.max(1, analyticsRect.width - 58);
            analyticsCanvas.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                clientX: analyticsRect.left + chartLeft + (targetYear / chartLifespan) * chartWidth,
                clientY: analyticsRect.top + 12,
            }));
            await sleep(400);
            out.chartSeek = {
                target: targetYear,
                two: +__tree2d.time.toFixed(1),
                three: +__tree3d.time.toFixed(1),
            };
            const originalCreateObjectURL = URL.createObjectURL;
            const originalAnchorClick = HTMLAnchorElement.prototype.click;
            let batchBlob = null;
            let batchName = '';
            URL.createObjectURL = (blob) => {
                batchBlob = blob;
                return originalCreateObjectURL.call(URL, blob);
            };
            HTMLAnchorElement.prototype.click = function () { batchName = this.download; };
            const batchTime = __tree2d.time;
            document.querySelector('.app-pane[data-view="2d"] .view-host').shadowRoot.querySelector('#exportBatch').click();
            await sleep(5000);
            const batchBytes = batchBlob ? new Uint8Array(await batchBlob.arrayBuffer()) : new Uint8Array();
            out.batch2d = {
                name: batchName,
                size: batchBytes.length,
                signature: [...batchBytes.slice(0, 4)],
                time: +__tree2d.time.toFixed(2),
                before: +batchTime.toFixed(2),
            };
            batchBlob = null;
            batchName = '';
            document.querySelector('.app-pane[data-view="3d"] .view-host').shadowRoot.querySelector('#exportBatch').click();
            await sleep(6000);
            const batch3dBytes = batchBlob ? new Uint8Array(await batchBlob.arrayBuffer()) : new Uint8Array();
            out.batch3d = {
                name: batchName,
                size: batch3dBytes.length,
                signature: [...batch3dBytes.slice(0, 4)],
                time: +__tree3d.time.toFixed(2),
                before: +batchTime.toFixed(2),
            };
            URL.createObjectURL = originalCreateObjectURL;
            HTMLAnchorElement.prototype.click = originalAnchorClick;
            const a11yCanvas2d = document.querySelector('.app-pane[data-view="2d"] .view-host').shadowRoot.querySelector('#c');
            const a11yCanvas3d = document.querySelector('.app-pane[data-view="3d"] .view-host').shadowRoot.querySelector('#c');
            const a11yAnalytics2d = document.querySelector('.app-pane[data-view="2d"] .view-host').shadowRoot.querySelector('#analytics');
            const parseRgb = (value) => {
                const parts = (value.match(/\\d+(?:\\.\\d+)?/g) || []).slice(0, 3).map(Number);
                return value.startsWith('color(') ? parts.map((part) => part * 255) : parts;
            };
            const luminance = ([r, g, b]) => {
                const channel = (v) => {
                    const s = v / 255;
                    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                };
                return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
            };
            const contrast = (fg, bg) => {
                const a = luminance(parseRgb(fg));
                const b = luminance(parseRgb(bg));
                return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            };
            const statusStyle = getComputedStyle(document.getElementById('status'));
            const headerStyle = getComputedStyle(document.querySelector('.app-header'));
            out.a11y = {
                canvas2dRole: a11yCanvas2d.getAttribute('role'),
                canvas2dLabel: a11yCanvas2d.getAttribute('aria-label'),
                canvas2dHelp: a11yCanvas2d.getAttribute('aria-describedby'),
                canvas3dRole: a11yCanvas3d.getAttribute('role'),
                canvas3dLabel: a11yCanvas3d.getAttribute('aria-label'),
                analyticsRole: a11yAnalytics2d.getAttribute('role'),
                analyticsLabel: a11yAnalytics2d.getAttribute('aria-label'),
                statusRole: document.getElementById('status').getAttribute('role'),
                statusLive: document.getElementById('status').getAttribute('aria-live'),
                panelLabelledby: document.getElementById('controlPanel').getAttribute('aria-labelledby'),
                panePressed: [document.getElementById('pane2d').getAttribute('aria-pressed'), document.getElementById('pane3d').getAttribute('aria-pressed')],
                statusColor: statusStyle.color,
                headerBackground: headerStyle.backgroundColor,
                statusContrast: Number.isFinite(contrast(statusStyle.color, headerStyle.backgroundColor))
                    ? contrast(statusStyle.color, headerStyle.backgroundColor)
                    : null,
            };
            return out;
        })()`);

        assert.strictEqual(result.panes, 2, 'studio should have two panes');
        assert.ok(result.panelControls > 80, `universal panel should expose all controls (got ${result.panelControls})`);
        assert.strictEqual(result.visibleWraps, 0, 'per-pane control sidebars should be hidden');
        assert.strictEqual(result.state.lifespan2, 140, 'lifespan should reach the 2D view');
        assert.strictEqual(result.state.lifespan3, 140, 'lifespan should reach the 3D view');
        assert.strictEqual(result.state.season2, 0.6, 'season should reach the 2D view');
        assert.strictEqual(result.state.season3, 0.6, 'season should reach the 3D view');
        assert.strictEqual(result.paramState.angle2, 52, 'growth params should reach the 2D view');
        assert.strictEqual(result.paramState.angle3, 52, 'growth params should reach the 3D view');
        assert.strictEqual(result.paramState.preset2, 'custom', 'editing a growth param should select Custom');
        assert.strictEqual(result.paramState.preset3, 'custom', 'editing a growth param should select Custom in both views');
        assert.strictEqual(result.state.preset2, 'pine', 'preset should reach the 2D view');
        assert.strictEqual(result.state.preset3, 'pine', 'preset should reach the 3D view');
        assert.strictEqual(result.state.uiPreset, 'pine', 'panel preset should show as active');
        assert.strictEqual(result.active, 'Active: 3D', 'active pane label should follow pane clicks');
        assert.strictEqual(result.activePane, '3d', '3D pane should become active');
        assert.deepStrictEqual(result.prune, { two: false, three: true }, 'prune should target the active pane');
        assert.strictEqual(result.collapsed, true, 'panel should collapse');
        assert.strictEqual(result.reopened, true, 'panel should reopen');
        assert.strictEqual(result.fullscreen.body, true, 'fullscreen should enter');
        assert.strictEqual(result.fullscreen.focus, '3d', 'fullscreen should target the active pane');
        assert.strictEqual(result.fullscreen.pane, '3d', 'active pane should be the focused pane');
        assert.strictEqual(result.fullscreen.header, 'none', 'header should hide in fullscreen');
        assert.strictEqual(result.fullscreen.panel, 'none', 'controls should hide in fullscreen');
        assert.strictEqual(result.fullscreen.analytics, 'none', 'analytics should hide in fullscreen');
        assert.strictEqual(result.fullscreen.exit, 'flex', 'exit control should show in fullscreen');
        assert.ok(result.fullscreen.width > 1200, `fullscreen canvas should fill width (got ${result.fullscreen.width})`);
        assert.ok(result.fullscreen.height > 800, `fullscreen canvas should fill height (got ${result.fullscreen.height})`);
        assert.strictEqual(result.fullscreenKeys.started.playing, true, 'Space should start playback in fullscreen');
        assert.ok(result.fullscreenKeys.started.time > 0, 'Space should advance the timeline');
        assert.strictEqual(result.fullscreenKeys.paused.playing, true, 'Space should pause playback in fullscreen');
        assert.strictEqual(result.fullscreenKeys.restarted.playing, true, 'R should restart playback in fullscreen');
        assert.ok(result.fullscreenKeys.restarted.time > 0, 'R should restart from year zero and advance');
        assert.ok(result.fullscreenKeys.restarted.time < result.fullscreenKeys.started.time + 2, 'R should reset the timeline near zero');
        assert.strictEqual(result.fullscreenKeys.stopped, true, 'Space should pause after restart');
        assert.strictEqual(result.fullscreenUiHidden.body, true, 'H should hide fullscreen UI');
        assert.strictEqual(result.fullscreenUiHidden.exit, 'none', 'H should hide the exit button');
        assert.strictEqual(result.fullscreenUiHidden.hint, 'none', 'H should hide the shortcut hint');
        assert.strictEqual(result.fullscreenUiHidden.canvasHint, 'none', 'H should hide in-canvas hints');
        assert.strictEqual(result.fullscreenUiHidden.host, true, 'H should mark the focused host UI-hidden');
        assert.strictEqual(result.fullscreenUiShown.body, false, 'H should restore fullscreen UI');
        assert.strictEqual(result.fullscreenUiShown.exit, 'flex', 'H should restore the exit button');
        assert.strictEqual(result.fullscreenUiShown.host, false, 'H should clear the host UI-hidden class');
        assert.strictEqual(result.exitFullscreen.body, false, 'fullscreen should exit');
        assert.strictEqual(result.exitFullscreen.focus, '', 'focus view should clear on exit');
        assert.strictEqual(result.exitFullscreen.focused, 0, 'focused pane class should clear on exit');
        assert.strictEqual(result.exitFullscreen.fullscreenHosts, 0, 'fullscreen host classes should clear on exit');
        assert.strictEqual(result.keyFullscreen, true, 'F should enter fullscreen');
        assert.strictEqual(result.keyExit, false, 'Escape should exit fullscreen');
        assert.strictEqual(result.fullscreen2d.focus, '2d', '2D should also enter fullscreen');
        assert.ok(result.fullscreen2d.width > 1200, `2D fullscreen canvas should fill width (got ${result.fullscreen2d.width})`);
        assert.ok(result.fullscreen2d.height > 800, `2D fullscreen canvas should fill height (got ${result.fullscreen2d.height})`);
        assert.strictEqual(result.groundOff.visible, false, 'ground detail should hide from the universal panel');
        assert.strictEqual(result.groundOff.checked, false, 'ground detail checkbox should clear');
        assert.strictEqual(result.groundOff.disabled, true, 'ground density should disable when detail is off');
        assert.strictEqual(result.groundHigh.visible, true, 'ground detail should return');
        assert.strictEqual(result.groundHigh.density, 'high', 'ground density should switch to high');
        assert.ok(result.groundHigh.grass >= 9000, `high ground density should fill grass (got ${result.groundHigh.grass})`);
        assert.ok(result.groundHigh.rocks >= 350, `high ground density should fill rocks (got ${result.groundHigh.rocks})`);
        assert.ok(result.groundHigh.shrubs >= 140, `high ground density should fill shrubs (got ${result.groundHigh.shrubs})`);
        assert.ok(result.groundHigh.radius >= 500, `ground detail should cover a broad area (got ${result.groundHigh.radius})`);
        assert.strictEqual(result.analyticsPinned.two, true, 'pinning should store a 2D baseline');
        assert.strictEqual(result.analyticsPinned.three, true, 'pinning should store a 3D baseline');
        assert.strictEqual(result.analyticsPinned.compareTwo, true, 'pinning should enable 2D comparison');
        assert.strictEqual(result.analyticsPinned.compareThree, true, 'pinning should enable 3D comparison');
        assert.ok(result.analyticsPinned.label.includes('Baseline:'), 'panel should label the pinned baseline');
        assert.ok(result.analyticsPinned.summary.includes('vs baseline'), 'panel should show metric deltas');
        assert.strictEqual(result.analyticsPinned.compareDisabled, false, 'compare should enable after pinning');
        assert.strictEqual(result.analyticsPinned.clearDisabled, false, 'clear should enable after pinning');
        assert.strictEqual(result.analyticsToggled.two, false, 'compare should toggle off in 2D');
        assert.strictEqual(result.analyticsToggled.three, false, 'compare should toggle off in 3D');
        assert.strictEqual(result.analyticsCleared.two, null, 'clearing should remove the 2D baseline');
        assert.strictEqual(result.analyticsCleared.three, null, 'clearing should remove the 3D baseline');
        assert.strictEqual(result.analyticsCleared.label, 'No baseline', 'panel should clear the baseline label');
        assert.strictEqual(result.analyticsCleared.clearDisabled, true, 'clear should disable without a baseline');
        assert.strictEqual(result.exportSettings.two.svgWidth, 1400, 'panel SVG width should reach 2D export settings');
        assert.strictEqual(result.exportSettings.three.svgWidth, 1400, 'export settings should sync to 3D');
        assert.strictEqual(result.exportSettings.two.svgAnnotations, true, 'panel annotations should persist');
        assert.strictEqual(result.exportSettings.two.glbLod, 'mid', 'panel GLB LOD should persist in 2D state');
        assert.strictEqual(result.exportSettings.three.glbLod, 'mid', 'panel GLB LOD should reach 3D export settings');
        assert.strictEqual(result.exportSettings.panelSvgWidth, '1400', 'panel should keep the SVG width value');
        assert.strictEqual(result.exportSettings.panelGlbLod, 'mid', 'panel should keep the GLB LOD value');
        assert.ok(Math.abs(result.chartSeek.two - result.chartSeek.target) < 1.5, `chart click should seek 2D near year ${result.chartSeek.target} (got ${result.chartSeek.two})`);
        assert.ok(Math.abs(result.chartSeek.three - result.chartSeek.target) < 1.5, `chart click should seek 3D near year ${result.chartSeek.target} (got ${result.chartSeek.three})`);
        assert.ok(result.batch2d.name.endsWith('.zip'), '2D batch export should download a ZIP');
        assert.deepStrictEqual(result.batch2d.signature, [0x50, 0x4b, 0x03, 0x04], '2D batch ZIP should have a local-file header');
        assert.ok(result.batch2d.size > 1000, `2D batch ZIP should contain files (got ${result.batch2d.size} bytes)`);
        assert.ok(Math.abs(result.batch2d.time - result.batch2d.before) < 0.2, '2D batch export should preserve the live time');
        assert.ok(result.batch3d.name.endsWith('.zip'), '3D batch export should download a ZIP');
        assert.deepStrictEqual(result.batch3d.signature, [0x50, 0x4b, 0x03, 0x04], '3D batch ZIP should have a local-file header');
        assert.ok(result.batch3d.size > 1000, `3D batch ZIP should contain files (got ${result.batch3d.size} bytes)`);
        assert.ok(Math.abs(result.batch3d.time - result.batch3d.before) < 0.2, '3D batch export should preserve the live time');
        assert.strictEqual(result.a11y.canvas2dRole, 'img', '2D canvas should expose an image role');
        assert.ok(result.a11y.canvas2dLabel.includes('2D'), '2D canvas should have a descriptive label');
        assert.strictEqual(result.a11y.canvas2dHelp, 'canvasHelp', '2D canvas should reference help text');
        assert.strictEqual(result.a11y.canvas3dRole, 'img', '3D canvas should expose an image role');
        assert.ok(result.a11y.canvas3dLabel.includes('3D'), '3D canvas should have a descriptive label');
        assert.strictEqual(result.a11y.analyticsRole, 'img', 'analytics chart should expose an image role');
        assert.ok(result.a11y.analyticsLabel.includes('analytics'), 'analytics chart should have a descriptive label');
        assert.strictEqual(result.a11y.statusRole, 'status', 'status should be a live region');
        assert.strictEqual(result.a11y.statusLive, 'polite', 'status should announce politely');
        assert.strictEqual(result.a11y.panelLabelledby, 'panelTitle', 'panel should be labelled by its title');
        assert.deepStrictEqual(result.a11y.panePressed, ['false', 'true'], 'pane buttons should expose pressed state');
        assert.ok(result.a11y.statusContrast != null && result.a11y.statusContrast >= 4.5, `status text contrast should pass AA (got ${result.a11y.statusContrast})`);

        await session.send('Emulation.setDeviceMetricsOverride', {
            width: 700, height: 900, deviceScaleFactor: 1, mobile: false,
        });
        await session.send('Page.navigate', { url: page });
        let mobileReady = false;
        for (let i = 0; i < 100; i++) {
            mobileReady = await session.evaluate(`typeof __tree3d !== 'undefined' && !document.body.classList.contains('booting')`);
            if (mobileReady) break;
            await sleep(250);
        }
        assert.ok(mobileReady, 'studio should boot at a mobile width');
        const mobile = await session.evaluate(`(async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const panel = document.getElementById('controlHost').shadowRoot;
            const out = {};
            out.initial = {
                collapsed: document.body.classList.contains('panel-collapsed'),
                backdrop: document.getElementById('panelBackdrop').hidden,
                role: document.getElementById('controlPanel').getAttribute('role'),
                modal: document.getElementById('controlPanel').getAttribute('aria-modal'),
                headerInert: document.querySelector('.app-header').inert,
            };
            document.getElementById('togglePanel').click();
            await sleep(150);
            const panelEl = document.getElementById('controlPanel');
            const firstFocus = document.activeElement?.id || document.activeElement?.className || '';
            out.open = {
                open: document.body.classList.contains('panel-open'),
                backdrop: document.getElementById('panelBackdrop').hidden,
                backdropDisplay: getComputedStyle(document.getElementById('panelBackdrop')).display,
                role: panelEl.getAttribute('role'),
                modal: panelEl.getAttribute('aria-modal'),
                headerInert: document.querySelector('.app-header').inert,
                mainInert: document.getElementById('appSplit').inert,
                focusInside: panelEl.contains(document.activeElement),
                firstFocus,
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
            out.shiftTab = panel.activeElement?.id || panel.activeElement?.tagName || '';
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(150);
            out.closed = {
                open: document.body.classList.contains('panel-open'),
                backdrop: document.getElementById('panelBackdrop').hidden,
                headerInert: document.querySelector('.app-header').inert,
                focus: document.activeElement?.id || '',
            };
            document.getElementById('togglePanel').click();
            await sleep(100);
            document.getElementById('panelBackdrop').click();
            await sleep(100);
            out.backdropClosed = !document.body.classList.contains('panel-open');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
            await sleep(100);
            out.keyboardPane = {
                active: document.querySelector('.app-pane.active')?.dataset.view,
                two: document.getElementById('pane2d').getAttribute('aria-pressed'),
                three: document.getElementById('pane3d').getAttribute('aria-pressed'),
            };
            out.skip = !!document.querySelector('.skip-link');
            return out;
        })()`);
        assert.strictEqual(mobile.initial.collapsed, true, 'mobile panel should start closed');
        assert.strictEqual(mobile.initial.backdrop, true, 'mobile backdrop should start hidden');
        assert.strictEqual(mobile.initial.role, 'complementary', 'closed panel should not be a dialog');
        assert.strictEqual(mobile.initial.headerInert, false, 'closed drawer should not inert the header');
        assert.strictEqual(mobile.open.open, true, 'mobile panel should open');
        assert.strictEqual(mobile.open.backdrop, false, 'mobile backdrop should show');
        assert.strictEqual(mobile.open.backdropDisplay, 'block', 'mobile backdrop should be visible');
        assert.strictEqual(mobile.open.role, 'dialog', 'open mobile panel should be a dialog');
        assert.strictEqual(mobile.open.modal, 'true', 'open mobile panel should be modal');
        assert.strictEqual(mobile.open.headerInert, true, 'open drawer should inert the header');
        assert.strictEqual(mobile.open.mainInert, true, 'open drawer should inert the canvases');
        assert.strictEqual(mobile.open.focusInside, true, 'focus should move into the open drawer');
        assert.notStrictEqual(mobile.shiftTab, 'panelClose', 'Shift+Tab from the first control should wrap to the last');
        assert.strictEqual(mobile.closed.open, false, 'Escape should close the mobile drawer');
        assert.strictEqual(mobile.closed.backdrop, true, 'Escape should hide the backdrop');
        assert.strictEqual(mobile.closed.headerInert, false, 'closing the drawer should restore the header');
        assert.strictEqual(mobile.closed.focus, 'togglePanel', 'closing the drawer should restore focus');
        assert.strictEqual(mobile.backdropClosed, true, 'backdrop click should close the drawer');
        assert.strictEqual(mobile.keyboardPane.active, '3d', 'keyboard 2 should select the 3D pane');
        assert.strictEqual(mobile.keyboardPane.two, 'false', 'pane 2D button should clear pressed state');
        assert.strictEqual(mobile.keyboardPane.three, 'true', 'pane 3D button should set pressed state');
        assert.strictEqual(mobile.skip, true, 'studio should expose a skip link');

        await session.send('Emulation.setDeviceMetricsOverride', {
            width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
        });

        for (const [dimension, url, bridge] of [
            ['2D', `http://127.0.0.1:${SERVER_PORT}/prototype/2d-prototype.html`, '__tree2d'],
            ['3D', `http://127.0.0.1:${SERVER_PORT}/3d-prototype/3d-prototype.html?test=1`, '__tree3d'],
        ]) {
            await session.send('Page.navigate', { url });
            let standaloneReady = false;
            for (let i = 0; i < 100; i++) {
                standaloneReady = await session.evaluate(`typeof ${bridge} !== 'undefined'`);
                if (standaloneReady) break;
                await sleep(250);
            }
            assert.ok(standaloneReady, `${dimension} standalone page should initialize`);
            const standalone = await session.evaluate(`(async () => {
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                const canvas = document.getElementById('c');
                document.getElementById('fullscreen').click();
                await sleep(600);
                const full = {
                    body: document.body.classList.contains('canvas-fullscreen'),
                    width: canvas.clientWidth,
                    height: canvas.clientHeight,
                    wrap: getComputedStyle(document.querySelector('.wrap')).display,
                    exit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                };
                const play = document.getElementById('play');
                window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
                await sleep(300);
                const spacePlay = play.textContent;
                window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
                await sleep(100);
                const spacePause = play.textContent;
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
                await sleep(300);
                const restartPlay = play.textContent;
                window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
                await sleep(100);
                const stopped = play.textContent;
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
                await sleep(150);
                const uiHidden = {
                    body: document.body.classList.contains('canvas-ui-hidden'),
                    exit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                    hint: getComputedStyle(document.getElementById('fullscreenHint')).display,
                    legend: getComputedStyle(document.querySelector('.legend')).display,
                };
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
                await sleep(150);
                const uiShown = {
                    body: document.body.classList.contains('canvas-ui-hidden'),
                    exit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                };
                document.getElementById('fullscreenExit').click();
                await sleep(400);
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
                await sleep(400);
                const keyFull = document.body.classList.contains('canvas-fullscreen');
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await sleep(300);
                const bridge = window['${bridge}'];
                document.getElementById('analyticsPin').click();
                await sleep(300);
                const pinned = bridge.captureState().compare;
                document.getElementById('analyticsCompare').click();
                await sleep(200);
                const toggled = bridge.captureState().compare;
                document.getElementById('analyticsClear').click();
                await sleep(200);
                const cleared = bridge.captureState().compare;
                return {
                    full,
                    analytics: {
                        pinned: !!pinned?.baseline?.points?.length,
                        compare: pinned?.enabled,
                        toggled: toggled?.enabled,
                        cleared,
                    },
                    normalBody: document.body.classList.contains('canvas-fullscreen'),
                    normalWrap: getComputedStyle(document.querySelector('.wrap')).display,
                    normalExit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                    keyFull,
                    keyExit: document.body.classList.contains('canvas-fullscreen'),
                    keys: { spacePlay, spacePause, restartPlay, stopped },
                    ui: { hidden: uiHidden, shown: uiShown },
                };
            })()`);
            assert.strictEqual(standalone.full.body, true, `${dimension} standalone fullscreen should enter`);
            assert.ok(standalone.full.width > 1200, `${dimension} standalone canvas should fill width (got ${standalone.full.width})`);
            assert.ok(standalone.full.height > 800, `${dimension} standalone canvas should fill height (got ${standalone.full.height})`);
            assert.strictEqual(standalone.full.wrap, 'none', `${dimension} standalone controls should hide in fullscreen`);
            assert.strictEqual(standalone.full.exit, 'flex', `${dimension} standalone exit control should show`);
            assert.strictEqual(standalone.normalBody, false, `${dimension} standalone fullscreen should exit`);
            assert.strictEqual(standalone.normalWrap, 'block', `${dimension} standalone controls should return`);
            assert.strictEqual(standalone.normalExit, 'none', `${dimension} standalone exit control should hide`);
            assert.strictEqual(standalone.keyFull, true, `${dimension} standalone F should enter fullscreen`);
            assert.strictEqual(standalone.keyExit, false, `${dimension} standalone Escape should exit fullscreen`);
            assert.strictEqual(standalone.keys.spacePlay, 'Pause', `${dimension} Space should start playback in fullscreen`);
            assert.strictEqual(standalone.keys.spacePause, 'Play', `${dimension} Space should pause playback in fullscreen`);
            assert.strictEqual(standalone.keys.restartPlay, 'Pause', `${dimension} R should restart playback in fullscreen`);
            assert.strictEqual(standalone.keys.stopped, 'Play', `${dimension} Space should pause after restart`);
            assert.strictEqual(standalone.ui.hidden.body, true, `${dimension} H should hide fullscreen UI`);
            assert.strictEqual(standalone.ui.hidden.exit, 'none', `${dimension} H should hide the exit button`);
            assert.strictEqual(standalone.ui.hidden.hint, 'none', `${dimension} H should hide the shortcut hint`);
            assert.strictEqual(standalone.ui.hidden.legend, 'none', `${dimension} H should hide in-canvas legends`);
            assert.strictEqual(standalone.ui.shown.body, false, `${dimension} H should restore fullscreen UI`);
            assert.strictEqual(standalone.ui.shown.exit, 'flex', `${dimension} H should restore the exit button`);
            assert.strictEqual(standalone.analytics.pinned, true, `${dimension} standalone should pin an analytics baseline`);
            assert.strictEqual(standalone.analytics.compare, true, `${dimension} standalone pin should enable comparison`);
            assert.strictEqual(standalone.analytics.toggled, false, `${dimension} standalone compare should toggle`);
            assert.strictEqual(standalone.analytics.cleared, null, `${dimension} standalone clear should remove the baseline`);

            if (dimension === '3D') {
                const ground = await session.evaluate(`(async () => {
                    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                    const toggle = document.getElementById('groundDetail');
                    const density = document.getElementById('groundDensity');
                    if (!toggle.checked) {
                        toggle.checked = true;
                        toggle.dispatchEvent(new Event('change', { bubbles: true }));
                        await sleep(300);
                    }
                    const before = __tree3d.groundDetail;
                    toggle.checked = false;
                    toggle.dispatchEvent(new Event('change', { bubbles: true }));
                    await sleep(400);
                    const off = {
                        visible: __tree3d.groundDetail.visible,
                        disabled: density.disabled,
                    };
                    toggle.checked = true;
                    toggle.dispatchEvent(new Event('change', { bubbles: true }));
                    density.value = 'high';
                    density.dispatchEvent(new Event('change', { bubbles: true }));
                    await sleep(600);
                    return {
                        before,
                        off,
                        high: __tree3d.groundDetail,
                    };
                })()`);
                assert.strictEqual(ground.before.visible, true, '3D ground detail should start enabled');
                assert.strictEqual(ground.off.visible, false, '3D ground detail should hide');
                assert.strictEqual(ground.off.disabled, true, '3D ground density should disable when detail is off');
                assert.strictEqual(ground.high.density, 'high', '3D ground density should switch to high');
                assert.ok(ground.high.grass >= 9000, `3D high density grass should fill (got ${ground.high.grass})`);
            }
        }

        await session.evaluate('localStorage.clear()');
        await session.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        await session.send('Page.navigate', {
            url: `http://127.0.0.1:${SERVER_PORT}/prototype/2d-prototype.html`,
        });
        let reducedReady = false;
        for (let i = 0; i < 100; i++) {
            reducedReady = await session.evaluate(`typeof __tree2d !== 'undefined'`);
            if (reducedReady) break;
            await sleep(250);
        }
        assert.ok(reducedReady, '2D page should boot with reduced motion');
        const reduced = await session.evaluate(`({
            media: matchMedia('(prefers-reduced-motion: reduce)').matches,
            param: __tree2d.captureState().params.reducedMotion,
            checked: document.getElementById('reducedMotion').checked,
        })`);
        assert.strictEqual(reduced.media, true, 'reduced-motion media query should emulate');
        assert.strictEqual(reduced.param, true, 'reduced motion should default on when the OS requests it');
        assert.strictEqual(reduced.checked, true, 'reduced-motion checkbox should reflect the default');

        assert.deepStrictEqual(session.errors, [], 'studio should not log runtime errors');
        console.log('Split studio UI checks passed.');
        console.log(`Universal panel controls: ${result.panelControls}`);
    } finally {
        session.close();
        proc.kill('SIGTERM');
        server.close();
        await sleep(500);
        try {
            fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
        } catch {
            // Chrome can briefly retain files in its profile directory.
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
