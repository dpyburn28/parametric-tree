/**
 * Studio UI preferences.
 *
 * Deliberately separate from simulation state and share links.
 * Anything persisted here is presentation or workflow chrome only.
 */

const KEY = 'ptree.ui.v1';

export const DEFAULT_UI_PREFS = {
    flyoutOpen: true,
    layout: 'split',
    activePane: '2d',
    autoZoom2d: true,
    autoZoom3d: true,
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
            flyoutOpen: parsed.flyoutOpen !== false,
            layout: ['split', '2d', '3d'].includes(parsed.layout) ? parsed.layout : prefs.layout,
            activePane: parsed.activePane === '3d' ? '3d' : '2d',
            autoZoom2d: parsed.autoZoom2d !== false,
            autoZoom3d: parsed.autoZoom3d !== false,
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
