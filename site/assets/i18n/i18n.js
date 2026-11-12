/*
 * Civgraph interface languages: English, Irish (Gaeilge) and Ulster-Scots (Ulstèr-Scotch).
 *
 * PREVIEW ONLY. This file is loaded by the bootstrap in shell head (packages/ui/src/templates/shell.js head()) only when the
 * preview flag is on (localStorage 'civgraph.langPreview'). Nothing on the site offers it: the
 * flag is set by typing a phrase into the Maps search box (src/catalogue/lang-reveal.js), which
 * calls the bootstrap's civgraphLangReveal(). The control's Hide action, or ?lang-preview=0,
 * clears it. Without the flag the page never requests this file, so the live site is unchanged.
 * The Irish and Ulster-Scots texts are drafts awaiting review by fluent speakers
 * (data/i18n/README.md).
 *
 * HOW STRINGS ARE FOUND
 *
 * Strings live in assets/i18n/<lang>.json under keys ("nav.maps": "Léarscáileanna"); en.json
 * holds the English for every key and is the fallback for anything a language lacks. The
 * interface code is not rewritten to call t(key) at every site (40,000 lines across files other
 * work is editing); instead this runtime translates what the page renders:
 *
 *   1. elements marked data-i18n="key" (text), data-i18n-html="key" (markup) and
 *      data-i18n-attr="title:key;aria-label:key" take the keyed string;
 *   2. every other text node and title / aria-label / placeholder / alt attribute is looked up
 *      by its English wording: en.json maps the wording to its key, and the key to the target
 *      language. Strings with values ("{n} maps") are matched as patterns;
 *   3. dates written "01 Apr 1969" / "Apr 1969" take the language's month names (Intl);
 *   4. a MutationObserver repeats this for whatever the application renders later.
 * The original English of each node is remembered, so switching back restores it exactly.
 *
 * WHICH LANGUAGES
 *
 * languages.json (generated from data/registries/languages.json by scripts/i18n/build-i18n.mjs)
 * lists them, in the control's order, with each one's own name, <html lang>, Intl locale and
 * direction; nothing here names a language, so a new one needs only its files (acceptance test
 * A5). The source language (English) is every key's text and the fallback.
 *
 * API (window.civgraphI18n):
 *   lang, locale, htmlLang, source, languages, ready (Promise); lang is '' and locale undefined
 *                              until languages.json has loaded
 *   t(key, params?)            the string for key in the current language, English fallback
 *   translate(english)         the current language's wording of an English string, or it
 *   setLanguage(code)          a code of languages.json (en, ga, sco); persists and re-translates in place
 *   formatNumber(n, opts?)     Intl number in the current locale
 *   formatDate(date, opts?)    Intl date in the current locale
 *   placeNameField(layer)      the tile property holding the Irish name of a layer's features,
 *                              when Irish is on and the layer has one (map labels, details)
 *   hide()                     back to English, remove the control, clear the flag (the
 *                              control's own Hide action); disablePreview() is the same
 *   show()                     rebuild the control after hide() on the same page
 * Events on document: 'civgraph:langchange' {detail: {lang}} after a switch, and once when the
 * first language has loaded.
 */
(function () {
  'use strict';

  /**
   * One language as languages.json gives it (packages/registries/src/languages.mjs runtimeLanguages).
   * @typedef {{ name: string, htmlLang: string | null, locale: string, dir: 'ltr' | 'rtl', translatesDates: boolean, placeNameFields: boolean }} RuntimeLanguage
   */
  /** @typedef {{ source?: string, languages?: Record<string, RuntimeLanguage> }} LanguagesFile  languages.json */
  /** @typedef {{ strings?: Record<string, string> }} StringsFile  <lang>.json */
  /** @typedef {{ names?: Record<string, string> }} NamesFile  names.<lang>.json */
  /** @typedef {{ layers?: Record<string, string>, hints?: string[] }} PlaceFieldsFile  place-name-fields.json */
  /** @typedef {{ re: RegExp, key: string, names: string[], anchor: string, strict: boolean }} Pattern */
  /** @typedef {{ english: string, written: string }} Memo  the English a node held and what was written over it */
  /** @typedef {{ short: string[], long: string[] }} MonthNames */
  /**
   * What placeNameField reads of a map layer (the map app's layer config).
   * @typedef {{ id?: string, layerId?: string, sourceMapId?: string, mapId?: string, categoricalProperties?: string[], popupProperties?: string[] }} LayerLike
   */
  var win = /** @type {Window & { civgraphI18n?: object }} */ (window);
  if (win.civgraphI18n) return;

  var LANG_KEY = 'civgraph.lang';
  var FLAG_KEY = 'civgraph.langPreview';
  var BASE = '/assets/i18n/';
  var VERSION = (function () {
    var script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
    var s = script && script.src;
    var m = s && /[?&]v=([^&]+)/.exec(s);
    return m ? m[1] : String(Date.now());
  })();

  // The languages come from languages.json, which scripts/i18n/build-i18n.mjs writes from the
  // registry (data/registries/languages.json): each one's own name, <html lang>, Intl locale and
  // direction, whether its dates are translated and whether the tiles carry its place names. A new
  // language needs no change here (acceptance test A5). Filled in place once the file has loaded.
  /** @type {Record<string, RuntimeLanguage>} */
  var LANGS = {};
  /** The source language (English): every key's text and the fallback. Set with LANGS. */
  var SOURCE = '';

  /** @type {Record<string, number>} */
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, TEXTAREA: 1, SVG: 1, CANVAS: 1, KBD: 1, SAMP: 1, TEMPLATE: 1, IFRAME: 1 };
  var ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-tooltip', 'aria-description'];
  var SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var root = document.documentElement;
  var originalHtmlLang = root.getAttribute('lang');
  var originalDir = root.getAttribute('dir');

  /**
   * @type {{ lang: string, en: Record<string, string>, target: Record<string, string>,
   *   byEnglish: Map<string, string>, names: Map<string, string>, patterns: Pattern[],
   *   units: Map<string, string>, placeFields: Record<string, string>, placeFieldHints: string[],
   *   monthNames: MonthNames | null }}
   */
  var state = {
    lang: '',        // a code of LANGS once languages.json has loaded
    en: {},          // key -> English
    target: {},      // key -> current language
    byEnglish: new Map(), // English wording -> key
    names: new Map(), // English name -> current language (map / catalogue names)
    patterns: [],    // [{re, key, names}]
    units: new Map(), // English counted noun -> form used after a numeral
    placeFields: {}, // layer id -> Irish name property
    placeFieldHints: [],
    monthNames: null
  };

  // Per text node / attribute: the English it held and what we last wrote.
  /** @type {WeakMap<Node, Memo>} */
  var textMemo = new WeakMap();
  /** @type {WeakMap<Element, Record<string, Memo>>} */
  var attrMemo = new WeakMap();

  /** @param {string} name */
  function readParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }
  /** @param {string} key @param {string | null} value */
  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* private mode: the URL parameter still works for this page */ }
  }
  /** @param {string} key */
  function stored(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function initialLanguage() {
    var fromUrl = readParam('lang');
    if (fromUrl && LANGS[fromUrl]) {
      store(LANG_KEY, fromUrl);
      return fromUrl;
    }
    var saved = stored(LANG_KEY);
    return saved && LANGS[saved] ? saved : SOURCE;
  }

  /**
   * The current language's entry, or null before languages.json has loaded.
   * @returns {RuntimeLanguage | null}
   */
  function current() { return LANGS[state.lang] || null; }
  /** Whether the page is in the source language (English): nothing to translate. */
  function inSource() { return state.lang === SOURCE; }

  /** @param {string} file @returns {Promise<unknown>} */
  function fetchJson(file) {
    return fetch(BASE + file + '?v=' + VERSION, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
  }

  /** @type {Record<string, Promise<unknown>>} */
  var cache = {};
  /** @param {string} file @returns {Promise<unknown>} */
  function load(file) {
    if (!cache[file]) cache[file] = fetchJson(file);
    return cache[file];
  }

  /** @param {string} s */
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /** @param {unknown} s */
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  // Typed placeholders: a count must be a number, so '{n} map' never matches 'Townland map';
  // a year is four digits; '{years}' is a year or a span ('1921–1969').
  var NUM = '(\\d[\\d,.]*)';
  /** @type {Record<string, string>} */
  var PLACEHOLDER_RE = {
    n: NUM, u: NUM, k: NUM, m: NUM, total: NUM, count: NUM, shown: NUM,
    year: '(\\d{4})', year2: '(\\d{4})',
    years: '(\\d{4}(?:\\s*[–-]\\s*\\d{4})?)',
    month: '(January|February|March|April|May|June|July|August|September|October|November|December)'
  };

  function compilePatterns() {
    /** @type {Pattern[]} */
    var list = [];
    Object.keys(state.en).forEach(function (key) {
      var en = state.en[key];
      if (typeof en !== 'string' || en.indexOf('{') < 0 || key.indexOf('units.') === 0) return;
      /** @type {string[]} */
      var names = [];
      var parts = en.split(/(\{[a-zA-Z0-9_]+\})/);
      var src = parts.map(function (part) {
        var m = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
        if (m) { names.push(m[1]); return PLACEHOLDER_RE[m[1]] || '(.+?)'; }
        return escapeRe(part);
      }).join('');
      if (!names.length) return;
      var literal = parts.filter(function (p) { return !/^\{/.test(p); }).sort(function (a, b) { return b.length - a.length; })[0] || '';
      var anyTyped = names.some(function (n) { return PLACEHOLDER_RE[n]; });
      // "{name}" alone would match everything; a pattern whose only literal is short
      // (", ", " - ") must have a typed value or translate every untyped one (strict).
      if (literal.trim().length < 1 && !anyTyped && !(names.length === 2 && names.indexOf('unit') >= 0)) return;
      list.push({ re: new RegExp('^' + src + '$'), key: key, names: names, anchor: literal.trim() ? literal : '', strict: literal.trim().length < 3 });
    });
    // Longest literal first, so "Show all {n} maps" wins over "Show all {n}".
    list.sort(function (a, b) { return b.anchor.length - a.anchor.length; });
    state.patterns = list;
  }

  /** @param {string} text @param {Record<string, string>} [params] */
  function interpolate(text, params) {
    return text.replace(/\{([a-zA-Z0-9_]+)\}/g, function (all, name) {
      return params && params[name] !== undefined ? params[name] : all;
    });
  }

  /** @param {string} key @param {Record<string, string>} [params] @returns {string} */
  function t(key, params) {
    var text = state.target[key];
    if (typeof text !== 'string' || !text) text = state.en[key];
    if (typeof text !== 'string') return key;
    return params ? interpolate(text, params) : text;
  }

  /**
   * Month names of the current locale, from Intl (CLDR): Irish "Aib", "Samh"...
   * @returns {MonthNames}
   */
  function months() {
    if (state.monthNames) return state.monthNames;
    var conf = current();
    /** @type {MonthNames} */
    var out = { short: SHORT_MONTHS.slice(), long: [] };
    try {
      if (conf) {
        var fs = new Intl.DateTimeFormat(conf.locale, { month: 'short', timeZone: 'UTC' });
        var fl = new Intl.DateTimeFormat(conf.locale, { month: 'long', timeZone: 'UTC' });
        for (var i = 0; i < 12; i++) {
          var d = new Date(Date.UTC(2000, i, 15));
          out.short[i] = fs.format(d).replace(/\.$/, '');
          out.long[i] = fl.format(d);
        }
      }
    } catch (e) { /* keep English */ }
    // The language file wins: not every browser build ships Irish locale data for Intl.
    for (var j = 0; j < 12; j++) {
      var own = state.target['months.short.' + j];
      if (own) out.short[j] = own;
    }
    state.monthNames = out;
    return out;
  }

  var DATE_RE = /\b(\d{1,2} )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/g;
  function translatesDates() { var c = current(); return Boolean(c && c.translatesDates); }
  /** @param {string} text @returns {string} */
  function translateDates(text) {
    if (!translatesDates() || !/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/.test(text)) return text;
    var m = months();
    return text.replace(DATE_RE, function (_all, day, mon, year) {
      return (day || '') + m.short[SHORT_MONTHS.indexOf(mon)] + ' ' + year;
    });
  }

  // The shared formatter (packages/core/src/format.js) writes dates in the current language's
  // locale, so a node the application renders while that language is on may already hold
  // "01 Aib 1969". Its English is "01 Apr 1969": that is what is remembered, so that switching
  // back restores English and the patterns match the English as before.
  /** @type {RegExp | null} */
  var sourceDateRe = null;
  /** @param {string} text @returns {string} */
  function sourceDates(text) {
    if (!translatesDates()) return text;
    var m = months();
    if (!sourceDateRe) {
      var names = m.short.filter(function (name, i) { return name && name !== SHORT_MONTHS[i]; })
        .sort(function (a, b) { return b.length - a.length; }).map(escapeRe);
      if (!names.length) return text;
      sourceDateRe = new RegExp('(^|[^0-9A-Za-z\\u00C0-\\u024F])(\\d{1,2} )?(' + names.join('|') + ') (\\d{4})(?![0-9])', 'g');
    }
    return text.replace(sourceDateRe, function (_all, lead, day, mon, year) {
      return lead + (day || '') + SHORT_MONTHS[m.short.indexOf(mon)] + ' ' + year;
    });
  }

  /** @param {string} s @returns {string | null} */
  function lookupExact(s) {
    var key = state.byEnglish.get(s);
    if (key !== undefined) {
      var text = state.target[key];
      if (typeof text === 'string' && text) return text;
    }
    var name = state.names.get(s);
    return name || null;
  }

  /**
   * A value captured by a pattern: numbers stay, words are translated in turn.
   * @param {string} name @param {string} value @param {number} depth
   * @returns {string}
   */
  function translateValue(name, value, depth) {
    if (/\d/.test(value) && !/[A-Za-z]{3}/.test(value)) return value;
    if (name === 'unit') {
      // Counted nouns: Irish uses the singular after a numeral ("32 contae"); units.txt has them.
      var unit = state.units.get(value) || state.units.get(value.toLowerCase());
      if (unit) return unit;
    }
    return translateString(value, depth + 1) || value;
  }

  /** @param {string} s @param {number} depth @returns {string | null} */
  function matchPatterns(s, depth) {
    if (s.length > 240) return null;
    for (var i = 0; i < state.patterns.length; i++) {
      var p = state.patterns[i];
      if (p.anchor && s.indexOf(p.anchor) < 0) continue;
      var match = p.re.exec(s);
      if (!match) continue;
      var target = state.target[p.key];
      if (typeof target !== 'string' || !target) continue;
      /** @type {Record<string, string>} */
      var params = {};
      var untranslated = 0;
      for (var j = 0; j < p.names.length; j++) {
        var value = match[j + 1];
        var out = translateValue(p.names[j], value, depth);
        if (out === value && /[A-Za-z]{3}/.test(value) && !PLACEHOLDER_RE[p.names[j]]) untranslated += 1;
        params[p.names[j]] = out;
      }
      // "{a} {b}"-style patterns with no literal of their own only count when they translated
      // something; otherwise any two words would be rearranged.
      if ((p.strict || !p.anchor) && untranslated) continue;
      return interpolate(target, params);
    }
    return null;
  }

  /**
   * The current language's wording of an English string, or null when it has none.
   * @param {string} english @param {number} [depth]
   * @returns {string | null}
   */
  function translateString(english, depth) {
    var s = norm(english);
    if (!s || inSource()) return null;
    var level = depth || 0;
    var hit = lookupExact(s);
    if (hit) return hit;
    // A trailing colon, full stop or ellipsis is presentation: "Source:" is "Source" + ":".
    var m = /^(.*?)(\s*[:…]|\.\.\.|\.)$/.exec(s);
    if (m && m[1]) {
      hit = lookupExact(m[1]);
      if (hit) return hit + m[2];
    }
    if (level < 3) {
      hit = matchPatterns(s, level);
      if (hit) return hit;
      // "01 Nov 1957 · Phelim Birch · 32 Counties": each part on its own.
      if (s.indexOf(' · ') > 0) {
        var changed = false;
        var parts = s.split(' · ').map(function (part) {
          var out = translateString(part, level + 1);
          if (out !== null && out !== part) { changed = true; return out; }
          return part;
        });
        if (changed) return parts.join(' · ');
      }
    }
    var dated = translateDates(s);
    return dated !== s ? dated : null;
  }

  /** @param {string} english @returns {string | null} */
  function translateEnglish(english) { return translateString(english, 0); }

  /** @param {Element} el */
  function skipElement(el) {
    /** @type {Element | null} */
    var node = el;
    for (; node && node !== document.body; node = node.parentElement) {
      if (SKIP_TAGS[node.tagName] || SKIP_TAGS[(node.tagName || '').toUpperCase()]) return true;
      if (/** @type {HTMLElement} */ (node).isContentEditable) return true;
      if (node.getAttribute && (node.getAttribute('translate') === 'no' || node.hasAttribute('data-i18n-skip'))) return true;
      if (node.classList && (node.classList.contains('notranslate'))) return true;
    }
    return false;
  }

  /** @param {Node} node @param {boolean} [checked] */
  function translateTextNode(node, checked) {
    var value = node.nodeValue;
    if (!value || !/[A-Za-z]/.test(value)) return;
    var memo = textMemo.get(node);
    var english;
    if (memo && value === memo.written) english = memo.english; // our own write: re-derive from the English
    else english = sourceDates(value); // new or changed by the application: this is English again
    var parent = node.parentElement;
    if (!parent || (!checked && skipElement(parent))) return;
    var out = inSource() ? null : translateEnglish(english);
    var next;
    if (out === null) next = english;
    else {
      var lead = (/^\s*/.exec(english) || [''])[0];
      var trail = (/\s*$/.exec(english) || [''])[0];
      next = lead + out + trail;
    }
    if (next !== value) node.nodeValue = next;
    if (next !== english) textMemo.set(node, { english: english, written: next });
    else textMemo.delete(node);
  }

  /** @param {Element} el @param {boolean} [checked] */
  function translateAttributes(el, checked) {
    if (!checked && skipElement(el)) return;
    var memo = attrMemo.get(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      if (!el.hasAttribute(name)) continue;
      var value = el.getAttribute(name) || '';
      var rec = memo && memo[name];
      var english = rec && value === rec.written ? rec.english : sourceDates(value);
      var out = inSource() ? null : translateEnglish(english);
      var next = out === null ? english : out;
      if (next !== value) el.setAttribute(name, next);
      if (next !== english) {
        if (!memo) { memo = {}; attrMemo.set(el, memo); }
        memo[name] = { english: english, written: next };
      } else if (memo) delete memo[name];
    }
    var input = /** @type {HTMLInputElement} */ (el);
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(input.type) && input.value) {
      var vm = memo && memo.value;
      var ev = vm && input.value === vm.written ? vm.english : input.value;
      var vo = inSource() ? null : translateEnglish(ev);
      input.value = vo === null ? ev : vo;
      if (!memo) { memo = {}; attrMemo.set(el, memo); }
      memo.value = { english: ev, written: input.value };
    }
  }

  /** @type {WeakMap<Element, { text: string | null, html: string }>} */
  var keyedMemo = new WeakMap();
  /** @param {Element} el */
  function translateKeyed(el) {
    var key = el.getAttribute('data-i18n');
    var htmlKey = el.getAttribute('data-i18n-html');
    var memo = keyedMemo.get(el);
    if (!memo) { memo = { text: el.textContent, html: el.innerHTML }; keyedMemo.set(el, memo); }
    if (htmlKey) {
      var html = inSource() ? null : state.target[htmlKey];
      var nextHtml = html || memo.html;
      if (el.innerHTML !== nextHtml) el.innerHTML = nextHtml;
    } else if (key) {
      var text = inSource() ? null : state.target[key];
      var nextText = text || memo.text;
      if (el.textContent !== nextText) el.textContent = nextText;
    }
    var spec = el.getAttribute('data-i18n-attr');
    if (spec) {
      spec.split(';').forEach(function (pair) {
        var bits = pair.split(':');
        if (bits.length !== 2) return;
        var attr = bits[0].trim();
        var akey = bits[1].trim();
        var orig = el.getAttribute('data-i18n-orig-' + attr);
        if (orig === null) { orig = el.getAttribute(attr) || ''; el.setAttribute('data-i18n-orig-' + attr, orig); }
        var v = inSource() ? null : state.target[akey];
        el.setAttribute(attr, v || orig);
      });
    }
  }

  /** @param {Node | null} rootNode */
  function walk(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) { translateTextNode(rootNode); return; }
    if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11) return;
    var el = rootNode.nodeType === 1 ? /** @type {Element} */ (rootNode) : null;
    if (el && skipElement(el)) return;
    /** @type {Element[]} */
    var keyed = [];
    if (el && (el.hasAttribute('data-i18n') || el.hasAttribute('data-i18n-html') || el.hasAttribute('data-i18n-attr'))) keyed.push(el);
    var container = /** @type {ParentNode} */ (rootNode);
    if (container.querySelectorAll) {
      var list = container.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-attr]');
      for (var k = 0; k < list.length; k++) keyed.push(list[k]);
    }
    keyed.forEach(translateKeyed);
    var walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (/** @type {Node} */ child) {
        if (child.nodeType === 1) {
          var node = /** @type {HTMLElement} */ (child);
          if (SKIP_TAGS[node.tagName.toUpperCase()] || node.getAttribute('translate') === 'no' || node.hasAttribute('data-i18n-skip') || node.isContentEditable || (node.classList && node.classList.contains('notranslate'))) return NodeFilter.FILTER_REJECT;
          if (node.hasAttribute('data-i18n') || node.hasAttribute('data-i18n-html')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node = rootNode.nodeType === 1 ? rootNode : walker.nextNode();
    if (node === rootNode && el) { translateAttributes(el, true); node = walker.nextNode(); }
    while (node) {
      if (node.nodeType === 3) translateTextNode(node, true);
      else translateAttributes(/** @type {Element} */ (node), true);
      node = walker.nextNode();
    }
  }

  // ---- observing what the application renders later ----
  /** @type {Set<Node>} */
  var pending = new Set();
  var scheduled = false;
  var applying = false;
  function flush() {
    scheduled = false;
    applying = true;
    try {
      pending.forEach(function (node) { if (node.isConnected) walk(node); });
    } finally {
      pending.clear();
      applying = false;
    }
  }
  /** @param {Node} node */
  function queue(node) {
    pending.add(node);
    if (!scheduled) {
      scheduled = true;
      // A microtask: the translation lands before the next paint, so English does not flash.
      Promise.resolve().then(flush);
    }
  }
  var observer = new MutationObserver(function (records) {
    if (applying || (inSource() && !textMemoInUse)) return;
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'childList') {
        for (var j = 0; j < r.addedNodes.length; j++) queue(r.addedNodes[j]);
      } else if (r.type === 'characterData') {
        queue(r.target);
      } else if (r.type === 'attributes') {
        queue(r.target);
      }
    }
  });
  var textMemoInUse = false;
  var observing = false;
  function observe() {
    if (observing || !document.body) return;
    observing = true;
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // ---- the language control in the site header ----
  // The header link and button rules apply in every language but the source ('@source' is
  // replaced at injection, when SOURCE is known).
  var CSS = '.lang-switch{position:relative;display:inline-flex;align-items:center;gap:.35rem;flex:0 0 auto;align-self:center;width:max-content;font-size:.8125rem;line-height:1.2;white-space:nowrap;max-width:100%}' +
    '.lang-switch__label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
    '.lang-switch__select{font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px;padding:.15rem .3rem;max-width:7.5rem;min-height:30px;cursor:pointer}' +
    '.lang-switch__select option{color:var(--raw-111111);background:var(--raw-ffffff)}' +
    '@media (pointer:coarse){.lang-switch__select{min-height:40px;font-size:1rem}}' +
    '.lang-switch__draft{position:absolute;top:-7px;right:-6px;font-size:.5625rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;line-height:1.3;padding:0 .25rem;border-radius:4px;background:var(--raw-b45309);color:var(--raw-ffffff);pointer-events:auto}' +
    '.lang-switch__hide{font:inherit;font-size:1rem;line-height:1;color:inherit;background:transparent;border:0;border-radius:4px;padding:.1rem .25rem;min-width:24px;min-height:24px;cursor:pointer;opacity:.7}' +
    '.lang-switch__hide:hover,.lang-switch__hide:focus-visible{opacity:1}' +
    '@media (pointer:coarse){.lang-switch__hide{min-width:40px;min-height:40px}}' +
    '.lang-switch--floating{position:fixed;right:12px;bottom:12px;z-index:9999;background:var(--raw-ffffff);color:var(--raw-111111);padding:.35rem .5rem;border-radius:8px;box-shadow:0 2px 10px var(--raw-000000-a250)}' +
    'html[data-ui-lang]:not([data-ui-lang="@source"]) .app-header__link span{overflow-wrap:anywhere}' +
    'html[data-ui-lang]:not([data-ui-lang="@source"]) button,html[data-ui-lang]:not([data-ui-lang="@source"]) .cn-tab{overflow-wrap:anywhere;hyphens:auto}';
  function injectCss() {
    if (document.getElementById('civgraph-i18n-css')) return;
    var style = document.createElement('style');
    style.id = 'civgraph-i18n-css';
    style.textContent = CSS.split('@source').join(SOURCE);
    document.head.appendChild(style);
  }

  function buildControl() {
    injectCss();
    if (document.querySelector('[data-lang-switch]')) return;
    var nav = document.querySelector('.app-header[data-site-chrome] .app-header__nav');
    var wrap = document.createElement('div');
    wrap.className = 'lang-switch';
    wrap.setAttribute('data-lang-switch', '');
    wrap.setAttribute('translate', 'no');
    var field = document.createElement('label');
    field.style.display = 'contents';
    var span = document.createElement('span');
    span.className = 'lang-switch__label';
    span.textContent = 'Language';
    span.setAttribute('data-i18n', 'chrome.language');
    var select = document.createElement('select');
    select.className = 'lang-switch__select';
    select.setAttribute('aria-label', 'Language');
    select.setAttribute('data-i18n-attr', 'aria-label:chrome.language');
    Object.keys(LANGS).forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = LANGS[code].name; // each language in its own name, never translated
      opt.lang = LANGS[code].htmlLang || SOURCE;
      select.appendChild(opt);
    });
    select.value = state.lang;
    select.addEventListener('change', function () { setLanguage(select.value); });
    field.appendChild(span);
    field.appendChild(select);
    wrap.appendChild(field);
    var badge = document.createElement('span');
    badge.className = 'lang-switch__draft';
    badge.setAttribute('data-i18n', 'chrome.languageDraft');
    badge.textContent = 'Draft';
    badge.title = 'Preview: the Irish and Ulster-Scots texts are drafts awaiting review';
    badge.setAttribute('data-i18n-attr', 'title:chrome.languageDraftTitle');
    wrap.appendChild(badge);
    // Hide: the control goes, the page returns to English, and the flag is cleared, so no page
    // shows it again until the phrase is typed once more.
    var hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'lang-switch__hide';
    hideBtn.setAttribute('data-lang-hide', '');
    hideBtn.textContent = '×';
    hideBtn.title = 'Hide language options';
    hideBtn.setAttribute('aria-label', 'Hide language options');
    hideBtn.setAttribute('data-i18n-attr', 'title:chrome.languageHide;aria-label:chrome.languageHide');
    hideBtn.addEventListener('click', function () { hide(); });
    wrap.appendChild(hideBtn);
    if (nav) {
      var anchor = nav.querySelector('[data-theme-toggle]');
      nav.insertBefore(wrap, anchor || null);
    } else {
      wrap.classList.add('lang-switch--floating');
      document.body.appendChild(wrap);
    }
    // The control's own strings are keyed; translate them now.
    translateKeyed(span);
    translateKeyed(select);
    translateKeyed(badge);
    translateKeyed(hideBtn);
  }

  // Back to English in place, then the control and the flag go; no reload. The runtime stays
  // loaded for this page only, idle in English (the next page does not load it).
  function hide() {
    return setLanguage(SOURCE).then(function () {
      observer.disconnect();
      observing = false;
      var wrap = document.querySelector('[data-lang-switch]');
      if (wrap) wrap.remove();
      store(FLAG_KEY, null);
      store(LANG_KEY, null);
      root.removeAttribute('data-ui-lang');
      document.dispatchEvent(new CustomEvent('civgraph:langhide'));
    });
  }

  // The phrase typed again on a page where the control was hidden: bring it back.
  function show() {
    setHtmlLang();
    buildControl();
    observe();
    syncControl();
  }

  function syncControl() {
    var select = /** @type {HTMLSelectElement | null} */ (document.querySelector('[data-lang-switch] select'));
    if (select && select.value !== state.lang) select.value = state.lang;
  }

  function setHtmlLang() {
    var conf = current();
    if (!conf) return;
    if (conf.htmlLang) root.setAttribute('lang', conf.htmlLang);
    else if (originalHtmlLang) root.setAttribute('lang', originalHtmlLang);
    // A right-to-left language turns the page; the others leave the page's own dir.
    if (conf.dir === 'rtl') root.setAttribute('dir', 'rtl');
    else if (originalDir !== null) root.setAttribute('dir', originalDir);
    else root.removeAttribute('dir');
    root.dataset.uiLang = state.lang;
  }

  function syncUrl() {
    try {
      var url = new URL(window.location.href);
      if (inSource()) url.searchParams.delete('lang');
      else url.searchParams.set('lang', state.lang);
      if (url.href !== window.location.href) history.replaceState(history.state, '', url.href);
    } catch (e) { /* ignore */ }
  }

  /**
   * @param {string} lang @param {StringsFile} en @param {StringsFile} target
   * @param {NamesFile} names @param {PlaceFieldsFile} places
   */
  function applyLanguageData(lang, en, target, names, places) {
    state.lang = lang;
    state.en = en.strings || {};
    state.target = lang === SOURCE ? {} : (target.strings || {});
    state.byEnglish = new Map();
    state.units = new Map();
    Object.keys(state.en).forEach(function (key) {
      var text = state.en[key];
      if (key.indexOf('units.') === 0) {
        if (state.target[key]) state.units.set(norm(text), state.target[key]);
        return;
      }
      if (key.indexOf('months.') === 0) return; // looked up by key only (months())
      if (typeof text === 'string' && text.indexOf('{') < 0) {
        var n = norm(text);
        if (!state.byEnglish.has(n) || state.target[key]) state.byEnglish.set(n, key);
      }
    });
    state.names = new Map();
    var nameMap = (names && names.names) || {};
    Object.keys(nameMap).forEach(function (english) { state.names.set(english, /** @type {string} */ (nameMap[english])); });
    state.placeFields = (places && places.layers) || {};
    state.placeFieldHints = (places && places.hints) || [];
    state.monthNames = null;
    sourceDateRe = null;
    compilePatterns();
  }

  /** @param {string} lang @returns {Promise<void>} */
  function loadLanguage(lang) {
    return Promise.all([
      load(SOURCE + '.json'),
      lang === SOURCE ? Promise.resolve({}) : load(lang + '.json'),
      lang === SOURCE ? Promise.resolve({}) : load('names.' + lang + '.json'),
      load('place-name-fields.json')
    ]).then(function (res) {
      applyLanguageData(lang, /** @type {StringsFile} */ (res[0]), /** @type {StringsFile} */ (res[1]), /** @type {NamesFile} */ (res[2]), /** @type {PlaceFieldsFile} */ (res[3]));
    });
  }

  function retranslateAll() {
    applying = true;
    try { walk(document.body); } finally { applying = false; }
    textMemoInUse = !inSource();
    var title = document.querySelector('title');
    if (title) {
      if (!title.dataset.i18nEnglish) title.dataset.i18nEnglish = title.textContent;
      var tt = inSource() ? null : translateEnglish(title.dataset.i18nEnglish);
      document.title = tt || title.dataset.i18nEnglish || '';
    }
  }

  /** @param {string} lang @returns {Promise<void>} */
  function setLanguage(lang) {
    if (!LANGS[lang]) lang = SOURCE;
    store(LANG_KEY, lang);
    return loadLanguage(lang).then(function () {
      setHtmlLang();
      syncUrl();
      retranslateAll();
      syncControl();
      document.dispatchEvent(new CustomEvent('civgraph:langchange', { detail: { lang: lang } }));
    });
  }

  // Irish name properties carried by the tiles (Tailte Éireann GAEILGE / GLE_NAME_VALUE, CSO
  // ED_GAEILGE, ...). place-name-fields.json lists them per layer; the hints catch a layer
  // that is not listed but whose metadata names such a property.
  /** @param {LayerLike | null | undefined} layer @returns {string | null} */
  function placeNameField(layer) {
    var conf = current();
    if (!conf || !conf.placeNameFields || !layer) return null;
    var ids = [layer.id, layer.layerId, layer.sourceMapId, layer.mapId];
    for (var k = 0; k < ids.length; k++) {
      var id = ids[k];
      if (id && state.placeFields[id]) return state.placeFields[id];
    }
    var props = /** @type {string[]} */ ([]).concat(layer.categoricalProperties || [], layer.popupProperties || []);
    for (var i = 0; i < state.placeFieldHints.length; i++) {
      if (props.indexOf(state.placeFieldHints[i]) >= 0) return state.placeFieldHints[i];
    }
    return null;
  }

  /** @param {number} n @param {Intl.NumberFormatOptions} [opts] @returns {string} */
  function formatNumber(n, opts) {
    var conf = current();
    if (!conf) return String(n);
    try { return new Intl.NumberFormat(conf.locale, opts).format(n); } catch (e) { return String(n); }
  }
  /** @param {Date | number} date @param {Intl.DateTimeFormatOptions} [opts] @returns {string} */
  function formatDate(date, opts) {
    var conf = current();
    if (!conf) return String(date);
    try { return new Intl.DateTimeFormat(conf.locale, opts || { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date); } catch (e) { return String(date); }
  }
  /** "01 Apr 1969" in the current language (packages/core/src/date-format.mjs calls this when present). */
  /**
   * @param {number | string | null | undefined} day @param {number} monthIndex @param {number | string} year
   * @returns {string}
   */
  function formatShortDate(day, monthIndex, year) {
    var m = translatesDates() ? months().short[monthIndex] : SHORT_MONTHS[monthIndex];
    return (day === null || day === undefined ? '' : String(Number(day)).padStart(2, '0') + ' ') + m + ' ' + year;
  }

  var api = {
    get lang() { return state.lang; },
    // undefined until languages.json has loaded: the shared formatter then writes the source's locale.
    get locale() { var c = current(); return c ? c.locale : undefined; },
    get htmlLang() { var c = current(); return (c && c.htmlLang) || originalHtmlLang || SOURCE; },
    get source() { return SOURCE; },
    languages: LANGS,
    t: t,
    translate: function (/** @type {string} */ english) { return translateEnglish(english) || english; },
    setLanguage: setLanguage,
    formatNumber: formatNumber,
    formatDate: formatDate,
    formatShortDate: formatShortDate,
    placeNameField: placeNameField,
    show: show,
    hide: hide,
    disablePreview: hide,
    /** @type {Promise<void> | null} resolves once the first language is in place */
    ready: null
  };
  win.civgraphI18n = api;

  /**
   * Fill LANGS and SOURCE from languages.json; false when it could not be read.
   * @param {LanguagesFile | null} table
   * @returns {boolean}
   */
  function applyLanguages(table) {
    var list = (table && table.languages) || {};
    if (!table || !table.source || !list[table.source]) return false;
    SOURCE = table.source;
    Object.keys(list).forEach(function (code) { LANGS[code] = /** @type {RuntimeLanguage} */ (list[code]); });
    return true;
  }

  api.ready = load('languages.json').then(function (table) {
    if (!applyLanguages(/** @type {LanguagesFile | null} */ (table))) return undefined; // no table: the page stays as it is, in English
    return loadLanguage(initialLanguage()).then(begin);
  });
  function begin() {
    function start() {
      setHtmlLang();
      buildControl();
      retranslateAll();
      observe();
      syncControl();
      document.dispatchEvent(new CustomEvent('civgraph:langchange', { detail: { lang: state.lang, initial: true } }));
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }
})();
