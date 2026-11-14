/**
 * Split-view studio controller.
 *
 * The 2D and 3D prototypes are no longer iframes. Each simulation is an ES
 * module, each renderer is mounted into its own shadow root, and this page
 * provides one universal control panel plus a shared transport. The panel is
 * cloned from the populated 2D control surface after boot and wired to the
 * hidden per-view controls, so both engines keep their existing behavior.
 */

const TEMPLATES = {
    '2d': './prototype/2d-prototype.html',
    '3d': './3d-prototype/3d-prototype.html',
};
const STYLES = {
    '2d': './prototype/styles.css',
    '3d': './3d-prototype/styles.css',
};
const MODULES = {
    '2d': './prototype/main.js',
    '3d': './3d-prototype/main.js',
};

const playButton = document.getElementById('play');
const timeSlider = document.getElementById('time');
const timeLabel = document.getElementById('timeLabel');
const activeViewEl = document.getElementById('activeView');
const pane2dButton = document.getElementById('pane2d');
const pane3dButton = document.getElementById('pane3d');
const fullscreenButton = document.getElementById('fullscreen');
const fullscreenExitButton = document.getElementById('fullscreenExit');
const togglePanelButton = document.getElementById('togglePanel');
const panelCloseButton = document.getElementById('panelClose');
const panelBackdrop = document.getElementById('panelBackdrop');
const copyButton = document.getElementById('copyLink');
const statusEl = document.getElementById('status');
const controlPanelEl = document.getElementById('controlPanel');
const controlHost = document.getElementById('controlHost');
const appHeader = document.querySelector('.app-header');
const appMain = document.getElementById('appSplit');
const paneElements = {
    '2d': document.querySelector('.app-pane[data-view="2d"]'),
    '3d': document.querySelector('.app-pane[data-view="3d"]'),
};
const viewHosts = {
    '2d': document.getElementById('view2d'),
    '3d': document.getElementById('view3d'),
};

let canonical = null;
let transportTime = 0;
let lifespan = 300;
let speed = 2.5;
let playing = false;
let playTimer = 0;
let booting = true;
let panelOpen = window.innerWidth > 1100;
let panelShadow = null;
let shadow2d = null;
let shadow3d = null;
let activePane = '2d';
let panelSyncTimer = 0;
let panelReturnFocus = null;
let panelWasMobile = window.innerWidth <= 1100;
let fullscreenPane = null;
let fullscreenUiHidden = false;
let stateLoadWarning = '';

function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
}

window.__TREE_APP_STATUS__ = setStatus;

function activeShadow() {
    return activePane === '2d' ? shadow2d : shadow3d;
}

function setActivePane(dimension) {
    activePane = dimension === '3d' ? '3d' : '2d';
    for (const [name, pane] of Object.entries(paneElements)) {
        if (pane) pane.classList.toggle('active', name === activePane);
    }
    if (activeViewEl) activeViewEl.textContent = `Active: ${activePane.toUpperCase()}`;
    if (pane2dButton) pane2dButton.setAttribute('aria-pressed', String(activePane === '2d'));
    if (pane3dButton) pane3dButton.setAttribute('aria-pressed', String(activePane === '3d'));
    window.__TREE_ACTIVE_PANE__ = activePane;
    syncPanel();
}

for (const pane of Object.values(paneElements)) {
    if (!pane) continue;
    pane.addEventListener('click', () => setActivePane(pane.dataset.view));
}

function isMobilePanel() {
    return window.innerWidth <= 1100;
}

function panelFocusables() {
    const list = [];
    if (panelCloseButton && !panelCloseButton.disabled) list.push(panelCloseButton);
    if (panelShadow) {
        for (const element of panelShadow.querySelectorAll(
            'button, input, select, textarea, summary, a[href], [tabindex]:not([tabindex="-1"])'
        )) {
            if (element.disabled || element.getAttribute('aria-hidden') === 'true') continue;
            if (!element.getClientRects().length) continue;
            list.push(element);
        }
    }
    return list;
}

function focusPanel() {
    requestAnimationFrame(() => {
        const first = panelFocusables()[0] || controlPanelEl;
        if (first && typeof first.focus === 'function') first.focus();
    });
}

function applyPanelState() {
    const modal = panelOpen && isMobilePanel();
    document.body.classList.toggle('panel-open', panelOpen);
    document.body.classList.toggle('panel-collapsed', !panelOpen);
    document.body.classList.toggle('panel-modal', modal);

    if (panelBackdrop) panelBackdrop.hidden = !modal;
    if (controlPanelEl) {
        controlPanelEl.inert = !panelOpen;
        controlPanelEl.setAttribute('aria-hidden', String(!panelOpen));
        controlPanelEl.setAttribute('role', modal ? 'dialog' : 'complementary');
        if (modal) controlPanelEl.setAttribute('aria-modal', 'true');
        else controlPanelEl.removeAttribute('aria-modal');
    }
    if (appHeader) appHeader.inert = modal;
    if (appMain) appMain.inert = modal;
    if (togglePanelButton) {
        togglePanelButton.textContent = panelOpen ? 'Hide controls' : 'Show controls';
        togglePanelButton.setAttribute('aria-expanded', String(panelOpen));
    }
}

function setPanelOpen(nextOpen, { restoreFocus = true, returnFocus = null } = {}) {
    const wasOpen = panelOpen;
    const mobile = isMobilePanel();
    if (nextOpen && mobile) {
        const active = document.activeElement;
        panelReturnFocus = returnFocus
            || (active && active !== document.body ? active : togglePanelButton);
    }
    panelOpen = !!nextOpen;
    applyPanelState();
    if (panelOpen && mobile) {
        focusPanel();
    } else if (wasOpen && mobile && restoreFocus) {
        const target = panelReturnFocus;
        panelReturnFocus = null;
        if (target && target.isConnected && typeof target.focus === 'function') {
            requestAnimationFrame(() => target.focus());
        }
    }
}

function togglePanel() {
    setPanelOpen(!panelOpen, { returnFocus: togglePanelButton });
}

function trapPanelFocus(event) {
    if (event.key !== 'Tab' || !panelOpen || !isMobilePanel()) return;
    const focusables = panelFocusables();
    if (!focusables.length) {
        event.preventDefault();
        controlPanelEl?.focus();
        return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const shadowActive = panelShadow?.activeElement;
    const active = shadowActive || document.activeElement;
    const inside = controlPanelEl && (
        controlPanelEl.contains(document.activeElement)
        || active === controlHost
        || panelShadow?.contains(active)
    );
    if (event.shiftKey && (!inside || active === first || active === controlPanelEl)) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
    }
}

function resizeViewsSoon() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
}

function syncFullscreenState() {
    const active = !!fullscreenPane;
    document.body.classList.toggle('canvas-fullscreen', active);
    document.body.classList.toggle('canvas-ui-hidden', active && fullscreenUiHidden);
    if (active) document.body.dataset.focusView = fullscreenPane;
    else delete document.body.dataset.focusView;

    for (const [name, pane] of Object.entries(paneElements)) {
        if (pane) pane.classList.toggle('focused', active && name === fullscreenPane);
    }
    for (const [name, host] of Object.entries(viewHosts)) {
        if (!host) continue;
        host.classList.toggle('fullscreen', active && name === fullscreenPane);
        host.classList.toggle('ui-hidden', active && fullscreenUiHidden && name === fullscreenPane);
    }

    if (fullscreenExitButton) {
        fullscreenExitButton.textContent = active
            ? `Exit ${fullscreenPane.toUpperCase()} fullscreen`
            : 'Exit fullscreen';
    }
    if (fullscreenButton) fullscreenButton.setAttribute('aria-pressed', String(active));
    resizeViewsSoon();
}

function enterFullscreen() {
    fullscreenPane = activePane;
    fullscreenUiHidden = false;
    if (document.activeElement) document.activeElement.blur();
    syncFullscreenState();
}

function exitFullscreen() {
    if (!fullscreenPane) return;
    fullscreenPane = null;
    fullscreenUiHidden = false;
    syncFullscreenState();
}

function toggleFullscreen() {
    if (fullscreenPane) exitFullscreen();
    else enterFullscreen();
}

fullscreenButton?.addEventListener('click', toggleFullscreen);
fullscreenExitButton?.addEventListener('click', exitFullscreen);

pane2dButton?.addEventListener('click', () => setActivePane('2d'));
pane3dButton?.addEventListener('click', () => setActivePane('3d'));

togglePanelButton?.addEventListener('click', togglePanel);
panelCloseButton?.addEventListener('click', () => setPanelOpen(false));
panelBackdrop?.addEventListener('click', () => setPanelOpen(false));
window.addEventListener('keydown', trapPanelFocus, true);

window.addEventListener('resize', () => {
    const mobile = isMobilePanel();
    if (mobile !== panelWasMobile) {
        panelWasMobile = mobile;
        if (mobile && panelOpen) {
            panelReturnFocus = togglePanelButton;
        }
        applyPanelState();
    }
});

/* ==========================================================================
   In-page linked bus
   ========================================================================== */

const busListeners = new Map();
const latestState = new Map();
const pendingLocalState = new Set();

const appBus = {
    subscribe(dimension, handler) {
        busListeners.set(dimension, handler);
    },
    noteLocalChange(dimension) {
        pendingLocalState.add(dimension);
    },
    post(from, message) {
        if (!message || typeof message !== 'object') return;

        if (booting) {
            if ((message.type === 'tree-state' || message.type === 'tree-ready') && message.state) {
                latestState.set(from, message.state);
            }
            return;
        }

        if (message.type === 'tree-state' || message.type === 'tree-ready') {
            if (message.type === 'tree-state') pendingLocalState.delete(from);
            if (message.state) {
                canonical = message.state;
                latestState.set(from, message.state);
                saveTreeStateLocal('app', message.state);
                syncTransportFromState();
                syncPanel();
            }
            const outbound = { type: 'tree-apply-state', state: message.state };
            for (const [dimension, handler] of busListeners) {
                if (dimension === from) continue;
                if (pendingLocalState.has(dimension)) continue;
                handler({ data: outbound });
            }
            setStatus('Synced');
            return;
        }

        if (message.type === 'tree-patch' && message.patch) {
            if (canonical) {
                if ('season' in message.patch) canonical.season = message.patch.season;
                if ('seasonAuto' in message.patch) canonical.seasonAuto = !!message.patch.seasonAuto;
                if ('time' in message.patch) canonical.time = message.patch.time;
                syncTransportFromState();
                syncPanel();
            }
            if (!('season' in message.patch)) return;
            for (const [dimension, handler] of busListeners) {
                if (dimension !== from) handler({ data: message });
            }
            return;
        }

        if (message.type === 'tree-play') {
            return;
        }

        if (message.type === 'tree-request-state') {
            const other = from === '2d' ? latestState.get('3d') : latestState.get('2d');
            if (other) {
                for (const [dimension, handler] of busListeners) {
                    if (dimension !== from) {
                        handler({ data: { type: 'tree-apply-state', state: other } });
                    }
                }
            }
        }
    },
};

window.__TREE_APP_BUS__ = appBus;
window.__TREE_APP_SKIP_RESTORE__ = true;
window.__TREE_APP_BOOTING__ = true;

/* ==========================================================================
   View mounting
   ========================================================================== */

/** Rewrite prototype global selectors so the stylesheet works in a shadow root. */
function scopeBaseCss(css) {
    return css
        .replace(/:root\[data-theme="dark"\]/g, ':host([data-theme="dark"])')
        .replace(/:root\s*\{/g, ':host {')
        .replace(/(^|\n)(\s*)html\s*\{/g, '$1$2:host {')
        .replace(/(^|\n)(\s*)body\s*\{/g, '$1$2.pane-body {')
        .replace(/(^|\n)(\s*)body::before\s*\{/g, '$1$2.pane-body::before {');
}

/** Styles for the two render panes: viewport, stats, analytics only. */
function paneCss(css, dimension) {
    return `${scopeBaseCss(css)}
        :host {
            display: block;
            height: 100%;
            background: var(--bg);
            color: var(--fg);
        }
        .pane-body {
            min-height: 100%;
        }
        .top {
            top: 0;
        }
        .row {
            display: none !important;
        }
        .wrap {
            display: none !important;
        }
        canvas {
            height: clamp(300px, 50vh, ${dimension === '3d' ? '560' : '520'}px);
        }
        :host(.fullscreen) .pane-body {
            height: 100%;
            min-height: 0;
        }
        :host(.fullscreen) .top {
            height: 100%;
            display: flex;
            flex-direction: column;
            padding: 0;
            border-bottom: 0;
            background: transparent;
        }
        :host(.fullscreen) .viewport {
            flex: 1 1 auto;
            min-height: 0;
        }
        :host(.fullscreen) .row,
        :host(.fullscreen) .stat,
        :host(.fullscreen) #analytics {
            display: none !important;
        }
        :host(.fullscreen) canvas#c {
            width: 100%;
            height: 100%;
            border: 0;
            border-radius: 0;
        }
        :host(.ui-hidden) .legend,
        :host(.ui-hidden) .hint,
        :host(.ui-hidden) .perf-hud {
            display: none !important;
        }
        @media (max-width: 900px) {
            canvas {
                height: min(32vh, 320px);
            }
        }
    `;
}

/** Styles for the universal panel clone. It keeps the prototype form styling. */
function panelCss(css) {
    return `${scopeBaseCss(css)}
        :host {
            display: block;
            height: 100%;
            background: var(--bg);
            color: var(--fg);
            font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        }
        .panel-body {
            height: 100%;
            overflow: auto;
            overscroll-behavior: contain;
            padding: 12px 14px 30px;
        }
        .wrap {
            max-width: none;
            margin: 0;
            padding: 0;
        }
        .row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 10px;
        }
        h2 {
            margin: 16px 0 6px;
            font-size: 11px;
            letter-spacing: 0.09em;
            text-transform: uppercase;
            color: var(--mut);
        }
        h2:first-child {
            margin-top: 0;
        }
        details {
            margin-top: 10px;
        }
        details > summary {
            cursor: pointer;
            padding: 5px 0;
            font-size: 12px;
            font-weight: 650;
            color: var(--mut);
        }
        details[open] > summary {
            color: var(--fg);
        }
        button {
            padding: 6px 9px;
            border-radius: 8px;
            font-size: 12px;
        }
        label {
            font-size: 12px;
        }
        #inspector {
            min-height: 64px;
        }
        #seedv {
            display: inline-block;
            margin-top: 4px;
        }
    `;
}

async function buildShadowView(dimension) {
    const [html, css] = await Promise.all([
        fetch(TEMPLATES[dimension]).then((response) => {
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            return response.text();
        }),
        fetch(STYLES[dimension]).then((response) => {
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            return response.text();
        }),
    ]);

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const host = viewHosts[dimension];
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = paneCss(css, dimension);
    shadow.appendChild(style);

    const body = document.createElement('div');
    body.className = 'pane-body';
    for (const child of Array.from(parsed.body.children)) {
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
        body.appendChild(document.importNode(child, true));
    }
    shadow.appendChild(body);
    return { shadow, css };
}

async function mountView(dimension, shadow) {
    window.__TREE_VIEW_ROOT__ = shadow;
    await import(MODULES[dimension]);
}

/* ==========================================================================
   Universal control panel
   ========================================================================== */

const ACTIVE_PANE_BUTTONS = new Set([
    'reseed',
    'prune',
    'lasso',
    'undoCut',
    'redoCut',
    'isolate',
    'snapshot',
    'compare',
    'loadState',
    'shareState',
    'saveState',
    'exportCsv',
    'exportPng',
    'exportJson',
    'exportBatch',
]);

function findInShadow(shadow, id) {
    return shadow ? shadow.querySelector('#' + id) : null;
}

function clone3DControl(id) {
    const source = findInShadow(shadow3d, id);
    if (!source) return null;
    const node = source.closest('label') || source;
    return document.importNode(node, true);
}

function make3DSection(title, ids, open = false) {
    const details = document.createElement('details');
    details.className = 'advanced-env';
    details.open = open;
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.appendChild(summary);
    const bar = document.createElement('div');
    bar.className = 'env-bar';
    for (const id of ids) {
        const node = clone3DControl(id);
        if (node) bar.appendChild(node);
    }
    details.appendChild(bar);
    return details;
}

function removeExplainer(wrap) {
    for (const heading of Array.from(wrap.querySelectorAll('h2'))) {
        if (!/^how it works/i.test(heading.textContent.trim())) continue;
        const next = heading.nextElementSibling;
        heading.remove();
        if (next && next.tagName === 'UL') next.remove();
    }
}


function renameControlLabel(root, id, text) {
    const input = root.querySelector('#' + id);
    const label = input?.closest('label');
    if (!label) return;
    for (const node of label.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue.trim()) continue;
        const leading = node.nodeValue.match(/^\s*/)?.[0] || '';
        const trailing = node.nodeValue.match(/\s*$/)?.[0] || '';
        node.nodeValue = leading + text + trailing;
        return;
    }
}

function buildControlPanel(css2d) {
    const source = shadow2d?.querySelector('.wrap');
    if (!source) return;

    const shadow = controlHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = panelCss(css2d);
    shadow.appendChild(style);

    const body = document.createElement('div');
    body.className = 'panel-body';
    shadow.appendChild(body);

    const wrap = document.importNode(source, true);
    wrap.classList.add('panel-wrap');
    removeExplainer(wrap);
    renameControlLabel(wrap, 'sunAngle', '2D sun angle');
    const svgButton = wrap.querySelector('#exportSvg');
    if (svgButton) svgButton.textContent = 'Export 2D SVG';
    body.appendChild(wrap);

    const advanced = wrap.querySelectorAll('details.advanced-env');
    const env3d = make3DSection('3D-only environment', [
        'sunAzimuth', 'sunElevation', 'sway', 'swayWind',
        'groundDetail', 'groundDensity', 'snow', 'espalier', 'bloom',
    ], true);
    renameControlLabel(env3d, 'sunAzimuth', '3D sun azimuth');
    renameControlLabel(env3d, 'sunElevation', '3D sun elevation');
    renameControlLabel(env3d, 'sway', '3D sway');
    if (advanced[0]) advanced[0].after(env3d);
    else wrap.appendChild(env3d);

    const view3d = make3DSection('3D view & export', [
        'spin', 'vizWire', 'vizPerf', 'exportGlb', 'glbRoots', 'glbLeaves',
        'glbMetadata', 'glbAxis', 'glbUnits', 'glbLod',
    ]);
    renameControlLabel(view3d, 'spin', '3D turntable');
    const glbButton = view3d.querySelector('#exportGlb');
    if (glbButton) glbButton.textContent = 'Export 3D GLB';
    if (advanced[1]) advanced[1].after(view3d);
    else wrap.appendChild(view3d);

    panelShadow = shadow;
    wirePanelControls();
    syncPanel();

    if (!panelSyncTimer) panelSyncTimer = setInterval(syncPanel, 150);
}

function dispatchTarget(target, element, eventName) {
    if (!target) return;
    if (element.type === 'checkbox') target.checked = element.checked;
    else target.value = element.value;
    target.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function targetsFor(id, isButton) {
    if (isButton && ACTIVE_PANE_BUTTONS.has(id)) {
        const target = findInShadow(activeShadow(), id);
        return target ? [target] : [];
    }
    return [findInShadow(shadow2d, id), findInShadow(shadow3d, id)].filter(Boolean);
}

function wirePanelControls() {
    if (!panelShadow) return;
    for (const element of panelShadow.querySelectorAll('[id]')) {
        const id = element.id;
        if (id === 'loadStateFile' || id === 'params' || id === 'presets' || id === 'inspector') continue;

        if (element.matches('input, select')) {
            if (element.type === 'file') continue;
            const eventName = element.type === 'range' || element.type === 'number' ? 'input' : 'change';
            element.addEventListener(eventName, () => {
                for (const target of targetsFor(id, false)) {
                    dispatchTarget(target, element, eventName);
                }
                syncPanel();
            });
        } else if (element.tagName === 'BUTTON') {
            element.addEventListener('click', (event) => {
                event.preventDefault();
                for (const target of targetsFor(id, true)) target.click();
                syncPanel();
            });
        }
    }

    for (const button of panelShadow.querySelectorAll('#presets button')) {
        button.addEventListener('click', () => {
            const preset = button.dataset.preset;
            for (const shadow of [shadow2d, shadow3d]) {
                shadow?.querySelector(`#presets button[data-preset="${preset}"]`)?.click();
            }
            syncPanel();
        });
    }

    for (const wrapper of panelShadow.querySelectorAll('#params [data-param-key]')) {
        const key = wrapper.dataset.paramKey;
        const input = wrapper.querySelector('input');
        if (!input) continue;
        input.addEventListener('input', () => {
            for (const shadow of [shadow2d, shadow3d]) {
                const target = shadow?.querySelector(`#params [data-param-key="${key}"] input`);
                if (!target) continue;
                target.value = input.value;
                target.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }
}

function syncPanel() {
    if (!panelShadow || !shadow2d || !shadow3d) return;

    for (const element of panelShadow.querySelectorAll('[id]')) {
        const id = element.id;
        if (id === 'loadStateFile' || id === 'params' || id === 'presets') continue;

        if (id === 'inspector') {
            const source = activeShadow()?.querySelector('#inspector');
            if (source && element.innerHTML !== source.innerHTML) element.innerHTML = source.innerHTML;
            continue;
        }

        const source = findInShadow(shadow2d, id) || findInShadow(shadow3d, id);
        if (!source) continue;

        if (element.matches('input, select')) {
            if (element.type === 'file') continue;
            if (element.type === 'checkbox') {
                if (element.checked !== source.checked) element.checked = source.checked;
            } else if (element.value !== source.value) {
                element.value = source.value;
            }
            if (id === 'groundDensity') element.disabled = source.disabled;
        } else if (element.tagName === 'BUTTON') {
            const stateSource = (id === 'prune' || id === 'lasso')
                ? (findInShadow(activeShadow(), id) || source)
                : source;
            element.classList.toggle('active', stateSource.classList.contains('active'));
            if (element.disabled !== stateSource.disabled) element.disabled = stateSource.disabled;
            const pressed = stateSource.getAttribute('aria-pressed');
            if (pressed !== null) element.setAttribute('aria-pressed', pressed);
        } else if (element.tagName === 'SPAN' || element.tagName === 'P') {
            if (element.textContent !== source.textContent) element.textContent = source.textContent;
        }
    }

    for (const button of panelShadow.querySelectorAll('#presets button')) {
        const source = shadow2d.querySelector(`#presets button[data-preset="${button.dataset.preset}"]`);
        if (source) button.classList.toggle('active', source.classList.contains('active'));
    }

    for (const wrapper of panelShadow.querySelectorAll('#params [data-param-key]')) {
        const key = wrapper.dataset.paramKey;
        const source = shadow2d.querySelector(`#params [data-param-key="${key}"]`);
        if (!source) continue;
        const sourceInput = source.querySelector('input');
        const sourceSpan = source.querySelector('span');
        const input = wrapper.querySelector('input');
        const span = wrapper.querySelector('span');
        if (input && sourceInput && input.value !== sourceInput.value) input.value = sourceInput.value;
        if (span && sourceSpan && span.textContent !== sourceSpan.textContent) span.textContent = sourceSpan.textContent;
    }
}

/* ==========================================================================
   Shared transport
   ========================================================================== */

function syncTransportFromState() {
    if (!canonical) return;
    lifespan = Number(canonical.params?.lifespan) || 300;
    speed = Number(canonical.params?.speed) || 2.5;
    transportTime = Math.min(lifespan + 1, Math.max(0, Number(canonical.time) || 0));

    timeSlider.max = String(lifespan + 1);
    timeSlider.value = String(transportTime);
    timeLabel.textContent = transportTime.toFixed(1);
}

function driveTime(nextTime, { updateState = true } = {}) {
    transportTime = Math.min(lifespan + 1, Math.max(0, nextTime));
    if (updateState && canonical) canonical.time = transportTime;
    timeSlider.value = String(transportTime);
    timeLabel.textContent = transportTime.toFixed(1);

    if (window.__tree2d) window.__tree2d.setTime(transportTime);
    if (window.__tree3d) window.__tree3d.setTime(transportTime);
}

function stopPlayback({ resetButton = true } = {}) {
    playing = false;
    if (playTimer) {
        clearInterval(playTimer);
        playTimer = 0;
    }
    if (resetButton) {
        playButton.textContent = 'Play';
        playButton.classList.remove('active');
    }
}

function startPlayback() {
    stopPlayback({ resetButton: false });
    if (transportTime >= lifespan + 1) driveTime(0);
    playing = true;
    playButton.textContent = 'Pause';
    playButton.classList.add('active');
    let last = performance.now();
    playTimer = setInterval(() => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        driveTime(transportTime + dt * speed);
        if (transportTime >= lifespan + 1) stopPlayback();
    }, 50);
}

function restartPlayback() {
    stopPlayback({ resetButton: false });
    driveTime(0);
    startPlayback();
}

function togglePlayback() {
    if (playing) stopPlayback();
    else startPlayback();
}

playButton.addEventListener('click', togglePlayback);
timeSlider.addEventListener('input', (event) => {
    stopPlayback();
    driveTime(+event.target.value);
});
copyButton.addEventListener('click', async () => {
    const state = canonical || window.__tree2d?.captureState();
    if (!state) return;
    const link = treeShareUrl(window.location, state);
    try {
        await navigator.clipboard.writeText(link);
        setStatus('Share link copied');
    } catch {
        window.prompt('Copy this share link:', link);
    }
});

window.addEventListener('keydown', (event) => {
    if (event.target && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    if (event.composedPath().some((node) => node?.id === 'controlHost')) return;
    if (event.code === 'Space') {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.target && /^(BUTTON|A|SUMMARY)$/.test(event.target.tagName)) return;
        event.preventDefault();
        togglePlayback();
    } else if (event.key === 'Escape') {
        if (fullscreenPane) {
            exitFullscreen();
        } else if (panelOpen && isMobilePanel()) {
            setPanelOpen(false);
        }
    } else if (event.key === '1' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setActivePane('2d');
    } else if (event.key === '2' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setActivePane('3d');
    } else if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        restartPlayback();
    } else if (event.key.toLowerCase() === 'h' && fullscreenPane && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        fullscreenUiHidden = !fullscreenUiHidden;
        syncFullscreenState();
    } else if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        toggleFullscreen();
    }
});

/* ==========================================================================
   Boot
   ========================================================================== */

async function boot() {
    applyPanelState();
    try {
        const [view2d, view3d] = await Promise.all([
            buildShadowView('2d'),
            buildShadowView('3d'),
        ]);
        shadow2d = view2d.shadow;
        shadow3d = view3d.shadow;

        await mountView('2d', shadow2d);
        await mountView('3d', shadow3d);

        const shared = (() => {
            let stateError = null;
            let state = null;
            try {
                state = treeStateFromUrl(window.location);
            } catch (error) {
                stateError = error;
            }
            if (!state) {
                for (const dimension of ['app', '2d', '3d']) {
                    const result = loadTreeStateLocalResult(dimension);
                    if (result.state && !state) state = result.state;
                    if (result.error && !stateError) stateError = result.error;
                }
            }
            if (!state) state = window.__tree2d.captureState();
            if (stateError) {
                stateLoadWarning = `Could not load saved state: ${stateError.message} Using the current tree.`;
                setStatus(stateLoadWarning);
            }
            return state;
        })();

        canonical = shared;
        if (window.__tree2d) window.__tree2d.restoreState(shared);
        if (window.__tree3d) window.__tree3d.restoreState(shared);
        saveTreeStateLocal('app', shared);
        syncTransportFromState();

        buildControlPanel(view2d.css);
        setActivePane('2d');

        booting = false;
        window.__TREE_APP_BOOTING__ = false;
        document.body.classList.remove('booting');
        setStatus(stateLoadWarning || 'Both views live · synced');
    } catch (error) {
        console.error(error);
        document.body.classList.remove('booting');
        setStatus('Could not load the split view. Serve this folder over HTTP (for example: python3 -m http.server).');
    }
}

boot();
