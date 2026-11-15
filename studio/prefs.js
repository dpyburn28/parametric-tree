/**
 * Studio UI preferences.
 *
 * Deliberately separate from simulation state (schema v2) and share links.
 * Anything persisted here is presentation or workflow chrome only.
 */

const KEY = 'ptree.ui.v1';

export const DEFAULT_UI_PREFS = {
    mode: 'grow',
    flyoutOpen: true,
    layout: 'split',
    activePane: '2d',
    studyOpen: false,
    studyHeight: 280,
    autoZoom2d: true,
    autoZoom3d: true,
    record: {
        preset: 'timelapse',
        source: 'split',
        frame: '16:9',
        startAge: 0,
        endAge: null,
        duration: 20,
        easing: 'linear',
        holdStart: 1,
        holdEnd: 3,
        loop: 'once',
        camera: 'fixed',
        turntableSpeed: 24,
        seasonMode: 'phenology',
        seasonLock: 0.33,
        seasonSweep: 16,
        yearCounter: true,
        title: '',
        caption: '',
        overlayPosition: 'bottom-left',
        overlaySize: 'medium',
        guides: true,
        countdown: 3,
        hideCursor: true,
        keepEndState: false,
    },
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function loadUiPrefs() {
    const prefs = clone(DEFAULT_UI_PREFS);
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return prefs;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return prefs;
        const merged = Object.assign(prefs, {
            mode: ['grow', 'sculpt', 'study', 'deliver'].includes(parsed.mode) ? parsed.mode : prefs.mode,
            flyoutOpen: parsed.flyoutOpen !== false,
            layout: ['split', '2d', '3d'].includes(parsed.layout) ? parsed.layout : prefs.layout,
            activePane: parsed.activePane === '3d' ? '3d' : '2d',
            studyOpen: !!parsed.studyOpen,
            studyHeight: Math.min(480, Math.max(160, Number(parsed.studyHeight) || prefs.studyHeight)),
            autoZoom2d: parsed.autoZoom2d !== false,
            autoZoom3d: parsed.autoZoom3d !== false,
            record: Object.assign(prefs.record, parsed.record || {}),
            tourSeen: !!parsed.tourSeen,
        });
        return merged;
    } catch {
        return prefs;
    }
}

let saveTimer = 0;
export function saveUiPrefs(prefs) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = 0;
        try {
            localStorage.setItem(KEY, JSON.stringify(prefs));
        } catch {
            // Private-mode storage failures are non-fatal.
        }
    }, 120);
}

export function saveUiPrefsNow(prefs) {
    try {
        localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
        // ignore
    }
}

export function markTourSeen() {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
        raw.tourSeen = true;
        localStorage.setItem(KEY, JSON.stringify(raw));
    } catch {
        // ignore
    }
}

export function hasSeenTour() {
    try {
        return !!JSON.parse(localStorage.getItem(KEY) || '{}').tourSeen;
    } catch {
        return true;
    }
}

export { KEY as UI_PREFS_KEY };
