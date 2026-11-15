/** Small inline-SVG icon set. Icons are always paired with a text label. */

const svg = (body, viewBox = '0 0 24 24') =>
    `<svg class="icon" viewBox="${viewBox}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
    grow: svg('<path d="M12 21V9"/><path d="M12 13c0-4 3-7 7-7 0 4-3 7-7 7Z"/><path d="M12 17c0-3-2.4-5.4-5.4-5.4C6.6 14.6 9 17 12 17Z"/><path d="M8 21h8"/>'),
    sculpt: svg('<path d="M4 20c4-2 6-5 7-9"/><path d="M14 5l5 5"/><path d="M12 7l5-5 5 5-5 5Z"/><path d="M16 16l4 4"/>'),
    study: svg('<path d="M4 20V4"/><path d="M4 20h16"/><path d="M7 16l4-5 3 3 5-7"/>'),
    deliver: svg('<path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M4 17v3h16v-3"/>'),
    play: svg('<path d="M8 5l11 7-11 7Z"/>'),
    pause: svg('<path d="M8 5v14M16 5v14"/>'),
    rewind: svg('<path d="M11 6 4 12l7 6Z"/><path d="M20 6l-7 6 7 6Z"/>'),
    stepBack: svg('<path d="M16 6 8 12l8 6Z"/><path d="M5 5v14"/>'),
    stepForward: svg('<path d="M8 6l8 6-8 6Z"/><path d="M19 5v14"/>'),
    record: svg('<circle cx="12" cy="12" r="7"/>'),
    search: svg('<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>'),
    help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 3.4 2.5c-.7.3-.9.9-.9 1.5"/><path d="M12 17h.01"/>'),
    close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
    chevron: svg('<path d="m6 9 6 6 6-6"/>'),
    isolate: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
    ghost: svg('<path d="M5 20V9a7 7 0 0 1 14 0v11l-3-2-2 2-2-2-2 2-2-2Z"/>'),
    scissors: svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 8l12 12M8 16 20 4"/>'),
    export: svg('<path d="M12 16V4"/><path d="m8 8 4-4 4 4"/><path d="M4 16v4h16v-4"/>'),
    camera: svg('<path d="M4 8h3l2-2h6l2 2h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>'),
};

export function modeIcon(name) {
    return ICONS[name] || ICONS.grow;
}
