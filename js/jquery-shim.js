/**
 * jquery-shim.js — Micro jQuery shim for stages2.js STV animation engine.
 * Implements only the 21 jQuery methods actually used by stages2.js.
 * 
 * Methods: $(), $.ajax, .text, .html, .css, .width, .height, .show, .hide,
 *   .addClass, .removeClass, .hasClass, .toggleClass, .on, .off,
 *   .append, .empty, .remove, .data, .attr, .find, .animate, .stop,
 *   .length, .each
 */
(function (root) {
    'use strict';

    // ---- Private helpers ----

    /** Parse an HTML string into DOM elements */
    function _createFromHTML(htmlStr) {
        const tpl = document.createElement('template');
        tpl.innerHTML = htmlStr.trim();
        return Array.from(tpl.content.childNodes);
    }

    /** Shared WeakMap for .data() storage (avoids polluting DOM elements) */
    const _dataStore = new WeakMap();

    function _getData(el) {
        if (!_dataStore.has(el)) _dataStore.set(el, {});
        return _dataStore.get(el);
    }

    /** Active animation timers keyed by element */
    const _animTimers = new WeakMap();

    /** Process the next entry in an element's animation queue */
    function _processQueue(el) {
        if (!el._shimAnimQueue || !el._shimAnimQueue.length) {
            el._shimQueueRunning = false;
            return;
        }
        el._shimQueueRunning = true;
        const entry = el._shimAnimQueue[0];

        if (entry.type === 'delay') {
            const timeout = setTimeout(() => {
                el._shimAnimQueue.shift();
                _processQueue(el);
            }, entry.ms);
            _animTimers.set(el, { raf: 0, timeout });
        } else if (entry.type === 'animate') {
            el._shimAnimQueue.shift();
            _runAnimation(el, entry.props, entry.durationMs, entry.startCb, entry.completeCb);
        }
    }

    /** Execute a single animation step with requestAnimationFrame */
    function _runAnimation(el, props, durationMs, startCb, completeCb) {
        // Store target for .stop(true, true)
        el._shimAnimTarget = { ...props };

        // Fire the start callback
        if (startCb) startCb.call(el);

        // Parse current values for each property
        const startValues = {};
        const endValues = {};
        const units = {};
        for (const [prop, rawTarget] of Object.entries(props)) {
            const computed = window.getComputedStyle(el)[prop] || '0';
            const startNum = parseFloat(computed) || 0;
            const endNum = typeof rawTarget === 'number' ? rawTarget : parseFloat(rawTarget) || 0;
            if (typeof rawTarget === 'number') {
                units[prop] = prop === 'opacity' ? '' : 'px';
            } else {
                const m = String(rawTarget).match(/[a-z%]+$/i);
                units[prop] = m ? m[0] : 'px';
            }
            startValues[prop] = startNum;
            endValues[prop] = endNum;
        }

        const startTime = performance.now();
        const step = (now) => {
            const elapsed = now - startTime;
            const t = Math.min(1, elapsed / durationMs);
            // Ease-in-out
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

            for (const prop of Object.keys(props)) {
                const val = startValues[prop] + (endValues[prop] - startValues[prop]) * eased;
                el.style[prop] = val + units[prop];
            }

            if (t < 1) {
                const raf = requestAnimationFrame(step);
                _animTimers.set(el, { raf, timeout: 0 });
            } else {
                // Ensure exact final values
                for (const [prop, rawTarget] of Object.entries(props)) {
                    el.style[prop] = typeof rawTarget === 'number'
                        ? rawTarget + units[prop] : rawTarget;
                }
                _animTimers.delete(el);
                el._shimAnimTarget = null;
                if (completeCb) completeCb.call(el);
                // Process next queued animation
                _processQueue(el);
            }
        };

        const raf = requestAnimationFrame(step);
        _animTimers.set(el, { raf, timeout: 0 });
    }

    // ---- $Set: the jQuery-like wrapper ----

    class $Set {
        constructor(elements) {
            this._els = elements || [];
            this.length = this._els.length;
            // Expose indexed access (stages2.js uses [0] occasionally)
            for (let i = 0; i < this._els.length; i++) {
                this[i] = this._els[i];
            }
        }

        // ---- Text & HTML ----

        text(value) {
            if (value === undefined) {
                return this._els.length ? this._els[0].textContent : '';
            }
            this._els.forEach(el => { el.textContent = value; });
            return this;
        }

        html(value) {
            if (value === undefined) {
                return this._els.length ? this._els[0].innerHTML : '';
            }
            this._els.forEach(el => { el.innerHTML = value; });
            return this;
        }

        // ---- CSS ----

        css(prop, value) {
            if (typeof prop === 'object') {
                // css({ top: 10, left: 20 })
                this._els.forEach(el => {
                    for (const [k, v] of Object.entries(prop)) {
                        el.style[k] = typeof v === 'number' && k !== 'zIndex' && k !== 'opacity'
                            ? v + 'px' : v;
                    }
                });
                return this;
            }
            if (value === undefined) {
                // Getter
                if (!this._els.length) return undefined;
                return getComputedStyle(this._els[0])[prop];
            }
            // Setter
            this._els.forEach(el => {
                el.style[prop] = typeof value === 'number' && prop !== 'zIndex' && prop !== 'opacity'
                    ? value + 'px' : value;
            });
            return this;
        }

        // ---- Dimensions ----

        width(value) {
            if (value === undefined) {
                return this._els.length ? this._els[0].offsetWidth : 0;
            }
            const px = typeof value === 'number' ? value + 'px' : value;
            this._els.forEach(el => { el.style.width = px; });
            return this;
        }

        height(value) {
            if (value === undefined) {
                return this._els.length ? this._els[0].offsetHeight : 0;
            }
            const px = typeof value === 'number' ? value + 'px' : value;
            this._els.forEach(el => { el.style.height = px; });
            return this;
        }

        // ---- Display ----

        show() {
            this._els.forEach(el => { el.style.display = ''; });
            return this;
        }

        hide() {
            this._els.forEach(el => { el.style.display = 'none'; });
            return this;
        }

        // ---- Classes ----

        addClass(names) {
            const classes = names.split(/\s+/).filter(Boolean);
            this._els.forEach(el => el.classList.add(...classes));
            return this;
        }

        removeClass(names) {
            const classes = names.split(/\s+/).filter(Boolean);
            this._els.forEach(el => el.classList.remove(...classes));
            return this;
        }

        hasClass(name) {
            return this._els.length ? this._els[0].classList.contains(name) : false;
        }

        toggleClass(name, force) {
            this._els.forEach(el => {
                if (force !== undefined) {
                    el.classList.toggle(name, force);
                } else {
                    el.classList.toggle(name);
                }
            });
            return this;
        }

        // ---- Events ----

        on(event, handler) {
            this._els.forEach(el => {
                if (!el._shimHandlers) el._shimHandlers = {};
                if (!el._shimHandlers[event]) el._shimHandlers[event] = [];
                el._shimHandlers[event].push(handler);
                el.addEventListener(event, handler);
            });
            return this;
        }

        off(eventOrNothing) {
            this._els.forEach(el => {
                if (!el._shimHandlers) return;
                if (eventOrNothing) {
                    const handlers = el._shimHandlers[eventOrNothing] || [];
                    handlers.forEach(h => el.removeEventListener(eventOrNothing, h));
                    el._shimHandlers[eventOrNothing] = [];
                } else {
                    // Remove all
                    for (const [evt, handlers] of Object.entries(el._shimHandlers)) {
                        handlers.forEach(h => el.removeEventListener(evt, h));
                    }
                    el._shimHandlers = {};
                }
            });
            return this;
        }

        click(handler) {
            if (handler) {
                return this.on('click', handler);
            }
            // No-args click() triggers click
            this._els.forEach(el => el.click());
            return this;
        }

        // ---- DOM Manipulation ----

        append(content) {
            this._els.forEach(el => {
                if (typeof content === 'string') {
                    el.insertAdjacentHTML('beforeend', content);
                } else if (content instanceof $Set) {
                    content._els.forEach(child => el.appendChild(child));
                } else if (content instanceof Node) {
                    el.appendChild(content);
                }
            });
            return this;
        }

        empty() {
            this._els.forEach(el => { el.innerHTML = ''; });
            return this;
        }

        remove() {
            this._els.forEach(el => { if (el.parentNode) el.parentNode.removeChild(el); });
            return this;
        }

        appendTo(target) {
            const targets = typeof target === 'string'
                ? Array.from(document.querySelectorAll(target))
                : (target instanceof $Set ? target._els : [target]);
            if (targets.length) {
                this._els.forEach(el => targets[0].appendChild(el));
            }
            return this;
        }

        // ---- Data ----

        data(key, value) {
            if (value === undefined) {
                // Getter
                if (!this._els.length) return undefined;
                const store = _getData(this._els[0]);
                if (key === undefined) return store;
                // Return stored value if present; otherwise fall back to
                // data-* HTML attribute (matches real jQuery behaviour).
                if (key in store) return store[key];
                const attrVal = this._els[0].getAttribute('data-' + key);
                if (attrVal !== null) {
                    // Auto-convert numeric strings (jQuery does this too)
                    const num = Number(attrVal);
                    return String(num) === attrVal ? num : attrVal;
                }
                return undefined;
            }
            // Setter
            this._els.forEach(el => {
                const store = _getData(el);
                store[key] = value;
            });
            return this;
        }

        removeData(key) {
            this._els.forEach(el => {
                const store = _getData(el);
                delete store[key];
            });
            return this;
        }

        // ---- Attributes ----

        attr(name, value) {
            if (value === undefined) {
                return this._els.length ? this._els[0].getAttribute(name) : undefined;
            }
            this._els.forEach(el => el.setAttribute(name, value));
            return this;
        }

        // ---- Traversal ----

        find(selector) {
            const results = [];
            this._els.forEach(el => {
                results.push(...el.querySelectorAll(selector));
            });
            return new $Set(results);
        }

        // ---- Animation ----
        // Full jQuery-compatible animation queue: chained .animate() calls
        // execute sequentially, .delay() inserts pauses, and object-form
        // options ({duration, start, complete}) are supported.

        stop(clearQueue, jumpToEnd) {
            this._els.forEach(el => {
                // Cancel any pending animation frame/timer
                const timer = _animTimers.get(el);
                if (timer) {
                    cancelAnimationFrame(timer.raf);
                    clearTimeout(timer.timeout);
                    _animTimers.delete(el);
                }
                if (clearQueue && el._shimAnimQueue) {
                    el._shimAnimQueue = [];
                    el._shimQueueRunning = false;
                }
                if (jumpToEnd && el._shimAnimTarget) {
                    // Jump to final values
                    for (const [prop, val] of Object.entries(el._shimAnimTarget)) {
                        el.style[prop] = typeof val === 'number' ? val + 'px' : val;
                    }
                    el._shimAnimTarget = null;
                }
                // Remove transition to stop any CSS-driven animation
                el.style.transition = 'none';
                // Force reflow so transition:none takes effect immediately
                el.offsetHeight; // eslint-disable-line no-unused-expressions
            });
            return this;
        }

        delay(ms) {
            const delayMs = typeof ms === 'number' ? ms : 0;
            this._els.forEach(el => {
                if (!el._shimAnimQueue) el._shimAnimQueue = [];
                el._shimAnimQueue.push({ type: 'delay', ms: delayMs });
                if (!el._shimQueueRunning) {
                    _processQueue(el);
                }
            });
            return this;
        }

        animate(props, durationOrOpts, easingOrCallback, callback) {
            // Parse arguments: support both positional and object forms
            let durationMs = 400, startCb = null, completeCb = null;

            if (durationOrOpts !== null && typeof durationOrOpts === 'object' && !Array.isArray(durationOrOpts)) {
                // Object form: .animate(props, {duration, start, complete})
                durationMs = typeof durationOrOpts.duration === 'number' ? durationOrOpts.duration : 400;
                startCb = typeof durationOrOpts.start === 'function' ? durationOrOpts.start : null;
                completeCb = typeof durationOrOpts.complete === 'function' ? durationOrOpts.complete : null;
            } else {
                // Positional form: .animate(props, duration, easing, callback)
                durationMs = typeof durationOrOpts === 'number' ? durationOrOpts : 400;
                completeCb = typeof easingOrCallback === 'function' ? easingOrCallback
                    : typeof callback === 'function' ? callback : null;
            }

            this._els.forEach(el => {
                if (!el._shimAnimQueue) el._shimAnimQueue = [];
                el._shimAnimQueue.push({
                    type: 'animate',
                    props: { ...props },
                    durationMs,
                    startCb,
                    completeCb,
                });
                if (!el._shimQueueRunning) {
                    _processQueue(el);
                }
            });
            return this;
        }

        // ---- Iteration ----

        each(fn) {
            this._els.forEach((el, i) => fn.call(el, i, el));
            return this;
        }
    }

    // ---- The $ function ----

    function $(selectorOrHtml) {
        if (!selectorOrHtml) return new $Set([]);

        // HTML string: $("<div class='foo'>bar</div>")
        if (typeof selectorOrHtml === 'string' && selectorOrHtml.trim().charAt(0) === '<') {
            return new $Set(_createFromHTML(selectorOrHtml));
        }

        // CSS selector: $("#animation")
        if (typeof selectorOrHtml === 'string') {
            return new $Set(Array.from(document.querySelectorAll(selectorOrHtml)));
        }

        // DOM element: $(element)
        if (selectorOrHtml instanceof Node) {
            return new $Set([selectorOrHtml]);
        }

        // Already a $Set
        if (selectorOrHtml instanceof $Set) {
            return selectorOrHtml;
        }

        return new $Set([]);
    }

    // ---- $.ajax ----
    // stages2.js uses ONE synchronous $.ajax call to load election JSON.
    // We intercept it: if _preloadedElectionData is set, inject that instead.

    let _preloadedElectionData = null;

    $.ajax = function (opts) {
        const result = {
            fail: function (fn) {
                if (!_preloadedElectionData && fn) {
                    fn({ status: 0, statusText: 'No pre-loaded data' });
                }
                return result;
            }
        };

        if (_preloadedElectionData) {
            if (opts.success) opts.success(_preloadedElectionData);
        } else {
            // Fallback: actual fetch (async, despite stages2.js expecting sync)
            console.warn('[jquery-shim] No pre-loaded data; $.ajax fetch fallback');
            if (opts.url) {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', opts.url, false); // synchronous to match stages2.js
                try {
                    xhr.send();
                    if (xhr.status === 200) {
                        const data = JSON.parse(xhr.responseText);
                        if (opts.success) opts.success(data);
                    } else if (result._failFn) {
                        result._failFn(xhr);
                    }
                } catch (e) {
                    console.error('[jquery-shim] XHR fallback failed', e);
                }
            }
        }

        return result;
    };

    // ---- Public helpers for pre-loading data ----

    $.preloadElectionData = function (data) {
        _preloadedElectionData = data;
    };

    $.clearPreloadedData = function () {
        _preloadedElectionData = null;
    };

    // ---- Expose globally ----
    root.$ = $;
    root.jQuery = $;

})(typeof self !== 'undefined' ? self : this);
