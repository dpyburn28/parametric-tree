/**
 * Shared automation (keyframe) editing UI.
 *
 * Loaded as a classic script. Provides a diamond button helper and a floating
 * editor popover that works in both standalone pages and the split studio.
 */
'use strict';

(function () {
    const UI = {};
    const INTERP = (window.AUTOMATION_INTERP || ['linear', 'smooth', 'step']);
    const LOOP = (window.AUTOMATION_LOOP || ['none', 'loop', 'pingpong']);

    function injectStyles() {
        if (document.getElementById('automation-ui-styles')) return;
        const style = document.createElement('style');
        style.id = 'automation-ui-styles';
        style.textContent = `
            .auto-btn { display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; padding:0; border-radius:50%; border:1px solid var(--line,#ccc); background:var(--card,#fff); color:var(--mut,#666); font-size:11px; line-height:1; cursor:pointer; vertical-align:middle; }
            .auto-btn.on { color:var(--acc,#2f6b2b); border-color:var(--acc,#2f6b2b); }
            .auto-pop { position:fixed; z-index:2147483647; width:300px; max-width:92vw; background:var(--bg,#fff); color:var(--fg,#111); border:1px solid var(--line,#ccc); border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,.25); padding:10px; font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
            .auto-pop h4 { margin:0 0 8px; font-size:13px; display:flex; justify-content:space-between; align-items:center; }
            .auto-pop .row { display:flex; gap:6px; align-items:center; margin:4px 0; }
            .auto-pop .keys { max-height:180px; overflow:auto; margin:6px 0; }
            .auto-pop .keyrow { display:grid; grid-template-columns: 1fr 1fr 24px; gap:4px; margin:3px 0; }
            .auto-pop input, .auto-pop select { width:100%; padding:3px 5px; border:1px solid var(--line,#ccc); border-radius:6px; background:var(--card,#fff); color:var(--fg,#111); font:inherit; }
            .auto-pop button { padding:3px 6px; border-radius:6px; border:1px solid var(--line,#ccc); background:var(--card,#fff); color:var(--fg,#111); cursor:pointer; font:inherit; }
            .auto-pop .actions { display:flex; gap:4px; flex-wrap:wrap; margin-top:6px; }
            .auto-pop .close { border:0; background:transparent; font-size:16px; cursor:pointer; color:var(--mut,#666); }
        `;
        document.head.appendChild(style);
    }

    UI.createButton = function (doc, label) {
        injectStyles();
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'auto-btn';
        btn.textContent = label || '◆';
        return btn;
    };

    function wrapOpts(opts, refresh) {
        const wrap = (fn) => function () {
            const r = fn && fn.apply(this, arguments);
            try { refresh(); } catch (e) {}
            return r;
        };
        if (opts.onToggleTrack) opts.onToggleTrack = wrap(opts.onToggleTrack);
        if (opts.onSetSine) opts.onSetSine = wrap(opts.onSetSine);
        if (opts.onAddKey) opts.onAddKey = wrap(opts.onAddKey);
        if (opts.onUpdateKey) opts.onUpdateKey = wrap(opts.onUpdateKey);
        if (opts.onDeleteKey) opts.onDeleteKey = wrap(opts.onDeleteKey);
        if (opts.onOptions) opts.onOptions = wrap(opts.onOptions);
        if (opts.onClear) opts.onClear = wrap(opts.onClear);
        if (opts.onToggleTrack) {
            const orig = opts.onToggleTrack;
            opts.onToggleTrack = function (on) { return orig(on); };
        }
    }

    function closePopover() {
        const existing = document.querySelector('.auto-pop');
        if (existing) existing.remove();
    }

    function openEditor(anchor, key, opts) {
        injectStyles();
        closePopover();
        const pop = document.createElement('div');
        pop.className = 'auto-pop';
        const rect = anchor.getBoundingClientRect();
        let left = rect.right + 8;
        let top = rect.top;
        if (left + 310 > window.innerWidth) left = Math.max(8, rect.left - 310);
        if (top + 360 > window.innerHeight) top = Math.max(8, window.innerHeight - 370);
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';

        function refresh() {
            render();
            if (anchor && anchor._refresh) anchor._refresh();
        }

        function render() {
            const track = opts.getTrack();
            const time = opts.getTime();
            const lifespan = opts.getLifespan();
            const value = opts.getValue ? opts.getValue() : (track ? opts.getValue() : null);
            const isSine = !!(track && (track.type === 'sine' || (track.amp != null && track.offset != null && !Array.isArray(track.keys))));
            const keys = (track && Array.isArray(track.keys)) ? track.keys.slice() : [];
            pop.innerHTML = '';
            const h = document.createElement('h4');
            h.textContent = key;
            const close = document.createElement('button');
            close.className = 'close';
            close.textContent = '×';
            close.onclick = () => pop.remove();
            h.appendChild(close);
            pop.appendChild(h);

            // Mode switch
            const modeRow = document.createElement('div');
            modeRow.className = 'row';
            const kfBtn = document.createElement('button');
            kfBtn.textContent = 'Keyframes';
            const sineBtn = document.createElement('button');
            sineBtn.textContent = 'Sine wave';
            const activeMode = track ? (isSine ? 'sine' : 'keys') : null;
            kfBtn.style.fontWeight = activeMode === 'keys' ? '700' : '400';
            sineBtn.style.fontWeight = activeMode === 'sine' ? '700' : '400';
            kfBtn.onclick = () => {
                if (activeMode === 'keys') return;
                if (opts.onToggleTrack) opts.onToggleTrack(true);
                refresh();
            };
            sineBtn.onclick = () => {
                if (activeMode === 'sine') return;
                if (opts.onSetSine) opts.onSetSine();
                refresh();
            };
            modeRow.appendChild(kfBtn);
            modeRow.appendChild(sineBtn);
            pop.appendChild(modeRow);

            // Track on/off
            const toggleRow = document.createElement('div');
            toggleRow.className = 'row';
            const toggleBtn = document.createElement('button');
            toggleBtn.textContent = track ? 'Disable track' : 'Enable track';
            toggleBtn.onclick = () => {
                if (track) {
                    if (opts.onClear) opts.onClear();
                } else {
                    // default to keyframes when enabling generically
                    if (opts.onToggleTrack) opts.onToggleTrack(true);
                }
                refresh();
            };
            toggleRow.appendChild(toggleBtn);
            const now = document.createElement('span');
            now.style.color = 'var(--mut,#666)';
            now.textContent = 'now ' + (Number.isFinite(value) ? Number(value).toFixed(3) : value);
            toggleRow.appendChild(now);
            pop.appendChild(toggleRow);

            if (track && !isSine) {
                // Keys
                const keysDiv = document.createElement('div');
                keysDiv.className = 'keys';
                keys.forEach((k, idx) => {
                    const row = document.createElement('div');
                    row.className = 'keyrow';
                    const yInput = document.createElement('input');
                    yInput.type = 'number';
                    yInput.step = '0.1';
                    yInput.value = k[0];
                    yInput.onchange = () => {
                        const y = Number(yInput.value);
                        const v = Number(vInput.value);
                        if (Number.isFinite(y) && Number.isFinite(v)) opts.onUpdateKey(idx, y, v);
                        refresh();
                    };
                    const vInput = document.createElement('input');
                    vInput.type = 'number';
                    vInput.step = '0.01';
                    vInput.value = k[1];
                    vInput.onchange = () => {
                        const y = Number(yInput.value);
                        const v = Number(vInput.value);
                        if (Number.isFinite(y) && Number.isFinite(v)) opts.onUpdateKey(idx, y, v);
                        refresh();
                    };
                    const del = document.createElement('button');
                    del.textContent = '×';
                    del.onclick = () => { opts.onDeleteKey(idx); refresh(); };
                    row.appendChild(yInput);
                    row.appendChild(vInput);
                    row.appendChild(del);
                    keysDiv.appendChild(row);
                });
                pop.appendChild(keysDiv);

                // Add key
                const addRow = document.createElement('div');
                addRow.className = 'actions';
                const addBtn = document.createElement('button');
                addBtn.textContent = 'Add key at playhead (' + Number(time).toFixed(1) + ' yr)';
                addBtn.onclick = () => {
                    const v = opts.getValue ? opts.getValue() : (track ? evaluateTrackSafe(track, time) : null);
                    opts.onAddKey(time, Number.isFinite(v) ? v : (keys.length ? keys[keys.length - 1][1] : 0));
                    refresh();
                };
                addRow.appendChild(addBtn);
                const seekBtn = document.createElement('button');
                seekBtn.textContent = 'Seek selected';
                seekBtn.onclick = () => {
                    if (opts.onSeek && keys.length) opts.onSeek(keys[0][0]);
                };
                addRow.appendChild(seekBtn);
                pop.appendChild(addRow);

                // Options
                const optRow = document.createElement('div');
                optRow.className = 'row';
                const interpSel = document.createElement('select');
                INTERP.forEach((it) => {
                    const o = document.createElement('option');
                    o.value = it; o.textContent = it;
                    if (it === track.interp) o.selected = true;
                    interpSel.appendChild(o);
                });
                interpSel.onchange = () => { opts.onOptions({ interp: interpSel.value }); refresh(); };
                const loopSel = document.createElement('select');
                LOOP.forEach((it) => {
                    const o = document.createElement('option');
                    o.value = it; o.textContent = it;
                    if (it === track.loop) o.selected = true;
                    loopSel.appendChild(o);
                });
                loopSel.onchange = () => { opts.onOptions({ loop: loopSel.value }); refresh(); };
                optRow.appendChild(interpSel);
                optRow.appendChild(loopSel);
                pop.appendChild(optRow);

                const clearRow = document.createElement('div');
                clearRow.className = 'actions';
                const clearBtn = document.createElement('button');
                clearBtn.textContent = 'Clear track';
                clearBtn.onclick = () => { opts.onClear(); refresh(); };
                clearRow.appendChild(clearBtn);
                pop.appendChild(clearRow);
            }

            if (track && isSine) {
                const sineRow = document.createElement('div');
                sineRow.className = 'row';
                const ampLabel = document.createElement('span');
                ampLabel.textContent = 'Amp';
                const ampInput = document.createElement('input');
                ampInput.type = 'number';
                ampInput.step = '0.01';
                ampInput.value = track.amp;
                const offLabel = document.createElement('span');
                offLabel.textContent = 'Offset';
                const offInput = document.createElement('input');
                offInput.type = 'number';
                offInput.step = '0.01';
                offInput.value = track.offset;
                const perLabel = document.createElement('span');
                perLabel.textContent = 'Period';
                const perInput = document.createElement('input');
                perInput.type = 'number';
                perInput.step = '1';
                perInput.value = Number.isFinite(track.period) && track.period > 0 ? track.period : '';
                perInput.placeholder = 'yrs';
                function commitSine() {
                    const a = Number(ampInput.value);
                    const o = Number(offInput.value);
                    const p = Number(perInput.value);
                    if (opts.onSetSine) opts.onSetSine(a, o, Number.isFinite(p) && p > 0 ? p : null);
                    refresh();
                }
                ampInput.onchange = commitSine;
                offInput.onchange = commitSine;
                perInput.onchange = commitSine;
                sineRow.appendChild(ampLabel);
                sineRow.appendChild(ampInput);
                sineRow.appendChild(offLabel);
                sineRow.appendChild(offInput);
                sineRow.appendChild(perLabel);
                sineRow.appendChild(perInput);
                pop.appendChild(sineRow);

                const clearRow = document.createElement('div');
                clearRow.className = 'actions';
                const clearBtn = document.createElement('button');
                clearBtn.textContent = 'Clear track';
                clearBtn.onclick = () => { opts.onClear(); refresh(); };
                clearRow.appendChild(clearBtn);
                pop.appendChild(clearRow);
            }

            const note = document.createElement('div');
            note.style.color = 'var(--mut,#666)';
            note.style.fontSize = '10px';
            note.style.marginTop = '6px';
            note.textContent = 'Keys are in tree years. Growth keys affect new growth from that age onward.';
            pop.appendChild(note);
        }

        function evaluateTrackSafe(track, t) {
            if (typeof evaluateTrack === 'function') {
                const fallback = (track && Array.isArray(track.keys) && track.keys.length) ? track.keys[0][1] : (Number.isFinite(track?.offset) ? track.offset : 0);
                return evaluateTrack(track, t, fallback, opts.getLifespan ? opts.getLifespan() : undefined);
            }
            if (track && Array.isArray(track.keys) && track.keys.length) return track.keys[track.keys.length - 1][1];
            return Number.isFinite(track?.offset) ? track.offset : 0;
        }

        wrapOpts(opts, refresh);
        render();
        document.body.appendChild(pop);

        const onDocClick = (e) => {
            if (!pop.contains(e.target) && e.target !== anchor) {
                pop.remove();
                document.removeEventListener('mousedown', onDocClick, true);
                document.removeEventListener('keydown', onKey, true);
            }
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                pop.remove();
                document.removeEventListener('mousedown', onDocClick, true);
                document.removeEventListener('keydown', onKey, true);
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', onDocClick, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
    }

    UI.attach = function (btn, key, opts) {
        injectStyles();
        wrapOpts(opts, function () {
            if (btn && btn._refresh) btn._refresh();
        });
        btn._refresh = function () {
            const track = opts.getTrack();
            btn.classList.toggle('on', !!track);
            btn.title = track ? 'Edit automation' : 'Animate this parameter over time';
        };
        btn._refresh();
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openEditor(btn, key, opts);
        });
    };

    UI.openEditor = openEditor;
    window.AutomationUI = UI;
})();
