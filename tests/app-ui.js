/**
 * Studio UI and workflow test.
 *
 * Run from the project root:
 *   node tests/app-ui.js
 *
 * Covers the manifest/re-parent guarantee, mode rail and flyout, layout versus
 * acting pane, the transport dock, Grow/Sculpt/Study/Deliver workflows, the
 * record stage, the command palette, mobile sheet behavior, accessibility, and
 * the standalone 2D/3D pages.
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
    '.mjs': 'text/javascript; charset=utf-8',
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

    for (let i = 0; i < 120; i++) {
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
                this.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || 'runtime exception');
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

async function waitReady(session, { timeout = 120000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        const ready = await session.evaluate(
            `typeof __tree3d !== 'undefined' && !document.body.classList.contains('booting')`
        );
        if (ready) return true;
        await sleep(250);
    }
    return false;
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

        assert.ok(await waitReady(session), 'studio should finish booting');

        const result = await session.evaluate(`(async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const S = window.__TREE_STUDIO__;
            const panel = document.getElementById('controlHost').shadowRoot;
            const dock = (name) => document.querySelector('[data-slot="' + name + '"]');
            const set = (el, value, type = 'input') => {
                el.value = value;
                el.dispatchEvent(new Event(type, { bubbles: true }));
                return el;
            };
            const setCheck = (el, checked) => {
                el.checked = checked;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const out = {};

            // Manifest coverage: every cloned control appears once, with a scope chip.
            out.manifest = {
                total: S.manifest.length,
                mounted: S.mountedKeys.length,
                missing: S.manifest.filter((entry) => !S.getMounted(entry.key)).map((entry) => entry.key),
                disconnected: S.manifest.filter((entry) => {
                    const node = S.getMounted(entry.key);
                    return node && !node.isConnected;
                }).map((entry) => entry.key),
                missingChip: S.manifest.filter((entry) => {
                    if (entry.id === 'loadStateFile') return false;
                    const node = S.getMounted(entry.key);
                    return node && !node.querySelector?.('.scope-chip');
                }).map((entry) => entry.key),
            };
            const ids = [];
            const collectIds = (root) => { for (const el of root.querySelectorAll('[id]')) ids.push(el.id); };
            collectIds(panel);
            collectIds(document);
            const counts = ids.reduce((map, id) => {
                map[id] = (map[id] || 0) + 1;
                return map;
            }, {});
            out.duplicateIds = Object.entries(counts).filter(([, count]) => count > 1).map(([id]) => id);

            out.shell = {
                rails: document.querySelectorAll('#modeRail [data-mode]').length,
                mode: S.mode,
                layout: S.layout,
                active: S.activePane,
                panelTitle: document.getElementById('panelTitle').textContent,
                studyHidden: document.getElementById('studyDrawer').hidden,
                actingChips: [...document.querySelectorAll('.pane-acting')].map((el) => getComputedStyle(el).display),
                activeBorder: getComputedStyle(document.querySelector('.app-pane.active')).borderTopWidth,
                canvasHeight: document.querySelector('.app-pane.active .view-host').shadowRoot.querySelector('#c').clientHeight,
                paneHeight: document.querySelector('.app-pane.active').clientHeight,
            };

            // Layout changes visibility only, and focus layouts force the acting view.
            S.setLayout('2d');
            await sleep(350);
            out.layout2d = {
                visible: [...document.querySelectorAll('.app-pane')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.dataset.view),
                active: S.activePane,
                pressed: document.querySelector('[data-layout="2d"]').getAttribute('aria-pressed'),
            };
            S.setLayout('3d');
            await sleep(350);
            out.layout3d = {
                visible: [...document.querySelectorAll('.app-pane')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.dataset.view),
                active: S.activePane,
            };
            S.setLayout('split');
            await sleep(300);
            S.setActivePane('2d');
            document.querySelector('[data-pane-activate="3d"]').click();
            await sleep(250);
            out.activeClick = {
                active: S.activePane,
                chips: [...document.querySelectorAll('.pane-acting')].map((el) => getComputedStyle(el).display),
                live: document.getElementById('activeView').textContent,
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
            await sleep(250);
            out.keyPane = S.activePane;
            S.setActivePane('2d');
            await sleep(200);

            // Dock: lifespan, speed, season, step, play and rewind.
            const lifespanInput = dock('dock-lifespan').querySelector('#lifespan');
            set(lifespanInput, '140');
            set(dock('dock-speed').querySelector('input'), '4');
            set(dock('dock-season').querySelector('#season'), '0.6');
            await sleep(1200);
            out.dock = {
                lifespan2: __tree2d.captureState().params.lifespan,
                lifespan3: __tree3d.captureState().params.lifespan,
                speed2: __tree2d.captureState().params.speed,
                season2: +__tree2d.season.toFixed(2),
                season3: +__tree3d.season.toFixed(2),
                max: document.getElementById('time').max,
                stageLabels: document.querySelectorAll('#scrubLabels .scrub-label').length,
                seasonBand: getComputedStyle(document.getElementById('seasonBand')).backgroundImage,
            };
            document.getElementById('restart').click();
            await sleep(200);
            document.getElementById('stepForward').click();
            await sleep(250);
            out.step = +__tree3d.time.toFixed(1);
            document.getElementById('play').click();
            await sleep(350);
            out.play = {
                label: document.getElementById('play').getAttribute('aria-label'),
                advanced: __tree3d.time > out.step,
            };
            document.getElementById('play').click();
            await sleep(120);
            document.getElementById('restart').click();
            await sleep(150);

            // Grow: species, essentials, custom banner and revert.
            panel.querySelector('.species-card[data-preset="pine"]').click();
            await sleep(1000);
            out.preset = { two: __tree2d.captureState().activePreset, three: __tree3d.captureState().activePreset };
            set(panel.querySelector('[data-control-key="param:angle"] input'), '52');
            await sleep(1000);
            out.custom = {
                two: __tree2d.captureState().activePreset,
                banner: !panel.querySelector('.custom-banner').hidden,
                text: panel.querySelector('#customBannerText').textContent,
            };
            panel.querySelector('#revertPreset').click();
            await sleep(1000);
            out.revert = {
                angle: __tree2d.captureState().params.angle,
                preset: __tree2d.captureState().activePreset,
            };
            out.growGroups = {
                planting: panel.querySelector('[data-group="Planting"]')?.tagName,
                shape: panel.querySelector('[data-group="Shape"]')?.tagName,
                environment: panel.querySelector('[data-group="Environment"]')?.tagName,
                species: panel.querySelectorAll('.species-card').length,
                seedValue: panel.querySelector('[data-control-key="seedv"] .display-value')?.textContent,
            };

            // Sculpt: acting-pane tools, floating toolbar, hint strip, history.
            S.setMode('sculpt');
            await sleep(350);
            panel.querySelector('[data-control-key="prune"] button').click();
            await sleep(250);
            out.sculptActive = {
                toolbar: !document.getElementById('sculptToolbar').hidden,
                prune2: document.getElementById('view2d').shadowRoot.getElementById('prune').classList.contains('active'),
                prune3: document.getElementById('view3d').shadowRoot.getElementById('prune').classList.contains('active'),
                hint: !document.getElementById('canvasHintStrip').hidden,
                acting: document.getElementById('actingOnChip').textContent,
            };
            document.querySelector('[data-slot="sculpt-toolbar"] .toolbar-tool').click();
            await sleep(200);
            out.sculptInspect = {
                prune2: document.getElementById('view2d').shadowRoot.getElementById('prune').classList.contains('active'),
                prune3: document.getElementById('view3d').shadowRoot.getElementById('prune').classList.contains('active'),
                hintHidden: document.getElementById('canvasHintStrip').hidden,
            };
            out.clearCutsDisabled = panel.querySelector('[data-control-key="clearCuts"] button').disabled;

            // Study: drawer, metric chips, source, baseline workflow, seek.
            S.setMode('study');
            await sleep(600);
            out.study = {
                hidden: document.getElementById('studyDrawer').hidden,
                chips: document.querySelectorAll('.metric-chip').length,
                chartRole: document.getElementById('studyChart').getAttribute('role'),
                chartMin: document.getElementById('studyChart').getAttribute('aria-valuemin'),
                chartText: document.getElementById('studyChart').getAttribute('aria-valuetext'),
                source: S.studySource,
            };
            panel.querySelector('[data-control-key="analyticsPin"] button').click();
            await sleep(400);
            const pinned2 = __tree2d.captureState();
            const pinned3 = __tree3d.captureState();
            out.pin = {
                two: !!pinned2.compare?.baseline?.points?.length,
                three: !!pinned3.compare?.baseline?.points?.length,
                compareTwo: pinned2.compare?.enabled,
                compareThree: pinned3.compare?.enabled,
                label: panel.querySelector('[data-control-key="analyticsBaselineLabel"] .display-value').textContent,
                summary: panel.querySelector('[data-control-key="analyticsSummary"] .display-value').textContent,
            };
            panel.querySelector('[data-control-key="analyticsCompare"] button').click();
            await sleep(250);
            out.compareToggle = {
                two: __tree2d.captureState().compare?.enabled,
                three: __tree3d.captureState().compare?.enabled,
            };
            panel.querySelector('[data-control-key="analyticsClear"] button').click();
            await sleep(300);
            out.clearBaseline = {
                two: __tree2d.captureState().compare,
                three: __tree3d.captureState().compare,
            };
            document.querySelector('[data-source="both"]').click();
            await sleep(200);
            out.sourceBoth = S.studySource;
            const chart = document.getElementById('studyChart');
            const chartRect = chart.getBoundingClientRect();
            const chartLifespan = __tree2d.captureState().params.lifespan;
            chart.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                clientX: chartRect.left + 48 + (60 / chartLifespan) * Math.max(1, chartRect.width - 58),
                clientY: chartRect.top + 20,
            }));
            await sleep(300);
            out.chartSeek = { two: +__tree2d.time.toFixed(1), three: +__tree3d.time.toFixed(1) };
            chart.focus();
            chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            await sleep(250);
            out.chartStep = +__tree2d.time.toFixed(1);

            // Deliver export: targets, options, acting-pane switching.
            S.setMode('deliver');
            await sleep(300);
            out.deliverTab = {
                record: panel.querySelector('[data-deliver-tab="record"]').getAttribute('aria-selected'),
                exportHidden: panel.getElementById('deliverExport').hidden,
            };
            panel.querySelector('[data-deliver-tab="export"]').click();
            await sleep(200);
            S.setDeliverTarget('glb');
            await sleep(300);
            out.glb = {
                active: S.activePane,
                options: [...panel.querySelectorAll('[data-export-options]')].filter((b) => !b.hidden).map((b) => b.dataset.exportOptions),
                action: [...panel.querySelectorAll('#deliverActionSlot [data-action-target]')].filter((b) => !b.hidden).map((b) => b.textContent.trim()),
                filename: panel.getElementById('exportFilename').textContent,
            };
            S.setDeliverTarget('svg');
            await sleep(250);
            out.svg = {
                active: S.activePane,
                options: [...panel.querySelectorAll('[data-export-options]')].filter((b) => !b.hidden).map((b) => b.dataset.exportOptions),
            };
            const svgWidth = panel.querySelector('[data-control-key="svgWidth"] input');
            set(svgWidth, '1400');
            setCheck(panel.querySelector('[data-control-key="svgAnnotations"] input'), true);
            S.setDeliverTarget('glb');
            set(panel.querySelector('[data-control-key="glbLod"] select'), 'mid', 'change');
            await sleep(800);
            const export2d = __tree2d.captureState().exportSettings;
            const export3d = __tree3d.captureState().exportSettings;
            out.exportSettings = {
                svgWidth2: export2d.svgWidth,
                svgWidth3: export3d.svgWidth,
                annotations: export2d.svgAnnotations,
                glbLod2: export2d.glbLod,
                glbLod3: export3d.glbLod,
            };

            // Palette: combobox semantics, search and action execution.
            S.openPalette();
            await sleep(200);
            const paletteInput = document.getElementById('paletteInput');
            out.palette = {
                role: paletteInput.getAttribute('role'),
                expanded: paletteInput.getAttribute('aria-expanded'),
                listRole: document.getElementById('paletteList').getAttribute('role'),
            };
            paletteInput.value = 'show study drawer';
            paletteInput.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(200);
            out.paletteSearch = {
                items: document.querySelectorAll('.palette-item').length,
                first: document.querySelector('.palette-item strong')?.textContent,
            };
            paletteInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await sleep(400);
            out.paletteRun = {
                mode: S.mode,
                studyOpen: !document.getElementById('studyDrawer').hidden,
                paletteHidden: document.getElementById('palette').hidden,
            };

            // Record stage: armed -> running -> complete -> Escape restore.
            S.setMode('deliver');
            await sleep(200);
            panel.querySelector('[data-deliver-tab="record"]').click();
            await sleep(200);
            const setRec = (key, value, type = 'input') => {
                const el = panel.querySelector('[data-rec="' + key + '"]');
                if (el.type === 'checkbox') el.checked = value;
                else el.value = value;
                el.dispatchEvent(new Event(type, { bubbles: true }));
            };
            setRec('countdown', '0', 'change');
            setRec('duration', '3');
            setRec('holdStart', '0');
            setRec('holdEnd', '0');
            const beforeRecordTime = __tree2d.time;
            panel.getElementById('recordStartTake').click();
            await sleep(300);
            out.recordArmed = {
                stage: document.body.classList.contains('record-stage'),
                armedCard: !document.getElementById('recordArmedCard').hidden,
                guides: !document.getElementById('recordGuides').hidden,
                overlay: !document.getElementById('recordOverlay').hidden,
                state: S.recordState,
                aspect: getComputedStyle(document.body).getPropertyValue('--record-aspect').trim(),
            };
            document.getElementById('recordStart').click();
            await sleep(450);
            out.recordRunning = {
                state: S.recordState,
                chromeHidden: document.body.classList.contains('record-controls-hidden'),
                running: document.body.classList.contains('record-running'),
                guidesHidden: document.getElementById('recordGuides').hidden,
            };
            await sleep(3200);
            out.recordComplete = {
                state: S.recordState,
                card: !document.getElementById('recordComplete').hidden,
                stage: document.body.classList.contains('record-stage'),
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(500);
            out.recordExit = {
                stage: document.body.classList.contains('record-stage'),
                restored: Math.abs(__tree2d.time - beforeRecordTime) < 0.6,
            };

            // Simulate feedback: heavy regeneration and explicit dock events.
            S.setMode('grow');
            set(dock('dock-lifespan').querySelector('#lifespan'), '300');
            await sleep(300);
            set(panel.querySelector('[data-control-key="trees"] select'), '7', 'change');
            await sleep(2000);
            const treesAfter = __tree2d.captureState().params.trees;
            window.dispatchEvent(new CustomEvent('tree-simulate-start', { detail: { dimension: '2d' } }));
            await sleep(60);
            const during = document.getElementById('syncChip').textContent;
            window.dispatchEvent(new CustomEvent('tree-simulate-end', { detail: { dimension: '2d' } }));
            await sleep(350);
            out.simulateFeedback = { trees: treesAfter, during };
            out.simulateSettled = document.getElementById('syncChip').textContent;
            set(panel.querySelector('[data-control-key="trees"] select'), '1', 'change');
            await sleep(1800);

            // Focus menu and project menu use the actual re-parented controls.
            out.menus = {
                zoom: !!document.querySelector('[data-slot="view-2d"] #zoom'),
                spin: !!document.querySelector('[data-slot="view-3d"] #spin'),
                save: !!document.querySelector('[data-slot="project-menu"] #saveState'),
                load: !!document.querySelector('[data-slot="project-menu"] #loadState'),
                seed: document.getElementById('headerSeed').textContent,
            };

            // Accessibility surface.
            const canvas2d = document.querySelector('.app-pane[data-view="2d"] .view-host').shadowRoot.querySelector('#c');
            const canvas3d = document.querySelector('.app-pane[data-view="3d"] .view-host').shadowRoot.querySelector('#c');
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
            const chip = panel.querySelector('.scope-chip.scope-both');
            const chipStyle = getComputedStyle(chip);
            const acting = getComputedStyle(document.getElementById('actingOnChip'));
            const muted = getComputedStyle(panel.querySelector('.fly-heading'));
            const cardBg = getComputedStyle(document.getElementById('controlPanel')).backgroundColor;
            out.a11y = {
                canvas2dRole: canvas2d.getAttribute('role'),
                canvas2dLabel: canvas2d.getAttribute('aria-label'),
                canvas3dRole: canvas3d.getAttribute('role'),
                canvas3dLabel: canvas3d.getAttribute('aria-label'),
                statusRole: document.getElementById('status').getAttribute('role'),
                statusLive: document.getElementById('status').getAttribute('aria-live'),
                panelLabelledby: document.getElementById('controlPanel').getAttribute('aria-labelledby'),
                railSelected: document.querySelector('#modeRail [data-mode="grow"]').getAttribute('aria-selected'),
                railCurrent: document.querySelector('#modeRail [data-mode="grow"]').getAttribute('aria-current'),
                chartRole: document.getElementById('studyChart').getAttribute('role'),
                chartValueText: document.getElementById('studyChart').getAttribute('aria-valuetext'),
                timeValueText: document.getElementById('time').getAttribute('aria-valuetext'),
                iconButtonsLabeled: [...document.querySelectorAll('.icon-button')].every((button) => button.getAttribute('aria-label')),
                scopeContrast: contrast(chipStyle.color, chipStyle.backgroundColor),
                actingContrast: contrast(acting.color, acting.backgroundColor),
                mutedContrast: contrast(muted.color, cardBg),
            };

            // UI prefs must not leak into simulation state or share links.
            const state = __tree2d.captureState();
            out.stateLeak = ['mode', 'flyoutOpen', 'layout', 'record', 'tourSeen'].filter((key) => key in state);
            return out;
        })()`);

        assert.deepStrictEqual(result.manifest.missing, [], 'every manifest control should be mounted');
        assert.deepStrictEqual(result.manifest.disconnected, [], 'mounted controls should stay connected');
        assert.deepStrictEqual(result.manifest.missingChip, [], 'every visible control should expose a scope chip');
        assert.strictEqual(result.manifest.mounted, result.manifest.total, 'manifest and mounted counts should match');
        assert.deepStrictEqual(result.duplicateIds, [], 'control ids must not be duplicated');

        assert.strictEqual(result.shell.rails, 4, 'the rail should expose four modes');
        assert.strictEqual(result.shell.mode, 'grow', 'Grow should be the default mode');
        assert.strictEqual(result.shell.panelTitle, 'Grow', 'flyout title should name the mode');
        assert.strictEqual(result.shell.actingChips.join(','), 'flex,none', 'only the acting pane should show the chip');
        assert.strictEqual(result.shell.activeBorder, '2px', 'the acting pane should use a 2px accent border');
        assert.ok(result.shell.canvasHeight > result.shell.paneHeight * 0.86, `canvas should fill the pane card (canvas ${result.shell.canvasHeight}, pane ${result.shell.paneHeight})`);

        assert.deepStrictEqual(result.layout2d.visible, ['2d'], '2D focus layout should show one pane');
        assert.strictEqual(result.layout2d.active, '2d', '2D focus layout should force the acting view');
        assert.strictEqual(result.layout2d.pressed, 'true', 'layout button should expose pressed state');
        assert.deepStrictEqual(result.layout3d.visible, ['3d'], '3D focus layout should show one pane');
        assert.strictEqual(result.layout3d.active, '3d', '3D focus layout should force the acting view');
        assert.strictEqual(result.activeClick.active, '3d', 'the pane link chip should set the acting view');
        assert.deepStrictEqual(result.activeClick.chips, ['none', 'flex'], 'Acting here should follow the acting pane');
        assert.ok(result.activeClick.live.includes('3D'), 'the live region should announce the acting view');
        assert.strictEqual(result.keyPane, '2d', 'key 1 should select the 2D view');

        assert.strictEqual(result.dock.lifespan2, 140, 'dock lifespan should reach 2D');
        assert.strictEqual(result.dock.lifespan3, 140, 'dock lifespan should reach 3D');
        assert.strictEqual(result.dock.speed2, 4, 'dock speed should reach the state');
        assert.strictEqual(result.dock.season2, 0.6, 'dock season should reach 2D');
        assert.strictEqual(result.dock.season3, 0.6, 'dock season should reach 3D');
        assert.strictEqual(result.dock.max, '141', 'the scrubber max should follow lifespan');
        assert.ok(result.dock.stageLabels >= 2, 'the scrubber should expose stage labels');
        assert.ok(result.dock.seasonBand.includes('gradient'), 'the scrubber should carry a season band');
        assert.ok(result.step >= 0.9 && result.step <= 1.1, `step forward should advance one year (got ${result.step})`);
        assert.strictEqual(result.play.label, 'Pause', 'play should become pause');
        assert.strictEqual(result.play.advanced, true, 'playback should advance time');

        assert.strictEqual(result.preset.two, 'pine', 'species should reach 2D');
        assert.strictEqual(result.preset.three, 'pine', 'species should reach 3D');
        assert.strictEqual(result.custom.two, 'custom', 'editing an essential should select Custom');
        assert.strictEqual(result.custom.banner, true, 'Custom should show the based-on banner');
        assert.ok(result.custom.text.includes('based on Pine'), 'the banner should name the base species');
        assert.strictEqual(result.revert.preset, 'pine', 'Revert should re-apply the base preset');
        assert.strictEqual(result.revert.angle, 65, 'Revert should restore the preset angle');
        assert.strictEqual(result.growGroups.species, 6, 'Grow should show six species cards');
        assert.ok(result.growGroups.seedValue.includes('seed'), 'the seed row should show the seed');
        assert.strictEqual(result.growGroups.shape, 'DETAILS', 'Shape should be a collapsed group');
        assert.strictEqual(result.growGroups.planting, 'DETAILS', 'Planting should be a collapsed group');

        assert.strictEqual(result.sculptActive.toolbar, true, 'the Sculpt floating toolbar should show');
        assert.deepStrictEqual(
            [result.sculptActive.prune2, result.sculptActive.prune3],
            [true, false],
            'prune should target only the acting view'
        );
        assert.strictEqual(result.sculptActive.hint, true, 'prune should show the canvas hint strip');
        assert.strictEqual(result.sculptActive.acting, 'Acting on: 2D', 'Sculpt should name the acting view');
        assert.deepStrictEqual(
            [result.sculptInspect.prune2, result.sculptInspect.prune3],
            [false, false],
            'Inspect should clear prune and lasso'
        );
        assert.strictEqual(result.sculptInspect.hintHidden, true, 'the hint should clear with Inspect');
        assert.strictEqual(result.clearCutsDisabled, true, 'Clear cuts should be disabled with no cuts');

        assert.strictEqual(result.study.hidden, false, 'Study should open the drawer');
        assert.strictEqual(result.study.chips, 7, 'Study should expose seven metric chips');
        assert.strictEqual(result.study.chartRole, 'slider', 'the chart should expose slider semantics');
        assert.strictEqual(result.study.chartMin, '0', 'the chart should expose a minimum year');
        assert.ok(result.study.chartText.includes('Year'), 'the chart should expose aria-valuetext');
        assert.strictEqual(result.study.source, '2d', 'the chart should default to the acting view');
        assert.strictEqual(result.pin.two, true, 'pinning should store a 2D run A');
        assert.strictEqual(result.pin.three, true, 'pinning should store a 3D run A');
        assert.strictEqual(result.pin.compareTwo, true, 'pinning should enable comparison in 2D');
        assert.strictEqual(result.pin.compareThree, true, 'pinning should enable comparison in 3D');
        assert.ok(result.pin.label.includes('Baseline:'), 'Run A should show its label');
        assert.ok(result.pin.summary.includes('vs baseline'), 'the delta summary should appear');
        assert.deepStrictEqual([result.compareToggle.two, result.compareToggle.three], [false, false], 'Compare to run A should toggle');
        assert.strictEqual(result.clearBaseline.two, null, 'clearing should remove 2D run A');
        assert.strictEqual(result.clearBaseline.three, null, 'clearing should remove 3D run A');
        assert.strictEqual(result.sourceBoth, 'both', 'the source toggle should overlay both views');
        assert.ok(Math.abs(result.chartSeek.two - 60) < 2, `chart click should seek 2D near year 60 (got ${result.chartSeek.two})`);
        assert.ok(Math.abs(result.chartSeek.three - 60) < 2, `chart click should seek 3D near year 60 (got ${result.chartSeek.three})`);
        assert.ok(Math.abs(result.chartStep - result.chartSeek.two - 1) < 0.15, 'chart arrow keys should step one year');

        assert.strictEqual(result.deliverTab.record, 'true', 'Deliver should default to Record');
        assert.strictEqual(result.deliverTab.exportHidden, true, 'Export should be hidden initially');
        assert.strictEqual(result.glb.active, '3d', 'choosing GLB should switch the acting view to 3D');
        assert.deepStrictEqual(result.glb.options, ['glb'], 'GLB should show GLB options');
        assert.deepStrictEqual(result.glb.action, ['Export GLB'], 'GLB should expose one primary action');
        assert.ok(result.glb.filename.endsWith('.glb'), 'the GLB preview should name the file');
        assert.strictEqual(result.svg.active, '2d', 'choosing SVG should switch the acting view to 2D');
        assert.deepStrictEqual(result.svg.options, ['svg'], 'SVG should show SVG options');
        assert.strictEqual(result.exportSettings.svgWidth2, 1400, 'SVG width should reach 2D');
        assert.strictEqual(result.exportSettings.svgWidth3, 1400, 'export settings should sync to 3D');
        assert.strictEqual(result.exportSettings.annotations, true, 'SVG annotations should persist');
        assert.strictEqual(result.exportSettings.glbLod2, 'mid', 'GLB detail should persist in 2D state');
        assert.strictEqual(result.exportSettings.glbLod3, 'mid', 'GLB detail should reach 3D');

        assert.strictEqual(result.palette.role, 'combobox', 'the palette should use combobox semantics');
        assert.strictEqual(result.palette.expanded, 'true', 'the palette combobox should be expanded');
        assert.strictEqual(result.palette.listRole, 'listbox', 'the palette results should be a listbox');
        assert.ok(result.paletteSearch.items > 0, 'the palette should search controls and actions');
        assert.strictEqual(result.paletteSearch.first, 'Show Study drawer', 'actions should rank ahead of similarly named controls');
        assert.strictEqual(result.paletteRun.mode, 'study', 'running an action should switch to its mode');
        assert.strictEqual(result.paletteRun.studyOpen, true, 'running Show Study drawer should open the drawer');
        assert.strictEqual(result.paletteRun.paletteHidden, true, 'running a result should close the palette');

        assert.strictEqual(result.recordArmed.stage, true, 'Start take should enter the record stage');
        assert.strictEqual(result.recordArmed.armedCard, true, 'the record stage should start armed');
        assert.strictEqual(result.recordArmed.guides, true, 'guides should show while armed');
        assert.strictEqual(result.recordArmed.overlay, true, 'the year overlay should be present');
        assert.strictEqual(result.recordArmed.state, 'armed', 'the take should be armed');
        assert.strictEqual(result.recordArmed.aspect, '1.7778', 'the record frame should carry its aspect ratio');
        assert.strictEqual(result.recordRunning.state, 'running', 'Start take should run the take');
        assert.strictEqual(result.recordRunning.chromeHidden, true, 'chrome should hide while the take runs');
        assert.strictEqual(result.recordRunning.running, true, 'the record stage should mark running');
        assert.strictEqual(result.recordRunning.guidesHidden, true, 'guides should hide while running');
        assert.strictEqual(result.recordComplete.state, 'complete', 'the take should complete');
        assert.strictEqual(result.recordComplete.card, true, 'the complete card should show');
        assert.strictEqual(result.recordExit.stage, false, 'Escape should leave the record stage');
        assert.strictEqual(result.recordExit.restored, true, 'leaving the stage should restore the prior time');

        assert.strictEqual(result.simulateFeedback.trees, 7, 'forest regeneration should reach the state');
        assert.strictEqual(result.simulateFeedback.during, 'Simulating…', 'the dock should report a long regeneration');
        assert.strictEqual(result.simulateSettled, 'Synced', 'the dock should settle back to Synced');

        assert.strictEqual(result.menus.zoom, true, 'auto-zoom should live in the pane View menu');
        assert.strictEqual(result.menus.spin, true, 'turntable should live in the 3D View menu');
        assert.strictEqual(result.menus.save, true, 'Save state should live in the Project menu');
        assert.strictEqual(result.menus.load, true, 'Load state should live in the Project menu');
        assert.ok(result.menus.seed.length > 0, 'the header should show the seed');

        assert.strictEqual(result.a11y.canvas2dRole, 'img', '2D canvas should expose an image role');
        assert.ok(result.a11y.canvas2dLabel.includes('2D'), '2D canvas should have a descriptive label');
        assert.strictEqual(result.a11y.canvas3dRole, 'img', '3D canvas should expose an image role');
        assert.ok(result.a11y.canvas3dLabel.includes('3D'), '3D canvas should have a descriptive label');
        assert.strictEqual(result.a11y.statusRole, 'status', 'status should be a live region');
        assert.strictEqual(result.a11y.statusLive, 'polite', 'status should announce politely');
        assert.strictEqual(result.a11y.panelLabelledby, 'panelTitle', 'the flyout should be labelled by its title');
        assert.strictEqual(result.a11y.railSelected, 'true', 'the active mode should expose selected state');
        assert.strictEqual(result.a11y.railCurrent, 'page', 'the active mode should expose aria-current');
        assert.strictEqual(result.a11y.chartRole, 'slider', 'the Study chart should expose slider semantics');
        assert.ok(result.a11y.chartValueText.includes('Year'), 'the Study chart should expose aria-valuetext');
        assert.ok(result.a11y.timeValueText.includes('Year'), 'the scrubber should expose aria-valuetext');
        assert.strictEqual(result.a11y.iconButtonsLabeled, true, 'icon-only buttons should be labelled');
        assert.ok(result.a11y.scopeContrast >= 4.5, `scope chips should pass AA (got ${result.a11y.scopeContrast})`);
        assert.ok(result.a11y.actingContrast >= 4.5, `acting chips should pass AA (got ${result.a11y.actingContrast})`);
        assert.ok(result.a11y.mutedContrast >= 4.5, `muted flyout text should pass AA (got ${result.a11y.mutedContrast})`);
        assert.deepStrictEqual(result.stateLeak, [], 'UI preferences must not leak into simulation state');

        // Batch ZIP still targets the acting pane and preserves live time.
        const batch = await session.evaluate(`(async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const S = window.__TREE_STUDIO__;
            const panel = document.getElementById('controlHost').shadowRoot;
            S.setMode('deliver');
            panel.querySelector('[data-deliver-tab="export"]').click();
            S.setDeliverTarget('batch');
            S.setActivePane('2d');
            await sleep(200);
            const originalCreateObjectURL = URL.createObjectURL;
            const originalAnchorClick = HTMLAnchorElement.prototype.click;
            let blob = null;
            let name = '';
            URL.createObjectURL = (next) => { blob = next; return originalCreateObjectURL.call(URL, next); };
            HTMLAnchorElement.prototype.click = function () { name = this.download; };
            const before = __tree2d.time;
            panel.querySelector('#deliverActionSlot [data-action-target="batch"]').click();
            await sleep(5000);
            const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
            const out = { name, size: bytes.length, signature: [...bytes.slice(0, 4)], before, after: +__tree2d.time.toFixed(2) };
            URL.createObjectURL = originalCreateObjectURL;
            HTMLAnchorElement.prototype.click = originalAnchorClick;
            S.setActivePane('3d');
            await sleep(150);
            return out;
        })()`);
        assert.ok(batch.name.endsWith('.zip'), 'batch export should download a ZIP');
        assert.deepStrictEqual(batch.signature, [0x50, 0x4b, 0x03, 0x04], 'batch ZIP should have a local-file header');
        assert.ok(batch.size > 1000, `batch ZIP should contain files (got ${batch.size} bytes)`);
        assert.ok(Math.abs(batch.after - batch.before) < 0.2, 'batch export should preserve live time');

        // 700px phone: bottom sheet, one visible pane, modal semantics at full.
        await session.evaluate('localStorage.clear()');
        await session.send('Emulation.setDeviceMetricsOverride', {
            width: 700, height: 900, deviceScaleFactor: 1, mobile: false,
        });
        await session.send('Page.navigate', { url: page });
        assert.ok(await waitReady(session), 'studio should boot at phone width');
        const mobile = await session.evaluate(`(async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const S = window.__TREE_STUDIO__;
            const panel = document.getElementById('controlPanel');
            const out = {};
            out.initial = {
                sheet: document.body.className,
                role: panel.getAttribute('role'),
                modal: panel.getAttribute('aria-modal'),
                headerInert: document.querySelector('.app-header').inert,
                visiblePanes: [...document.querySelectorAll('.app-pane')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.dataset.view),
                panelTransform: getComputedStyle(panel).transform,
            };
            S.setSheetState('full');
            await sleep(300);
            out.full = {
                role: panel.getAttribute('role'),
                modal: panel.getAttribute('aria-modal'),
                headerInert: document.querySelector('.app-header').inert,
                mainInert: document.getElementById('appSplit').inert,
                dockInert: document.getElementById('transportDock').inert,
                focusInside: panel.contains(document.activeElement),
                backdrop: !document.getElementById('panelBackdrop').hidden,
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(200);
            out.afterEscape = {
                sheet: document.body.className,
                modal: panel.getAttribute('aria-modal'),
                headerInert: document.querySelector('.app-header').inert,
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(200);
            out.closed = { open: document.body.classList.contains('panel-open') };
            document.querySelector('[data-mobile-pane="3d"]').click();
            await sleep(350);
            out.pane = {
                active: S.activePane,
                visible: [...document.querySelectorAll('.app-pane')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.dataset.view),
                pressed: document.querySelector('[data-mobile-pane="3d"]').getAttribute('aria-pressed'),
            };
            return out;
        })()`);
        assert.ok(mobile.initial.sheet.includes('sheet-peek'), 'phone sheet should start at peek');
        assert.strictEqual(mobile.initial.role, 'complementary', 'peek sheet should not be a dialog');
        assert.strictEqual(mobile.initial.modal, null, 'peek sheet should not be modal');
        assert.strictEqual(mobile.initial.headerInert, false, 'peek sheet should leave the canvas available');
        assert.deepStrictEqual(mobile.initial.visiblePanes, ['2d'], 'phone should show one pane');
        assert.ok(mobile.initial.panelTransform.includes('matrix'), 'peek sheet should be translated out of view');
        assert.strictEqual(mobile.full.role, 'dialog', 'full sheet should be a dialog');
        assert.strictEqual(mobile.full.modal, 'true', 'full sheet should be modal');
        assert.strictEqual(mobile.full.headerInert, true, 'full sheet should inert the header');
        assert.strictEqual(mobile.full.mainInert, true, 'full sheet should inert the canvas');
        assert.strictEqual(mobile.full.dockInert, true, 'full sheet should inert the dock');
        assert.strictEqual(mobile.full.focusInside, true, 'full sheet should move focus inside');
        assert.strictEqual(mobile.full.backdrop, true, 'full sheet should show a backdrop');
        assert.ok(mobile.afterEscape.sheet.includes('sheet-half'), 'Escape should drop a full sheet to half');
        assert.strictEqual(mobile.afterEscape.modal, null, 'half sheet should not be modal');
        assert.strictEqual(mobile.afterEscape.headerInert, false, 'half sheet should restore the canvas');
        assert.strictEqual(mobile.closed.open, false, 'a second Escape should close the sheet');
        assert.strictEqual(mobile.pane.active, '3d', 'the mobile pane toggle should set the acting view');
        assert.deepStrictEqual(mobile.pane.visible, ['3d'], 'the mobile pane toggle should change visibility');
        assert.strictEqual(mobile.pane.pressed, 'true', 'the mobile pane toggle should expose pressed state');

        // Tablet width still uses the modal drawer.
        await session.evaluate('localStorage.clear()');
        await session.send('Emulation.setDeviceMetricsOverride', {
            width: 900, height: 900, deviceScaleFactor: 1, mobile: false,
        });
        await session.send('Page.navigate', { url: page });
        assert.ok(await waitReady(session), 'studio should boot at tablet width');
        const tablet = await session.evaluate(`({
            role: document.getElementById('controlPanel').getAttribute('role'),
            modal: document.getElementById('controlPanel').getAttribute('aria-modal'),
            headerInert: document.querySelector('.app-header').inert,
            backdrop: getComputedStyle(document.getElementById('panelBackdrop')).display,
            visiblePanes: [...document.querySelectorAll('.app-pane')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.dataset.view),
        })`);
        assert.strictEqual(tablet.role, 'dialog', 'tablet drawer should be a dialog');
        assert.strictEqual(tablet.modal, 'true', 'tablet drawer should be modal');
        assert.strictEqual(tablet.headerInert, true, 'tablet drawer should inert the header');
        assert.strictEqual(tablet.backdrop, 'block', 'tablet drawer should show a backdrop');
        assert.deepStrictEqual(tablet.visiblePanes, ['2d', '3d'], 'tablet should keep both panes side by side');

        // Fullscreen and standalone pages keep their existing behavior.
        await session.send('Emulation.setDeviceMetricsOverride', {
            width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
        });
        await session.send('Page.navigate', { url: page });
        assert.ok(await waitReady(session), 'studio should boot for fullscreen checks');
        const fullscreen = await session.evaluate(`(async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            document.getElementById('fullscreen').click();
            await sleep(500);
            const pane = document.querySelector('.app-pane.focused');
            const canvas = pane.querySelector('.view-host').shadowRoot.querySelector('#c');
            const out = {
                body: document.body.classList.contains('canvas-fullscreen'),
                focus: document.body.dataset.focusView,
                header: getComputedStyle(document.querySelector('.app-header')).display,
                panel: getComputedStyle(document.getElementById('controlPanel')).display,
                dock: getComputedStyle(document.getElementById('transportDock')).display,
                exit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                width: canvas.clientWidth,
                height: canvas.clientHeight,
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
            await sleep(300);
            const playing = document.getElementById('play').getAttribute('aria-label');
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
            await sleep(100);
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }));
            await sleep(300);
            const restarted = document.getElementById('play').getAttribute('aria-label');
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
            await sleep(100);
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
            await sleep(150);
            out.hidden = {
                body: document.body.classList.contains('canvas-ui-hidden'),
                exit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                dock: getComputedStyle(document.getElementById('transportDock')).display,
                host: document.querySelector('.app-pane.focused .view-host').classList.contains('ui-hidden'),
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
            await sleep(150);
            document.getElementById('fullscreenExit').click();
            await sleep(400);
            out.exitState = {
                body: document.body.classList.contains('canvas-fullscreen'),
                focus: document.body.dataset.focusView || '',
                focused: document.querySelectorAll('.app-pane.focused').length,
                host: document.querySelectorAll('.view-host.ui-hidden').length,
            };
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
            await sleep(300);
            out.keyFull = document.body.classList.contains('canvas-fullscreen');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(300);
            out.keyExit = document.body.classList.contains('canvas-fullscreen');
            return { ...out, playing, restarted };
        })()`);
        assert.strictEqual(fullscreen.body, true, 'fullscreen should enter');
        assert.strictEqual(fullscreen.focus, '2d', 'fullscreen should target the acting pane');
        assert.strictEqual(fullscreen.header, 'none', 'header should hide in fullscreen');
        assert.strictEqual(fullscreen.panel, 'none', 'flyout should hide in fullscreen');
        assert.strictEqual(fullscreen.exit, 'flex', 'exit control should show in fullscreen');
        assert.ok(fullscreen.width > 1200, `fullscreen canvas should fill width (got ${fullscreen.width})`);
        assert.ok(fullscreen.height > 800, `fullscreen canvas should fill height (got ${fullscreen.height})`);
        assert.strictEqual(fullscreen.playing, 'Pause', 'Space should start playback in fullscreen');
        assert.strictEqual(fullscreen.restarted, 'Pause', 'R should rewind and play in fullscreen');
        assert.strictEqual(fullscreen.hidden.body, true, 'H should hide fullscreen UI');
        assert.strictEqual(fullscreen.hidden.exit, 'none', 'H should hide the exit pill');
        assert.strictEqual(fullscreen.hidden.dock, 'none', 'H should hide the minimal dock');
        assert.strictEqual(fullscreen.hidden.host, true, 'H should hide in-canvas hints');
        assert.strictEqual(fullscreen.exitState.body, false, 'fullscreen should exit');
        assert.strictEqual(fullscreen.exitState.focus, '', 'focus view should clear');
        assert.strictEqual(fullscreen.exitState.focused, 0, 'focused pane class should clear');
        assert.strictEqual(fullscreen.exitState.host, 0, 'host UI-hidden class should clear');
        assert.strictEqual(fullscreen.keyFull, true, 'F should enter fullscreen');
        assert.strictEqual(fullscreen.keyExit, false, 'Escape should exit fullscreen');

        for (const [dimension, url, bridge] of [
            ['2D', `http://127.0.0.1:${SERVER_PORT}/prototype/2d-prototype.html`, '__tree2d'],
            ['3D', `http://127.0.0.1:${SERVER_PORT}/3d-prototype/3d-prototype.html?test=1`, '__tree3d'],
        ]) {
            await session.send('Page.navigate', { url });
            let ready = false;
            for (let i = 0; i < 120; i++) {
                ready = await session.evaluate(`typeof ${bridge} !== 'undefined'`);
                if (ready) break;
                await sleep(250);
            }
            assert.ok(ready, `${dimension} standalone page should initialize`);
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
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
                await sleep(150);
                const hidden = {
                    body: document.body.classList.contains('canvas-ui-hidden'),
                    exit: getComputedStyle(document.getElementById('fullscreenExit')).display,
                    hint: getComputedStyle(document.getElementById('fullscreenHint')).display,
                };
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', bubbles: true }));
                await sleep(100);
                document.getElementById('fullscreenExit').click();
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
                return { full, hidden, pinned: !!pinned?.baseline?.points?.length, compare: pinned?.enabled, toggled: toggled?.enabled, cleared: bridge.captureState().compare };
            })()`);
            assert.strictEqual(standalone.full.body, true, `${dimension} standalone fullscreen should enter`);
            assert.ok(standalone.full.width > 1200, `${dimension} standalone canvas should fill width`);
            assert.ok(standalone.full.height > 800, `${dimension} standalone canvas should fill height`);
            assert.strictEqual(standalone.full.wrap, 'none', `${dimension} standalone controls should hide in fullscreen`);
            assert.strictEqual(standalone.full.exit, 'flex', `${dimension} standalone exit control should show`);
            assert.strictEqual(standalone.hidden.body, true, `${dimension} standalone H should hide UI`);
            assert.strictEqual(standalone.hidden.exit, 'none', `${dimension} standalone H should hide the exit pill`);
            assert.strictEqual(standalone.hidden.hint, 'none', `${dimension} standalone H should hide the shortcut hint`);
            assert.strictEqual(standalone.pinned, true, `${dimension} standalone should pin a baseline`);
            assert.strictEqual(standalone.compare, true, `${dimension} standalone pin should enable comparison`);
            assert.strictEqual(standalone.toggled, false, `${dimension} standalone compare should toggle`);
            assert.strictEqual(standalone.cleared, null, `${dimension} standalone clear should remove the baseline`);
        }

        await session.evaluate('localStorage.clear()');
        await session.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        await session.send('Page.navigate', {
            url: `http://127.0.0.1:${SERVER_PORT}/prototype/2d-prototype.html`,
        });
        let reducedReady = false;
        for (let i = 0; i < 120; i++) {
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
        console.log('Studio redesign UI checks passed.');
        console.log(`Manifest controls: ${result.manifest.total}`);
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
