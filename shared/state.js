/**
 * Shared persistence and share-link state for both prototypes.
 *
 * Only user-facing state is stored: seed, parameters, cuts, time, season,
 * preset, visualization settings, and optional 3D camera. The skeleton is
 * always rebuilt from this state.
 */

'use strict';

const TREE_STATE_VERSION = 2;
const TREE_STATE_LOCAL_PREFIX = 'parametric-tree-state';

/**
 * Migration steps are intentionally small and pure. Add a new entry when a
 * persisted field changes shape; never edit an old migration once shipped.
 */
const TREE_STATE_MIGRATIONS = {
    1(state) {
        const next = Object.assign({}, state);
        next.version = 2;
        next.params = next.params && typeof next.params === 'object' ? next.params : {};
        next.cuts = Array.isArray(next.cuts) ? next.cuts : [];
        next.viz = next.viz && typeof next.viz === 'object' ? next.viz : {};
        next.ui = next.ui && typeof next.ui === 'object' ? next.ui : { theme: 'auto' };
        next.exportSettings = next.exportSettings && typeof next.exportSettings === 'object'
            ? next.exportSettings
            : null;
        next.compare = next.compare && typeof next.compare === 'object' ? next.compare : null;
        return next;
    },
};

function migrateTreeState(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new Error('Tree state must be an object.');
    }
    let version = Number(state.version);
    if (!Number.isFinite(version)) {
        throw new Error('Tree state is missing a version number.');
    }
    if (version > TREE_STATE_VERSION) {
        throw new Error(
            `Tree state version ${version} is newer than the supported version ${TREE_STATE_VERSION}.`
        );
    }
    let next = state;
    while (version < TREE_STATE_VERSION) {
        const migrate = TREE_STATE_MIGRATIONS[version];
        if (!migrate) {
            throw new Error(`No migration path from tree state version ${version}.`);
        }
        next = migrate(next);
        version = Number(next.version);
    }
    return next;
}

function cloneParamValue(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object') return Object.assign({}, value);
    return value;
}

function captureTreeState(app) {
    const params = {};
    for (const [key, value] of Object.entries(app.P)) {
        params[key] = cloneParamValue(value);
    }
    return {
        version: TREE_STATE_VERSION,
        dimension: app.dimension,
        seed: app.seed,
        params,
        cuts: Array.from(app.prunedCuts.entries()).map(([key, value]) => [key, value.type || 'thinning']),
        time: app.time,
        season: app.season,
        seasonAuto: !!app.seasonAuto,
        activePreset: app.activePreset,
        viz: Object.assign({}, app.viz),
        ui: app.ui ? Object.assign({}, app.ui) : { theme: 'auto' },
        exportSettings: app.exportSettings ? Object.assign({}, app.exportSettings) : null,
        compare: app.compare ? Object.assign({}, app.compare) : null,
        camera: app.camera ? {
            position: [app.camera.position.x, app.camera.position.y, app.camera.position.z],
            target: [app.camera.target.x, app.camera.target.y, app.camera.target.z],
        } : null,
    };
}

function stateToJson(state) {
    return JSON.stringify(state);
}

function stateFromJson(text) {
    let state;
    try {
        state = JSON.parse(text);
    } catch (error) {
        throw new Error(`Could not parse tree state JSON: ${error.message}`);
    }
    return migrateTreeState(state);
}

function encodeTreeState(state) {
    const json = stateToJson(state);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeTreeState(encoded) {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
        + '='.repeat((4 - encoded.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return stateFromJson(new TextDecoder().decode(bytes));
}

function treeStateFromUrl(locationObject) {
    const url = new URL(locationObject.href);
    const encoded = url.searchParams.get('state') || url.hash.replace(/^#state=/, '');
    if (!encoded) return null;
    return decodeTreeState(encoded);
}

function treeShareUrl(locationObject, state) {
    const url = new URL(locationObject.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('state', encodeTreeState(state));
    return url.toString();
}

function applyTreeStateParams(state, P) {
    if (!state || !state.params) return;
    for (const [key, value] of Object.entries(state.params)) {
        if (!(key in P)) continue;
        if (key === 'phenology') {
            P.phenology = Object.assign({}, P.phenology, value);
        } else if (key === 'angleOrderBias') {
            P.angleOrderBias = Array.isArray(value) ? value.slice() : P.angleOrderBias;
        } else {
            P[key] = value;
        }
    }
}

function treeStateStorageKey(dimension) {
    return `${TREE_STATE_LOCAL_PREFIX}-${dimension}`;
}

function saveTreeStateLocal(dimension, state) {
    try {
        localStorage.setItem(treeStateStorageKey(dimension), stateToJson(state));
        return true;
    } catch {
        return false;
    }
}

function loadTreeStateLocalResult(dimension) {
    try {
        const text = localStorage.getItem(treeStateStorageKey(dimension));
        if (!text) return { state: null, error: null };
        return { state: stateFromJson(text), error: null };
    } catch (error) {
        return { state: null, error };
    }
}

function loadTreeStateLocal(dimension) {
    return loadTreeStateLocalResult(dimension).state;
}

function clearTreeStateLocal(dimension) {
    try {
        localStorage.removeItem(treeStateStorageKey(dimension));
    } catch {
        // Ignore storage failures.
    }
}

function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTextFile(name, text, type = 'application/json') {
    downloadBlob(name, new Blob([text], { type }));
}

function readTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}
