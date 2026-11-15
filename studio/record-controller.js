/**
 * Deterministic take controller math.
 *
 * Kept framework-free and side-effect-free so it can be unit-tested with a
 * fake clock. The studio shell owns timers, rendering and browser chrome.
 */

export const EASINGS = {
    linear: (t) => t,
    'ease-out': (t) => 1 - (1 - t) * (1 - t),
    'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),
};

export const TAKE_PRESETS = {
    timelapse: {
        label: 'Growth time-lapse',
        description: 'The whole life of the tree in twenty seconds, then hold the mature crown.',
        values: {
            startAge: 0,
            endAge: null,
            duration: 20,
            easing: 'linear',
            holdStart: 1,
            holdEnd: 3,
            loop: 'once',
            camera: 'fixed',
            seasonMode: 'phenology',
        },
    },
    reveal: {
        label: 'Slow reveal',
        description: 'A slower take with fast early growth and a long, slow finish.',
        values: {
            startAge: 0,
            endAge: null,
            duration: 60,
            easing: 'ease-out',
            holdStart: 1,
            holdEnd: 3,
            loop: 'once',
            camera: 'fixed',
            seasonMode: 'phenology',
        },
    },
    turntable: {
        label: 'Turntable',
        description: 'Hold the current year and orbit the 3D camera through a full turn.',
        values: {
            startAge: null,
            endAge: null,
            duration: 15,
            easing: 'linear',
            holdStart: 0,
            holdEnd: 1,
            loop: 'once',
            camera: 'turntable',
            turntableSpeed: 24,
            seasonMode: 'lock',
        },
    },
    seasons: {
        label: 'Four seasons',
        description: 'Hold the current year while the season sweeps through a full cycle.',
        values: {
            startAge: null,
            endAge: null,
            duration: 16,
            easing: 'linear',
            holdStart: 0,
            holdEnd: 1,
            loop: 'once',
            camera: 'fixed',
            seasonMode: 'sweep',
            seasonSweep: 16,
        },
    },
};

export function easing(name) {
    return EASINGS[name] || EASINGS.linear;
}

export function normalizeSettings(settings = {}, lifespan = 300) {
    const startAge = Number.isFinite(+settings.startAge) ? +settings.startAge : 0;
    const endAge = settings.endAge == null || settings.endAge === ''
        ? lifespan
        : Math.max(startAge, Math.min(lifespan, +settings.endAge));
    const duration = Math.max(1, +settings.duration || 20);
    return {
        startAge: Math.max(0, Math.min(lifespan, startAge)),
        endAge,
        duration,
        easing: settings.easing || 'linear',
        holdStart: Math.max(0, Math.min(10, +settings.holdStart ?? 1)),
        holdEnd: Math.max(0, Math.min(10, +settings.holdEnd ?? 3)),
        loop: settings.loop || 'once',
        camera: settings.camera || 'fixed',
        turntableSpeed: +settings.turntableSpeed || 24,
        seasonMode: settings.seasonMode || 'phenology',
        seasonLock: Number.isFinite(+settings.seasonLock) ? +settings.seasonLock : 0.33,
        seasonSweep: Math.max(1, +settings.seasonSweep || 16),
        startHold: Math.max(0, Math.min(10, +settings.holdStart ?? 1)),
        endHold: Math.max(0, Math.min(10, +settings.holdEnd ?? 3)),
    };
}

/**
 * Map elapsed wall-clock seconds to a take sample.
 *
 * Phases: `start-hold`, `run`, `end-hold`, `complete`. Looping restarts the
 * whole segment; ping-pong reverses the run segment on alternate passes while
 * still honouring both holds.
 */
export function sampleTake(settings, elapsedSeconds, lifespan = 300) {
    const s = normalizeSettings(settings, lifespan);
    const segment = s.holdStart + s.duration + s.holdEnd;
    let phase = 'run';
    let loopCount = 0;
    let local = Math.max(0, elapsedSeconds);

    if (s.loop === 'loop' || s.loop === 'ping-pong') {
        if (local >= segment) {
            loopCount = Math.floor(local / segment);
            local %= segment;
        }
    }

    let progress = 0;
    if (local < s.holdStart) {
        phase = 'start-hold';
        progress = 0;
    } else if (local < s.holdStart + s.duration) {
        phase = 'run';
        progress = (local - s.holdStart) / s.duration;
    } else if (local < segment) {
        phase = 'end-hold';
        progress = 1;
    } else {
        phase = 'complete';
        progress = 1;
    }

    if (s.loop === 'ping-pong' && loopCount % 2 === 1) {
        progress = 1 - progress;
    }

    const eased = easing(s.easing)(Math.min(1, Math.max(0, progress)));
    const time = s.startAge + (s.endAge - s.startAge) * eased;
    let season = s.seasonLock;
    if (s.seasonMode === 'phenology') season = ((time % 4) + 4) % 4 / 4;
    else if (s.seasonMode === 'sweep') season = ((elapsedSeconds % s.seasonSweep) / s.seasonSweep);
    const cameraAngle = s.camera === 'turntable' ? (elapsedSeconds * s.turntableSpeed) % 360 : 0;

    return {
        phase: elapsedSeconds >= segment && s.loop === 'once' ? 'complete' : phase,
        progress,
        eased,
        time,
        season,
        cameraAngle,
        loopCount,
        segment,
        total: s.loop === 'once' ? segment : Infinity,
    };
}

/** Human-readable take duration (holds included). */
export function takeDuration(settings, lifespan = 300) {
    const s = normalizeSettings(settings, lifespan);
    return s.holdStart + s.duration + s.holdEnd;
}

/** Rotate a camera pose around its target by `degrees`. */
export function orbitPose(pose, degrees) {
    if (!pose || !pose.position || !pose.target) return pose;
    const [x, y, z] = pose.position;
    const [tx, ty, tz] = pose.target;
    const rad = (degrees * Math.PI) / 180;
    const dx = x - tx;
    const dz = z - tz;
    return {
        position: [
            tx + dx * Math.cos(rad) - dz * Math.sin(rad),
            y,
            tz + dx * Math.sin(rad) + dz * Math.cos(rad),
        ],
        target: pose.target.slice(),
    };
}
