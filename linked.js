/**
 * Split-view studio controller.
 *
 * The 2D and 3D prototypes are no longer iframes. Each simulation is an ES
 * module, each renderer is mounted into its own shadow root, and this page
 * provides one shared stage, a mode rail with one flyout, a persistent
 * transport dock and the workflow modes Grow / Sculpt / Study / Deliver.
 *
 * The universal panel is still cloned from the populated 2D control surface
 * (with 3D-only controls injected), then re-parented into manifest slots.
 * Moving nodes preserves every existing listener and the state sync loop.
 */

import {
    STUDIO_MODES,
    MANIFEST,
    MANIFEST_BY_KEY,
    SCOPE_LABEL,
    CONTROL_HELP,
} from './studio/manifest.js';
import {
    loadUiPrefs,
    saveUiPrefs,
    saveUiPrefsNow,
    markTourSeen,
    hasSeenTour,
    UI_PREFS_KEY,
} from './studio/prefs.js';
import { ICONS, modeIcon } from './studio/icons.js';
import {
    TAKE_PRESETS,
    sampleTake,
    normalizeSettings,
    takeDuration,
    orbitPose,
} from './studio/record-controller.js';

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

const $ = (id) => document.getElementById(id);

const playButton = $('play');
const timeSlider = $('time');
const ageInput = $('ageInput');
const statusEl = $('status');
const activeViewEl = $('activeView');
const controlPanelEl = $('controlPanel');
const controlHost = $('controlHost');
const panelBackdrop = $('panelBackdrop');
const appHeader = document.querySelector('.app-header');
const appMain = $('appSplit');
const transportDock = $('transportDock');
const modeRail = $('modeRail');
const paneElements = {
    '2d': document.querySelector('.app-pane[data-view="2d"]'),
    '3d': document.querySelector('.app-pane[data-view="3d"]'),
};
const viewHosts = {
    '2d': $('view2d'),
    '3d': $('view3d'),
};

const prefs = loadUiPrefs();

let canonical = null;
let transportTime = 0;
let lifespan = 300;
let speed = 2.5;
let playing = false;
let playTimer = 0;
let booting = true;
let panelShadow = null;
let shadow2d = null;
let shadow3d = null;
let activePane = prefs.activePane;
let mode = prefs.mode;
let layout = prefs.layout;
let panelOpen = prefs.flyoutOpen;
let panelReturnFocus = null;
let panelWasMobile = window.innerWidth <= 1100;
let fullscreenPane = null;
let fullscreenUiHidden = false;
let stateLoadWarning = '';
let lastPreset = 'oak';
let appStateClearing = false;
const suspendedPanes = new Set();
let deliverTab = 'record';
let deliverTarget = 'svg';
let studyOpen = prefs.studyOpen;
let studyHeight = prefs.studyHeight;
let studySource = '2d';
let studyMetrics = ['biomass', 'height'];
let studyHover = null;
let lastInspectorSignature = '';
let sheetState = 'peek';
let recordState = 'idle';
let recordSettings = Object.assign({}, prefs.record);
let recordSnapshot = null;
let recordStartedAt = 0;
let recordElapsed = 0;
let recordRAF = 0;
let recordPaused = false;
let recordPreviewing = false;
let recordCameraBase = null;
let recordCountdownTimer = 0;
let recordReturnFocus = null;
let performanceCheckRunning = false;
let simStartAt = 0;
let simEndTimer = 0;
let pendingSimCount = 0;
let lastScrubKey = '';
let lifespanOverrideUntil = 0;
let speedOverrideUntil = 0;

/* ==========================================================================
   Small utilities
   ========================================================================== */

function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
}

window.__TREE_APP_STATUS__ = setStatus;

let toastTimer = 0;
function showToast(message, { duration = 3200 } = {}) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    setStatus(message);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.hidden = true;
        toastTimer = 0;
    }, duration);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return /^(INPUT|SELECT|TEXTAREA)$/.test(tag) || target.isContentEditable;
}

function seasonName(value) {
    const s = ((Number(value) || 0) % 1 + 1) % 1;
    if (s < 0.15) return 'Spring';
    if (s < 0.5) return 'Summer';
    if (s < 0.8) return 'Autumn';
    return 'Winter';
}

function stageName(t) {
    if (t < 1) return 'Seed';
    if (t < 5) return 'Seedling';
    if (t < 20) return 'Sapling';
    if (t < 80) return 'Young tree';
    return 'Mature tree';
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

function activeShadow() {
    return activePane === '2d' ? shadow2d : shadow3d;
}

function clearSelectionIn(dimension) {
    const bridge = window[dimension === '3d' ? '__tree3d' : '__tree2d'];
    bridge?.clearSelection?.();
}

function clearAllSelections() {
    clearSelectionIn('2d');
    clearSelectionIn('3d');
    lastInspectorSignature = '';
    updateAnchoredInspector();
}

function setSelectionEnabled(engine2d, engine3d) {
    window.__tree2d?.setSelectionEnabled?.(!!engine2d);
    window.__tree3d?.setSelectionEnabled?.(!!engine3d);
}

/** Node inspection is a Study-mode interaction; tools stay available elsewhere. */
function applySelectionPolicy() {
    const studying = mode === 'study';
    if (!studying) {
        setSelectionEnabled(false, false);
        clearAllSelections();
    } else {
        // Prune/Lasso take precedence over inspection, so leave them before
        // entering Study. Otherwise a click would cut instead of inspect.
        for (const shadow of [shadow2d, shadow3d]) {
            const prune = findInShadow(shadow, 'prune');
            const lasso = findInShadow(shadow, 'lasso');
            if (prune?.classList.contains('active')) prune.click();
            if (lasso?.classList.contains('active')) lasso.click();
        }
        clearAllSelections();
        setSelectionEnabled(true, true);
    }
    updateAnchoredInspector();
    syncPanel();
}

function findInShadow(shadow, id) {
    return shadow ? shadow.querySelector('#' + CSS.escape(id)) : null;
}

function currentPreset() {
    return shadow2d?.querySelector('#presets button.active')?.dataset.preset
        || canonical?.activePreset
        || 'custom';
}

/* ==========================================================================
   View mounting and pane chrome
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

/** Styles for the two render panes: the canvas fills the card. */
function paneCss(css, dimension) {
    return `${scopeBaseCss(css)}
        :host {
            display: block;
            height: 100%;
            background: var(--bg);
            color: var(--fg);
        }
        .pane-body {
            height: 100%;
            min-height: 0;
            overflow: hidden;
        }
        .top {
            position: relative !important;
            top: 0 !important;
            height: 100%;
            display: flex;
            flex-direction: column;
            padding: 0 !important;
            border-bottom: 0 !important;
            background: transparent !important;
        }
        .viewport {
            flex: 1 1 auto;
            min-height: 0;
            position: relative;
        }
        .row,
        .wrap {
            display: none !important;
        }
        canvas#c {
            width: 100%;
            height: 100% !important;
            min-height: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
        }
        .stat {
            flex: 0 0 auto;
            padding: 6px 10px !important;
            border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
            font-size: 11px !important;
        }
        #analytics {
            display: none !important;
        }
        :host(.fullscreen) .pane-body {
            height: 100%;
            min-height: 0;
        }
        :host(.fullscreen) .top {
            height: 100%;
            padding: 0;
            border: 0;
        }
        :host(.fullscreen) .stat,
        :host(.fullscreen) .hint,
        :host(.fullscreen) .legend {
            display: none !important;
        }
        :host(.fullscreen) canvas#c {
            width: 100%;
            height: 100% !important;
            border: 0;
            border-radius: 0;
        }
        :host(.ui-hidden) .legend,
        :host(.ui-hidden) .hint,
        :host(.ui-hidden) .perf-hud {
            display: none !important;
        }
        :host(.recording) .stat,
        :host(.recording) .hint,
        :host(.recording) .legend,
        :host(.recording) .perf-hud {
            display: none !important;
        }
        @media (max-width: 900px) {
            .stat {
                font-size: 10px !important;
            }
        }
    `;
}

/** Styles for the universal panel clone: prototype controls plus flyout UI. */
const FLYOUT_CSS = `
    :host {
        display: block;
        height: 100%;
        background: var(--bg);
        color: var(--fg);
        font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    .panel-body {
        height: 100%;
        overflow: auto;
        overscroll-behavior: contain;
        padding: 10px 12px 34px;
        scrollbar-width: thin;
    }
    .wrap {
        max-width: none;
        margin: 0;
        padding: 0;
    }
    .source-pool {
        display: none !important;
    }
    .studio-flyout {
        display: block;
    }
    .mode-panel {
        display: grid;
        gap: 12px;
    }
    .mode-panel[hidden] {
        display: none;
    }
    .fly-section,
    .fly-group {
        margin: 0;
        padding: 0;
        border: 0;
    }
    .fly-section {
        display: grid;
        gap: 8px;
    }
    .fly-heading,
    .fly-group > summary,
    .fly-subgroup > summary {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        color: var(--mut);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        list-style: none;
        cursor: default;
    }
    .fly-group > summary,
    .fly-subgroup > summary {
        cursor: pointer;
        padding: 6px 0;
    }
    .fly-group > summary::-webkit-details-marker,
    .fly-subgroup > summary::-webkit-details-marker {
        display: none;
    }
    .fly-group > summary::before,
    .fly-subgroup > summary::before {
        content: "▸";
        display: inline-block;
        width: 10px;
        color: var(--mut);
        font-size: 9px;
        transition: transform 120ms ease;
    }
    .fly-group[open] > summary::before,
    .fly-subgroup[open] > summary::before {
        transform: rotate(90deg);
    }
    .fly-group > summary:hover,
    .fly-subgroup > summary:hover {
        color: var(--fg);
    }
    .fly-body {
        display: grid;
        gap: 10px;
        padding: 2px 0 4px;
    }
    .fly-subgroup {
        margin-top: 6px;
        padding-left: 8px;
        border-left: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    }
    .ctl-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 8px;
        padding: 4px 0 2px;
    }
    .ctl-grid.ctl-inline {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .ctl {
        position: relative;
        min-width: 0;
    }
    .ctl-row {
        display: grid;
        gap: 3px;
        font-size: 12px;
        color: var(--fg);
    }
    .ctl-head {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
        min-width: 0;
    }
    .ctl-name {
        min-width: 0;
        font-size: 12px;
        color: var(--fg);
    }
    .ctl-value {
        margin-left: auto;
        color: var(--mut);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }
    .ctl-row input[type="range"] {
        width: 100%;
        margin: 0;
        accent-color: var(--acc);
        -webkit-appearance: none;
        appearance: none;
        height: 16px;
        background: transparent;
    }
    .ctl-row input[type="range"]::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--acc) 22%, var(--line));
    }
    .ctl-row input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        margin-top: -5px;
        border-radius: 50%;
        border: 2px solid var(--card);
        background: var(--acc);
        box-shadow: 0 1px 3px rgba(32, 36, 30, 0.25);
    }
    .ctl-row input[type="range"]::-moz-range-track {
        height: 4px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--acc) 22%, var(--line));
    }
    .ctl-row input[type="range"]::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid var(--card);
        background: var(--acc);
    }
    .ctl-row select,
    .ctl-row input[type="number"],
    .ctl-row input[type="text"] {
        width: 100%;
        min-width: 0;
        padding: 5px 7px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--card);
        color: var(--fg);
        font-size: 12px;
    }
    .ctl-row input[type="checkbox"] {
        width: 15px;
        height: 15px;
        margin: 0;
        accent-color: var(--acc);
    }
    .ctl-check {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 12px;
    }
    .ctl-action {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
    }
    .ctl-action button {
        flex: 1 1 auto;
        min-width: 0;
        padding: 7px 9px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--card);
        color: var(--fg);
        font-size: 12px;
        font-weight: 600;
        text-align: left;
    }
    .ctl-action button:hover {
        border-color: var(--acc);
    }
    .ctl-action .help-button {
        flex: 0 0 auto;
        width: 16px;
        height: 16px;
        padding: 0;
        border-radius: 50%;
        text-align: center;
    }
    .ctl-action button.active,
    .ctl-action button[aria-pressed="true"] {
        border-color: var(--acc);
        background: var(--acc);
        color: #fff;
    }
    .ctl-action button.primary-button,
    .primary-button {
        border-color: var(--acc);
        background: var(--acc);
        color: #fff;
    }
    .ctl-action button.destructive-button,
    .destructive-button {
        border-color: #8f2f22;
        color: #8f2f22;
        background: var(--card);
    }
    .ctl-action button.destructive-button:hover,
    .destructive-button:hover {
        background: #f7e9e5;
    }
    .ctl-action .tool-toggle {
        flex: 0 1 auto;
    }
    .scope-chip {
        display: inline-flex;
        align-items: center;
        padding: 1px 5px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--card);
        color: var(--mut);
        font: 700 8px/1.5 system-ui, sans-serif;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
    }
    .scope-2d {
        border-color: #d8c3a3;
        background: #fbf3e6;
        color: #74522a;
    }
    .scope-3d {
        border-color: #b9d3dc;
        background: #edf6f8;
        color: #2e5c68;
    }
    .scope-active {
        border-color: #c6d8bd;
        background: #f1f7ed;
        color: #3d6a34;
    }
    .help-button {
        width: 16px;
        height: 16px;
        padding: 0;
        border: 1px solid var(--line);
        border-radius: 50%;
        background: var(--card);
        color: var(--mut);
        font: 700 9px/1 system-ui, sans-serif;
        cursor: pointer;
    }
    .help-button:hover {
        border-color: var(--acc);
        color: var(--acc);
    }
    .help-pop {
        position: absolute;
        z-index: 12;
        left: 0;
        right: 0;
        top: calc(100% + 4px);
        padding: 8px 9px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--card);
        color: var(--fg);
        font-size: 11px;
        line-height: 1.4;
        box-shadow: 0 10px 24px rgba(32, 36, 30, 0.14);
    }
    .help-pop strong {
        display: block;
        margin-bottom: 2px;
        color: var(--mut);
        font-size: 9px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }
    .ctl-reason {
        margin: 0;
        color: var(--mut);
        font-size: 10px;
    }
    .species-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
    }
    .species-card {
        position: relative;
        display: grid;
        justify-items: center;
        gap: 2px;
        min-height: 74px;
        padding: 6px 4px 5px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--card);
        color: var(--mut);
        font: 600 10px/1.2 system-ui, sans-serif;
        text-align: center;
    }
    .species-card:hover {
        border-color: var(--acc);
    }
    .species-card[aria-pressed="true"],
    .species-card.active {
        border-color: var(--acc);
        background: var(--acc-soft);
        color: #356d31;
    }
    .species-card svg {
        width: 36px;
        height: 44px;
        color: currentColor;
    }
    .species-card .scope-chip {
        position: absolute;
        top: 3px;
        right: 3px;
        transform: scale(0.9);
    }
    .custom-banner {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: 1px dashed color-mix(in srgb, var(--acc) 44%, var(--line));
        border-radius: 8px;
        background: var(--acc-soft);
        color: #356d31;
        font-size: 10px;
    }
    .custom-banner span {
        flex: 1 1 auto;
    }
    .custom-banner button {
        border: 1px solid currentColor;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font-size: 10px;
        padding: 3px 7px;
    }
    .group-note {
        margin: 0;
        color: var(--mut);
        font-size: 10px;
    }
    .palette-highlight {
        animation: palette-pulse 1.4s ease;
        border-radius: 6px;
    }
    @keyframes palette-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(63, 125, 58, 0); }
        15% { box-shadow: 0 0 0 3px rgba(63, 125, 58, 0.34); }
    }
    #inspector {
        min-height: 64px;
        padding: 7px 8px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--card);
        font-size: 11px;
        color: var(--mut);
    }
    #inspector .inspect-title {
        margin-bottom: 5px;
        color: var(--fg);
        font-weight: 700;
        font-size: 12px;
    }
    #inspector .inspect-grid {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 2px 8px;
    }
    #inspector .inspect-grid span {
        color: var(--mut);
    }
    #seedv {
        display: inline-block;
        color: var(--mut);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }
    .analytics-baseline-label,
    .analytics-summary {
        display: block;
        color: var(--mut);
        font-size: 10px;
        line-height: 1.4;
    }
    .analytics-summary {
        margin: 0;
        padding: 5px 0;
    }
    .deliver-tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        padding: 2px;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: color-mix(in srgb, var(--card) 70%, var(--bg));
    }
    .deliver-tabs button {
        padding: 6px 8px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--mut);
        font-size: 12px;
        font-weight: 700;
    }
    .deliver-tabs button[aria-selected="true"] {
        background: var(--acc);
        color: #fff;
    }
    .deliver-panel {
        display: grid;
        gap: 10px;
    }
    .deliver-panel[hidden] {
        display: none;
    }
    .deliver-step {
        display: grid;
        gap: 6px;
    }
    .deliver-step > h3 {
        margin: 0;
        color: var(--mut);
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
    .export-targets {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 5px;
    }
    .export-target {
        display: grid;
        gap: 1px;
        padding: 7px 8px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--card);
        text-align: left;
        font-size: 11px;
        font-weight: 600;
    }
    .export-target span {
        color: var(--mut);
        font-size: 9px;
        font-weight: 400;
    }
    .export-target[aria-pressed="true"] {
        border-color: var(--acc);
        background: var(--acc-soft);
        color: #356d31;
    }
    .export-option-block {
        display: grid;
        gap: 6px;
        padding: 6px 0;
    }
    .export-option-block[hidden] {
        display: none;
    }
    .export-preview {
        display: grid;
        gap: 5px;
        padding: 7px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: color-mix(in srgb, var(--card) 70%, var(--bg));
    }
    #exportPreviewCanvas {
        width: 100%;
        height: 92px;
        border-radius: 6px;
        background: #e7e5dc;
        object-fit: contain;
    }
    .export-filename {
        margin: 0;
        overflow: hidden;
        color: var(--mut);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .deliver-action-slot {
        display: grid;
        gap: 5px;
    }
    .deliver-action-slot .ctl[hidden],
    .deliver-action-slot button[hidden] {
        display: none;
    }
    .deliver-action-slot .help-button,
    .deliver-action-slot .scope-chip {
        display: none;
    }
    .deliver-action-slot button {
        flex: 1 1 auto;
        border-color: var(--acc);
        background: var(--acc);
        color: #fff;
    }
    .deliver-action-slot button:hover {
        background: #356d31;
    }
    .record-presets {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 5px;
    }
    .record-preset {
        display: grid;
        gap: 2px;
        padding: 7px 8px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--card);
        text-align: left;
    }
    .record-preset strong {
        font-size: 11px;
    }
    .record-preset span {
        color: var(--mut);
        font-size: 9px;
        line-height: 1.3;
    }
    .record-preset[aria-pressed="true"] {
        border-color: var(--acc);
        background: var(--acc-soft);
    }
    .record-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
    }
    .record-grid label {
        display: grid;
        gap: 3px;
        color: var(--mut);
        font-size: 10px;
    }
    .record-grid select,
    .record-grid input[type="number"],
    .record-grid input[type="text"] {
        width: 100%;
        padding: 5px 6px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--card);
        color: var(--fg);
        font-size: 11px;
    }
    .record-checks {
        display: grid;
        gap: 5px;
    }
    .record-checks label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
    }
    .preflight {
        display: grid;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
    }
    .preflight li {
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr) max-content;
        gap: 5px;
        align-items: start;
        padding: 4px 6px;
        border: 1px solid var(--line);
        border-radius: 6px;
        font-size: 10px;
    }
    .preflight li b {
        font-size: 10px;
    }
    .preflight .ok { color: #2f6b2b; }
    .preflight .warn { color: #7a531e; }
    .preflight .fix {
        border: 0;
        background: transparent;
        color: var(--acc);
        font-size: 10px;
        text-decoration: underline;
        padding: 2px;
    }
    .record-tip {
        margin: 0;
        color: var(--mut);
        font-size: 10px;
    }
    .record-tip summary {
        cursor: pointer;
        font-weight: 600;
    }
    .record-actions {
        display: flex;
        gap: 6px;
    }
    .record-actions button {
        flex: 1 1 auto;
        padding: 8px 9px;
    }
    .record-mobile-note {
        display: none;
        margin: 0;
        padding: 6px 8px;
        border: 1px dashed var(--line);
        border-radius: 7px;
        color: var(--mut);
        font-size: 10px;
        line-height: 1.4;
    }
    @media (max-width: 800px) {
        .record-mobile-note {
            display: block;
        }
    }
`;

function panelCss(css) {
    return `${scopeBaseCss(css)}
        :host {
            display: block;
            height: 100%;
            background: var(--bg);
            color: var(--fg);
            font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        }
        .panel-body {
            height: 100%;
            overflow: auto;
            overscroll-behavior: contain;
            padding: 10px 12px 34px;
        }
        button {
            padding: 6px 9px;
            border-radius: 8px;
            font-size: 12px;
        }
        label {
            font-size: 12px;
        }
        ${FLYOUT_CSS}
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
   Control panel: clone, re-parent, decorate, wire
   ========================================================================== */

const mounted = new Map();
const sourcePool = { wrap: null, injected: [] };
const groupSlots = new Map();
let customBanner = null;
let speciesGrid = null;
let deliverActionSlot = null;
let deliverActionButtons = new Map();

const ACTIVE_PANE_BUTTONS = new Set([
    'reseed', 'prune', 'lasso', 'undoCut', 'redoCut', 'isolate', 'snapshot',
    'compare', 'loadState', 'shareState', 'saveState', 'exportCsv', 'exportPng',
    'exportJson', 'exportBatch',
]);

const ACTION_PRIMARY = new Set(['exportSvg', 'exportPng', 'exportGlb', 'exportCsv', 'exportJson', 'exportBatch', 'shareState']);
const DESTRUCTIVE = new Set(['reseed', 'clearCuts']);

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
    const input = root.querySelector('#' + CSS.escape(id));
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

function speciesSilhouette(name) {
    const common = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"';
    if (name === 'poplar') {
        return `<svg viewBox="0 0 40 48" aria-hidden="true"><path ${common} d="M20 46V14"/><path ${common} d="M20 14c-5 0-8 4-8 10s3 12 8 12 8-6 8-12-3-10-8-10Z"/><path ${common} d="M20 46l-5 2M20 46l5 2"/></svg>`;
    }
    if (name === 'oak') {
        return `<svg viewBox="0 0 40 48" aria-hidden="true"><path ${common} d="M20 46V22"/><path ${common} d="M20 22c-7-2-12 1-13 7-1 5 3 9 8 8-3 4 0 8 5 7 5 1 8-3 5-7 5 1 9-3 8-8-1-6-6-9-13-7Z"/><path ${common} d="M20 46l-6 2M20 46l6 2"/></svg>`;
    }
    if (name === 'willow') {
        return `<svg viewBox="0 0 40 48" aria-hidden="true"><path ${common} d="M20 46V12"/><path ${common} d="M20 12c-6 5-9 13-7 25M20 12c6 5 9 13 7 25M20 16c-3 7-4 15-2 23M20 16c3 7 4 15 2 23"/></svg>`;
    }
    if (name === 'pine') {
        return `<svg viewBox="0 0 40 48" aria-hidden="true"><path ${common} d="M20 46V10"/><path ${common} d="M20 10 9 26h22L20 10Z"/><path ${common} d="M20 20 6 36h28L20 20Z"/><path ${common} d="M20 46l-5 2M20 46l5 2"/></svg>`;
    }
    if (name === 'cherry') {
        return `<svg viewBox="0 0 40 48" aria-hidden="true"><path ${common} d="M20 46V22"/><path ${common} d="M20 22c-7-5-14-2-15 5-1 6 4 10 9 8 1 4 5 6 9 4 4 2 8 0 9-4 5 2 10-2 9-8-1-7-8-10-15-5Z"/><circle cx="14" cy="29" r="1.4" fill="currentColor"/><circle cx="25" cy="27" r="1.2" fill="currentColor"/><circle cx="21" cy="34" r="1.1" fill="currentColor"/><path ${common} d="M20 46l-6 2M20 46l6 2"/></svg>`;
    }
    return `<svg viewBox="0 0 40 48" aria-hidden="true"><path ${common} d="M20 46V18"/><path ${common} d="M20 18l-9-6M20 24l9-7M20 30l-8-5M20 36l8-6"/><circle cx="20" cy="18" r="2.4"/><circle cx="11" cy="12" r="1.8"/><circle cx="29" cy="17" r="1.8"/></svg>`;
}

function buildControlPanel(css2d) {
    const source = shadow2d?.querySelector('.wrap');
    if (!source) return;

    // Clone the populated 2D form and inject the 3D-only controls so every
    // source node lives in one pool before it is re-parented.
    const wrap = document.importNode(source, true);
    wrap.classList.add('panel-wrap');
    removeExplainer(wrap);
    renameControlLabel(wrap, 'sunAngle', '2D sun angle');
    const svgButton = wrap.querySelector('#exportSvg');
    if (svgButton) svgButton.textContent = 'Export 2D SVG';

    const advanced = wrap.querySelectorAll('details.advanced-env');
    const env3d = make3DSection('3D-only environment', [
        'sunAzimuth', 'sunElevation', 'sway', 'swayWind',
        'groundDetail', 'groundDensity', 'snow', 'espalier', 'bloom',
    ], true);
    renameControlLabel(env3d, 'sunAzimuth', '3D sun azimuth');
    renameControlLabel(env3d, 'sunElevation', '3D sun elevation');
    renameControlLabel(env3d, 'sway', '3D sway');
    if (advanced[0]) advanced[0].after(env3d); else wrap.appendChild(env3d);

    const view3d = make3DSection('3D view & export', [
        'spin', 'vizWire', 'vizPerf', 'exportGlb', 'glbRoots', 'glbLeaves',
        'glbMetadata', 'glbAxis', 'glbUnits', 'glbLod',
    ]);
    renameControlLabel(view3d, 'spin', '3D turntable');
    const glbButton = view3d.querySelector('#exportGlb');
    if (glbButton) glbButton.textContent = 'Export 3D GLB';
    if (advanced[1]) advanced[1].after(view3d); else wrap.appendChild(view3d);

    sourcePool.wrap = wrap;
    sourcePool.injected = [env3d, view3d];

    const shadow = controlHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = panelCss(css2d);
    shadow.appendChild(style);

    const body = document.createElement('div');
    body.className = 'panel-body';
    shadow.appendChild(body);

    const flyout = document.createElement('div');
    flyout.className = 'studio-flyout';
    body.appendChild(flyout);
    panelShadow = shadow;

    buildModePanels(flyout);

    // Hidden source pool keeps any not-yet-moved nodes available for audit.
    const pool = document.createElement('div');
    pool.className = 'source-pool';
    pool.hidden = true;
    pool.appendChild(wrap);
    body.appendChild(pool);

    mountAllControls();
    decorateSpecies();
    decorateGroups();
    wirePanelControls();
    wireAutomationButtons();
    syncPanel();
    if (!panelSyncTimer) panelSyncTimer = setInterval(syncPanel, 150);
}

let panelSyncTimer = 0;

function buildModePanels(flyout) {
    for (const meta of STUDIO_MODES) {
        if (meta.id === 'deliver') {
            flyout.appendChild(buildDeliverPanel());
            continue;
        }
        const panel = document.createElement('div');
        panel.className = 'mode-panel';
        panel.dataset.mode = meta.id;
        panel.id = `modePanel-${meta.id}`;
        panel.hidden = meta.id !== mode;
        buildGenericGroups(panel, meta.id);
        if (meta.id === 'study') {
            const head = document.createElement('section');
            head.className = 'fly-section';
            head.innerHTML = '<div class="fly-heading">Study drawer</div>';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'primary-button';
            btn.id = 'studyShowToggle';
            btn.textContent = 'Show Study drawer';
            btn.addEventListener('click', () => {
                studyOpen = !studyOpen;
                applyStudyState();
                savePrefs();
            });
            head.appendChild(btn);
            panel.prepend(head);
        }
        flyout.appendChild(panel);
    }
}

function buildGenericGroups(panel, modeId) {
    const entries = MANIFEST
        .filter((entry) => entry.mode === modeId && !entry.mount)
        .sort((a, b) => a.order - b.order);

    const topOrder = [];
    for (const entry of entries) {
        if (!topOrder.includes(entry.group[0])) topOrder.push(entry.group[0]);
    }

    for (const top of topOrder) {
        const topEntries = entries.filter((entry) => entry.group[0] === top);
        const direct = topEntries.filter((entry) => entry.group.length === 1);
        const essential = direct.some((entry) => entry.level === 'essential');

        let container;
        let body;
        if (essential) {
            container = document.createElement('section');
            container.className = 'fly-section';
            const heading = document.createElement('div');
            heading.className = 'fly-heading';
            heading.textContent = top;
            container.appendChild(heading);
            body = container;
        } else {
            container = document.createElement('details');
            container.className = 'fly-group';
            const summary = document.createElement('summary');
            summary.textContent = top;
            container.appendChild(summary);
            body = document.createElement('div');
            body.className = 'fly-body';
            container.appendChild(body);
        }
        container.dataset.group = top;

        if (direct.length) {
            const grid = document.createElement('div');
            grid.className = 'ctl-grid';
            grid.dataset.groupSlot = `${modeId}|${top}`;
            groupSlots.set(`${modeId}|${top}`, grid);
            body.appendChild(grid);
        }

        const nested = [];
        for (const entry of topEntries) {
            if (entry.group.length < 2) continue;
            const name = entry.group[1];
            if (!nested.includes(name)) nested.push(name);
        }
        for (const name of nested) {
            const details = document.createElement('details');
            details.className = 'fly-subgroup';
            const summary = document.createElement('summary');
            summary.textContent = name;
            details.appendChild(summary);
            const grid = document.createElement('div');
            grid.className = 'ctl-grid';
            grid.dataset.groupSlot = `${modeId}|${top}|${name}`;
            groupSlots.set(`${modeId}|${top}|${name}`, grid);
            details.appendChild(grid);
            body.appendChild(details);
        }

        panel.appendChild(container);
    }
}

function findSourceNode(entry) {
    const wrap = sourcePool.wrap;
    if (!wrap) return null;
    if (entry.kind === 'param') return wrap.querySelector(`[data-param-key="${entry.id}"]`);
    if (entry.kind === 'preset') return wrap.querySelector(`#presets button[data-preset="${entry.id}"]`);
    const source = wrap.querySelector('#' + CSS.escape(entry.id));
    if (!source) return null;
    if (source.matches('input, select, textarea') && source.closest('label')) {
        return source.closest('label');
    }
    return source;
}

function controlLabelFor(entry) {
    return entry.kind === 'param' ? entry.label : entry.label;
}

function addScopeAndHelp(host, entry, { inline = false } = {}) {
    const chip = document.createElement('span');
    chip.className = `scope-chip scope-${entry.scope}`;
    chip.textContent = SCOPE_LABEL[entry.scope] || 'Both';
    chip.title = `Scope: ${SCOPE_LABEL[entry.scope] || 'Both'}`;
    host.appendChild(chip);

    const help = entry.help || CONTROL_HELP[entry.key];
    if (help) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'help-button';
        btn.textContent = '?';
        btn.setAttribute('aria-label', `Help for ${entry.label}`);
        const pop = document.createElement('div');
        pop.className = 'help-pop';
        pop.setAttribute('role', 'tooltip');
        pop.hidden = true;
        const technical = entry.technical ? `${entry.technical} — ` : '';
        pop.innerHTML = `<strong>${escapeHtml(entry.label)}</strong>${escapeHtml(technical + help)}`;
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const open = pop.hidden;
            for (const other of panelShadow.querySelectorAll('.help-pop')) other.hidden = true;
            pop.hidden = !open;
        });
        host.appendChild(btn);
        host.appendChild(pop);
    }
}

function decorateRow(entry, node) {
    node.classList.add('ctl', 'ctl-row');
    const input = node.querySelector('input, select, textarea');
    const value = Array.from(node.children).find((child) => child.tagName === 'SPAN' && !child.classList.contains('scope-chip'));
    const head = document.createElement('span');
    head.className = 'ctl-head';
    const name = document.createElement('span');
    name.className = 'ctl-name';
    name.textContent = controlLabelFor(entry);
    head.appendChild(name);
    if (value) {
        value.classList.add('ctl-value');
        head.appendChild(value);
    }
    addScopeAndHelp(head, entry);
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) child.remove();
    }
    node.prepend(head);
    if (input && input.type === 'checkbox') {
        node.classList.add('ctl-check');
    }
    node.dataset.controlKey = entry.key;
    return node;
}

function decorateAction(entry, button) {
    button.dataset.controlKey = entry.key;
    button.classList.add('ctl-button');
    if (entry.kind === 'preset') return button;
    if (ACTION_PRIMARY.has(entry.id)) button.classList.add('primary-button');
    if (DESTRUCTIVE.has(entry.id)) button.classList.add('destructive-button');
    if (entry.id === 'prune' || entry.id === 'lasso') button.classList.add('tool-toggle');
    const wrapper = document.createElement('div');
    wrapper.className = 'ctl ctl-action';
    wrapper.dataset.controlKey = entry.key;
    wrapper.appendChild(button);
    addScopeAndHelp(wrapper, entry);
    return wrapper;
}

function decorateDisplay(entry, node) {
    node.classList.add('ctl', 'ctl-display');
    node.dataset.controlKey = entry.key;
    const value = document.createElement('span');
    value.className = 'display-value';
    value.innerHTML = node.innerHTML;
    node.innerHTML = '';
    node.appendChild(value);
    addScopeAndHelp(node, entry);
    return node;
}

function mountEntry(entry) {
    if (mounted.has(entry.key)) return;
    const source = findSourceNode(entry);
    if (!source) return;
    const slot = slotForEntry(entry);
    if (!slot) return;

    let node = source;
    if (entry.kind === 'param') {
        decorateRow(entry, source);
    } else if (entry.kind === 'preset') {
        source.classList.add('species-card');
        source.dataset.controlKey = entry.key;
        source.setAttribute('aria-pressed', 'false');
        const svg = document.createElement('div');
        svg.innerHTML = speciesSilhouette(entry.id);
        source.prepend(svg.firstElementChild);
        addScopeAndHelp(source, entry);
    } else if (source.tagName === 'BUTTON') {
        source.textContent = entry.label;
        node = decorateAction(entry, source);
    } else if (source.tagName === 'LABEL') {
        decorateRow(entry, source);
    } else if (source.matches('input, select, textarea')) {
        // Unlabelled hidden input (load state file).
        source.dataset.controlKey = entry.key;
    } else if (source.tagName === 'SPAN' || source.tagName === 'P' || source.tagName === 'DIV') {
        decorateDisplay(entry, source);
    } else {
        source.dataset.controlKey = entry.key;
    }

    slot.appendChild(node);
    mounted.set(entry.key, node);

    if (entry.mode === 'deliver' && ['exportSvg', 'exportPng', 'exportGlb', 'exportCsv', 'exportJson', 'exportBatch', 'shareState'].includes(entry.id)) {
        const button = node.tagName === 'BUTTON' ? node : node.querySelector('button');
        if (button) {
            deliverActionButtons.set(entry.id, button);
            button.dataset.actionTarget = DELIVER_ACTION_TARGET[entry.id];
        }
    }

    if (entry.id === 'isolate') {
        const reason = document.createElement('p');
        reason.className = 'ctl-reason';
        reason.dataset.reasonFor = 'isolate';
        reason.textContent = 'Select a branch first.';
        slot.appendChild(reason);
    }
    if (entry.id === 'inspector') {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.id = 'clearSelectionButton';
        clear.className = 'secondary-button';
        clear.textContent = 'Clear selection';
        clear.disabled = true;
        clear.addEventListener('click', () => {
            clearSelectionIn(activePane);
            updateAnchoredInspector();
            syncPanel();
        });
        slot.appendChild(clear);
    }
    if (entry.id === 'pruneType') {
        const note = document.createElement('p');
        note.className = 'group-note';
        note.textContent = 'Thinning removes cleanly · heading cuts to a bud · pollard grows dense knuckles.';
        slot.appendChild(note);
    }
    if (entry.id === 'clearCuts') {
        const note = document.createElement('p');
        note.className = 'group-note';
        note.id = 'flyoutCutCount';
        note.textContent = '0 cuts';
        slot.appendChild(note);
    }
    if (entry.id === 'compare') {
        const note = document.createElement('p');
        note.className = 'group-note';
        note.textContent = 'Overlays the structure you captured so you can see what your cuts changed.';
        slot.appendChild(note);
    }
    if (entry.id === 'analyticsClear') {
        const note = document.createElement('p');
        note.className = 'group-note';
        note.textContent = '1 · Pin run A. 2 · Change anything, then Compare to run A.';
        slot.appendChild(note);
    }
}

function mountAllControls() {
    for (const entry of MANIFEST) mountEntry(entry);

    // Species grid is the slot for the species cards; add the revert banner.
    speciesGrid = panelShadow.querySelector('[data-group-slot="grow|Species"]');
    if (speciesGrid) {
        customBanner = document.createElement('div');
        customBanner.className = 'custom-banner';
        customBanner.hidden = true;
        customBanner.innerHTML = '<span id="customBannerText">Custom · based on Oak</span><button type="button" id="revertPreset">Revert</button>';
        customBanner.querySelector('#revertPreset').addEventListener('click', () => {
            const button = panelShadow.querySelector(`#presets button[data-preset="${lastPreset}"]`)
                || shadow2d?.querySelector(`#presets button[data-preset="${lastPreset}"]`);
            button?.click();
            showToast(`Reverted to ${lastPreset}`);
        });
        speciesGrid.after(customBanner);
    }

    // Planting note when the forest has more than one tree.
    const trees = mounted.get('trees');
    const plantingSlot = trees?.closest('.ctl-grid');
    if (plantingSlot) {
        const note = document.createElement('p');
        note.className = 'group-note';
        note.id = 'plantingNote';
        note.textContent = 'Above one tree, regeneration can take longer.';
        plantingSlot.appendChild(note);
    }
}

function decorateSpecies() {
    const grid = panelShadow?.querySelector('[data-group-slot="grow|Species"]');
    if (grid) grid.classList.add('species-grid');
}

function decorateGroups() {
    // The manifest controls carry their own scope chips. Groups stay quiet.
}

function mountControl(entry) {
    mountEntry(entry);
    return mounted.get(entry.key);
}

/* ==========================================================================
   Control wiring and sync
   ========================================================================== */

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

function entrySource(entry) {
    if (entry.kind === 'param') {
        return shadow2d?.querySelector(`[data-param-key="${entry.id}"] input`);
    }
    if (entry.kind === 'preset') {
        return shadow2d?.querySelector(`#presets button[data-preset="${entry.id}"]`);
    }
    const activeIds = new Set(['inspector', 'analyticsBaselineLabel', 'analyticsSummary', 'prune', 'lasso', 'isolate']);
    const primary = activeIds.has(entry.id) ? activeShadow() : shadow2d;
    return findInShadow(primary, entry.id) || findInShadow(primary === shadow2d ? shadow3d : shadow2d, entry.id);
}

function wirePanelControls() {
    for (const [key, node] of mounted) {
        const entry = MANIFEST_BY_KEY.get(key);
        if (!entry) continue;
        if (entry.kind === 'display') continue;

        const input = node.matches('input, select, textarea')
            ? node
            : node.querySelector('input, select, textarea');
        if (input) {
            if (input.type === 'file') {
                input.addEventListener('change', () => {
                    const target = findInShadow(activeShadow(), 'loadStateFile');
                    if (target) {
                        target.files = input.files;
                        target.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
                continue;
            }
            const eventName = input.type === 'range' || input.type === 'number' ? 'input' : 'change';
            input.addEventListener(eventName, () => {
                if (entry.kind === 'param') {
                    for (const shadow of [shadow2d, shadow3d]) {
                        const target = shadow?.querySelector(`[data-param-key="${entry.id}"] input`);
                        if (!target) continue;
                        target.value = input.value;
                        target.dispatchEvent(new Event(eventName, { bubbles: true }));
                    }
                    if (entry.id === 'speed') {
                        speed = Number(input.value) || speed;
                        speedOverrideUntil = performance.now() + 1000;
                        if (canonical?.params) canonical.params.speed = speed;
                        updateDockReadouts();
                    }
                } else if (entry.id === 'zoom') {
                    const target = findInShadow(shadow2d, 'zoom');
                    if (target) dispatchTarget(target, input, eventName);
                    prefs.autoZoom2d = input.checked;
                    savePrefs();
                } else {
                    for (const target of targetsFor(entry.id, false)) {
                        dispatchTarget(target, input, eventName);
                    }
                    if (entry.id === 'lifespan') showToast('Lifespan change clears cuts', { duration: 1800 });
                    if (entry.id === 'seasonAuto' || entry.id === 'season') updateDockReadouts();
                }
                if (entry.id === 'lifespan') {
                    lifespan = Number(input.value) || lifespan;
                    lifespanOverrideUntil = performance.now() + 1000;
                    if (canonical?.params) canonical.params.lifespan = lifespan;
                    timeSlider.max = String(lifespan + 1);
                    if (transportTime > lifespan + 1) driveTime(lifespan + 1);
                    updateScrubDecor();
                    updateDockReadouts();
                }
                syncPanel();
            });
            continue;
        }

        const button = node.tagName === 'BUTTON' ? node : node.querySelector('button');
        if (button) {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                if (entry.id === 'reset') stopPlayback();
                for (const target of targetsFor(entry.id, true)) target.click();
                if (entry.id === 'reset') driveTime(0);
                if (entry.id === 'reseed') showToast('New seed started; cuts cleared');
                if (entry.id === 'saveState') showToast('State saved');
                if (entry.id === 'loadState') showToast('Choose a saved state file');
                if (entry.id === 'shareState') copyCanonicalLink();
                if (entry.id === 'clearCuts') showToast('Cuts cleared; undo to restore');
                if (entry.id === 'snapshot') showToast('Before state captured');
                if (entry.id === 'compare') showToast('Ghost overlay toggled');
                if (['exportSvg', 'exportPng', 'exportGlb', 'exportCsv', 'exportJson', 'exportBatch'].includes(entry.id)) {
                    showToast(`${entry.label} started`);
                }
                syncPanel();
            });
        }
    }

    // Species presets apply to both engines and remember the base preset.
    for (const entry of MANIFEST.filter((item) => item.kind === 'preset')) {
        const node = mounted.get(entry.key);
        if (!node) continue;
        node.addEventListener('click', () => {
            const preset = entry.id;
            for (const shadow of [shadow2d, shadow3d]) {
                shadow?.querySelector(`#presets button[data-preset="${preset}"]`)?.click();
            }
            if (preset !== 'custom') lastPreset = preset;
            syncPanel();
            showToast(preset === 'custom' ? 'Custom selection' : `${entry.label} applied`);
        });
    }
}

function wireAutomationButtons() {
    for (const [key, node] of mounted) {
        const entry = MANIFEST_BY_KEY.get(key);
        if (!entry) continue;
        const paramKey = (entry.kind === 'param')
            ? entry.id
            : (AUTOMATION_META && AUTOMATION_META[entry.id] ? entry.id : null);
        if (!paramKey || !AUTOMATION_META[paramKey]) continue;
        const btn = node.querySelector('.auto-btn');
        if (!btn) continue;
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openStudioAutomationEditor(btn, paramKey);
        });
    }
}

function applyStudioAutomation(auto) {
    const normalized = (typeof normalizeAutomation === 'function') ? normalizeAutomation(auto) : auto;
    if (canonical) canonical.automation = normalized;
    window.__tree2d?.applyAutomation?.(normalized);
    window.__tree3d?.applyAutomation?.(normalized);
    scheduleStateAutosave();
    syncPanel();
}

function openStudioAutomationEditor(btn, key) {
    if (!AUTOMATION_META[key]) return;
    const opts = {
        meta: AUTOMATION_META[key],
        getTrack: () => canonical?.automation?.tracks?.[key] || null,
        getTime: () => transportTime,
        getLifespan: () => lifespan,
        getValue: () => {
            const track = canonical?.automation?.tracks?.[key];
            const base = canonical?.params?.[key];
            return (track && canonical?.automation?.enabled !== false)
                ? evaluateTrack(track, transportTime, base)
                : base;
        },
        onToggleTrack: (on) => {
            const auto = normalizeAutomation(canonical?.automation);
            if (on) {
                const base = canonical?.params?.[key];
                auto.tracks[key] = normalizeTrack(key, { keys: [[transportTime, base]], interp: 'smooth', loop: 'none' });
            } else {
                delete auto.tracks[key];
            }
            applyStudioAutomation(auto);
        },
        onAddKey: (year, value) => {
            const auto = normalizeAutomation(canonical?.automation);
            if (!auto.tracks[key]) {
                auto.tracks[key] = normalizeTrack(key, { keys: [[year, value]], interp: 'smooth', loop: 'none' });
            } else {
                const track = auto.tracks[key];
                const idx = track.keys.findIndex((k) => Math.abs(k[0] - year) < 0.5);
                if (idx >= 0) track.keys[idx] = [year, value];
                else track.keys.push([year, value]);
                track.keys.sort((a, b) => a[0] - b[0]);
            }
            applyStudioAutomation(auto);
        },
        onUpdateKey: (index, year, value) => {
            const auto = normalizeAutomation(canonical?.automation);
            const track = auto.tracks[key];
            if (!track) return;
            track.keys[index] = [year, value];
            track.keys.sort((a, b) => a[0] - b[0]);
            applyStudioAutomation(auto);
        },
        onDeleteKey: (index) => {
            const auto = normalizeAutomation(canonical?.automation);
            const track = auto.tracks[key];
            if (!track) return;
            track.keys.splice(index, 1);
            if (!track.keys.length) delete auto.tracks[key];
            applyStudioAutomation(auto);
        },
        onOptions: (o) => {
            const auto = normalizeAutomation(canonical?.automation);
            const track = auto.tracks[key];
            if (!track) return;
            if (o.interp) track.interp = o.interp;
            if (o.loop) track.loop = o.loop;
            applyStudioAutomation(auto);
        },
        onClear: () => {
            const auto = normalizeAutomation(canonical?.automation);
            delete auto.tracks[key];
            applyStudioAutomation(auto);
        },
        onSeek: (year) => { driveTime(year); },
    };
    if (typeof AutomationUI !== 'undefined' && AutomationUI.openEditor) {
        AutomationUI.openEditor(btn, key, opts);
    }
}

function syncPanel() {
    if (!panelShadow || !shadow2d || !shadow3d || !mounted.size) return;

    for (const [key, node] of mounted) {
        const entry = MANIFEST_BY_KEY.get(key);
        if (!entry || entry.kind === 'display') continue;
        const source = entrySource(entry);
        if (!source) continue;

        const input = node.matches('input, select, textarea')
            ? node
            : node.querySelector('input, select, textarea');
        if (input && input.type !== 'file') {
            if (input.type === 'checkbox') {
                if (input.checked !== source.checked) input.checked = source.checked;
            } else if (input.value !== source.value) {
                input.value = source.value;
            }
            if (entry.id === 'groundDensity') input.disabled = source.disabled;
            if (entry.kind === 'param') {
                const span = node.querySelector('.ctl-value');
                if (span && span.textContent !== source.value) span.textContent = source.value;
            }
            continue;
        }

        const button = node.tagName === 'BUTTON' ? node : node.querySelector('button');
        if (button) {
            const stateSource = (entry.id === 'prune' || entry.id === 'lasso')
                ? (findInShadow(activeShadow(), entry.id) || source)
                : source;
            button.classList.toggle('active', stateSource.classList.contains('active'));
            if (button.disabled !== stateSource.disabled) button.disabled = stateSource.disabled;
            const pressed = stateSource.getAttribute('aria-pressed');
            if (pressed !== null) button.setAttribute('aria-pressed', pressed);
        }
    }

    for (const entry of MANIFEST.filter((item) => item.kind === 'preset')) {
        const node = mounted.get(entry.key);
        if (!node) continue;
        const source = shadow2d.querySelector(`#presets button[data-preset="${entry.id}"]`);
        const isActive = !!source?.classList.contains('active');
        node.classList.toggle('active', isActive);
        node.setAttribute('aria-pressed', String(isActive));
        if (isActive && entry.id !== 'custom') lastPreset = entry.id;
    }

    // Display controls and mirrors.
    const inspectorSource = findInShadow(activeShadow(), 'inspector');
    if (inspectorSource) {
        const html = inspectorSource.innerHTML;
        if (html !== lastInspectorSignature) {
            lastInspectorSignature = html;
            const target = mounted.get('inspector');
            const value = target?.querySelector('.display-value') || target;
            if (value && value.innerHTML !== html) value.innerHTML = html;
        }
        updateAnchoredInspector();
    }
    for (const id of ['analyticsBaselineLabel', 'analyticsSummary', 'seedv']) {
        const target = mounted.get(id);
        const value = target?.querySelector('.display-value') || target;
        const source = findInShadow(activeShadow(), id) || findInShadow(shadow2d, id);
        if (value && source && value.textContent !== source.textContent) value.textContent = source.textContent;
    }

    for (const [key, node] of mounted) {
        const btn = node.querySelector('.auto-btn');
        if (btn) btn.classList.toggle('on', !!canonical?.automation?.tracks?.[key]);
    }
    updateSpeciesBanner();
    updateDisabledReasons();
    updateDockReadouts();
    updateToolbar();
    updateActingChips();
    const zoomProxy = document.getElementById('autoZoom3d');
    const zoom3d = findInShadow(shadow3d, 'zoom');
    if (zoomProxy && zoom3d && zoomProxy.checked !== zoom3d.checked) {
        zoomProxy.checked = zoom3d.checked;
        prefs.autoZoom3d = zoom3d.checked;
        savePrefs();
    }
    syncCameraMenu();
}

function updateSpeciesBanner() {
    if (!customBanner) return;
    const preset = currentPreset();
    const isCustom = preset === 'custom';
    customBanner.hidden = !isCustom;
    if (isCustom) {
        const text = customBanner.querySelector('#customBannerText');
        if (text) text.textContent = `Custom · based on ${lastPreset.charAt(0).toUpperCase() + lastPreset.slice(1)}`;
    }
}

function updateDisabledReasons() {
    const isolate = mounted.get('isolate');
    const selected = window[`__tree${activePane}`]?.selectedNode ?? -1;
    if (isolate) {
        const button = isolate.tagName === 'BUTTON' ? isolate : isolate.querySelector('button');
        const disabled = selected < 0;
        if (button) {
            button.disabled = disabled;
            button.title = disabled ? 'Select a branch first.' : 'Toggle isolation of the selected branch.';
        }
    }
    const reason = panelShadow.querySelector('[data-reason-for="isolate"]');
    if (reason) reason.hidden = selected >= 0;

    const clearSelection = panelShadow?.getElementById('clearSelectionButton');
    if (clearSelection) clearSelection.disabled = selected < 0;

    const clear = mounted.get('clearCuts');
    if (clear) {
        const button = clear.tagName === 'BUTTON' ? clear : clear.querySelector('button');
        const cuts = canonical?.cuts?.length || 0;
        if (button) {
            button.disabled = cuts === 0;
            button.title = cuts === 0 ? 'There are no cuts to clear.' : 'Clear every cut; this is undoable.';
        }
    }

    for (const id of ['undoCut', 'redoCut']) {
        const node = mounted.get(id);
        const button = node?.tagName === 'BUTTON' ? node : node?.querySelector('button');
        if (button) button.title = button.disabled
            ? `No ${id === 'undoCut' ? 'undo' : 'redo'} history in the acting view.`
            : `${id === 'undoCut' ? 'Undo' : 'Redo'} the last cut in the acting view.`;
    }

    const analyticsCompareNode = mounted.get('analyticsCompare');
    const compareButton = analyticsCompareNode?.tagName === 'BUTTON' ? analyticsCompareNode : analyticsCompareNode?.querySelector('button');
    if (compareButton) {
        compareButton.title = compareButton.disabled
            ? 'Pin run A first.'
            : 'Draw run A as dashed lines over the current run.';
    }

    const plantingNote = panelShadow.getElementById('plantingNote');
    if (plantingNote) plantingNote.hidden = (canonical?.params?.trees || 1) <= 1;

    const compare = mounted.get('compare');
    if (compare) {
        const button = compare.tagName === 'BUTTON' ? compare : compare.querySelector('button');
        if (button) {
            button.title = 'Overlay the structure captured with Capture before.';
        }
    }
}

function copyCanonicalLink() {
    const state = canonical || window.__tree2d?.captureState();
    if (!state) return;
    const link = treeShareUrl(window.location, state);
    const write = navigator.clipboard?.writeText
        ? navigator.clipboard.writeText(link)
        : Promise.reject(new Error('Clipboard unavailable'));
    write.then(
        () => showToast('Share link copied'),
        () => {
            window.prompt('Copy this share link:', link);
            showToast('Share link ready to copy');
        }
    );
}

/* ==========================================================================
   Modes, layout, active pane
   ========================================================================== */

function savePrefs() {
    prefs.mode = mode;
    prefs.flyoutOpen = panelOpen;
    prefs.layout = layout;
    prefs.activePane = activePane;
    prefs.studyOpen = studyOpen;
    prefs.studyHeight = studyHeight;
    prefs.record = recordSettings;
    saveUiPrefs(prefs);
}

function isPhone() {
    return window.innerWidth <= 800;
}

function isDrawerMobile() {
    return window.innerWidth <= 1100;
}

function updateModePanelVisibility() {
    if (!panelShadow) return;
    for (const panel of panelShadow.querySelectorAll('.mode-panel')) {
        panel.hidden = panel.dataset.mode !== mode;
    }
    const meta = STUDIO_MODES.find((item) => item.id === mode);
    $('panelTitle').textContent = meta?.label || 'Controls';
    $('panelQuestion').textContent = meta?.question || '';
    document.body.dataset.mode = mode;
    document.body.classList.remove('mode-grow', 'mode-sculpt', 'mode-study', 'mode-deliver');
    document.body.classList.add(`mode-${mode}`);

    for (const button of modeRail.querySelectorAll('[data-mode]')) {
        const active = button.dataset.mode === mode;
        button.setAttribute('aria-selected', String(active));
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
        button.tabIndex = active ? 0 : -1;
    }

    applyStudyState();
    updateActingChips();
    updateSculptChrome();
}

function setMode(nextMode, { openFlyout = true } = {}) {
    if (!STUDIO_MODES.some((item) => item.id === nextMode)) return;
    mode = nextMode;
    if (mode === 'study') studyOpen = true;
    updateModePanelVisibility();
    applySelectionPolicy();
    if (openFlyout) setPanelOpen(true);
    if (isPhone()) setSheetState('half');
    savePrefs();
}

function setPaneSuspended(dimension, suspended) {
    const bridge = dimension === '3d' ? window.__tree3d : window.__tree2d;
    const wasSuspended = suspendedPanes.has(dimension);
    if (suspended) {
        const hadPendingState = pendingLocalState.has(dimension);
        suspendedPanes.add(dimension);
        pendingLocalState.delete(dimension);
        if (!wasSuspended && !booting && hadPendingState) {
            try {
                bridge?.flushState?.();
            } catch (error) {
                console.warn(`Could not flush the ${dimension} view before suspending it:`, error);
            }
        }
        bridge?.setVisible?.(false);
        return;
    }
    if (!wasSuspended) return;
    suspendedPanes.delete(dimension);
    pendingLocalState.delete(dimension);
    if (canonical) {
        try {
            bridge?.restoreState?.(canonical);
        } catch (error) {
            console.warn(`Could not refresh the suspended ${dimension} view:`, error);
        }
    }
    bridge?.setVisible?.(true);
}

/** Whether a pane is actually on screen, accounting for focus and phone layouts. */
function paneIsShown(dimension) {
    if (layout === '3d') return dimension === '3d';
    if (layout === '2d') return dimension === '2d';
    if (isPhone()) return dimension === activePane;
    return true;
}

function syncPaneVisibility() {
    setPaneSuspended('2d', !paneIsShown('2d'));
    setPaneSuspended('3d', !paneIsShown('3d'));
}

function setLayout(nextLayout, { fromUser = true } = {}) {
    if (!['split', '2d', '3d'].includes(nextLayout)) return;
    layout = nextLayout;
    document.body.classList.remove('layout-split', 'layout-2d', 'layout-3d');
    document.body.classList.add(`layout-${layout}`);
    for (const button of document.querySelectorAll('[data-layout]')) {
        button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
    }
    if (layout === '2d') activePane = '2d';
    if (layout === '3d') activePane = '3d';
    syncPaneVisibility();
    updateActivePaneChrome();
    if (isPhone()) {
        document.body.classList.remove('mobile-pane-2d', 'mobile-pane-3d');
        document.body.classList.add(`mobile-pane-${activePane}`);
    }
    resizeViewsSoon();
    if (fromUser) savePrefs();
}

function setActivePane(dimension, { silent = false } = {}) {
    const previousPane = activePane;
    let next = dimension === '3d' ? '3d' : '2d';
    if (layout === '2d') next = '2d';
    if (layout === '3d') next = '3d';
    activePane = next;
    updateActivePaneChrome();
    if (isPhone()) {
        document.body.classList.remove('mobile-pane-2d', 'mobile-pane-3d');
        document.body.classList.add(`mobile-pane-${activePane}`);
    }
    syncPaneVisibility();
    window.__TREE_ACTIVE_PANE__ = activePane;
    if (!silent) {
        if (previousPane !== activePane) {
            clearSelectionIn(previousPane);
            lastInspectorSignature = '';
        }
        updateAnchoredInspector();
        syncPanel();
    }
    if (!booting) savePrefs();
}

function updateActivePaneChrome() {
    for (const [name, pane] of Object.entries(paneElements)) {
        if (pane) pane.classList.toggle('active', name === activePane);
    }
    if (activeViewEl) activeViewEl.textContent = `Acting view: ${activePane.toUpperCase()}`;
    for (const button of document.querySelectorAll('[data-mobile-pane]')) {
        button.setAttribute('aria-pressed', String(button.dataset.mobilePane === activePane));
    }
    updateActingChips();
}

function updateActingChips() {
    const chip = $('actingOnChip');
    if (chip) {
        const visible = ['sculpt', 'study'].includes(mode)
            || (mode === 'deliver' && deliverTab === 'export');
        chip.hidden = !visible;
        chip.textContent = `Acting on: ${activePane.toUpperCase()}`;
    }
    const sculpt = $('sculptActingChip');
    if (sculpt) sculpt.textContent = `Acting on: ${activePane.toUpperCase()}`;
}

function updateSculptChrome() {
    const toolbar = $('sculptToolbar');
    if (toolbar) toolbar.hidden = mode !== 'sculpt';
    const hint = $('canvasHintStrip');
    const active = activeShadow();
    const prune = active?.querySelector('#prune')?.classList.contains('active');
    const lasso = active?.querySelector('#lasso')?.classList.contains('active');
    if (!prune && !lasso) {
        if (hint) hint.hidden = true;
        return;
    }
    if (hint) {
        hint.hidden = false;
        hint.textContent = prune
            ? 'Prune mode · click a branch · hover to preview · Esc to exit'
            : 'Lasso mode · drag around branch roots · Esc to exit';
    }
}

function applyPanelState() {
    const modal = panelOpen && (isPhone() ? sheetState === 'full' : isDrawerMobile());
    document.body.classList.toggle('panel-open', panelOpen);
    document.body.classList.toggle('panel-collapsed', !panelOpen);
    document.body.classList.toggle('panel-modal', modal);
    document.body.classList.toggle('sheet', isPhone());

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
    if (modeRail) modeRail.inert = modal;
    if (transportDock) transportDock.inert = modal;
    const drawer = $('studyDrawer');
    if (drawer) drawer.inert = modal;
    const collapse = $('panelCollapse');
    if (collapse) collapse.setAttribute('aria-expanded', String(panelOpen));
}

function setPanelOpen(nextOpen, { restoreFocus = true, returnFocus = null } = {}) {
    const wasOpen = panelOpen;
    const mobile = isDrawerMobile();
    if (nextOpen && mobile) {
        const active = document.activeElement;
        panelReturnFocus = returnFocus
            || (active && active !== document.body ? active : document.querySelector(`[data-mode="${mode}"]`));
    }
    panelOpen = !!nextOpen;
    applyPanelState();
    if (panelOpen && mobile) {
        focusPanel();
    } else if (wasOpen && mobile && restoreFocus) {
        const target = panelReturnFocus || document.querySelector(`#modeRail [data-mode="${mode}"]`);
        panelReturnFocus = null;
        if (target && target.isConnected && typeof target.focus === 'function') {
            requestAnimationFrame(() => target.focus());
        }
    }
    savePrefs();
}

function togglePanel() {
    setPanelOpen(!panelOpen, { returnFocus: document.querySelector(`[data-mode="${mode}"]`) });
}

function panelFocusables() {
    const list = [];
    const headerButtons = controlPanelEl?.querySelectorAll('button');
    if (headerButtons) {
        for (const element of headerButtons) {
            if (!element.disabled && element.getClientRects().length) list.push(element);
        }
    }
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

function trapPanelFocus(event) {
    if (event.key !== 'Tab') return;
    const modal = panelOpen && (isPhone() ? sheetState === 'full' : isDrawerMobile());
    if (!modal) return;
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
    if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
    }
}

function setSheetState(next) {
    if (!['peek', 'half', 'full'].includes(next)) return;
    sheetState = next;
    document.body.classList.remove('sheet-peek', 'sheet-half', 'sheet-full');
    document.body.classList.add(`sheet-${next}`);
    for (const button of document.querySelectorAll('[data-snap]')) {
        button.setAttribute('aria-pressed', String(button.dataset.snap === next));
    }
    if (next === 'full') {
        document.body.classList.add('panel-open');
        panelOpen = true;
    }
    applyPanelState();
    if (next === 'full') focusPanel();
    savePrefs();
}

/* ==========================================================================
   Dock and transport
   ========================================================================== */

function syncTransportFromState() {
    if (!canonical) return;
    const now = performance.now();
    const stateLifespan = Number(canonical.params?.lifespan) || 300;
    const stateSpeed = Number(canonical.params?.speed) || 2.5;
    if (now < lifespanOverrideUntil && stateLifespan !== lifespan) {
        // Keep the dock's local edit while an older in-flight state message lands.
    } else {
        lifespan = stateLifespan;
        if (stateLifespan === lifespan) lifespanOverrideUntil = 0;
    }
    if (now < speedOverrideUntil && stateSpeed !== speed) {
        // Keep the local speed edit.
    } else {
        speed = stateSpeed;
        if (stateSpeed === speed) speedOverrideUntil = 0;
    }
    transportTime = Math.min(lifespan + 1, Math.max(0, Number(canonical.time) || 0));

    timeSlider.max = String(lifespan + 1);
    timeSlider.value = String(transportTime);
    updateDockReadouts();
    const scrubKey = `${lifespan}|${canonical.seasonAuto ? 'auto' : canonical.season}`;
    if (scrubKey !== lastScrubKey) {
        lastScrubKey = scrubKey;
        updateScrubDecor();
    }
}

function driveTime(nextTime, { updateState = true } = {}) {
    transportTime = Math.min(lifespan + 1, Math.max(0, nextTime));
    if (updateState && canonical) canonical.time = transportTime;
    timeSlider.value = String(transportTime);
    if (window.__tree2d && !suspendedPanes.has('2d')) window.__tree2d.setTime(transportTime);
    if (window.__tree3d && !suspendedPanes.has('3d')) window.__tree3d.setTime(transportTime);
    updateDockReadouts();
    if (studyOpen && mode === 'study') drawStudyChart();
}

function stopPlayback({ resetButton = true } = {}) {
    playing = false;
    if (playTimer) {
        clearInterval(playTimer);
        playTimer = 0;
    }
    if (resetButton) updatePlayButton();
}

function updatePlayButton() {
    if (!playButton) return;
    playButton.innerHTML = playing ? `${ICONS.pause}<span>Pause</span>` : `${ICONS.play}<span>Play</span>`;
    playButton.classList.toggle('active', playing);
    playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function startPlayback() {
    stopPlayback({ resetButton: false });
    if (transportTime >= lifespan + 1) driveTime(0);
    playing = true;
    updatePlayButton();
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

function stepTime(direction, amount = 1) {
    stopPlayback();
    driveTime(transportTime + direction * amount);
}

function updateDockReadouts() {
    if (ageInput && document.activeElement !== ageInput) ageInput.value = transportTime.toFixed(1);
    if (ageInput) ageInput.max = String(lifespan + 1);
    const stage = $('scrubStage');
    if (stage) stage.textContent = stageName(transportTime);
    const history = $('historyLabel');
    if (history) history.textContent = `${transportTime.toFixed(1)} yr`;
    const lived = $('lifespanReadout');
    if (lived) lived.textContent = String(lifespan);
    const speedEl = $('speedReadout');
    if (speedEl) speedEl.textContent = Number(speed).toFixed(1);
    const season = $('seasonReadout');
    if (season) {
        const value = canonical?.seasonAuto
            ? (transportTime % 4) / 4
            : (canonical?.season ?? window.__tree2d?.season ?? 0.33);
        season.textContent = seasonName(value);
    }
    const headerSeed = $('headerSeed');
    const projectSeed = $('projectSeed');
    const seed = canonical?.seed ?? window.__tree2d?.seed ?? '—';
    if (headerSeed) headerSeed.textContent = seed;
    if (projectSeed) projectSeed.textContent = seed;

    timeSlider.setAttribute('aria-valuenow', String(Math.round(transportTime)));
    timeSlider.setAttribute('aria-valuetext', `Year ${transportTime.toFixed(1)}`);
}

function seasonColorAt(value) {
    if (typeof phenologyAt === 'function') {
        try {
            const phenology = phenologyAt(value, canonical?.params?.phenology);
            if (phenology) {
                return `hsl(${Math.round(phenology.hue)} ${Math.round(phenology.sat)}% ${Math.round(phenology.light)}%)`;
            }
        } catch {
            // Fall through to the neutral season palette.
        }
    }
    const s = ((value % 1) + 1) % 1;
    const stops = [
        { at: 0.0, color: [190, 214, 166] },
        { at: 0.18, color: [124, 166, 92] },
        { at: 0.5, color: [111, 145, 74] },
        { at: 0.68, color: [196, 138, 58] },
        { at: 0.84, color: [154, 140, 122] },
        { at: 1.0, color: [190, 214, 166] },
    ];
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (s >= a.at && s <= b.at) {
            const t = (s - a.at) / Math.max(1e-6, b.at - a.at);
            const rgb = a.color.map((v, index) => Math.round(v + (b.color[index] - v) * t));
            return `rgb(${rgb.join(',')})`;
        }
    }
    return 'rgb(111,145,74)';
}

function updateScrubDecor() {
    const band = $('seasonBand');
    if (band) {
        const samples = 18;
        const stops = [];
        const auto = !!canonical?.seasonAuto;
        const fixed = canonical?.season ?? 0.33;
        for (let i = 0; i <= samples; i++) {
            const year = (i / samples) * lifespan;
            const season = auto ? (year % 4) / 4 : fixed;
            stops.push(`${seasonColorAt(season)} ${(i / samples) * 100}%`);
        }
        band.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    }
    const labels = $('scrubLabels');
    if (labels) {
        labels.innerHTML = '';
        const marks = [
            { at: 1, label: 'Seedling', row: 0 },
            { at: 5, label: 'Sapling', row: 1 },
            { at: 20, label: 'Young', row: 0 },
            { at: 80, label: 'Mature', row: 0 },
        ];
        const trackWidth = timeSlider?.clientWidth || 600;
        const rowRight = [-Infinity, -Infinity];
        for (const mark of marks) {
            if (mark.at >= lifespan) continue;
            const leftPx = (mark.at / lifespan) * trackWidth;
            const halfWidth = (mark.label.length * 5) / 2;
            if (leftPx - halfWidth < rowRight[mark.row] + 8) continue;
            const span = document.createElement('span');
            span.className = 'scrub-label';
            span.style.left = `${(mark.at / lifespan) * 100}%`;
            span.style.top = `${mark.row * 9}px`;
            span.textContent = mark.label;
            labels.appendChild(span);
            rowRight[mark.row] = leftPx + halfWidth;
        }
    }
}

function resizeViewsSoon() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            window.dispatchEvent(new Event('resize'));
            if (!suspendedPanes.has('2d')) window.__tree2d?.resize?.();
            if (!suspendedPanes.has('3d')) window.__tree3d?.resize?.();
        });
    });
}

/* ==========================================================================
   Simulating feedback
   ========================================================================== */

function beginSimulating(dimension) {
    pendingSimCount += 1;
    simStartAt = performance.now();
    if (simEndTimer) clearTimeout(simEndTimer);
    const chip = $('syncChip');
    const sliver = $('syncSliver');
    if (chip) {
        chip.textContent = 'Simulating…';
        chip.classList.add('simulating');
    }
    if (sliver) sliver.hidden = false;
    document.body.classList.add('simulating');
}

function endSimulating(dimension) {
    pendingSimCount = Math.max(0, pendingSimCount - 1);
    if (pendingSimCount > 0) return;
    const duration = performance.now() - simStartAt;
    if (simEndTimer) clearTimeout(simEndTimer);
    const finish = () => {
        const chip = $('syncChip');
        const sliver = $('syncSliver');
        if (chip) {
            chip.textContent = 'Synced';
            chip.classList.remove('simulating');
        }
        if (sliver) sliver.hidden = true;
        document.body.classList.remove('simulating');
        for (const pane of Object.values(paneElements)) pane?.classList.remove('simulating');
        setStatus('Synced');
        syncPanel();
    };
    if (duration > 300) {
        for (const pane of Object.values(paneElements)) pane?.classList.add('simulating');
        setStatus('Simulating…');
        const delay = 260;
        simEndTimer = setTimeout(() => {
            simEndTimer = 0;
            finish();
        }, delay);
    } else {
        finish();
    }
}

window.addEventListener('tree-simulate-start', (event) => beginSimulating(event.detail?.dimension));
window.addEventListener('tree-simulate-end', (event) => endSimulating(event.detail?.dimension));

/* ==========================================================================
   Study drawer
   ========================================================================== */

const METRICS = {
    biomass: { label: 'Biomass', unit: '', color: '#0072B2', key: 'biomass' },
    height: { label: 'Height', unit: 'm', color: '#56B4E9', key: 'height', scale: 0.1 },
    crownWidth: { label: 'Crown', unit: 'm', color: '#CC79A7', key: 'crownWidth', scale: 0.1 },
    leafArea: { label: 'Leaf area', unit: '', color: '#009E73', key: 'leafArea', scale: 0.01 },
    light: { label: 'Light', unit: '%', color: '#E69F00', key: 'light', scale: 100 },
    tips: { label: 'Tips / shed', unit: '', color: '#009E73', key: 'tips', secondary: 'shed', secondaryColor: '#D55E00' },
    leafLight: { label: 'Leaf light', unit: '%', color: '#AA3377', key: 'leafLight', scale: 100 },
};

function metricValue(metric, point) {
    const def = METRICS[metric];
    if (!def || !point) return NaN;
    const value = point[def.key];
    return Number.isFinite(value) ? value * (def.scale || 1) : NaN;
}

function metricRange(metric, pointSets) {
    let max = 0;
    let min = 0;
    for (const points of pointSets) {
        for (const point of points || []) {
            const value = metricValue(metric, point);
            if (Number.isFinite(value)) max = Math.max(max, value);
            if (Number.isFinite(value)) min = Math.min(min, value);
            if (METRICS[metric]?.secondary) {
                const secondary = point[METRICS[metric].secondary];
                if (Number.isFinite(secondary)) max = Math.max(max, secondary);
            }
        }
    }
    return { min: Math.min(0, min), max: max || 1 };
}

function formatMetric(metric, value) {
    if (!Number.isFinite(value)) return '—';
    const def = METRICS[metric];
    if (def?.unit === '%') return `${value.toFixed(1)}%`;
    if (def?.unit === 'm') return `${value.toFixed(1)} m`;
    if (Math.abs(value) >= 10000) return `${(value / 1000).toFixed(1)}k`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}k`;
    if (Math.abs(value) >= 100) return value.toFixed(0);
    if (Math.abs(value) < 0.005) return '0';
    return value.toFixed(2);
}

function sourceAnalytics() {
    const two = window.__tree2d?.analytics || null;
    const three = window.__tree3d?.analytics || null;
    if (studySource === '3d') return { sets: [{ source: '3D', analytics: three, color: '#0072B2' }] };
    if (studySource === 'both') {
        return {
            sets: [
                { source: '2D', analytics: two, color: '#0072B2' },
                { source: '3D', analytics: three, color: '#D55E00' },
            ],
        };
    }
    return { sets: [{ source: '2D', analytics: two, color: '#0072B2' }] };
}

function baselineForSource() {
    const state = activeShadow() === shadow3d
        ? window.__tree3d?.captureState()
        : window.__tree2d?.captureState();
    if (!state?.compare?.enabled || !state.compare.baseline?.points?.length) return null;
    return state.compare.baseline;
}

function applyStudyState() {
    const visible = mode === 'study' && studyOpen;
    const drawer = $('studyDrawer');
    if (drawer) {
        drawer.hidden = !visible;
        drawer.style.height = `${studyHeight}px`;
    }
    if (visible) {
        renderMetricChips();
        drawStudyChart();
        renderDataTable();
    }
    for (const button of document.querySelectorAll('[data-source]')) {
        button.setAttribute('aria-pressed', String(button.dataset.source === studySource));
    }
    const label = $('studySourceLabel');
    if (label) label.textContent = studySource === 'both' ? '2D + 3D' : studySource.toUpperCase();
    const toggle = panelShadow?.getElementById('studyShowToggle');
    if (toggle) toggle.textContent = studyOpen ? 'Hide Study drawer' : 'Show Study drawer';
}

function renderMetricChips() {
    const holder = $('metricChips');
    if (!holder) return;
    holder.innerHTML = '';
    for (const [key, def] of Object.entries(METRICS)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'metric-chip';
        button.dataset.metric = key;
        button.setAttribute('aria-pressed', String(studyMetrics.includes(key)));
        button.textContent = def.label;
        button.addEventListener('click', () => {
            if (studyMetrics.includes(key)) {
                if (studyMetrics.length === 1) return;
                studyMetrics = studyMetrics.filter((item) => item !== key);
            } else {
                studyMetrics.push(key);
            }
            renderMetricChips();
            drawStudyChart();
            renderDataTable();
        });
        holder.appendChild(button);
    }
}

function chartYearAt(event, rect, left, right, chartLifespan) {
    const x = event.clientX - rect.left;
    return clamp(((x - left) / Math.max(1, rect.width - left - right)) * chartLifespan, 0, chartLifespan);
}

function drawStudyChart() {
    if (!studyOpen || mode !== 'study') return;
    const canvas = $('studyChart');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, rect.width || 600);
    const height = canvas.parentElement?.clientHeight || 150;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);

    const left = 48;
    const right = 10;
    const top = 12;
    const bottom = 20;
    const chartW = Math.max(1, width - left - right);
    const chartH = Math.max(1, height - top - bottom);

    const { sets } = sourceAnalytics();
    const active = sets.find((set) => set.analytics?.points?.length) || sets[0];
    const points = active?.analytics?.points || [];
    const chartLifespan = active?.analytics?.lifespan || lifespan || 300;
    const baseline = baselineForSource();
    const metric = studyMetrics[0] || 'biomass';
    const range = metricRange(metric, [points, baseline?.points || []]);

    // Season band across the top.
    const seasonStops = [];
    const auto = !!canonical?.seasonAuto;
    const fixed = canonical?.season ?? 0.33;
    for (let i = 0; i <= 16; i++) {
        const year = (i / 16) * chartLifespan;
        seasonStops.push(`${seasonColorAt(auto ? (year % 4) / 4 : fixed)} ${(i / 16) * 100}%`);
    }
    const grad = g.createLinearGradient(left, 0, left + chartW, 0);
    // Canvas gradients cannot take multi-stop CSS strings directly; sample.
    for (let i = 0; i <= 16; i++) {
        const year = (i / 16) * chartLifespan;
        grad.addColorStop(i / 16, seasonColorAt(auto ? (year % 4) / 4 : fixed));
    }
    g.fillStyle = grad;
    g.fillRect(left, top, chartW, 8);

    const dark = document.documentElement.dataset.theme === 'dark';
    const grid = dark ? 'rgba(220,225,215,0.22)' : 'rgba(55,65,55,0.16)';
    const label = dark ? 'rgba(230,235,225,0.92)' : 'rgba(45,55,45,0.88)';
    g.font = '10px system-ui, sans-serif';
    g.textBaseline = 'middle';

    // Axes and ticks.
    g.strokeStyle = grid;
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = top + 14 + (chartH - 14) * (i / 4);
        g.beginPath();
        g.moveTo(left, y);
        g.lineTo(left + chartW, y);
        g.stroke();
        const value = range.max - (range.max - range.min) * (i / 4);
        g.fillStyle = label;
        g.fillText(formatMetric(metric, value), 3, y);
    }
    for (let i = 0; i <= 4; i++) {
        const x = left + chartW * (i / 4);
        g.fillStyle = label;
        g.fillText(`${Math.round((i / 4) * chartLifespan)}y`, x - (i === 4 ? 14 : 2), height - 7);
    }

    const yearToX = (year) => left + (year / chartLifespan) * chartW;
    const valueToY = (value) => {
        const t = (value - range.min) / Math.max(1e-6, range.max - range.min);
        return top + 14 + (chartH - 14) * (1 - t);
    };

    const drawLine = (items, color, dashed = false, scale = true) => {
        if (!items?.length) return;
        g.save();
        g.strokeStyle = color;
        g.lineWidth = dashed ? 1.2 : 1.8;
        if (dashed) g.setLineDash([4, 3]);
        g.beginPath();
        let started = false;
        for (const point of items) {
            const value = metricValue(metric, point);
            if (!Number.isFinite(value)) continue;
            const x = yearToX(point.year);
            const y = valueToY(value);
            if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
        }
        g.stroke();
        g.restore();
    };

    if (!sets.some((set) => set.analytics?.points?.length)) {
        g.fillStyle = label;
        g.font = '12px system-ui, sans-serif';
        g.fillText('Waiting for the simulation…', left + 10, top + chartH * 0.45);
        updateChartAria(chartLifespan);
        return;
    }

    if (baseline) drawLine(baseline.points, '#687064', true);
    for (const set of sets) {
        if (!set.analytics?.points?.length) continue;
        drawLine(set.analytics.points, set.color || '#0072B2', false);
        const def = METRICS[metric];
        if (def?.secondary) {
            // Draw the secondary shed series with the same scale.
            g.save();
            g.strokeStyle = def.secondaryColor;
            g.lineWidth = 1.1;
            g.setLineDash([3, 3]);
            g.beginPath();
            let started = false;
            for (const point of set.analytics.points) {
                const value = point[def.secondary];
                if (!Number.isFinite(value)) continue;
                const x = yearToX(point.year);
                const y = valueToY(value);
                if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
            }
            g.stroke();
            g.restore();
        }
    }

    // Playhead.
    const px = yearToX(Math.min(transportTime, chartLifespan));
    g.strokeStyle = 'rgba(60,120,220,0.8)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(px, top);
    g.lineTo(px, top + chartH);
    g.stroke();

    // Hover readout.
    if (studyHover != null) {
        const hoverYear = studyHover;
        const x = yearToX(hoverYear);
        g.strokeStyle = 'rgba(60,120,220,0.45)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, top);
        g.lineTo(x, top + chartH);
        g.stroke();
        const point = nearestPoint(points, hoverYear);
        if (point) {
            const value = metricValue(metric, point);
            const text = `Year ${hoverYear.toFixed(1)} · ${formatMetric(metric, value)}`;
            g.font = '11px system-ui, sans-serif';
            const boxW = g.measureText(text).width + 14;
            g.fillStyle = dark ? 'rgba(20,24,20,0.94)' : 'rgba(255,253,248,0.97)';
            g.strokeStyle = grid;
            const bx = Math.min(left + chartW - boxW, Math.max(left, x + 8));
            const by = top + 18;
            g.fillRect(bx, by, boxW, 22);
            g.strokeRect(bx + 0.5, by + 0.5, boxW - 1, 21);
            g.fillStyle = label;
            g.fillText(text, bx + 7, by + 11);
        }
    }

    // Legend when both sources or a baseline is visible.
    g.font = '9px system-ui, sans-serif';
    g.fillStyle = label;
    let legendX = left + 4;
    if (studySource === 'both') {
        for (const set of sets) {
            g.fillStyle = set.color;
            g.fillRect(legendX, top + chartH + 4, 10, 3);
            g.fillStyle = label;
            g.fillText(set.source, legendX + 14, top + chartH + 6);
            legendX += 40;
        }
    }
    if (baseline) {
        g.fillStyle = label;
        g.fillText('solid current · dashed run A', left + chartW - 150, top + chartH + 6);
    }

    updateChartAria(chartLifespan);
    drawSparklines(chartLifespan, baseline);
}

function nearestPoint(points, year) {
    if (!points?.length) return null;
    let best = points[0];
    let distance = Math.abs(best.year - year);
    for (const point of points) {
        const d = Math.abs(point.year - year);
        if (d < distance) { best = point; distance = d; }
    }
    return best;
}

function updateChartAria(chartLifespan) {
    const canvas = $('studyChart');
    if (!canvas) return;
    canvas.setAttribute('aria-valuemin', '0');
    canvas.setAttribute('aria-valuemax', String(Math.round(chartLifespan)));
    canvas.setAttribute('aria-valuenow', String(Math.round(transportTime)));
    canvas.setAttribute('aria-valuetext', `Year ${transportTime.toFixed(1)}, ${METRICS[studyMetrics[0]]?.label || 'Biomass'}`);
}

function drawSparklines(chartLifespan, baseline) {
    const holder = $('studySparklines');
    if (!holder) return;
    const metrics = studyMetrics.slice(1);
    const { sets } = sourceAnalytics();
    if (!metrics.length) {
        holder.innerHTML = '';
        return;
    }
    holder.innerHTML = '';
    for (const metric of metrics) {
        const card = document.createElement('div');
        card.className = 'sparkline-card';
        const canvas = document.createElement('canvas');
        const caption = document.createElement('span');
        caption.textContent = METRICS[metric].label;
        card.append(canvas, caption);
        holder.appendChild(card);
        const width = card.clientWidth || 220;
        const height = 28;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        const g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const range = metricRange(metric, sets.map((set) => set.analytics?.points || []));
        const plot = (items, color, dashed = false) => {
            if (!items?.length) return;
            g.save();
            g.strokeStyle = color;
            g.lineWidth = dashed ? 1 : 1.5;
            if (dashed) g.setLineDash([3, 2]);
            g.beginPath();
            let started = false;
            for (const point of items) {
                const value = metricValue(metric, point);
                if (!Number.isFinite(value)) continue;
                const x = (point.year / chartLifespan) * width;
                const y = height - 2 - ((value - range.min) / Math.max(1e-6, range.max - range.min)) * (height - 4);
                if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
            }
            g.stroke();
            g.restore();
        };
        if (baseline) plot(baseline.points, '#687064', true);
        for (const set of sets) plot(set.analytics?.points || [], set.color || '#0072B2');
        // Playhead.
        g.strokeStyle = 'rgba(60,120,220,0.55)';
        const px = (Math.min(transportTime, chartLifespan) / chartLifespan) * width;
        g.beginPath(); g.moveTo(px, 0); g.lineTo(px, height); g.stroke();
    }
}

function renderDataTable() {
    const holder = $('studyDataTable');
    if (!holder || holder.hidden) return;
    const { sets } = sourceAnalytics();
    const points = sets.find((set) => set.analytics?.points?.length)?.analytics?.points || [];
    if (!points.length) {
        holder.innerHTML = '<p class="study-footnote">No analytics yet.</p>';
        return;
    }
    const lifespanMax = Math.max(...points.map((point) => point.year), 1);
    const stepYears = Math.max(1, Math.round(lifespanMax / 12));
    const rows = points.filter((point) => Math.round(point.year) % stepYears === 0);
    const metrics = studyMetrics;
    const head = `<tr><th>Year</th>${metrics.map((metric) => `<th>${escapeHtml(METRICS[metric].label)}${METRICS[metric].unit ? ` (${METRICS[metric].unit})` : ''}</th>`).join('')}</tr>`;
    const body = rows.map((point) => `<tr><td>${point.year.toFixed(1)}</td>${metrics.map((metric) => `<td>${escapeHtml(formatMetric(metric, metricValue(metric, point)))}</td>`).join('')}</tr>`).join('');
    holder.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function bindStudyDrawer() {
    const canvas = $('studyChart');
    if (canvas) {
        canvas.addEventListener('mousemove', (event) => {
            const rect = canvas.getBoundingClientRect();
            const { sets } = sourceAnalytics();
            const chartLifespan = sets.find((set) => set.analytics?.points?.length)?.analytics?.lifespan || lifespan;
            studyHover = chartYearAt(event, rect, 48, 10, chartLifespan);
            drawStudyChart();
        });
        canvas.addEventListener('mouseleave', () => {
            studyHover = null;
            drawStudyChart();
        });
        canvas.addEventListener('click', (event) => {
            const rect = canvas.getBoundingClientRect();
            const { sets } = sourceAnalytics();
            const chartLifespan = sets.find((set) => set.analytics?.points?.length)?.analytics?.lifespan || lifespan;
            stopPlayback();
            driveTime(chartYearAt(event, rect, 48, 10, chartLifespan));
        });
        canvas.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            stopPlayback();
            const step = event.shiftKey ? 10 : 1;
            driveTime(transportTime + (event.key === 'ArrowRight' ? step : -step));
        });
    }
    for (const button of document.querySelectorAll('[data-source]')) {
        button.addEventListener('click', () => {
            studySource = button.dataset.source;
            applyStudyState();
        });
    }
    $('studyDataToggle')?.addEventListener('click', () => {
        const table = $('studyDataTable');
        const button = $('studyDataToggle');
        if (!table) return;
        table.hidden = !table.hidden;
        button.setAttribute('aria-expanded', String(!table.hidden));
        if (!table.hidden) renderDataTable();
    });
    $('studyCollapse')?.addEventListener('click', () => {
        studyOpen = false;
        applyStudyState();
        savePrefs();
    });
    const resize = $('studyResize');
    if (resize) {
        let startY = 0;
        let startHeight = 0;
        const move = (event) => {
            const dy = startY - event.clientY;
            studyHeight = Math.round(clamp(startHeight + dy, 160, 480));
            const drawer = $('studyDrawer');
            if (drawer) drawer.style.height = `${studyHeight}px`;
            drawStudyChart();
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            savePrefs();
        };
        resize.addEventListener('pointerdown', (event) => {
            startY = event.clientY;
            startHeight = studyHeight;
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
        resize.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            studyHeight = Math.round(clamp(studyHeight + (event.key === 'ArrowUp' ? 20 : -20), 160, 480));
            const drawer = $('studyDrawer');
            if (drawer) drawer.style.height = `${studyHeight}px`;
            drawStudyChart();
            savePrefs();
        });
    }
}

/* ==========================================================================
   Scaffolding: view menus, sculpt toolbar, anchored inspector, sheet
   ========================================================================== */

function fillIcons() {
    for (const button of modeRail.querySelectorAll('[data-mode]')) {
        button.querySelector('.mode-icon').innerHTML = modeIcon(button.dataset.mode);
    }
    if (playButton) playButton.innerHTML = `${ICONS.play}<span>Play</span>`;
    if ($('stepBack')) $('stepBack').innerHTML = ICONS.stepBack;
    if ($('stepForward')) $('stepForward').innerHTML = ICONS.stepForward;
    if ($('restart')) $('restart').innerHTML = ICONS.rewind;
    if ($('searchButton')) $('searchButton').querySelector('.search-icon').innerHTML = ICONS.search;
    const hint = $('helpButton');
    if (hint) hint.innerHTML = ICONS.help;
}

function buildViewMenuProxies() {
    const slot = document.querySelector('[data-slot="view-3d"]');
    if (!slot || slot.querySelector('#autoZoom3d')) return;
    const label = document.createElement('label');
    label.className = 'view-proxy-row';
    label.innerHTML = '<input type="checkbox" id="autoZoom3d"> Auto-zoom (3D)';
    const input = label.querySelector('input');
    input.checked = prefs.autoZoom3d !== false;
    input.addEventListener('change', () => {
        const target = findInShadow(shadow3d, 'zoom');
        if (target) {
            target.checked = input.checked;
            target.dispatchEvent(new Event('change', { bubbles: true }));
        }
        prefs.autoZoom3d = input.checked;
        savePrefs();
    });
    slot.appendChild(label);
}

function applyAutoZoomPrefs() {
    const two = findInShadow(shadow2d, 'zoom');
    if (two) {
        two.checked = prefs.autoZoom2d !== false;
        two.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const three = findInShadow(shadow3d, 'zoom');
    if (three) {
        three.checked = prefs.autoZoom3d !== false;
        three.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const proxy = document.getElementById('autoZoom3d');
    if (proxy) proxy.checked = prefs.autoZoom3d !== false;
}

let cameraMenu = null;

function cameraBridge() {
    return window.__tree3d;
}

function cameraInputValue(input) {
    const raw = input?.value?.trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function cameraVec(ids) {
    const values = ids.map((id) => cameraInputValue(document.getElementById(id)));
    return values.every((value) => value !== null) ? values : null;
}

function applyCameraPatch(patch) {
    const bridge = cameraBridge();
    if (!bridge?.setCameraSettings) return;
    bridge.setCameraSettings(patch);
    syncCameraMenu();
}

function buildCameraMenu() {
    const slot = document.querySelector('[data-slot="view-3d"]');
    if (!slot || slot.querySelector('#cameraMenu')) return;

    const details = document.createElement('details');
    details.className = 'view-menu-sub';
    details.id = 'cameraMenu';
    details.innerHTML = `
        <summary>Camera</summary>
        <div class="camera-menu-body">
            <div class="camera-row">
                <span>Position</span>
                <input type="number" id="camPosX" step="0.1" aria-label="Camera X">
                <input type="number" id="camPosY" step="0.1" aria-label="Camera Y">
                <input type="number" id="camPosZ" step="0.1" aria-label="Camera Z">
            </div>
            <div class="camera-row camera-row-fov">
                <span>FOV</span>
                <input type="number" id="camFov" min="15" max="120" step="1" aria-label="Camera field of view">
            </div>
            <label class="camera-check" title="Keep the camera above ground and within orbit distance limits"><input type="checkbox" id="camLimits"> Camera limits</label>
            <div class="camera-row">
                <span>Look at</span>
                <input type="number" id="camLookX" step="0.1" aria-label="Look-at X">
                <input type="number" id="camLookY" step="0.1" aria-label="Look-at Y">
                <input type="number" id="camLookZ" step="0.1" aria-label="Look-at Z">
            </div>
            <label class="camera-check"><input type="checkbox" id="camAutoLook"> Auto look at tree</label>
            <label class="camera-check"><input type="checkbox" id="camOrbitLook"> Orbit around look-at</label>
            <div class="camera-row">
                <span>Orbit</span>
                <input type="number" id="camOrbitX" step="0.1" aria-label="Orbit X">
                <input type="number" id="camOrbitY" step="0.1" aria-label="Orbit Y">
                <input type="number" id="camOrbitZ" step="0.1" aria-label="Orbit Z">
            </div>
            <button type="button" id="camResetCamera" class="quiet-button">Reset camera</button>
        </div>`;
    slot.appendChild(details);
    cameraMenu = details;

    const spinNode = slot.querySelector('[data-control-key="spin"]');
    const spinInput = spinNode?.querySelector('input');
    spinInput?.addEventListener('change', () => {
        cameraBridge()?.setCameraSettings?.({ orbitEnabled: spinInput.checked });
        syncCameraMenu();
    });

    for (const [ids, key] of [
        [['camPosX', 'camPosY', 'camPosZ'], 'position'],
        [['camLookX', 'camLookY', 'camLookZ'], 'lookAt'],
        [['camOrbitX', 'camOrbitY', 'camOrbitZ'], 'orbitTarget'],
    ]) {
        for (const id of ids) {
            const input = document.getElementById(id);
            input?.addEventListener('change', () => {
                const vec = cameraVec(ids);
                if (vec) applyCameraPatch({ [key]: vec });
            });
        }
    }

    document.getElementById('camFov')?.addEventListener('change', (event) => {
        const fov = cameraInputValue(event.target);
        if (fov !== null) applyCameraPatch({ fov });
    });
    document.getElementById('camLimits')?.addEventListener('change', (event) => {
        applyCameraPatch({ limitsEnabled: event.target.checked });
    });
    document.getElementById('camAutoLook')?.addEventListener('change', (event) => {
        applyCameraPatch({ autoLookAt: event.target.checked });
    });
    document.getElementById('camOrbitLook')?.addEventListener('change', (event) => {
        applyCameraPatch({ useLookAtForOrbit: event.target.checked });
    });
    document.getElementById('camResetCamera')?.addEventListener('click', () => {
        cameraBridge()?.resetCamera?.();
        syncCameraMenu();
    });

    syncCameraMenu();
}

function setCameraField(id, value) {
    const input = document.getElementById(id);
    if (!input || document.activeElement === input) return;
    input.value = Number(value).toFixed(1).replace(/\.0$/, '');
}

function syncCameraMenu() {
    if (!cameraMenu) return;
    const settings = cameraBridge()?.getCameraSettings?.();
    if (!settings) return;
    setCameraField('camPosX', settings.position[0]);
    setCameraField('camPosY', settings.position[1]);
    setCameraField('camPosZ', settings.position[2]);
    setCameraField('camFov', settings.fov);
    setCameraField('camLookX', settings.lookAt[0]);
    setCameraField('camLookY', settings.lookAt[1]);
    setCameraField('camLookZ', settings.lookAt[2]);
    setCameraField('camOrbitX', settings.orbitTarget[0]);
    setCameraField('camOrbitY', settings.orbitTarget[1]);
    setCameraField('camOrbitZ', settings.orbitTarget[2]);

    const autoLook = document.getElementById('camAutoLook');
    if (autoLook && document.activeElement !== autoLook) autoLook.checked = !!settings.autoLookAt;
    const limits = document.getElementById('camLimits');
    if (limits && document.activeElement !== limits) limits.checked = !!settings.limitsEnabled;
    const orbitLook = document.getElementById('camOrbitLook');
    if (orbitLook && document.activeElement !== orbitLook) {
        orbitLook.checked = !!settings.useLookAtForOrbit;
    }
    for (const id of ['camLookX', 'camLookY', 'camLookZ']) {
        const input = document.getElementById(id);
        if (input) input.disabled = !!settings.autoLookAt;
    }
    for (const id of ['camOrbitX', 'camOrbitY', 'camOrbitZ']) {
        const input = document.getElementById(id);
        if (input) input.disabled = !!settings.useLookAtForOrbit;
    }
}

function buildSculptToolbar() {
    const slot = document.querySelector('[data-slot="sculpt-toolbar"]');
    if (!slot) return;
    slot.innerHTML = '';
    const inspect = document.createElement('button');
    inspect.type = 'button';
    inspect.className = 'toolbar-tool';
    inspect.textContent = 'Inspect';
    inspect.addEventListener('click', () => {
        for (const shadow of [shadow2d, shadow3d]) {
            const prune = shadow.querySelector('#prune');
            const lasso = shadow.querySelector('#lasso');
            if (prune?.classList.contains('active')) prune.click();
            if (lasso?.classList.contains('active')) lasso.click();
        }
        syncPanel();
    });
    const prune = document.createElement('button');
    prune.type = 'button';
    prune.className = 'toolbar-tool';
    prune.textContent = 'Prune';
    prune.addEventListener('click', () => { findInShadow(activeShadow(), 'prune')?.click(); syncPanel(); });
    const lasso = document.createElement('button');
    lasso.type = 'button';
    lasso.className = 'toolbar-tool';
    lasso.textContent = 'Lasso';
    lasso.addEventListener('click', () => { findInShadow(activeShadow(), 'lasso')?.click(); syncPanel(); });
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'toolbar-tool';
    undo.textContent = 'Undo';
    undo.addEventListener('click', () => { findInShadow(activeShadow(), 'undoCut')?.click(); syncPanel(); });
    const redo = document.createElement('button');
    redo.type = 'button';
    redo.className = 'toolbar-tool';
    redo.textContent = 'Redo';
    redo.addEventListener('click', () => { findInShadow(activeShadow(), 'redoCut')?.click(); syncPanel(); });
    const cut = document.createElement('select');
    cut.className = 'toolbar-select';
    cut.setAttribute('aria-label', 'Cut type');
    cut.innerHTML = '<option value="thinning">Thinning</option><option value="heading">Heading</option><option value="pollard">Pollard</option>';
    cut.addEventListener('change', () => {
        for (const shadow of [shadow2d, shadow3d]) {
            const select = shadow.querySelector('#pruneType');
            if (!select) continue;
            select.value = cut.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncPanel();
    });
    slot.append(inspect, prune, lasso, cut, undo, redo);
    updateToolbar();
}

function updateToolbar() {
    const slot = document.querySelector('[data-slot="sculpt-toolbar"]');
    if (!slot) return;
    const active = activeShadow();
    const prune = active?.querySelector('#prune')?.classList.contains('active');
    const lasso = active?.querySelector('#lasso')?.classList.contains('active');
    const inspect = slot.querySelectorAll('.toolbar-tool')[0];
    if (inspect) inspect.classList.toggle('active', !prune && !lasso);
    if (slot.querySelectorAll('.toolbar-tool')[1]) slot.querySelectorAll('.toolbar-tool')[1].classList.toggle('active', !!prune);
    if (slot.querySelectorAll('.toolbar-tool')[2]) slot.querySelectorAll('.toolbar-tool')[2].classList.toggle('active', !!lasso);
    const select = slot.querySelector('.toolbar-select');
    const source = active?.querySelector('#pruneType');
    if (select && source && select.value !== source.value) select.value = source.value;
    const undo = slot.querySelectorAll('.toolbar-tool')[3];
    const redo = slot.querySelectorAll('.toolbar-tool')[4];
    if (undo) undo.disabled = !!active?.querySelector('#undoCut')?.disabled;
    if (redo) redo.disabled = !!active?.querySelector('#redoCut')?.disabled;
    const count = $('sculptCutCount');
    if (count) {
        const state = active === shadow3d ? window.__tree3d?.captureState() : window.__tree2d?.captureState();
        const cuts = state?.cuts?.length || 0;
        count.textContent = `${cuts} cut${cuts === 1 ? '' : 's'}`;
    }
    const flyoutCount = panelShadow?.getElementById('flyoutCutCount');
    if (flyoutCount) {
        const state = active === shadow3d ? window.__tree3d?.captureState() : window.__tree2d?.captureState();
        const cuts = state?.cuts?.length || 0;
        flyoutCount.textContent = `${cuts} cut${cuts === 1 ? '' : 's'}`;
    }
    updateSculptChrome();
}

function updateAnchoredInspector() {
    const card = $('anchoredInspector');
    if (!card) return;
    if (mode !== 'study') {
        card.hidden = true;
        return;
    }
    const bridge = window[`__tree${activePane}`];
    const index = bridge?.selectedNode ?? -1;
    const source = findInShadow(activeShadow(), 'inspector');
    if (index < 0 || !source?.innerHTML.trim()) {
        card.hidden = true;
        return;
    }
    const signature = `${activePane}:${index}`;
    if (card.dataset.selected !== signature) {
        card.dataset.selected = signature;
        const temp = document.createElement('div');
        temp.innerHTML = source.innerHTML;
        const grid = temp.querySelector('.inspect-grid');
        const body = $('anchoredBody');
        const more = $('anchoredMore');
        if (body) {
            body.innerHTML = '';
            const title = temp.querySelector('.inspect-title');
            if (title) body.appendChild(title.cloneNode(true));
            if (grid) {
                const summaryGrid = document.createElement('div');
                summaryGrid.className = 'inspect-grid';
                const children = Array.from(grid.children).slice(0, 10);
                for (const child of children) summaryGrid.appendChild(child.cloneNode(true));
                body.appendChild(summaryGrid);
            }
        }
        if (more && grid) more.innerHTML = grid.outerHTML;
    }

    const pos = bridge?.nodeScreenPosition?.(index);
    if (!pos) {
        card.hidden = true;
        return;
    }
    card.hidden = false;
    const hostRect = viewHosts[activePane].getBoundingClientRect();
    const splitRect = appMain.getBoundingClientRect();
    const x = hostRect.left - splitRect.left + pos.x;
    const y = hostRect.top - splitRect.top + pos.y;
    const cardWidth = card.offsetWidth || 280;
    const left = clamp(x + 18, 8, splitRect.width - cardWidth - 8);
    const top = clamp(y - 16, 8, splitRect.height - 110);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
}

function bindAnchoredInspector() {
    $('anchoredClose')?.addEventListener('click', () => {
        clearSelectionIn(activePane);
        updateAnchoredInspector();
        syncPanel();
    });
    $('anchoredIsolate')?.addEventListener('click', () => {
        const button = findInShadow(activeShadow(), 'isolate');
        if (button && !button.disabled) button.click();
        syncPanel();
    });
    $('anchoredPrune')?.addEventListener('click', () => {
        const bridge = window[`__tree${activePane}`];
        if (bridge?.pruneSelected?.()) {
            showToast('Branch pruned');
            syncPanel();
        } else {
            showToast('Select a branch first');
        }
    });
}

function bindRecordChrome() {
    $('recordStart')?.addEventListener('click', startRecordCountdown);
    $('recordExit')?.addEventListener('click', () => exitRecordStage());
    $('recordAbort')?.addEventListener('click', () => exitRecordStage());
    $('recordBack')?.addEventListener('click', () => exitRecordStage());
    $('recordReplay')?.addEventListener('click', () => {
        const keep = recordSettings.keepEndState;
        exitRecordStage({ keepEnd: keep });
        setTimeout(() => openRecordStage(), 60);
    });
}

/* ==========================================================================
   Deliver: export and record
   ========================================================================== */

function buildDeliverPanel() {
    const panel = document.createElement('div');
    panel.className = 'mode-panel';
    panel.dataset.mode = 'deliver';
    panel.id = 'modePanel-deliver';
    panel.hidden = mode !== 'deliver';

    panel.innerHTML = `
        <div class="deliver-tabs" role="tablist" aria-label="Deliver workflow">
            <button type="button" role="tab" data-deliver-tab="record" aria-selected="true">Record</button>
            <button type="button" role="tab" data-deliver-tab="export" aria-selected="false">Export</button>
        </div>
        <section class="deliver-panel" id="deliverRecord" role="tabpanel" aria-label="Record">
            <p class="record-mobile-note">Record is best on a larger screen. Portrait phones default to a 9:16 frame.</p>
            <div class="fly-section">
                <div class="fly-heading">Presets</div>
                <div class="record-presets" id="recordPresets"></div>
            </div>
            <div class="fly-section">
                <div class="fly-heading">Settings</div>
                <div class="record-grid">
                    <label>Source<select data-rec="source"><option value="2d">2D</option><option value="3d">3D</option><option value="split">Split</option></select></label>
                    <label>Frame<select data-rec="frame"><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="fit">Fit window</option></select></label>
                    <label>Start age<input type="number" data-rec="startAge" min="0" step="1"></label>
                    <label>End age<input type="number" data-rec="endAge" min="0" step="1"></label>
                    <label>Duration (s)<input type="number" data-rec="duration" min="1" max="600" step="1"></label>
                    <label>Speed (yr/s)<input type="number" data-rec="recordSpeed" min="0.1" step="0.1"></label>
                    <label>Easing<select data-rec="easing"><option value="linear">Linear</option><option value="ease-out">Ease out</option><option value="ease-in-out">Ease in-out</option></select></label>
                    <label>Start hold (s)<input type="number" data-rec="holdStart" min="0" max="10" step="0.5"></label>
                    <label>End hold (s)<input type="number" data-rec="holdEnd" min="0" max="10" step="0.5"></label>
                    <label>Loop<select data-rec="loop"><option value="once">Once</option><option value="loop">Loop</option><option value="ping-pong">Ping-pong</option></select></label>
                    <label>Camera (3D)<select data-rec="camera"><option value="fixed">Fixed (auto-zoom)</option><option value="turntable">Turntable</option></select></label>
                    <label>Turntable °/s<input type="number" data-rec="turntableSpeed" min="1" max="180" step="1"></label>
                    <label>Season<select data-rec="seasonMode"><option value="phenology">Follow phenology</option><option value="lock">Lock at value</option><option value="sweep">Sweep</option></select></label>
                    <label>Season lock<input type="number" data-rec="seasonLock" min="0" max="1" step="0.01"></label>
                    <label>Sweep (s)<input type="number" data-rec="seasonSweep" min="1" max="120" step="1"></label>
                    <label>Overlay position<select data-rec="overlayPosition"><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option><option value="top-left">Top left</option><option value="top-right">Top right</option></select></label>
                    <label>Overlay size<select data-rec="overlaySize"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
                    <label>Countdown<select data-rec="countdown"><option value="0">Off</option><option value="3">3 s</option><option value="5">5 s</option></select></label>
                    <label>Title<input type="text" data-rec="title" placeholder="Optional title"></label>
                    <label>Caption<input type="text" data-rec="caption" placeholder="Optional caption"></label>
                </div>
                <div class="record-checks">
                    <label><input type="checkbox" data-rec="yearCounter"> Year counter</label>
                    <label><input type="checkbox" data-rec="guides"> Safe-frame and crop marks</label>
                    <label><input type="checkbox" data-rec="hideCursor"> Hide cursor</label>
                    <label><input type="checkbox" data-rec="keepEndState"> Keep end state</label>
                </div>
            </div>
            <div class="fly-section">
                <div class="fly-heading">Preflight</div>
                <ul class="preflight" id="preflightList"></ul>
                <p class="record-tip" id="perfResult"></p>
                <button type="button" id="perfCheck" class="quiet-button">Run performance check</button>
            </div>
            <details class="record-tip">
                <summary>Capturing the take</summary>
                <p>Use the OS screen recorder or OBS and record the window or the frame area. Prefer 60 fps. Because time is a render parameter, the same settings always produce the same growth, so a take can be repeated for identical frames.</p>
            </details>
            <div class="record-actions">
                <button type="button" id="recordPreview" class="secondary-button">Preview</button>
                <button type="button" id="recordStartTake" class="primary-button">Start take</button>
            </div>
        </section>
        <section class="deliver-panel" id="deliverExport" role="tabpanel" aria-label="Export" hidden>
            <div class="deliver-step">
                <h3>1 · Choose a target</h3>
                <div class="export-targets" id="exportTargets">
                    <button type="button" class="export-target" data-target="svg" aria-pressed="true">2D drawing<span>SVG</span></button>
                    <button type="button" class="export-target" data-target="png" aria-pressed="false">Image<span>PNG</span></button>
                    <button type="button" class="export-target" data-target="glb" aria-pressed="false">3D model<span>GLB</span></button>
                    <button type="button" class="export-target" data-target="data" aria-pressed="false">Data<span>CSV · JSON</span></button>
                    <button type="button" class="export-target" data-target="batch" aria-pressed="false">Batch package<span>ZIP</span></button>
                    <button type="button" class="export-target" data-target="share" aria-pressed="false">Share link<span>Copy</span></button>
                </div>
            </div>
            <div class="deliver-step">
                <h3>2 · Options</h3>
                <div class="export-options" id="exportOptions">
                    <div class="export-option-block" data-export-options="svg"><div class="ctl-grid" data-deliver-options="svg"></div></div>
                    <div class="export-option-block" data-export-options="png" hidden><div class="ctl-grid" data-deliver-options="png"></div></div>
                    <div class="export-option-block" data-export-options="glb" hidden><div class="ctl-grid" data-deliver-options="glb"></div></div>
                    <div class="export-option-block" data-export-options="data" hidden><p class="group-note">CSV and JSON include run A and delta columns when a baseline is pinned.</p></div>
                    <div class="export-option-block" data-export-options="batch" hidden><p class="group-note">2D: five SVG frames at 0/25/50/75/100% plus current.svg, analytics.csv, state.json and manifest.json. 3D: current.glb plus analytics.csv, state.json and manifest.json.</p></div>
                    <div class="export-option-block" data-export-options="share" hidden><p class="group-note">Copies a canonical share link that restores this tree for both views.</p></div>
                </div>
            </div>
            <div class="deliver-step">
                <h3>3 · Preview and action</h3>
                <div class="export-preview">
                    <canvas id="exportPreviewCanvas" width="320" height="92" aria-label="Export preview"></canvas>
                    <p class="export-filename" id="exportFilename">parametric-tree.svg</p>
                </div>
                <div class="deliver-action-slot" id="deliverActionSlot"></div>
            </div>
        </section>
    `;

    const exportOptions = new Map();
    for (const block of panel.querySelectorAll('[data-deliver-options]')) {
        exportOptions.set(block.dataset.deliverOptions, block);
    }
    deliverActionSlot = panel.querySelector('#deliverActionSlot');

    for (const [key, slot] of exportOptions) {
        DELIVER_OPTION_SLOTS.set(key, slot);
    }
    panel._exportOptions = exportOptions;

    for (const button of panel.querySelectorAll('[data-deliver-tab]')) {
        button.addEventListener('click', () => {
            deliverTab = button.dataset.deliverTab;
            panel.querySelectorAll('[data-deliver-tab]').forEach((tab) => {
                tab.setAttribute('aria-selected', String(tab.dataset.deliverTab === deliverTab));
            });
            panel.querySelector('#deliverRecord').hidden = deliverTab !== 'record';
            panel.querySelector('#deliverExport').hidden = deliverTab !== 'export';
            updateActingChips();
            updateDeliverTab();
            savePrefs();
        });
    }
    for (const button of panel.querySelectorAll('[data-target]')) {
        button.addEventListener('click', () => setDeliverTarget(button.dataset.target));
    }

    buildRecordControls(panel);
    return panel;
}

const DELIVER_OPTION_SLOTS = new Map();
const DELIVER_ACTION_TARGET = {
    exportSvg: 'svg', exportPng: 'png', exportGlb: 'glb',
    exportCsv: 'data', exportJson: 'data', exportBatch: 'batch', shareState: 'share',
    svgRoots: 'svg', svgBranches: 'svg', svgLeaves: 'svg', svgBackground: 'svg', svgLineArt: 'svg',
    svgWidth: 'svg', svgHeight: 'svg', svgDpi: 'svg', svgAnnotations: 'svg', svgScaleBar: 'svg',
    pngScale: 'png', glbRoots: 'glb', glbLeaves: 'glb', glbMetadata: 'glb',
    glbAxis: 'glb', glbUnits: 'glb', glbLod: 'glb',
};

function slotForEntry(entry) {
    if (entry.mode === 'deliver') {
        if (DELIVER_ACTION_TARGET[entry.id] && ['exportSvg', 'exportPng', 'exportGlb', 'exportCsv', 'exportJson', 'exportBatch', 'shareState'].includes(entry.id)) {
            return deliverActionSlot;
        }
        const target = DELIVER_ACTION_TARGET[entry.id];
        if (target && DELIVER_OPTION_SLOTS.has(target)) return DELIVER_OPTION_SLOTS.get(target);
    }
    if (entry.mount) {
        const bySlot = document.querySelector(`[data-slot="${entry.mount}"]`);
        if (bySlot) return bySlot;
        const fallback = $(entry.mount);
        if (fallback) return fallback;
    }
    const key = entry.mode + '|' + entry.group.join('|');
    return groupSlots.get(key) || groupSlots.get(entry.mode + '|' + entry.group[0]) || null;
}

function setDeliverTarget(target, { switchPane = true } = {}) {
    deliverTarget = target;
    const panel = panelShadow?.querySelector('#modePanel-deliver');
    if (panel) {
        for (const button of panel.querySelectorAll('[data-target]')) {
            button.setAttribute('aria-pressed', String(button.dataset.target === target));
        }
        for (const block of panel.querySelectorAll('[data-export-options]')) {
            block.hidden = block.dataset.exportOptions !== target;
        }
    }
    if (switchPane && target === 'svg') setActivePane('2d', { silent: true });
    if (switchPane && target === 'glb') setActivePane('3d', { silent: true });
    updateActingChips();
    updateDeliverActions();
    updateExportPreview();
    syncPanel();
}

function updateDeliverActions() {
    for (const [key, button] of deliverActionButtons) {
        const target = DELIVER_ACTION_TARGET[key];
        button.hidden = target !== deliverTarget;
        const wrapper = button.closest('.ctl-action');
        if (wrapper) wrapper.hidden = button.hidden;
        if (!button.hidden) {
            button.textContent = MANIFEST_BY_KEY.get(key)?.label || button.textContent;
        }
    }
}

function updateExportPreview() {
    const canvas = panelShadow?.getElementById('exportPreviewCanvas');
    const filename = panelShadow?.getElementById('exportFilename');
    if (!canvas) return;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#fffdf8';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const bridge = window[`__tree${deliverTarget === 'glb' ? '3d' : (deliverTarget === 'svg' ? '2d' : activePane)}`];
    const paneCanvas = bridge?.canvas || findInShadow(deliverTarget === 'glb' ? shadow3d : shadow2d, 'c');
    if (paneCanvas && paneCanvas.width) {
        try {
            const scale = Math.min(canvas.width / paneCanvas.width, canvas.height / paneCanvas.height);
            const w = paneCanvas.width * scale;
            const h = paneCanvas.height * scale;
            g.drawImage(paneCanvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        } catch {
            // Canvas taint is not expected here, but keep the preview usable.
        }
    }
    if (filename) {
        const year = Math.round(transportTime);
        const seed = canonical?.seed ?? '—';
        const names = {
            svg: `parametric-tree-${year}y.svg`,
            png: `parametric-tree-${deliverTarget === 'glb' ? '3d' : activePane}-${year}y.png`,
            glb: `parametric-tree-${year}y.glb`,
            data: `parametric-tree-analytics-seed-${seed}${canonical?.compare?.baseline ? '-compare' : ''}.csv`,
            batch: `parametric-tree-batch-${seed}.zip`,
            share: 'Share link',
        };
        filename.textContent = names[deliverTarget] || 'export';
    }
}

function updateDeliverTab() {
    const panel = panelShadow?.querySelector('#modePanel-deliver');
    if (!panel) return;
    for (const tab of panel.querySelectorAll('[data-deliver-tab]')) {
        tab.setAttribute('aria-selected', String(tab.dataset.deliverTab === deliverTab));
    }
    panel.querySelector('#deliverRecord').hidden = deliverTab !== 'record';
    panel.querySelector('#deliverExport').hidden = deliverTab !== 'export';
    updateDeliverActions();
    updateExportPreview();
}

/* ---- Record controls -------------------------------------------------- */

function buildRecordControls(panel) {
    const presets = panel.querySelector('#recordPresets');
    for (const [key, preset] of Object.entries(TAKE_PRESETS)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'record-preset';
        button.dataset.recordPreset = key;
        button.setAttribute('aria-pressed', String(recordSettings.preset === key));
        button.innerHTML = `<strong>${escapeHtml(preset.label)}</strong><span>${escapeHtml(preset.description)}</span>`;
        button.addEventListener('click', () => applyRecordPreset(key));
        presets.appendChild(button);
    }

    for (const input of panel.querySelectorAll('[data-rec]')) {
        const key = input.dataset.rec;
        if (key === 'recordSpeed') continue;
        const eventName = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
        input.addEventListener(eventName, () => {
            let value = input.type === 'checkbox' ? input.checked : input.value;
            if (input.type === 'number') value = value === '' ? '' : Number(value);
            recordSettings[key] = value;
            if (key === 'duration') {
                syncRecordSpeedField(panel);
            }
            if (key === 'startAge' || key === 'endAge' || key === 'duration') updatePreflight();
            if (key === 'guides') updateRecordGuides();
            savePrefs();
        });
    }

    const speedInput = panel.querySelector('[data-rec="recordSpeed"]');
    speedInput?.addEventListener('input', () => {
        const lifespanNow = lifespan;
        const start = Number(recordSettings.startAge) || 0;
        const end = recordSettings.endAge == null || recordSettings.endAge === ''
            ? lifespanNow
            : Number(recordSettings.endAge);
        const speedValue = Math.max(0.1, Number(speedInput.value) || 1);
        recordSettings.duration = Math.max(1, Math.round(((end - start) / speedValue) * 10) / 10);
        const durationInput = panel.querySelector('[data-rec="duration"]');
        if (durationInput) durationInput.value = recordSettings.duration;
        savePrefs();
    });

    panel.querySelector('#recordPreview')?.addEventListener('click', startRecordPreview);
    panel.querySelector('#recordStartTake')?.addEventListener('click', openRecordStage);
    panel.querySelector('#perfCheck')?.addEventListener('click', runPerformanceCheck);
    syncRecordForm(panel);
    updatePreflight();
}

function syncRecordForm(panel = panelShadow?.querySelector('#modePanel-deliver')) {
    if (!panel) return;
    const settings = recordSettings;
    const lifespanNow = lifespan;
    for (const input of panel.querySelectorAll('[data-rec]')) {
        const key = input.dataset.rec;
        if (key === 'recordSpeed') continue;
        if (input.type === 'checkbox') input.checked = !!settings[key];
        else if (key === 'endAge') input.value = settings.endAge == null ? lifespanNow : settings.endAge;
        else if (input.value !== String(settings[key] ?? '')) input.value = settings[key] ?? '';
    }
    syncRecordSpeedField(panel);
    for (const button of panel.querySelectorAll('[data-record-preset]')) {
        button.setAttribute('aria-pressed', String(button.dataset.recordPreset === settings.preset));
    }
}

function syncRecordSpeedField(panel = panelShadow?.querySelector('#modePanel-deliver')) {
    if (!panel) return;
    const input = panel.querySelector('[data-rec="recordSpeed"]');
    if (!input) return;
    const start = Number(recordSettings.startAge) || 0;
    const end = recordSettings.endAge == null ? lifespan : Number(recordSettings.endAge);
    const duration = Math.max(0.1, Number(recordSettings.duration) || 1);
    input.value = (Math.max(0.1, (end - start) / duration)).toFixed(1);
}

function applyRecordPreset(key) {
    const preset = TAKE_PRESETS[key];
    if (!preset) return;
    const values = Object.assign({}, preset.values);
    if (values.startAge === null) {
        values.startAge = Math.round(transportTime);
        values.endAge = Math.round(transportTime);
    }
    recordSettings = Object.assign({}, recordSettings, values, { preset: key });
    syncRecordForm();
    updatePreflight();
    updateRecordGuides();
    savePrefs();
}

function updatePreflight() {
    const panel = panelShadow?.querySelector('#modePanel-deliver');
    const list = panel?.querySelector('#preflightList');
    if (!list) return;
    const aspect = recordAspect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const frame = fitFrame(aspect, viewportW, viewportH);
    const quality = canonical?.params?.quality || 'auto';
    const reduced = !!canonical?.params?.reducedMotion;
    const rows = [
        {
            status: frame.width <= viewportW && frame.height <= viewportH ? 'ok' : 'warn',
            label: `Frame ${Math.round(frame.width)}×${Math.round(frame.height)} ${frame.width <= viewportW && frame.height <= viewportH ? 'fits' : 'is larger than'} the window.`,
            fix: null,
        },
        {
            status: quality === 'low' ? 'warn' : 'ok',
            label: `Quality tier: ${quality}. ${quality === 'low' ? 'Medium or High is better for 3D takes.' : ''}`,
            fix: 'quality',
        },
        {
            status: reduced ? 'warn' : 'ok',
            label: reduced ? 'Reduce motion is on: sway and turntable are suppressed.' : 'Motion is on.',
            fix: 'reducedMotion',
        },
    ];
    list.innerHTML = '';
    for (const row of rows) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="${row.status === 'ok' ? 'ok' : 'warn'}">${row.status === 'ok' ? '✓' : '!'}</span><span>${escapeHtml(row.label)}</span>`;
        if (row.fix) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fix';
            button.textContent = 'Fix';
            button.addEventListener('click', () => focusControl(keyForId(row.fix)));
            li.appendChild(button);
        } else {
            li.appendChild(document.createElement('span'));
        }
        list.appendChild(li);
    }
}

function keyForId(id) {
    return MANIFEST.find((entry) => entry.id === id)?.key || `param:${id}`;
}

function recordAspect() {
    const frame = recordSettings.frame || '16:9';
    if (frame === 'fit') return window.innerWidth / Math.max(1, window.innerHeight);
    const [w, h] = frame.split(':').map(Number);
    return w / h;
}

function fitFrame(aspect, viewportW, viewportH) {
    const availW = viewportW;
    const availH = viewportH;
    let width = availW;
    let height = width / aspect;
    if (height > availH) {
        height = availH;
        width = height * aspect;
    }
    return { width, height };
}

function updateRecordGuides() {
    const guides = $('recordGuides');
    if (guides) {
        const armed = recordState === 'armed' || recordState === 'countdown' || recordState === 'complete';
        guides.hidden = !(recordSettings.guides && armed);
    }
    const overlay = $('recordOverlay');
    if (overlay) {
        overlay.classList.remove('pos-bottom-right', 'pos-top-left', 'pos-top-right');
        if (recordSettings.overlayPosition !== 'bottom-left') overlay.classList.add(`pos-${recordSettings.overlayPosition}`);
        overlay.classList.remove('size-small', 'size-large');
        if (recordSettings.overlaySize === 'small') overlay.classList.add('size-small');
        if (recordSettings.overlaySize === 'large') overlay.classList.add('size-large');
    }
}

function runPerformanceCheck() {
    if (performanceCheckRunning) return;
    performanceCheckRunning = true;
    const output = panelShadow?.querySelector('#perfResult');
    const button = panelShadow?.querySelector('#perfCheck');
    if (button) button.disabled = true;
    if (output) output.textContent = 'Running a 3-second stress playback…';
    const wasPlaying = playing;
    if (!wasPlaying) startPlayback();
    let frames = 0;
    let dropped = 0;
    let last = performance.now();
    const start = last;
    const step = (now) => {
        const delta = now - last;
        last = now;
        frames += 1;
        if (delta > 34) dropped += 1;
        if (now - start < 3000) {
            requestAnimationFrame(step);
            return;
        }
        const fps = frames / ((now - start) / 1000);
        performanceCheckRunning = false;
        stopPlayback();
        if (wasPlaying) startPlayback();
        if (button) button.disabled = false;
        const advice = fps < 50 ? ' Consider a lower quality tier.' : '';
        if (output) output.textContent = `Average ${fps.toFixed(0)} fps · ${dropped} dropped frames.${advice}`;
        showToast(`Performance check: ${fps.toFixed(0)} fps`);
    };
    requestAnimationFrame(step);
}

/* ---- Record stage controller ----------------------------------------- */

function captureRecordSnapshot() {
    return {
        time: transportTime,
        season: window.__tree2d?.season ?? 0.33,
        seasonAuto: !!canonical?.seasonAuto,
        playing,
        layout,
        mode,
        activePane,
        camera: window.__tree3d?.captureCamera?.() || null,
        lifespan,
    };
}

function restoreRecordSnapshot(snapshot) {
    if (!snapshot) return;
    stopPlayback();
    setLayout(snapshot.layout, { fromUser: false });
    setMode(snapshot.mode, { openFlyout: true });
    setActivePane(snapshot.activePane, { silent: true });
    if (snapshot.camera && window.__tree3d?.setCameraPose) window.__tree3d.setCameraPose(snapshot.camera);
    if (snapshot.seasonAuto) {
        const auto = findInShadow(shadow2d, 'seasonAuto');
        if (auto) {
            auto.checked = true;
            auto.dispatchEvent(new Event('change', { bubbles: true }));
        }
    } else if (window.__tree2d?.setSeason) {
        window.__tree2d.setSeason(snapshot.season);
    }
    driveTime(snapshot.time);
    if (snapshot.playing) startPlayback();
}

function applyRecordSourceLayout() {
    if (recordSettings.source === '2d') setLayout('2d', { fromUser: false });
    else if (recordSettings.source === '3d') setLayout('3d', { fromUser: false });
    else setLayout('split', { fromUser: false });
}

function openRecordStage() {
    if (recordState !== 'idle') return;
    recordReturnFocus = document.activeElement;
    recordSnapshot = captureRecordSnapshot();
    recordState = 'armed';
    recordElapsed = 0;
    applyRecordSourceLayout();
    document.body.classList.add('record-stage', 'record-controls-visible');
    document.body.classList.remove('record-running', 'record-controls-hidden');
    for (const host of Object.values(viewHosts)) host.classList.add('recording');
    document.body.style.setProperty('--record-aspect', recordAspect().toFixed(4));
    const chrome = $('recordChrome');
    if (chrome) chrome.hidden = false;
    if ($('recordArmedCard')) $('recordArmedCard').hidden = false;
    if ($('recordComplete')) $('recordComplete').hidden = true;
    if ($('recordCountdown')) $('recordCountdown').hidden = true;
    updateRecordGuides();
    const overlay = $('recordOverlay');
    if (overlay) overlay.hidden = false;
    updateRecordOverlay(recordSettings.startAge ?? transportTime, 0.33);
    updateRecordFrameNote();
    resizeViewsSoon();
    try {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {
        // Windowed record stage is the fallback.
    }
    requestAnimationFrame(() => $('recordStart')?.focus());
}

function updateRecordFrameNote() {
    const note = $('recordFrameNote');
    if (!note) return;
    const frame = fitFrame(recordAspect(), window.innerWidth, window.innerHeight);
    note.textContent = `Frame ${recordSettings.frame} · ${Math.round(frame.width)}×${Math.round(frame.height)}`;
}

function startRecordCountdown() {
    if (recordState !== 'armed') return;
    recordState = 'countdown';
    const card = $('recordArmedCard');
    if (card) card.hidden = true;
    const countdown = $('recordCountdown');
    const seconds = Number(recordSettings.countdown) || 0;
    setStatus('Starting take');
    let remaining = seconds;
    if (countdown) countdown.hidden = false;
    const paint = () => {
        if (!countdown) return;
        countdown.textContent = remaining > 0 ? String(remaining) : '';
    };
    paint();
    clearInterval(recordCountdownTimer);
    if (seconds <= 0) {
        beginRecordRun();
        return;
    }
    recordCountdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(recordCountdownTimer);
            recordCountdownTimer = 0;
            if (countdown) countdown.hidden = true;
            beginRecordRun();
        } else {
            paint();
        }
    }, 1000);
}

function beginRecordRun() {
    recordState = 'running';
    recordPaused = false;
    recordStartedAt = performance.now() - recordElapsed * 1000;
    document.body.classList.add('record-running');
    document.body.classList.toggle('record-hide-cursor', !!recordSettings.hideCursor);
    document.body.classList.remove('record-controls-visible');
    document.body.classList.add('record-controls-hidden');
    if (transportDock) transportDock.inert = true;
    if (appMain) appMain.inert = false;
    updateRecordGuides();
    recordCameraBase = window.__tree3d?.captureCamera?.() || null;
    if (recordSettings.camera === 'turntable' && recordCameraBase && window.__tree3d?.setCameraPose) {
        window.__tree3d.setCameraPose(recordCameraBase);
    }
    cancelAnimationFrame(recordRAF);
    recordRAF = requestAnimationFrame(recordTick);
}

function recordTick(now) {
    if (recordState !== 'running' || recordPaused) return;
    recordElapsed = Math.max(0, (now - recordStartedAt) / 1000);
    const sample = sampleTake(recordSettings, recordElapsed, lifespan);
    if (!suspendedPanes.has('2d')) window.__tree2d?.setSeasonSilent?.(sample.season);
    if (!suspendedPanes.has('3d')) window.__tree3d?.setSeasonSilent?.(sample.season);
    driveTime(sample.time);
    if (recordSettings.camera === 'turntable' && recordCameraBase && !suspendedPanes.has('3d')) {
        window.__tree3d?.setCameraPose?.(orbitPose(recordCameraBase, sample.cameraAngle));
    }
    updateRecordOverlay(sample.time, sample.season);
    if (sample.phase === 'complete' && recordSettings.loop === 'once') {
        finishRecordTake();
        return;
    }
    recordRAF = requestAnimationFrame(recordTick);
}

function updateRecordOverlay(time, season) {
    const overlay = $('recordOverlay');
    if (overlay) overlay.hidden = false;
    const year = $('recordYear');
    if (year) {
        year.textContent = recordSettings.yearCounter ? `Year ${Math.max(0, time).toFixed(1)}` : '';
        year.hidden = !recordSettings.yearCounter;
    }
    const title = $('recordTitle');
    if (title) {
        title.textContent = recordSettings.title || '';
        title.hidden = !recordSettings.title;
    }
    const caption = $('recordCaption');
    if (caption) {
        caption.textContent = recordSettings.caption || seasonName(season);
        caption.hidden = !recordSettings.caption && !recordSettings.yearCounter;
    }
}

function finishRecordTake() {
    recordState = 'complete';
    cancelAnimationFrame(recordRAF);
    recordRAF = 0;
    document.body.classList.remove('record-running');
    document.body.classList.add('record-controls-visible');
    if (transportDock) transportDock.inert = false;
    if ($('recordComplete')) $('recordComplete').hidden = false;
    if ($('recordCountdown')) $('recordCountdown').hidden = true;
    setStatus('Take complete');
    requestAnimationFrame(() => $('recordComplete')?.querySelector('button')?.focus());
}

function pauseRecordTake() {
    if (recordState !== 'running') return;
    if (recordPaused) {
        recordPaused = false;
        recordStartedAt = performance.now() - recordElapsed * 1000;
        document.body.classList.remove('record-paused');
        const countdown = $('recordCountdown');
        if (countdown) countdown.hidden = true;
        recordRAF = requestAnimationFrame(recordTick);
    } else {
        recordPaused = true;
        cancelAnimationFrame(recordRAF);
        recordRAF = 0;
        document.body.classList.add('record-paused');
        const countdown = $('recordCountdown');
        if (countdown) {
            countdown.hidden = false;
            countdown.textContent = 'Paused';
        }
    }
}

function exitRecordStage({ keepEnd = false } = {}) {
    clearInterval(recordCountdownTimer);
    cancelAnimationFrame(recordRAF);
    recordRAF = 0;
    recordState = 'idle';
    recordPreviewing = false;
    document.body.classList.remove('record-stage', 'record-running', 'record-controls-hidden', 'record-controls-visible', 'record-paused', 'record-hide-cursor');
    for (const host of Object.values(viewHosts)) host.classList.remove('recording');
    document.body.style.removeProperty('--record-aspect');
    if ($('recordChrome')) $('recordChrome').hidden = true;
    if ($('recordOverlay')) $('recordOverlay').hidden = true;
    if ($('recordGuides')) $('recordGuides').hidden = true;
    if (transportDock) transportDock.inert = false;
    if (appMain) appMain.inert = false;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    if (!keepEnd && !recordSettings.keepEndState) restoreRecordSnapshot(recordSnapshot);
    recordSnapshot = null;
    resizeViewsSoon();
    setStatus('Synced');
    const focusTarget = recordReturnFocus;
    recordReturnFocus = null;
    if (focusTarget?.isConnected) requestAnimationFrame(() => focusTarget.focus?.());
}

function startRecordPreview() {
    if (recordState !== 'idle') return;
    recordSnapshot = captureRecordSnapshot();
    recordPreviewing = true;
    recordState = 'running';
    recordElapsed = 0;
    recordStartedAt = performance.now();
    recordCameraBase = window.__tree3d?.captureCamera?.() || null;
    setStatus('Previewing take');
    showToast('Preview runs with chrome visible; Start take opens the record frame.');
    const tick = (now) => {
        if (recordState !== 'running') return;
        recordElapsed = (now - recordStartedAt) / 1000;
        const sample = sampleTake(recordSettings, recordElapsed, lifespan);
        if (!suspendedPanes.has('2d')) window.__tree2d?.setSeasonSilent?.(sample.season);
        if (!suspendedPanes.has('3d')) window.__tree3d?.setSeasonSilent?.(sample.season);
        driveTime(sample.time);
        if (recordSettings.camera === 'turntable' && recordCameraBase && !suspendedPanes.has('3d')) {
            window.__tree3d?.setCameraPose?.(orbitPose(recordCameraBase, sample.cameraAngle));
        }
        if (sample.phase === 'complete' && recordSettings.loop === 'once') {
            recordState = 'idle';
            recordPreviewing = false;
            restoreRecordSnapshot(recordSnapshot);
            recordSnapshot = null;
            showToast('Preview complete');
            return;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/* ==========================================================================
   Command palette, shortcuts and tour
   ========================================================================== */

let paletteResults = [];
let paletteIndex = 0;
let paletteReturnFocus = null;
const ACTION_COMMANDS = [
    { label: 'Start take', group: 'Deliver · Record', run: () => { setMode('deliver'); deliverTab = 'record'; updateDeliverTab(); openRecordStage(); } },
    { label: 'Preview take', group: 'Deliver · Record', run: () => { setMode('deliver'); deliverTab = 'record'; updateDeliverTab(); startRecordPreview(); } },
    { label: 'Export SVG', group: 'Deliver · Export', run: () => { setMode('deliver'); deliverTab = 'export'; updateDeliverTab(); setDeliverTarget('svg'); findInShadow(shadow2d, 'exportSvg')?.click(); } },
    { label: 'Export GLB', group: 'Deliver · Export', run: () => { setMode('deliver'); deliverTab = 'export'; updateDeliverTab(); setDeliverTarget('glb'); findInShadow(shadow3d, 'exportGlb')?.click(); } },
    { label: 'Export PNG', group: 'Deliver · Export', run: () => findInShadow(activeShadow(), 'exportPng')?.click() },
    { label: 'Export batch ZIP', group: 'Deliver · Export', run: () => findInShadow(activeShadow(), 'exportBatch')?.click() },
    { label: 'Export analytics CSV', group: 'Deliver · Export', run: () => findInShadow(activeShadow(), 'exportCsv')?.click() },
    { label: 'Export analytics JSON', group: 'Deliver · Export', run: () => findInShadow(activeShadow(), 'exportJson')?.click() },
    { label: 'Copy share link', group: 'Project', run: copyCanonicalLink },
    { label: 'Save state', group: 'Project', run: () => findInShadow(activeShadow(), 'saveState')?.click() },
    { label: 'Load state', group: 'Project', run: () => findInShadow(activeShadow(), 'loadState')?.click() },
    { label: 'New seed', group: 'Grow', run: () => findInShadow(activeShadow(), 'reseed')?.click() },
    { label: 'Undo cut', group: 'Sculpt', run: () => findInShadow(activeShadow(), 'undoCut')?.click() },
    { label: 'Redo cut', group: 'Sculpt', run: () => findInShadow(activeShadow(), 'redoCut')?.click() },
    { label: 'Clear cuts', group: 'Sculpt', run: () => findInShadow(activeShadow(), 'clearCuts')?.click() },
    { label: 'Toggle fullscreen', group: 'View', run: toggleFullscreen },
    { label: 'Show Study drawer', group: 'Study', run: () => { setMode('study'); studyOpen = true; applyStudyState(); } },
    { label: 'Keyboard shortcuts', group: 'Help', run: openShortcuts },
    { label: 'Replay first-run tour', group: 'Help', run: () => openTour(true) },
];

function paletteScore(text, query) {
    if (!query) return 1;
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    if (lower.startsWith(q)) return 100;
    const index = lower.indexOf(q);
    if (index >= 0) return 80 - Math.min(20, index / 4);
    // Simple subsequence match.
    let at = 0;
    for (const ch of q) {
        at = lower.indexOf(ch, at);
        if (at < 0) return 0;
        at += 1;
    }
    return 20;
}

function renderPalette(query = '') {
    const list = $('paletteList');
    if (!list) return;
    const controls = MANIFEST.map((entry) => ({
        label: entry.label,
        group: `${entry.mode.charAt(0).toUpperCase() + entry.mode.slice(1)} › ${entry.group.join(' › ')}`,
        entry,
        score: paletteScore(`${entry.label} ${entry.group.join(' ')}`, query),
        command: false,
    }));
    const commands = ACTION_COMMANDS.map((command) => {
        const base = paletteScore(command.label, query);
        return {
            label: command.label,
            group: command.group,
            command,
            score: base ? base + 120 : 0,
            commandFlag: true,
        };
    });
    paletteResults = [...controls, ...commands]
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40);
    paletteIndex = 0;
    list.innerHTML = '';
    paletteResults.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'palette-item';
        li.id = `paletteItem${index}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(index === 0));
        const scope = item.entry ? SCOPE_LABEL[item.entry.scope] : 'Action';
        const scopeClass = item.entry ? `scope-${item.entry.scope}` : 'scope-both';
        li.innerHTML = `<strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.group)}</span><span class="scope-chip ${scopeClass}">${escapeHtml(scope)}</span>`;
        li.addEventListener('click', () => runPaletteItem(index));
        list.appendChild(li);
    });
    updatePaletteSelection();
}

function updatePaletteSelection() {
    const list = $('paletteList');
    const input = $('paletteInput');
    if (!list || !input) return;
    const items = Array.from(list.children);
    items.forEach((item, index) => item.setAttribute('aria-selected', String(index === paletteIndex)));
    const selected = items[paletteIndex];
    if (selected) {
        input.setAttribute('aria-activedescendant', selected.id);
        selected.scrollIntoView({ block: 'nearest' });
    } else {
        input.removeAttribute('aria-activedescendant');
    }
}

function runPaletteItem(index) {
    const item = paletteResults[index];
    closePalette();
    if (!item) return;
    if (item.command) {
        item.command.run();
    } else {
        focusControl(item.entry);
    }
}

function openPalette() {
    const palette = $('palette');
    const backdrop = $('dialogBackdrop');
    if (!palette || !backdrop) return;
    paletteReturnFocus = document.activeElement;
    backdrop.hidden = false;
    palette.hidden = false;
    renderPalette('');
    $('paletteInput').value = '';
    requestAnimationFrame(() => $('paletteInput')?.focus());
}

function closePalette() {
    const palette = $('palette');
    const backdrop = $('dialogBackdrop');
    if (!palette) return;
    palette.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if (paletteReturnFocus?.isConnected) paletteReturnFocus.focus();
    paletteReturnFocus = null;
}

function focusControl(entry) {
    if (!entry) return;
    if (entry.mount === 'project-menu') {
        $('projectMenu').hidden = false;
        $('projectButton').setAttribute('aria-expanded', 'true');
    } else if (entry.mount && entry.mount.startsWith('dock-')) {
        const popovers = { 'dock-lifespan': 'lifespanPopover', 'dock-season': 'seasonPopover', 'dock-speed': 'speedPopover' };
        const popover = popovers[entry.mount];
        if (popover) openPopover($(popover));
    } else if (entry.mount && entry.mount.startsWith('view-')) {
        const pane = entry.mount === 'view-3d' ? paneElements['3d'] : paneElements['2d'];
        const details = pane?.querySelector('.view-menu');
        if (details) details.open = true;
    } else if (STUDIO_MODES.some((item) => item.id === entry.mode)) {
        setMode(entry.mode, { openFlyout: true });
    }

    const node = mounted.get(entry.key);
    if (!node) return;
    let details = node.closest('details');
    while (details) {
        details.open = true;
        details = details.parentElement?.closest('details');
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.add('palette-highlight');
    setTimeout(() => node.classList.remove('palette-highlight'), 1500);
    const target = node.matches('input, select, button')
        ? node
        : node.querySelector('input, select, button');
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
}

function openResetDialog() {
    const dialog = $('resetDialog');
    const backdrop = $('dialogBackdrop');
    if (!dialog) return;
    paletteReturnFocus = document.activeElement;
    if (backdrop) backdrop.hidden = false;
    dialog.hidden = false;
    requestAnimationFrame(() => $('resetCancel')?.focus());
}

function closeResetDialog() {
    const dialog = $('resetDialog');
    const backdrop = $('dialogBackdrop');
    if (!dialog) return;
    dialog.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if (paletteReturnFocus?.isConnected) paletteReturnFocus.focus();
    paletteReturnFocus = null;
}

/**
 * Remove persisted tree/session state and reset UI preferences while keeping
 * the tour-seen flag. Returns a clean URL; the caller performs navigation.
 */
function clearStoredAppState() {
    // Stop both engines before clearing so an in-flight autosave cannot
    // recreate the state we are deleting.
    appStateClearing = true;
    window.__tree2d?.setVisible?.(false);
    window.__tree3d?.setVisible?.(false);
    let tourSeen = false;
    try {
        tourSeen = !!JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}').tourSeen;
    } catch {
        tourSeen = false;
    }
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key === UI_PREFS_KEY || key?.startsWith('parametric-tree-state-')) keys.push(key);
    }
    for (const key of keys) {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
    if (tourSeen) {
        try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ tourSeen: true })); } catch { /* ignore */ }
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('state');
    return url.href;
}

function resetAppState() {
    const href = clearStoredAppState();
    window.location.replace(href);
}

function openShortcuts() {
    const dialog = $('shortcutsDialog');
    const backdrop = $('dialogBackdrop');
    if (!dialog) return;
    paletteReturnFocus = document.activeElement;
    if (backdrop) backdrop.hidden = false;
    dialog.hidden = false;
    requestAnimationFrame(() => dialog.querySelector('[data-close-dialog]')?.focus());
}

function closeShortcuts() {
    const dialog = $('shortcutsDialog');
    const backdrop = $('dialogBackdrop');
    if (!dialog) return;
    dialog.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if (paletteReturnFocus?.isConnected) paletteReturnFocus.focus();
    paletteReturnFocus = null;
}

const TOUR_STEPS = [
    {
        title: 'Two linked views',
        body: 'One tree, shown two ways. The 2D silhouette and the 3D form share a seed, parameters, cuts and time.',
    },
    {
        title: 'Act on the acting view',
        body: 'Click a view to act on it. Prune, Export and Save follow the view marked “Acting here”. The Acting on chip in the flyout always names it.',
    },
    {
        title: 'Grow with the timeline',
        body: 'Drag the timeline to grow the tree. Click a branch to inspect it, then use Sculpt to cut, isolate or compare.',
    },
];
let tourStep = 0;
let tourReturnFocus = null;

function openTour(manual = false) {
    const tour = $('tour');
    if (!tour) return;
    tourStep = 0;
    tourReturnFocus = document.activeElement;
    tour.hidden = false;
    renderTour();
    requestAnimationFrame(() => $('tourNext')?.focus());
    if (manual) setStatus('First-run tour reopened');
}

function renderTour() {
    const step = TOUR_STEPS[tourStep];
    $('tourStepLabel').textContent = `${tourStep + 1} of ${TOUR_STEPS.length}`;
    $('tourTitle').textContent = step.title;
    $('tourBody').textContent = step.body;
    $('tourBack').hidden = tourStep === 0;
    $('tourNext').textContent = tourStep === TOUR_STEPS.length - 1 ? 'Done' : 'Next';
}

function closeTour() {
    const tour = $('tour');
    if (!tour) return;
    tour.hidden = true;
    markTourSeen();
    prefs.tourSeen = true;
    saveUiPrefsNow(prefs);
    if (tourReturnFocus?.isConnected) tourReturnFocus.focus();
    tourReturnFocus = null;
}

/* ==========================================================================
   Popovers, project menu, dialogs
   ========================================================================== */

function openPopover(popover) {
    if (!popover) return;
    const wasOpen = !popover.hidden;
    for (const other of document.querySelectorAll('.popover')) other.hidden = true;
    for (const button of document.querySelectorAll('[data-popover]')) {
        button.setAttribute('aria-expanded', String(button.dataset.popover === popover.id && !wasOpen));
    }
    popover.hidden = wasOpen;
    if (!wasOpen) {
        requestAnimationFrame(() => {
            const focusable = popover.querySelector('input, select, button');
            focusable?.focus();
        });
    }
}

function bindPopovers() {
    for (const button of document.querySelectorAll('[data-popover]')) {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            openPopover($(button.dataset.popover));
        });
    }
    document.addEventListener('click', (event) => {
        if (event.target.closest('.popover') || event.target.closest('[data-popover]')) return;
        for (const popover of document.querySelectorAll('.popover')) popover.hidden = true;
        for (const button of document.querySelectorAll('[data-popover]')) button.setAttribute('aria-expanded', 'false');
        if (!event.target.closest('#dockReadouts') && !event.target.closest('#timelineSettings')) {
            document.body.classList.remove('timeline-open');
            $('timelineSettings')?.setAttribute('aria-expanded', 'false');
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        document.body.classList.remove('timeline-open');
        $('timelineSettings')?.setAttribute('aria-expanded', 'false');
        for (const popover of document.querySelectorAll('.popover')) {
            if (!popover.hidden) {
                popover.hidden = true;
                for (const button of document.querySelectorAll('[data-popover]')) button.setAttribute('aria-expanded', 'false');
            }
        }
    });
}

function bindProjectMenu() {
    const button = $('projectButton');
    const menu = $('projectMenu');
    if (!button || !menu) return;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        menu.hidden = !menu.hidden;
        button.setAttribute('aria-expanded', String(!menu.hidden));
        if (!menu.hidden) requestAnimationFrame(() => menu.querySelector('button')?.focus());
    });
    document.addEventListener('click', (event) => {
        if (event.target.closest('#projectMenu') || event.target.closest('#projectButton')) return;
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    });
    $('projectCopy')?.addEventListener('click', copyCanonicalLink);
    $('projectPreferences')?.addEventListener('click', () => {
        menu.hidden = true;
        focusControl(MANIFEST_BY_KEY.get('param:quality') || MANIFEST_BY_KEY.get('quality'));
    });
    $('projectShortcuts')?.addEventListener('click', () => {
        menu.hidden = true;
        openShortcuts();
    });
    $('projectReset')?.addEventListener('click', () => {
        menu.hidden = true;
        $('projectButton').setAttribute('aria-expanded', 'false');
        openResetDialog();
    });
}

function trapDialogFocus(event) {
    if (event.key !== 'Tab') return;
    const dialog = !$('palette')?.hidden
        ? $('palette')
        : (!($('shortcutsDialog')?.hidden)
            ? $('shortcutsDialog')
            : (!($('resetDialog')?.hidden) ? $('resetDialog') : null));
    if (!dialog) return;
    const focusables = [...dialog.querySelectorAll('button, input, a[href], [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && el.getClientRects().length);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function bindDialogs() {
    window.addEventListener('keydown', trapDialogFocus, true);
    $('searchButton')?.addEventListener('click', openPalette);
    $('helpButton')?.addEventListener('click', openShortcuts);
    $('dialogBackdrop')?.addEventListener('click', () => {
        closePalette();
        closeShortcuts();
        closeResetDialog();
    });
    for (const button of document.querySelectorAll('[data-close-dialog]')) {
        button.addEventListener('click', () => {
            const dialog = $(button.dataset.closeDialog);
            if (dialog?.id === 'shortcutsDialog') closeShortcuts();
            if (dialog?.id === 'resetDialog') closeResetDialog();
        });
    }
    $('resetCancel')?.addEventListener('click', closeResetDialog);
    $('resetConfirm')?.addEventListener('click', resetAppState);
    const input = $('paletteInput');
    input?.addEventListener('input', () => renderPalette(input.value));
    input?.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            paletteIndex = Math.min(paletteResults.length - 1, paletteIndex + 1);
            updatePaletteSelection();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            paletteIndex = Math.max(0, paletteIndex - 1);
            updatePaletteSelection();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            runPaletteItem(paletteIndex);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closePalette();
        }
    });

    // Replay tour affordance in the shortcuts dialog.
    const note = document.querySelector('#shortcutsDialog .dialog-note');
    if (note && !$('replayTour')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'replayTour';
        button.className = 'quiet-button';
        button.textContent = 'Replay first-run tour';
        button.style.marginLeft = '8px';
        button.addEventListener('click', () => {
            closeShortcuts();
            openTour(true);
        });
        note.appendChild(button);
    }

    $('tourNext')?.addEventListener('click', () => {
        if (tourStep >= TOUR_STEPS.length - 1) closeTour();
        else {
            tourStep += 1;
            renderTour();
        }
    });
    $('tourBack')?.addEventListener('click', () => {
        if (tourStep > 0) {
            tourStep -= 1;
            renderTour();
        }
    });
    $('tourSkip')?.addEventListener('click', closeTour);
}

/* ==========================================================================
   Bus, boot, events
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
                // 2D state has no camera; keep the last 3D camera with the
                // shared session instead of dropping it on alternating posts.
                if (!message.state.camera && canonical?.camera) {
                    message.state.camera = canonical.camera;
                }
                canonical = message.state;
                latestState.set(from, message.state);
                if (!appStateClearing) saveTreeStateLocal('app', message.state);
                syncTransportFromState();
                syncPanel();
                if (studyOpen && mode === 'study') {
                    drawStudyChart();
                    renderDataTable();
                }
            }
            const outbound = { type: 'tree-apply-state', state: message.state };
            for (const [dimension, handler] of busListeners) {
                if (dimension === from) continue;
                if (pendingLocalState.has(dimension)) continue;
                if (suspendedPanes.has(dimension)) continue;
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
            if ('season' in message.patch) {
                for (const [dimension, handler] of busListeners) {
                    if (dimension !== from && !suspendedPanes.has(dimension)) handler({ data: message });
                }
            }
            return;
        }

        if (message.type === 'tree-play') return;

        if (message.type === 'tree-request-state') {
            const other = from === '2d' ? latestState.get('3d') : latestState.get('2d');
            if (other) {
                for (const [dimension, handler] of busListeners) {
                    if (dimension !== from && !suspendedPanes.has(dimension)) {
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

function updateFullscreenState() {
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
    if ($('fullscreenExit')) {
        $('fullscreenExit').textContent = active
            ? `Exit ${fullscreenPane.toUpperCase()} fullscreen`
            : 'Exit fullscreen';
    }
    if ($('fullscreen')) $('fullscreen').setAttribute('aria-pressed', String(active));
    resizeViewsSoon();
}

function enterFullscreen() {
    fullscreenPane = activePane;
    fullscreenUiHidden = false;
    if (document.activeElement) document.activeElement.blur();
    updateFullscreenState();
}

function exitFullscreen() {
    if (!fullscreenPane) return;
    fullscreenPane = null;
    fullscreenUiHidden = false;
    updateFullscreenState();
}

function toggleFullscreen() {
    if (fullscreenPane) exitFullscreen();
    else enterFullscreen();
}

function bindHeaderAndRail() {
    for (const button of document.querySelectorAll('[data-layout]')) {
        button.addEventListener('click', () => setLayout(button.dataset.layout));
    }
    for (const button of document.querySelectorAll('[data-mobile-pane]')) {
        button.addEventListener('click', () => {
            setActivePane(button.dataset.mobilePane);
            if (layout !== 'split') setLayout(button.dataset.mobilePane);
        });
    }
    for (const button of document.querySelectorAll('[data-pane-activate]')) {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            setActivePane(button.dataset.paneActivate);
        });
    }
    for (const button of modeRail.querySelectorAll('[data-mode]')) {
        button.addEventListener('click', () => {
            if (button.dataset.mode === mode) {
                if (isPhone()) {
                    setSheetState(sheetState === 'peek' ? 'half' : (sheetState === 'half' ? 'full' : 'peek'));
                } else {
                    setPanelOpen(!panelOpen);
                }
            } else {
                setMode(button.dataset.mode);
                if (isPhone()) setSheetState('half');
            }
        });
        button.addEventListener('keydown', (event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(modeRail.querySelectorAll('[data-mode]'));
            const index = buttons.indexOf(button);
            let next = index;
            if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
            if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = buttons.length - 1;
            buttons[next].focus();
            setMode(buttons[next].dataset.mode);
        });
    }

    for (const [name, pane] of Object.entries(paneElements)) {
        pane?.addEventListener('click', (event) => {
            if (event.target.closest('.view-menu') || event.target.closest('.pane-link-chip')) return;
            setActivePane(name);
        });
    }

    $('panelClose')?.addEventListener('click', () => setPanelOpen(false));
    $('panelCollapse')?.addEventListener('click', () => setPanelOpen(false));
    panelBackdrop?.addEventListener('click', () => {
        if (isPhone() && sheetState !== 'full') {
            setSheetState('peek');
        } else {
            setPanelOpen(false);
        }
    });
    window.addEventListener('keydown', trapPanelFocus, true);

    $('fullscreen')?.addEventListener('click', toggleFullscreen);
    $('fullscreenExit')?.addEventListener('click', exitFullscreen);

    for (const button of document.querySelectorAll('[data-snap]')) {
        button.addEventListener('click', () => setSheetState(button.dataset.snap));
    }
    {
        const handle = document.querySelector('.sheet-handle');
        let startY = null;
        handle?.addEventListener('pointerdown', (event) => {
            if (!isPhone()) return;
            startY = event.clientY;
            handle.setPointerCapture?.(event.pointerId);
        });
        handle?.addEventListener('pointerup', (event) => {
            if (!isPhone() || startY == null) return;
            const dy = event.clientY - startY;
            startY = null;
            const order = ['peek', 'half', 'full'];
            if (Math.abs(dy) < 28) {
                setSheetState(sheetState === 'peek' ? 'half' : (sheetState === 'half' ? 'full' : 'half'));
                return;
            }
            const index = order.indexOf(sheetState);
            const next = dy < 0
                ? order[Math.min(order.length - 1, index + 1)]
                : order[Math.max(0, index - 1)];
            setSheetState(next);
        });
    }

    // Swipe between views on phones.
    let touchStart = null;
    appMain?.addEventListener('touchstart', (event) => {
        if (!isPhone() || event.touches.length !== 1) return;
        touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }, { passive: true });
    appMain?.addEventListener('touchend', (event) => {
        if (!isPhone() || !touchStart) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - touchStart.x;
        const dy = touch.clientY - touchStart.y;
        touchStart = null;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
        const next = dx < 0 ? '3d' : '2d';
        setActivePane(next);
        if (layout !== 'split') setLayout(next);
    }, { passive: true });

    window.addEventListener('resize', () => {
        if (isPhone() && layout !== 'split') setLayout('split', { fromUser: false });
        syncPaneVisibility();
        const mobile = isDrawerMobile();
        if (mobile !== panelWasMobile) {
            panelWasMobile = mobile;
            applyPanelState();
        }
        if (studyOpen && mode === 'study') drawStudyChart();
        if (recordState !== 'idle') {
            document.body.style.setProperty('--record-aspect', recordAspect().toFixed(4));
            updateRecordFrameNote();
        }
        updatePreflight();
    });
}

function bindDock() {
    playButton?.addEventListener('click', togglePlayback);
    $('stepBack')?.addEventListener('click', (event) => stepTime(-1, event.shiftKey ? 10 : 1));
    $('stepForward')?.addEventListener('click', (event) => stepTime(1, event.shiftKey ? 10 : 1));
    $('restart')?.addEventListener('click', () => {
        stopPlayback();
        driveTime(0);
        showToast('Rewound to year 0');
    });
    $('timelineSettings')?.addEventListener('click', (event) => {
        event.stopPropagation();
        const open = document.body.classList.toggle('timeline-open');
        $('timelineSettings').setAttribute('aria-expanded', String(open));
    });
    timeSlider?.addEventListener('input', (event) => {
        stopPlayback();
        driveTime(Number(event.target.value));
    });
    ageInput?.addEventListener('change', () => {
        stopPlayback();
        driveTime(Number(ageInput.value) || 0);
    });
    timeSlider?.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        stopPlayback();
        const step = event.shiftKey ? 10 : 1;
        driveTime(transportTime + (event.key === 'ArrowRight' ? step : -step));
    });
    bindPopovers();
}

function bindKeys() {
    window.addEventListener('keydown', (event) => {
        if (isTypingTarget(event.target)) return;
        const meta = event.metaKey || event.ctrlKey;
        const activeTag = event.target?.tagName;

        // Mode shortcuts use the physical key so Option+digit works on macOS.
        if (event.altKey && !meta && /^Digit[1-4]$/.test(event.code)) {
            event.preventDefault();
            const nextMode = STUDIO_MODES[Number(event.code.slice(5)) - 1];
            if (nextMode) setMode(nextMode.id);
            return;
        }
        if (meta && event.code === 'KeyK') {
            event.preventDefault();
            openPalette();
            return;
        }
        if (event.key === '?' && !meta && !event.altKey) {
            event.preventDefault();
            openShortcuts();
            return;
        }
        if (event.key === 'Escape') {
            if (!$('palette')?.hidden) { closePalette(); return; }
            if (!$('shortcutsDialog')?.hidden) { closeShortcuts(); return; }
            if (!$('resetDialog')?.hidden) { closeResetDialog(); return; }
            if (!$('tour')?.hidden) { closeTour(); return; }
            if (recordState !== 'idle') { exitRecordStage(); return; }
            if (mode === 'study' && (window[activePane === '2d' ? '__tree2d' : '__tree3d']?.selectedNode ?? -1) >= 0) {
                clearSelectionIn(activePane);
                updateAnchoredInspector();
                syncPanel();
                return;
            }
            if (fullscreenPane) { exitFullscreen(); return; }
            if (panelOpen && isPhone()) {
                if (sheetState === 'full') setSheetState('half');
                else setPanelOpen(false);
                return;
            }
            if (panelOpen && isDrawerMobile()) { setPanelOpen(false); return; }
            return;
        }
        if (recordState === 'running' && event.code === 'Space') {
            event.preventDefault();
            pauseRecordTake();
            return;
        }
        if (event.code === 'Space') {
            if (meta || event.altKey) return;
            if (/^(BUTTON|A|SUMMARY)$/.test(activeTag)) return;
            event.preventDefault();
            togglePlayback();
            return;
        }
        if (event.key.toLowerCase() === 'r' && !meta && !event.altKey) {
            event.preventDefault();
            restartPlayback();
            return;
        }
        if (event.key.toLowerCase() === 'h' && !meta && !event.altKey) {
            if (!fullscreenPane) return;
            event.preventDefault();
            fullscreenUiHidden = !fullscreenUiHidden;
            updateFullscreenState();
            return;
        }
        if (event.key.toLowerCase() === 'f' && !meta && !event.altKey) {
            event.preventDefault();
            toggleFullscreen();
            return;
        }
        if (event.key === '1' && !meta && !event.altKey) {
            event.preventDefault();
            if (layout === '3d') setLayout('2d'); else setActivePane('2d');
            return;
        }
        if (event.key === '2' && !meta && !event.altKey) {
            event.preventDefault();
            if (layout === '2d') setLayout('3d'); else setActivePane('3d');
            return;
        }
    });
}

async function boot() {
    document.body.classList.add(`layout-${layout}`, `mode-${mode}`);
    document.body.classList.toggle('panel-open', panelOpen);
    document.body.classList.toggle('panel-collapsed', !panelOpen);
    if (isPhone() && window.innerHeight > window.innerWidth && recordSettings.frame === '16:9') {
        recordSettings.frame = '9:16';
    }
    if (isPhone()) {
        panelOpen = true;
        document.body.classList.add('panel-open', 'sheet', 'sheet-peek');
        document.body.classList.remove('panel-collapsed');
    }
    applyPanelState();
    fillIcons();

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
        studySource = activePane === '3d' ? '3d' : '2d';
        if (window.__tree2d) window.__tree2d.restoreState(shared);
        if (window.__tree3d) window.__tree3d.restoreState(shared);
        saveTreeStateLocal('app', shared);
        if (shared.activePreset && shared.activePreset !== 'custom') lastPreset = shared.activePreset;
        syncTransportFromState();

        buildControlPanel(view2d.css);
        setActivePane(activePane, { silent: true });
        setLayout(layout, { fromUser: false });
        updateModePanelVisibility();
        applySelectionPolicy();
        buildSculptToolbar();
        buildViewMenuProxies();
        buildCameraMenu();
        applyAutoZoomPrefs();
        bindAnchoredInspector();
        bindRecordChrome();
        bindStudyDrawer();
        bindDock();
        bindHeaderAndRail();
        bindProjectMenu();
        bindDialogs();
        bindKeys();
        updateDeliverTab();
        setDeliverTarget(deliverTarget, { switchPane: false });
        updatePreflight();
        updateRecordGuides();
        updateScrubDecor();
        updatePlayButton();
        applyStudyState();

        booting = false;
        window.__TREE_APP_BOOTING__ = false;
        document.body.classList.remove('booting');
        setStatus(stateLoadWarning || 'Synced');

        if (!new URLSearchParams(window.location.search).has('test') && !hasSeenTour()) {
            setTimeout(() => openTour(false), 900);
        }
    } catch (error) {
        console.error(error);
        document.body.classList.remove('booting');
        setStatus('Could not load the split view. Serve this folder over HTTP (for example: python3 -m http.server).');
    }
}

window.__TREE_STUDIO__ = {
    manifest: MANIFEST,
    get mountedKeys() { return Array.from(mounted.keys()); },
    getMounted(key) { return mounted.get(key) || null; },
    get mode() { return mode; },
    get layout() { return layout; },
    get activePane() { return activePane; },
    get recordState() { return recordState; },
    get recordSettings() { return recordSettings; },
    get studySource() { return studySource; },
    setMode,
    setLayout,
    setActivePane,
    focusControl: (key) => focusControl(MANIFEST_BY_KEY.get(key)),
    openPalette,
    openShortcuts,
    openTour,
    setDeliverTarget,
    setSheetState,
    captureRecordSnapshot,
    restoreRecordSnapshot,
    clearStoredAppState,
    openResetDialog,
    closeResetDialog,
    resetAppState,
    clearAllSelections,
    applySelectionPolicy,
};

boot();
