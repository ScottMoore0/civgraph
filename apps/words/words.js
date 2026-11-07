/*
 * Words in parliament (apps/words/).
 *
 * Reads Civgraph's static word-count shards on R2 (data/parliament/words/): meta.json holds
 * the words spoken per chamber, year, party and language (the denominators); each term lives
 * in one gzip JSON bucket chosen by md5(term), holding its uses per chamber, year and party
 * and its top speakers. Nothing else is fetched except this page's own parties.json (party
 * labels folded to Civgraph's party records, built by scripts/build/words-parties.mjs).
 *
 * ?data=<origin> points the page at another copy of the bucket, as on the Census Explorer.
 *
 * An ES module (its imports are versioned by the import map in apps/words/index.html).
 */
import { TOOLTIP } from './state-machines.js';

(function () {
  'use strict';

  var CDN = 'https://data.civgraph.net/';
  var DATA = (function () {
    var m = /[?&]data=([^&#]+)/.exec(location.search);
    return (m ? decodeURIComponent(m[1]).replace(/\/?$/, '/') : CDN) + 'data/parliament/words/';
  })();
  var MAX_TERMS = 7;
  var LOW_WORDS = 100000;
  var RATE_FLOOR = 20000;
  var BODIES = [
    { code: 'dail', label: 'Dáil', name: 'Dáil Éireann', slot: 1 },
    { code: 'seanad', label: 'Seanad', name: 'Seanad Éireann', slot: 2 },
    { code: 'commons', label: 'Commons', name: 'House of Commons (Irish and NI members)', slot: 3 },
    { code: 'nia', label: 'NI Assembly', name: 'Northern Ireland Assembly', slot: 4 },
    { code: 'lords', label: 'Lords', name: 'House of Lords (NI-linked peers)', slot: 5 }
  ];
  var BODY = {}; BODIES.forEach(function (b) { BODY[b.code] = b; });
  var EXAMPLES = [
    { q: 'partition, home rule', label: 'partition, home rule' },
    { q: 'housing, health', label: 'housing, health' },
    { q: 'border, brexit', label: 'border, brexit', split: 'body' },
    { q: 'unemployment', label: 'unemployment by party', split: 'party', pb: 'dail' },
    { q: 'gaeilge', label: 'gaeilge (in Irish)', lang: 'ga' }
  ];

  var META = null;     // indexed meta.json
  var PARTIES = null;  // label -> [slug, name]
  var SPEAKERS = null; // speakers.json rows
  var fileCache = {};  // url -> Promise<object>
  var RESULTS = [];    // [{term, n, entry|null, error}]
  var S = defaults();
  var renderToken = 0;

  // ------------------------------------------------------------------ helpers
  /**
   * An element of the page: any HTML element, with the form-control fields read where it is one.
   * @typedef {HTMLElement & Partial<Pick<HTMLInputElement, 'value' | 'checked' | 'disabled' | 'type' | 'placeholder'>>} UiElement
   */
  /** @param {string} id @returns {UiElement} */
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (e) { n.addEventListener(e, v[e]); });
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function int(n) { return Math.round(n).toLocaleString('en-GB'); }
  function rateFmt(v) {
    if (v == null || !isFinite(v)) return '–';
    if (v === 0) return '0';
    if (v >= 100) return Math.round(v).toLocaleString('en-GB');
    if (v >= 10) return v.toFixed(1);
    if (v >= 1) return v.toFixed(2);
    return v.toPrecision(2);
  }
  function words(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'k';
    return int(n);
  }
  function quote(t) { return '“' + t + '”'; }

  // md5 of a UTF-8 string, as the shard builder's bucket rule: int(md5(term)[:8], 16) % buckets.
  function md5hex(str) {
    var bytes = new TextEncoder().encode(str);
    var n = bytes.length;
    var words32 = new Array(((n + 8) >> 6) + 1 << 4).fill(0);
    for (var i = 0; i < n; i++) words32[i >> 2] |= bytes[i] << ((i % 4) * 8);
    words32[n >> 2] |= 0x80 << ((n % 4) * 8);
    words32[words32.length - 2] = n * 8;
    var S1 = [7, 12, 17, 22], S2 = [5, 9, 14, 20], S3 = [4, 11, 16, 23], S4 = [6, 10, 15, 21];
    var K = []; for (var k = 0; k < 64; k++) K[k] = Math.floor(Math.abs(Math.sin(k + 1)) * 4294967296) | 0;
    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (var off = 0; off < words32.length; off += 16) {
      var A = a0, B = b0, C = c0, D = d0;
      for (var j = 0; j < 64; j++) {
        var F, g, s;
        if (j < 16) { F = (B & C) | (~B & D); g = j; s = S1[j % 4]; }
        else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; s = S2[j % 4]; }
        else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; s = S3[j % 4]; }
        else { F = C ^ (B | ~D); g = (7 * j) % 16; s = S4[j % 4]; }
        var tmp = D; D = C; C = B;
        var x = (A + F + K[j] + words32[off + g]) | 0;
        B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    return [a0, b0, c0, d0].map(function (v) {
      var h = ''; for (var q = 0; q < 4; q++) h += ((v >>> (q * 8)) & 255).toString(16).padStart(2, '0'); return h;
    }).join('');
  }
  function bucketOf(term, n) { return parseInt(md5hex(term).slice(0, 8), 16) % META.buckets[String(n)]; }

  // The shards are gzip JSON. R2 serves them either as stored bytes (decompressed here) or
  // with Content-Encoding: gzip (already decompressed by the browser); both are handled.
  function fetchData(path, opts) {
    var url = DATA + path;
    if (fileCache[url]) return fileCache[url];
    var p = fetch(url).then(function (r) {
      if (r.status === 404 && opts && opts.missingOk) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + path);
      return r.arrayBuffer().then(function (buf) {
        var b = new Uint8Array(buf);
        if (b.length > 1 && b[0] === 0x1f && b[1] === 0x8b) {
          if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed files.');
          return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(JSON.parse);
        }
        return JSON.parse(new TextDecoder().decode(b));
      });
    });
    fileCache[url] = p;
    p.catch(function () { delete fileCache[url]; });
    return p;
  }

  // Tokenise as the counts did: letters and digits, inner apostrophes kept, lower case.
  function tokens(raw) {
    var s = String(raw || '').normalize('NFC').replace(/[‘’ʼ]/g, "'").toLowerCase();
    return s.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || [];
  }
  function parseQuery(raw) {
    var seen = {}; var out = [];
    String(raw || '').split(',').forEach(function (part) {
      var t = tokens(part);
      if (!t.length) return;
      var term = t.join(' ');
      if (seen[term]) return;
      seen[term] = 1; out.push({ term: term, n: t.length });
    });
    return out;
  }

  // ------------------------------------------------------------------ state <-> URL
  function defaults() {
    return { q: [], b: BODIES.map(function (b) { return b.code; }), split: 'none', pb: 'dail', lang: 'en', sm: 0, from: null, to: null, t: 0, sort: 'uses', sb: '', cb: 'dail' };
  }
  function readUrl() {
    var p = new URLSearchParams(location.search);
    var s = defaults();
    if (p.get('q')) s.q = parseQuery(p.get('q')).map(function (x) { return x.term; });
    if (p.get('b')) { var b = p.get('b').split(',').filter(function (c) { return BODY[c]; }); if (b.length) s.b = b; }
    if (['none', 'body', 'party'].indexOf(p.get('split')) >= 0) s.split = p.get('split');
    if (BODY[p.get('pb')]) s.pb = p.get('pb');
    if (BODY[p.get('cb')]) s.cb = p.get('cb'); else s.cb = s.pb;
    if (p.get('lang') === 'ga') s.lang = 'ga';
    var sm = Number(p.get('sm')); if ([1, 2, 3, 5].indexOf(sm) >= 0) s.sm = sm;
    var f = Number(p.get('from')); if (f >= 1800 && f <= 2100) s.from = f;
    var t = Number(p.get('to')); if (t >= 1800 && t <= 2100) s.to = t;
    var ti = Number(p.get('t')); if (ti > 0 && ti < MAX_TERMS) s.t = ti;
    if (p.get('sort') === 'rate') s.sort = 'rate';
    if (BODY[p.get('sb')]) s.sb = p.get('sb');
    return s;
  }
  function enc(v) { return encodeURIComponent(v).replace(/%2C/g, ',').replace(/%20/g, '+'); }
  function urlFor(s) {
    var parts = [];
    var keep = new URLSearchParams(location.search).get('data');
    if (s.q.length) parts.push('q=' + enc(s.q.join(',')));
    if (s.b.length !== BODIES.length) parts.push('b=' + s.b.join(','));
    if (s.split !== 'none') parts.push('split=' + s.split);
    if (s.split === 'party' && s.pb !== 'dail') parts.push('pb=' + s.pb);
    if (s.cb !== 'dail') parts.push('cb=' + s.cb);
    if (s.lang !== 'en') parts.push('lang=' + s.lang);
    if (s.sm) parts.push('sm=' + s.sm);
    if (s.from) parts.push('from=' + s.from);
    if (s.to) parts.push('to=' + s.to);
    if (s.t) parts.push('t=' + s.t);
    if (s.sort !== 'uses') parts.push('sort=' + s.sort);
    if (s.sb) parts.push('sb=' + s.sb);
    if (keep) parts.push('data=' + encodeURIComponent(keep));
    return location.pathname + (parts.length ? '?' + parts.join('&') : '');
  }
  function writeUrl(push) {
    var u = urlFor(S);
    if (u === location.pathname + location.search) return;
    history[push ? 'pushState' : 'replaceState'](null, '', u);
  }

  // ------------------------------------------------------------------ meta
  function groupOf(label) {
    var m = PARTIES && PARTIES[label];
    if (!m) return { key: 'x:' + label, name: label, slug: '' };
    if (!m[0]) return { key: m[1] === 'No party recorded' ? 'none' : 'x:' + m[1], name: m[1], slug: '' };
    return { key: m[0], name: m[1], slug: m[0] };
  }
  function indexMeta(raw) {
    var bi = {}; raw.bodies.forEach(function (c, i) { bi[i] = c; });
    var groups = raw.parties.map(groupOf);
    var W = {}; var WP = {}; var yrs = {};
    raw.totals.forEach(function (r) {
      var body = bi[r[0]]; if (!BODY[body]) return; // the Stormont sample is not shown
      var y = r[1]; var g = groups[r[2]]; var lang = r[3]; var w = r[4];
      W[lang] = W[lang] || {}; WP[lang] = WP[lang] || {};
      var wb = W[lang][body] = W[lang][body] || {};
      wb[y] = (wb[y] || 0) + w;
      var pb = WP[lang][body] = WP[lang][body] || {};
      var pg = pb[g.key] = pb[g.key] || {};
      pg[y] = (pg[y] || 0) + w;
      yrs[lang] = yrs[lang] || {}; yrs[lang][body] = yrs[lang][body] || [9999, 0];
      if (w > 0) { yrs[lang][body][0] = Math.min(yrs[lang][body][0], y); yrs[lang][body][1] = Math.max(yrs[lang][body][1], y); }
    });
    var gByKey = {}; groups.forEach(function (g) { gByKey[g.key] = g; });
    return { bodies: bi, groups: groups, gByKey: gByKey, W: W, WP: WP, years: yrs, buckets: raw.buckets };
  }
  function span(lang, bodies) {
    var lo = 9999, hi = 0;
    bodies.forEach(function (b) { var y = META.years[lang] && META.years[lang][b]; if (y && y[1]) { lo = Math.min(lo, y[0]); hi = Math.max(hi, y[1]); } });
    return hi ? [lo, hi] : null;
  }

  // ------------------------------------------------------------------ term data
  function loadTerm(lang, item) {
    if (item.n > 2) return Promise.resolve({ term: item.term, n: item.n, entry: null, reason: 'long' });
    var path = 'terms/' + lang + '/' + item.n + '/' + bucketOf(item.term, item.n) + '.json.gz';
    return fetchData(path, { missingOk: true }).then(function (obj) {
      var e = obj && obj[item.term];
      if (!e) return { term: item.term, n: item.n, entry: null, reason: 'absent' };
      return { term: item.term, n: item.n, entry: indexEntry(e) };
    });
  }
  function indexEntry(e) {
    var C = {}; var CP = {};
    for (var i = 0; i < e.s.length; i += 4) {
      var body = META.bodies[e.s[i]]; if (!BODY[body]) continue;
      var y = e.s[i + 1]; var g = META.groups[e.s[i + 2]]; var c = e.s[i + 3];
      var cb = C[body] = C[body] || {}; cb[y] = (cb[y] || 0) + c;
      var pb = CP[body] = CP[body] || {}; var pg = pb[g.key] = pb[g.key] || {}; pg[y] = (pg[y] || 0) + c;
    }
    return { total: e.c, C: C, CP: CP, k: e.k || [] };
  }

  // ------------------------------------------------------------------ series
  function years() {
    var sp = span(S.lang, S.b) || [1803, 2026];
    var from = S.from ? Math.max(S.from, 1803) : sp[0];
    var to = S.to ? Math.min(S.to, 2026) : sp[1];
    if (from > to) { var t = from; from = to; to = t; }
    return [from, to];
  }
  function mkSeries(key, label, cls, cFn, wFn, yr) {
    var pts = [];
    for (var y = yr[0]; y <= yr[1]; y++) pts.push({ y: y, c: cFn(y), w: wFn(y) });
    return { key: key, label: label, cls: cls, pts: pts };
  }
  function sumBodies(map, bodies, y) { var s = 0; bodies.forEach(function (b) { s += (map[b] && map[b][y]) || 0; }); return s; }

  // Party lines for one chamber: the seven parties with the most words in the years shown,
  // in that order, so a party keeps its colour whatever the term; the rest fold into Other.
  function partyLineup(body, yr) {
    var wp = (META.WP[S.lang] && META.WP[S.lang][body]) || {};
    var tot = Object.keys(wp).map(function (k) {
      var s = 0; for (var y = yr[0]; y <= yr[1]; y++) s += wp[k][y] || 0;
      return { key: k, w: s };
    }).filter(function (x) { return x.w > 0; }).sort(function (a, b) { return b.w - a.w; });
    return { top: tot.slice(0, 7).map(function (x) { return x.key; }), rest: tot.slice(7).map(function (x) { return x.key; }) };
  }

  function panels() {
    var yr = years(); var lang = S.lang;
    var found = RESULTS.filter(function (r) { return r.entry; });
    var W = META.W[lang] || {};
    var bodies = S.b.filter(function (b) { return W[b]; });
    if (S.split === 'none') {
      return [{ title: null, series: found.map(function (r, i) {
        return mkSeries(r.term, r.term, 's' + (i + 1), function (y) { return sumBodies(r.entry.C, bodies, y); }, function (y) { return sumBodies(W, bodies, y); }, yr);
      }) }];
    }
    if (S.split === 'body') {
      return found.map(function (r) {
        return { title: r.term, series: bodies.map(function (b) {
          return mkSeries(b, BODY[b].label, 's' + BODY[b].slot, function (y) { return (r.entry.C[b] && r.entry.C[b][y]) || 0; }, function (y) { return (W[b] && W[b][y]) || 0; }, yr);
        }) };
      });
    }
    var body = S.pb; var lu = partyLineup(body, yr);
    var wp = (META.WP[lang] && META.WP[lang][body]) || {};
    return found.map(function (r) {
      var cp = r.entry.CP[body] || {};
      var series = lu.top.map(function (k, i) {
        return mkSeries(k, META.gByKey[k].name, 's' + (i + 1), function (y) { return (cp[k] && cp[k][y]) || 0; }, function (y) { return (wp[k] && wp[k][y]) || 0; }, yr);
      });
      if (lu.rest.length) {
        series.push(mkSeries('other', 'Other parties', 'so', function (y) { var s = 0; lu.rest.forEach(function (k) { s += (cp[k] && cp[k][y]) || 0; }); return s; },
          function (y) { var s = 0; lu.rest.forEach(function (k) { s += (wp[k] && wp[k][y]) || 0; }); return s; }, yr));
      }
      return { title: r.term + ' — ' + BODY[body].label, series: series };
    });
  }
  // Rate per million at each point, pooled over the smoothing window (sum of uses over sum of words).
  function rates(series) {
    var k = S.sm; var pts = series.pts;
    return pts.map(function (p, i) {
      if (!(p.w > 0)) return null;
      var c = 0, w = 0;
      for (var j = Math.max(0, i - k); j <= Math.min(pts.length - 1, i + k); j++) { if (pts[j].w > 0) { c += pts[j].c; w += pts[j].w; } }
      return { y: p.y, r: c / w * 1e6, raw: p.c / p.w * 1e6, c: p.c, w: p.w, low: p.w < LOW_WORDS };
    });
  }

  // ------------------------------------------------------------------ chart
  function niceStep(span, target) {
    var raw = span / Math.max(1, target); var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / mag; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  }
  function drawPanel(fig, panel) {
    var plot = fig.querySelector('.plot');
    var width = Math.max(280, Math.round(plot.clientWidth || 640));
    var data = panel.series.map(function (s) { return rates(s); });
    var yr = years();
    var max = 0; data.forEach(function (d) { d.forEach(function (p) { if (p && p.r > max) max = p.r; }); });
    if (!(max > 0)) max = 1;
    var direct = panel.series.length <= 4 && panel.series.length > 1 && width >= 560;
    var M = { l: 52, r: direct ? 118 : 14, t: 12, b: 28 };
    var height = Math.round(Math.min(380, Math.max(230, width * 0.46)));
    var iw = width - M.l - M.r; var ih = height - M.t - M.b;
    var ystep = niceStep(max, 5); var ymax = Math.ceil(max * 1.04 / ystep) * ystep;
    var x = function (y) { return M.l + (yr[1] === yr[0] ? iw / 2 : (y - yr[0]) / (yr[1] - yr[0]) * iw); };
    var yv = function (v) { return M.t + ih - v / ymax * ih; };
    var svg = sv('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, role: 'img',
      'aria-label': (panel.title ? panel.title + ': ' : '') + 'uses per million words, ' + yr[0] + ' to ' + yr[1] + '. ' + panel.series.map(function (s, i) {
        /** @type {{ r: number, y: number } | null} */
        var best = null; data[i].forEach(function (p) { if (p && (!best || p.r > best.r)) best = p; });
        return s.label + (best ? ', highest ' + rateFmt(best.r) + ' in ' + best.y : ', no uses');
      }).join('; ') + '.' });
    for (var v = 0; v <= ymax + 1e-9; v += ystep) {
      svg.appendChild(sv('line', { class: v === 0 ? 'axis' : 'grid', x1: M.l, x2: M.l + iw, y1: yv(v), y2: yv(v) }));
      svg.appendChild(sv('text', { x: M.l - 6, y: yv(v) + 4, 'text-anchor': 'end', text: rateFmt(v) }));
    }
    var xstep = [1, 2, 5, 10, 20, 25, 50, 100].find(function (s) { return (yr[1] - yr[0]) / s <= Math.max(2, iw / 70); }) || 100;
    for (var t = Math.ceil(yr[0] / xstep) * xstep; t <= yr[1]; t += xstep) {
      svg.appendChild(sv('line', { class: 'axis', x1: x(t), x2: x(t), y1: M.t + ih, y2: M.t + ih + 4 }));
      svg.appendChild(sv('text', { x: x(t), y: M.t + ih + 17, 'text-anchor': 'middle', text: String(t) }));
    }
    var anyLow = false; var labels = [];
    panel.series.forEach(function (s, i) {
      var d = data[i];
      // A path per run of points, solid or dotted (low volume); a gap where there were no words.
      var runs = []; var cur = null;
      for (var j = 0; j < d.length; j++) {
        var p = d[j];
        if (!p) { cur = null; continue; }
        if (p.low) anyLow = true;
        if (cur && j > 0 && d[j - 1]) {
          var low = p.low || d[j - 1].low;
          if (cur.low !== low) { cur = { low: low, pts: [d[j - 1]] }; runs.push(cur); }
          cur.pts.push(p);
        } else { cur = { low: p.low, pts: [p] }; runs.push(cur); }
      }
      runs.forEach(function (run) {
        if (run.pts.length === 1) { svg.appendChild(sv('circle', { class: s.cls, cx: x(run.pts[0].y), cy: yv(run.pts[0].r), r: 2.5 })); return; }
        svg.appendChild(sv('path', { class: 'ln ' + s.cls + (run.low ? ' low' : ''), d: run.pts.map(function (q, m) { return (m ? 'L' : 'M') + x(q.y).toFixed(1) + ',' + yv(q.r).toFixed(1); }).join('') }));
      });
      var last = null; for (var z = d.length - 1; z >= 0; z--) if (d[z]) { last = d[z]; break; }
      if (direct && last) labels.push({ y: yv(last.r), x: x(last.y), s: s });
    });
    // Direct labels for up to four lines, pushed apart so they never overlap.
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var li = 1; li < labels.length; li++) if (labels[li].y - labels[li - 1].y < 15) labels[li].y = labels[li - 1].y + 15;
    var over = labels.length ? labels[labels.length - 1].y - (M.t + ih) : 0;
    if (over > 0) labels.forEach(function (l) { l.y -= over; });
    labels.forEach(function (l) {
      svg.appendChild(sv('line', { class: l.s.cls, x1: M.l + iw + 6, x2: M.l + iw + 16, y1: l.y, y2: l.y, 'stroke-width': 3 }));
      var name = l.s.label.length > 14 ? l.s.label.slice(0, 13) + '…' : l.s.label;
      svg.appendChild(sv('text', { class: 'dl', x: M.l + iw + 20, y: l.y + 4, text: name }));
    });
    // Hover and keyboard layer.
    var cross = sv('line', { class: 'cross', y1: M.t, y2: M.t + ih, visibility: 'hidden' });
    svg.appendChild(cross);
    var dots = panel.series.map(function (s) { var c = sv('circle', { class: 'dot ' + s.cls, r: 4.5, visibility: 'hidden' }); svg.appendChild(c); return c; });
    var hit = sv('rect', { class: 'hit', x: M.l, y: M.t, width: iw, height: ih });
    svg.appendChild(hit);
    var old = plot.querySelector('svg'); if (old) plot.replaceChild(svg, old); else plot.insertBefore(svg, plot.firstChild);
    var tip = plot.querySelector('.tip'); var live = fig.querySelector('.live');
    var curYear = null;
    // The tooltip element outlives a redraw (only the svg is replaced), so the run starts where it is.
    var tipState = TOOLTIP.start(tip.hidden ? 'hidden' : 'shown');
    function setTip(next) { if (tipState.state() !== next) tipState.to(next); tip.hidden = next === 'hidden'; }
    function show(yv0, announce) {
      var y = Math.max(yr[0], Math.min(yr[1], yv0)); curYear = y;
      var idx = y - yr[0]; var xx = x(y);
      cross.setAttribute('x1', String(xx)); cross.setAttribute('x2', String(xx)); cross.setAttribute('visibility', 'visible');
      clear(tip); tip.appendChild(el('strong', { text: String(y) }));
      var spoken = [];
      panel.series.forEach(function (s, i) {
        var p = data[i][idx];
        if (p) { dots[i].setAttribute('cx', xx); dots[i].setAttribute('cy', yv(p.r)); dots[i].setAttribute('visibility', 'visible'); }
        else dots[i].setAttribute('visibility', 'hidden');
        var txt = p ? rateFmt(p.r) + ' per million' : 'no words in scope';
        var sub = p ? int(p.c) + ' uses in ' + words(p.w) + ' words' + (S.sm ? ' (that year)' : '') + (p.low ? ', low volume' : '') : '';
        tip.appendChild(el('div', { class: 'row' }, [el('i', { class: 'sw ' + s.cls, 'aria-hidden': 'true' }), el('span', { text: s.label }), el('span', { text: txt }), sub ? el('small', { text: sub }) : null]));
        spoken.push(s.label + ' ' + txt + (p ? ', ' + int(p.c) + ' uses' : ''));
      });
      setTip('shown');
      var tw = tip.offsetWidth; var left = xx / width * plot.clientWidth + 12;
      if (left + tw > plot.clientWidth) left = Math.max(0, xx / width * plot.clientWidth - tw - 12);
      tip.style.left = left + 'px'; tip.style.top = '8px';
      if (announce) live.textContent = y + ': ' + spoken.join('; ');
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); }); setTip('hidden'); }
    function yearAt(evt) { var r = svg.getBoundingClientRect(); var px = (evt.clientX - r.left) / r.width * width; return Math.round(yr[0] + (px - M.l) / iw * (yr[1] - yr[0])); }
    hit.addEventListener('pointermove', function (e) { show(yearAt(e), false); });
    hit.addEventListener('pointerdown', function (e) { show(yearAt(e), false); });
    hit.addEventListener('pointerleave', hide);
    plot.onkeydown = function (e) {
      var step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 }[e.key];
      if (step) { e.preventDefault(); show((curYear == null ? yr[1] : curYear) + step, true); }
      else if (e.key === 'Home') { e.preventDefault(); show(yr[0], true); }
      else if (e.key === 'End') { e.preventDefault(); show(yr[1], true); }
      else if (e.key === 'Escape') hide();
    };
    plot.onblur = hide;
    var notes = fig.querySelector('.chart-notes');
    clear(notes);
    if (anyLow) notes.appendChild(el('span', {}, [el('i', { class: 'sw-low', 'aria-hidden': 'true' }), 'Dotted: fewer than 100,000 words spoken that year in scope. ']));
    notes.appendChild(document.createTextNode('Gaps: no sittings or no members in scope.' + (S.sm ? ' Smoothed over ' + (2 * S.sm + 1) + ' years.' : '')));
  }

  function panelTable(panel) {
    var data = panel.series.map(rates);
    var rows = [];
    var n = panel.series[0] ? panel.series[0].pts.length : 0;
    for (var i = 0; i < n; i++) {
      if (!data.some(function (d) { return d[i]; })) continue;
      rows.push(el('tr', {}, [el('th', { scope: 'row', text: String(panel.series[0].pts[i].y) })].concat(data.map(function (d) {
        return el('td', { class: 'num', text: d[i] ? rateFmt(d[i].r) + ' (' + int(d[i].c) + ')' : '–' });
      }))));
    }
    return el('details', { class: 'tbl' }, [
      el('summary', { text: 'Table of the plotted figures' }),
      el('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': 'Plotted figures' + (panel.title ? ', ' + panel.title : '') }, [
        el('table', { class: 'data' }, [
          el('caption', { class: 'visually-hidden', text: 'Uses per million words by year, with the number of uses in brackets' }),
          el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Year' })].concat(panel.series.map(function (s) { return el('th', { scope: 'col', class: 'num', text: s.label }); })))]),
          el('tbody', {}, rows)
        ])
      ])
    ]);
  }

  var resizeObs = null; var drawn = [];
  function renderPanels() {
    var mount = clear($('panels'));
    drawn = [];
    var ps = panels();
    var bodyNames = S.b.filter(function (b) { return META.W[S.lang] && META.W[S.lang][b]; }).map(function (b) { return BODY[b].label; });
    $('chartIntro').textContent = (S.split === 'none' ? 'All the chambers selected, pooled: ' + bodyNames.join(', ') + '.'
      : S.split === 'body' ? 'One chart per term, a line per chamber.'
        : 'One chart per term, a line for each of the seven parties with the most words in the ' + BODY[S.pb].name + ' over these years; the rest are Other parties.')
      + (S.lang === 'ga' ? ' Irish-language paragraphs only.' : '') + ' Hover over a chart, or focus it and use the arrow keys, to read the figures for a year.';
    ps.forEach(function (panel, pi) {
      var fig = el('figure', { class: 'panel' }, [
        el('figcaption', {}, [panel.title ? el('h3', { text: panel.title }) : el('span', { class: 'visually-hidden', text: 'Uses per million words' }), el('span', { class: 'unit', text: 'uses per million words' })]),
        el('div', { class: 'plot', tabindex: '0', 'aria-label': (panel.title || 'Chart') + '. Use the left and right arrow keys to read values by year.' }, [el('div', { class: 'tip', hidden: true })]),
        el('div', { class: 'visually-hidden live', 'aria-live': 'polite' }),
        panel.series.length > 1 ? el('ul', { class: 'legend', 'aria-label': 'Legend' }, panel.series.map(function (s) {
          return el('li', {}, [el('i', { class: 'sw ' + s.cls, 'aria-hidden': 'true' }), s.label]);
        })) : null,
        el('p', { class: 'chart-notes' }),
        panelTable(panel)
      ]);
      if (!panel.series.length) {
        fig.querySelector('.plot').replaceWith(el('p', { class: 'empty', text: 'No chamber selected has words in this language.' }));
        mount.appendChild(fig); return;
      }
      mount.appendChild(fig);
      drawPanel(fig, panel);
      drawn.push({ fig: fig, panel: panel, w: fig.querySelector('.plot').clientWidth });
    });
    if (!resizeObs && typeof ResizeObserver !== 'undefined') {
      var pending = null;
      resizeObs = new ResizeObserver(function () {
        if (pending) return;
        pending = requestAnimationFrame(function () {
          pending = null;
          drawn.forEach(function (d) { var w = d.fig.querySelector('.plot').clientWidth; if (Math.abs(w - d.w) > 4) { d.w = w; drawPanel(d.fig, d.panel); } });
        });
      });
      resizeObs.observe($('panels'));
    }
  }

  // ------------------------------------------------------------------ speakers
  function personLink(row) {
    var key = row[0]; var pid = row[4];
    var m = /^p(\d+)$/.exec(pid || '');
    if (m) return el('a', { href: '/browse/#/persons/' + m[1], text: row[1] });
    var ext = null;
    if (/^oireachtas:/.test(key)) ext = ['https://www.oireachtas.ie/en/members/member/' + encodeURIComponent(key.slice(11)) + '/', 'Oireachtas'];
    else if (/^niassembly:\d+$/.test(key)) ext = ['https://aims.niassembly.gov.uk/mlas/details.aspx?per=' + key.slice(11), 'NI Assembly'];
    else if (/^ukparliament:\d+$/.test(key)) ext = ['https://members.parliament.uk/member/' + key.slice(13) + '/contact', 'UK Parliament'];
    if (!ext) return document.createTextNode(row[1]);
    return el('span', {}, [el('a', { href: ext[0], rel: 'noopener', text: row[1] }), el('span', { class: 'tag', text: ext[1] })]);
  }
  function partyCell(label) {
    var g = groupOf(label);
    return g.slug ? el('a', { href: '/browse/#/parties/' + encodeURIComponent(g.slug), text: g.name }) : document.createTextNode(g.name);
  }
  function focusResult() {
    var found = RESULTS.filter(function (r) { return r.entry; });
    return found[Math.min(S.t, found.length - 1)] || null;
  }
  function renderSpeakers() {
    var mount = clear($('speakers'));
    var r = focusResult(); if (!r) return;
    if (!SPEAKERS) { mount.appendChild(el('p', { class: 'hint', text: 'Loading speakers…' })); return; }
    var rows = [];
    for (var i = 0; i < r.entry.k.length; i += 2) {
      var sp = SPEAKERS[r.entry.k[i]]; if (!sp || !BODY[sp[2]]) continue;
      if (S.b.indexOf(sp[2]) < 0) continue;
      if (S.sb && sp[2] !== S.sb) continue;
      rows.push({ si: r.entry.k[i], sp: sp, c: r.entry.k[i + 1], rate: sp[5] > 0 ? r.entry.k[i + 1] / sp[5] * 1e4 : 0 });
    }
    var note = null;
    if (S.sort === 'rate') {
      var before = rows.length;
      rows = rows.filter(function (x) { return x.sp[5] >= RATE_FLOOR; }).sort(function (a, b) { return b.rate - a.rate; });
      if (before > rows.length) note = (before - rows.length) + ' speaker' + (before - rows.length === 1 ? '' : 's') + ' with fewer than 20,000 words left out of this order.';
    }
    if (!rows.length) {
      mount.appendChild(el('p', { class: 'empty', text: 'None of the top thirty speakers for ' + quote(r.term) + ' sat in the chambers selected.' }));
      return;
    }
    var tbody = el('tbody');
    rows.forEach(function (x, n) {
      var distBtn = S.lang === 'en' ? el('button', { type: 'button', class: 'linkish', 'aria-expanded': 'false', text: 'Their words', title: 'Words this speaker used more than colleagues' }) : null;
      var tr = el('tr', {}, [
        el('td', { class: 'num', text: String(n + 1) }),
        el('td', {}, [personLink(x.sp)]),
        el('td', { text: BODY[x.sp[2]].label }),
        el('td', {}, [partyCell(x.sp[3])]),
        el('td', { class: 'num hide-sm', text: x.sp[6] === x.sp[7] ? String(x.sp[6]) : x.sp[6] + '–' + x.sp[7] }),
        el('td', { class: 'num', text: int(x.c) }),
        el('td', { class: 'num', text: x.sp[5] >= RATE_FLOOR ? x.rate.toFixed(2) : x.rate.toFixed(2) + '*' }),
        el('td', {}, [distBtn])
      ]);
      tbody.appendChild(tr);
      if (distBtn) distBtn.addEventListener('click', function () { toggleDistinct(distBtn, tr, x); });
    });
    mount.appendChild(el('div', { class: 'tablewrap' }, [el('table', { class: 'data' }, [
      el('caption', { class: 'visually-hidden', text: 'Top speakers for ' + r.term }),
      el('thead', {}, [el('tr', {}, [
        el('th', { scope: 'col', class: 'num', text: '#' }), el('th', { scope: 'col', text: 'Speaker' }), el('th', { scope: 'col', text: 'Chamber' }),
        el('th', { scope: 'col', text: 'Party' }), el('th', { scope: 'col', class: 'num hide-sm', text: 'Years' }), el('th', { scope: 'col', class: 'num', text: 'Uses' }),
        el('th', { scope: 'col', class: 'num', text: 'Per 10,000 words' }), el('th', { scope: 'col' }, [el('span', { class: 'visually-hidden', text: 'Distinctive words' })])
      ])]),
      tbody
    ])]));
    var foot = 'Party as most often recorded for the speaker in that chamber. * fewer than 20,000 words on record, so the rate is unreliable.';
    mount.appendChild(el('p', { class: 'hint', text: (note ? note + ' ' : '') + foot }));
  }
  function toggleDistinct(btn, tr, x) {
    var next = tr.nextElementSibling;
    if (next && next.classList.contains('dist')) { next.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    var cell = el('td', { colspan: '8' }, [el('span', { class: 'hint', text: 'Loading…' })]);
    var row = el('tr', { class: 'dist' }, [cell]);
    tr.after(row); btn.setAttribute('aria-expanded', 'true');
    fetchData('speaker_terms/' + Math.floor(x.si / 200) + '.json.gz').then(function (obj) {
      clear(cell);
      var list = (obj && obj[String(x.si)]) || [];
      if (!list.length) { cell.appendChild(el('span', { class: 'hint', text: 'No distinctive words recorded for this speaker.' })); return; }
      cell.appendChild(el('div', { class: 'hint', text: 'Words and phrases ' + x.sp[1] + ' used more often than the ' + BODY[x.sp[2]].label + ' as a whole (times as often). Select one to search it.' }));
      cell.appendChild(el('div', { class: 'termlist' }, list.slice(0, 20).map(function (t) {
        return el('button', { type: 'button', text: t[0] + ' ×' + t[2], on: { click: function () { search(t[0], { lang: 'en' }); } } });
      })));
    }).catch(function () { clear(cell).appendChild(el('span', { class: 'hint', text: 'Could not load this speaker’s words.' })); });
  }

  // ------------------------------------------------------------------ parties
  function renderParties() {
    var mount = clear($('parties'));
    var r = focusResult(); if (!r) return;
    var body = S.cb; var yr = years();
    var wp = (META.WP[S.lang] && META.WP[S.lang][body]) || {};
    var cp = r.entry.CP[body] || {};
    /** @type {Array<{ key: string, w: number, c: number, label?: string }>} */
    var rows = Object.keys(wp).map(function (k) {
      var w = 0, c = 0; for (var y = yr[0]; y <= yr[1]; y++) { w += wp[k][y] || 0; c += (cp[k] && cp[k][y]) || 0; }
      return { key: k, w: w, c: c };
    }).filter(function (x) { return x.w > 0; });
    var W = 0, C = 0; rows.forEach(function (x) { W += x.w; C += x.c; });
    if (!W) { mount.appendChild(el('p', { class: 'empty', text: 'The ' + BODY[body].name + ' has no ' + (S.lang === 'ga' ? 'Irish-language ' : '') + 'words on record in ' + yr[0] + '–' + yr[1] + '.' })); return; }
    if (!C) { mount.appendChild(el('p', { class: 'empty', text: 'No uses of ' + quote(r.term) + ' in the ' + BODY[body].name + ' in ' + yr[0] + '–' + yr[1] + '.' })); return; }
    rows.sort(function (a, b) { return b.c - a.c || b.w - a.w; });
    var show = rows.slice(0, 10); var rest = rows.slice(10);
    if (rest.length) {
      var o = { key: 'other', w: 0, c: 0, label: 'Other parties (' + rest.length + ')' };
      rest.forEach(function (x) { o.w += x.w; o.c += x.c; }); show.push(o);
    }
    var maxShare = 0; show.forEach(function (x) { maxShare = Math.max(maxShare, x.c / C, x.w / W); });
    function bar(cls, share) {
      return el('div', { class: 'bar' }, [el('i', { class: cls, style: 'width:' + Math.max(1, share / maxShare * 90).toFixed(0) + 'px', 'aria-hidden': 'true' }), el('span', { text: (share * 100).toFixed(1) + '%' })]);
    }
    var tbody = el('tbody', {}, show.map(function (x) {
      var g = META.gByKey[x.key]; var ratio = (x.c / C) / (x.w / W);
      return el('tr', {}, [
        el('td', {}, [x.label ? document.createTextNode(x.label) : g.slug ? el('a', { href: '/browse/#/parties/' + encodeURIComponent(g.slug), text: g.name }) : document.createTextNode(g.name)]),
        el('td', { class: 'num', text: int(x.c) }),
        el('td', {}, [bar('u', x.c / C)]),
        el('td', {}, [bar('w', x.w / W)]),
        el('td', { class: 'num over', text: x.w / W < 0.002 ? '–' : ratio.toFixed(2) })
      ]);
    }));
    mount.appendChild(el('div', { class: 'tablewrap' }, [el('table', { class: 'data' }, [
      el('caption', { class: 'visually-hidden', text: 'Party shares of ' + r.term + ' in the ' + BODY[body].name + ', ' + yr[0] + '–' + yr[1] }),
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Party' }), el('th', { scope: 'col', class: 'num', text: 'Uses' }), el('th', { scope: 'col', text: 'Share of uses' }), el('th', { scope: 'col', text: 'Share of words' }), el('th', { scope: 'col', class: 'num', text: 'Ratio' })])]),
      tbody
    ])]));
    mount.appendChild(el('p', { class: 'hint', text: quote(r.term) + ' in the ' + BODY[body].name + ', ' + yr[0] + '–' + yr[1] + ': ' + int(C) + ' uses in ' + words(W) + ' words. Ratio not shown for parties with under 0.2% of the words.' }));
  }

  // ------------------------------------------------------------------ CSV
  function downloadCsv() {
    var lines = [['term', 'language', 'lines', 'series', 'year', 'uses', 'words', 'per_million', 'per_million_smoothed', 'smoothing_years'].join(',')];
    var q = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var ps = panels();
    var terms = RESULTS.filter(function (r) { return r.entry; });
    ps.forEach(function (panel, pi) {
      panel.series.forEach(function (s) {
        var term = S.split === 'none' ? s.label : terms[pi].term;
        var series = S.split === 'none' ? 'all selected chambers' : s.label;
        rates(s).forEach(function (p) {
          if (!p) return;
          lines.push([q(term), S.lang, S.split, q(series), p.y, p.c, Math.round(p.w), p.raw.toFixed(4), p.r.toFixed(4), S.sm ? 2 * S.sm + 1 : 1].join(','));
        });
      });
    });
    var csv = lines.join('\r\n') + '\r\n';
    var a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'civgraph-words-' + terms.map(function (r) { return r.term.replace(/[^\p{L}\p{N}]+/gu, '-'); }).join('_').slice(0, 80) + '.csv' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ------------------------------------------------------------------ controls
  function buildControls() {
    var chips = clear($('bodyChips'));
    BODIES.forEach(function (b) {
      var input = el('input', { type: 'checkbox', value: b.code, id: 'b-' + b.code });
      input.addEventListener('change', function () {
        var on = BODIES.map(function (x) { return x.code; }).filter(function (c) { return $('b-' + c).checked; });
        if (!on.length) { input.checked = true; return; }
        S.b = on; S.sb = S.sb && on.indexOf(S.sb) < 0 ? '' : S.sb; changed();
      });
      chips.appendChild(el('label', { class: 'chip', title: b.name }, [input, el('span', { text: b.label })]));
    });
    ['pb', 'cmpBody'].forEach(function (id) {
      var s = clear($(id)); BODIES.forEach(function (b) { s.appendChild(el('option', { value: b.code, text: b.label })); });
    });
    $('split').addEventListener('change', /** @this {UiElement} */ function () { S.split = this.value; changed(); });
    $('pb').addEventListener('change', /** @this {UiElement} */ function () { S.pb = this.value; S.cb = this.value; changed(); });
    $('cmpBody').addEventListener('change', /** @this {UiElement} */ function () { S.cb = this.value; writeUrl(false); renderParties(); });
    $('sm').addEventListener('change', /** @this {UiElement} */ function () { S.sm = Number(this.value); changed(); });
    document.querySelectorAll('input[name="lang"]').forEach(function (r) {
      r.addEventListener('change', /** @this {UiElement} */ function () { if (this.checked) { S.lang = this.value; run(false); } });
    });
    ['from', 'to'].forEach(function (id) {
      $(id).addEventListener('change', /** @this {UiElement} */ function () {
        var v = Number(this.value); S[id] = this.value && v >= 1803 && v <= 2026 ? v : null; changed();
      });
    });
    $('focus').addEventListener('change', /** @this {UiElement} */ function () { S.t = Number(this.value); writeUrl(false); renderSpeakers(); renderParties(); });
    $('spkBody').addEventListener('change', /** @this {UiElement} */ function () { S.sb = this.value; writeUrl(false); renderSpeakers(); });
    $('spkSort').addEventListener('change', /** @this {UiElement} */ function () { S.sort = this.value; writeUrl(false); renderSpeakers(); });
    $('csvBtn').addEventListener('click', downloadCsv);
    $('copyBtn').addEventListener('click', function () {
      var msg = $('copyMsg'); var url = location.href;
      var done = function () { msg.textContent = 'Link copied.'; setTimeout(function () { msg.textContent = ''; }, 3000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { msg.textContent = url; });
      else msg.textContent = url;
    });
    $('searchForm').addEventListener('submit', function (e) { e.preventDefault(); closeSuggest(); search($('q').value); });
    var ex = $('examples');
    EXAMPLES.forEach(function (x) {
      ex.appendChild(el('button', { type: 'button', class: 'linkish', text: x.label, on: { click: function () { search(x.q, x); } } }));
    });
    setupSuggest();
  }
  function syncControls() {
    $('q').value = S.q.join(', ');
    BODIES.forEach(function (b) { $('b-' + b.code).checked = S.b.indexOf(b.code) >= 0; });
    $('split').value = S.split; $('pb').value = S.pb; $('pbField').hidden = S.split !== 'party';
    $('cmpBody').value = S.cb; $('sm').value = String(S.sm);
    /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="lang"]')).forEach(function (r) { r.checked = r.value === S.lang; });
    var yr = META ? years() : [1803, 2026];
    $('from').value = S.from || ''; $('to').value = S.to || '';
    $('from').placeholder = String(yr[0]); $('to').placeholder = String(yr[1]);
    $('spkSort').value = S.sort;
    var sb = clear($('spkBody'));
    sb.appendChild(el('option', { value: '', text: 'All selected' }));
    S.b.forEach(function (c) { sb.appendChild(el('option', { value: c, text: BODY[c].label })); });
    sb.value = S.sb;
    var found = RESULTS.filter(function (r) { return r.entry; });
    var f = clear($('focus'));
    found.forEach(function (r, i) { f.appendChild(el('option', { value: String(i), text: r.term })); });
    if (S.t >= found.length) S.t = 0;
    f.value = String(S.t); $('focusField').hidden = found.length < 2;
  }
  function changed() { writeUrl(false); syncControls(); render(); }
  function search(raw, opts) {
    var items = parseQuery(raw);
    S.q = items.map(function (x) { return x.term; });
    S.t = 0; S.sb = '';
    if (opts && opts.lang) S.lang = opts.lang;
    if (opts && opts.split) S.split = opts.split;
    if (opts && opts.pb) { S.pb = opts.pb; S.cb = opts.pb; }
    run(true);
  }

  // ------------------------------------------------------------------ autocomplete
  var sugActive = -1; var sugItems = [];
  function lastSegment() { var v = $('q').value; var i = v.lastIndexOf(','); return { head: i >= 0 ? v.slice(0, i + 1) + ' ' : '', seg: (i >= 0 ? v.slice(i + 1) : v).trim() }; }
  function closeSuggest() { $('suggest').hidden = true; $('q').setAttribute('aria-expanded', 'false'); $('q').removeAttribute('aria-activedescendant'); sugActive = -1; sugItems = []; }
  function setupSuggest() {
    var input = $('q'); var list = $('suggest'); var seq = 0;
    input.addEventListener('input', function () {
      var ls = lastSegment(); var t = tokens(ls.seg); var mine = ++seq;
      if (t.length === 0 || t.length > 2 || ls.seg.length < 2) { closeSuggest(); return; }
      var prefix = t.join(' ') + (/\s$/.test($('q').value) && t.length === 1 ? ' ' : '');
      var n = prefix.indexOf(' ') >= 0 ? 2 : 1;
      fetchData('suggest/' + S.lang + '-' + n + '.json.gz').then(function (rows) {
        if (mine !== seq) return;
        sugItems = [];
        for (var i = 0; i < rows.length && sugItems.length < 8; i++) if (rows[i][0].indexOf(prefix) === 0) sugItems.push(rows[i]);
        clear(list); sugActive = -1;
        if (!sugItems.length) { closeSuggest(); return; }
        sugItems.forEach(function (row, i) {
          list.appendChild(el('li', { id: 'sug-' + i, role: 'option', 'aria-selected': 'false', on: { mousedown: function (e) { e.preventDefault(); pick(i); } } },
            [el('span', { text: row[0] }), el('span', { class: 'n', text: words(row[1]) + ' uses' })]));
        });
        list.hidden = false; input.setAttribute('aria-expanded', 'true');
      }).catch(function () { closeSuggest(); });
    });
    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sugActive = (sugActive + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length;
        Array.prototype.forEach.call(list.children, function (li, i) { li.setAttribute('aria-selected', i === sugActive ? 'true' : 'false'); });
        input.setAttribute('aria-activedescendant', 'sug-' + sugActive);
        list.children[sugActive].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && sugActive >= 0) { e.preventDefault(); pick(sugActive); }
      else if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); }
    });
    input.addEventListener('blur', function () { setTimeout(closeSuggest, 120); });
    function pick(i) { var ls = lastSegment(); input.value = ls.head + sugItems[i][0]; closeSuggest(); input.focus(); }
  }

  // ------------------------------------------------------------------ run
  function setStatus(t) { $('status').textContent = t; }
  function notices() {
    var mount = clear($('notices'));
    var missing = RESULTS.filter(function (r) { return !r.entry && !r.error; });
    var failed = RESULTS.filter(function (r) { return r.error; });
    if (missing.length) {
      mount.appendChild(el('div', { class: 'notice warn' }, [
        el('strong', { text: 'Not in the counts:' }),
        el('ul', {}, missing.map(function (r) {
          return el('li', {}, [quote(r.term) + ' — ' + (r.reason === 'long' ? 'only single words and two-word phrases are counted.'
            : r.n === 2 ? 'two-word phrases are kept only if used at least 100 times' + (S.lang === 'ga' ? ' in Irish' : '') + ', and not if both words are stop words.'
              : 'words are kept only if used at least 10 times' + (S.lang === 'ga' ? ' in Irish' : '') + ', and stop words such as “the” are not counted.')]);
        }))
      ]));
    }
    if (failed.length) {
      mount.appendChild(el('div', { class: 'notice err', role: 'alert' }, [
        'Could not load the counts for ' + failed.map(function (r) { return quote(r.term); }).join(', ') + ' (' + failed[0].error + ').',
        el('button', { type: 'button', class: 'btn', text: 'Try again', on: { click: function () { run(false); } } })
      ]));
    }
    if (S.q.length > MAX_TERMS) mount.appendChild(el('div', { class: 'notice warn', text: 'Only the first ' + MAX_TERMS + ' terms are shown.' }));
  }
  function render() {
    var found = RESULTS.filter(function (r) { return r.entry; });
    notices();
    $('empty').hidden = S.q.length > 0;
    $('results').hidden = !found.length;
    if (!found.length) return;
    renderPanels(); renderSpeakers(); renderParties();
  }
  function run(push) {
    var mine = ++renderToken;
    writeUrl(push);
    syncControls();
    if (!S.q.length) { RESULTS = []; setStatus(''); render(); return; }
    var items = S.q.slice(0, MAX_TERMS).map(function (t) { return { term: t, n: t.split(' ').length }; });
    setStatus('Loading ' + items.map(function (x) { return quote(x.term); }).join(', ') + '…');
    var speakers = SPEAKERS ? Promise.resolve(SPEAKERS) : fetchData('speakers.json.gz').then(function (s) { SPEAKERS = s; return s; }).catch(function () { return null; });
    Promise.all(items.map(function (it) {
      return loadTerm(S.lang, it).catch(function (e) { return { term: it.term, n: it.n, entry: null, error: e.message }; });
    })).then(function (res) {
      if (mine !== renderToken) return;
      RESULTS = res;
      syncControls();
      var found = res.filter(function (r) { return r.entry; });
      setStatus(found.length ? found.map(function (r) { return quote(r.term) + ': ' + int(r.entry.total) + ' uses'; }).join('; ') + (S.lang === 'ga' ? ' (in Irish).' : '.') : '');
      render();
      speakers.then(function () { if (mine === renderToken) renderSpeakers(); });
    });
  }

  function boot() {
    buildControls();
    S = readUrl();
    syncControls();
    setStatus('Loading the word totals…');
    Promise.all([fetchData('meta.json'), fetch('/apps/words/parties.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })])
      .then(function (out) {
        PARTIES = out[1]; META = indexMeta(out[0]);
        setStatus('');
        run(false);
      })
      .catch(function (e) {
        setStatus('');
        clear($('notices')).appendChild(el('div', { class: 'notice err', role: 'alert' }, [
          'The word counts could not be loaded (' + e.message + ').',
          el('button', { type: 'button', class: 'btn', text: 'Try again', on: { click: function () { location.reload(); } } })
        ]));
      });
    window.addEventListener('popstate', function () { S = readUrl(); run(false); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
