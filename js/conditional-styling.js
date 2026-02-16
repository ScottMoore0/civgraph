import mapController from './map-controller.js';
import dataService from './data-service.js';

class ConditionalStyling {
    constructor() {
        this.activeLayerId = null;
        this.activeConfig = null;
        this.modal = null;
        this.advancedActive = false;
        this.advancedConfig = null;
        this.enableAdvancedStyling = false;
        this.maxShareChars = 2000;
        this.routePrefix = 'as/v1/';
        this.compactKeyMap = { version: 'v', requiresLayers: 'r', targetLayer: 't', where: 'w', style: 's', rules: 'u', if: 'i', else: 'e' };
    }

    static hexToHSL(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }
        return [h * 360, s * 100, l * 100];
    }

    static hslToHex(h, s, l) {
        h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = (n) => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
        return '#' + f(0) + f(8) + f(4);
    }

    static interpolateColor(hex1, hex2, t) {
        const [h1, s1, l1] = ConditionalStyling.hexToHSL(hex1);
        const [h2, s2, l2] = ConditionalStyling.hexToHSL(hex2);
        let dh = h2 - h1; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
        return ConditionalStyling.hslToHex(h1 + dh * t, s1 + (s2 - s1) * t, l1 + (l2 - l1) * t);
    }

    getColor(value) {
        if (value === null || value === undefined || isNaN(value)) return this.activeConfig?.noDataColor || '#cccccc';
        const cfg = this.activeConfig;
        if (!cfg) return '#cccccc';
        const range = cfg.max - cfg.min;
        if (range <= 0) return cfg.lowColor;
        const t = Math.max(0, Math.min(1, (value - cfg.min) / range));
        return ConditionalStyling.interpolateColor(cfg.lowColor, cfg.highColor, t);
    }

    apply() {
        if (!this.activeLayerId || !this.activeConfig) return;
        const attr = this.activeConfig.attribute;
        mapController.applyLayerStyle(this.activeLayerId, (feature) => {
            if (feature.geometry?.type === 'Point') return {};
            const val = feature.properties?.[attr];
            return { fillColor: this.getColor(typeof val === 'number' ? val : null), fillOpacity: 0.7, color: '#333', weight: 1.5, opacity: 0.8 };
        });
    }

    clear() {
        if (this.activeLayerId) mapController.resetLayerStyle(this.activeLayerId);
        if (this.advancedConfig?.targetLayer) mapController.resetLayerStyle(this.advancedConfig.targetLayer);
        this.activeLayerId = null;
        this.activeConfig = null;
        this.advancedActive = false;
        this.advancedConfig = null;
    }

    serialize() {
        if (this.advancedActive || !this.activeConfig || !this.activeLayerId) return '';
        const c = this.activeConfig;
        return `g:${this.activeLayerId}:${c.attribute}:${c.min}-${c.max}:${c.lowColor.replace('#', '')}-${c.highColor.replace('#', '')}:${c.noDataColor.replace('#', '')}`;
    }

    restoreFromURL(csParam) {
        if (!csParam) return;
        const p = csParam.split(':');
        if (p[0] !== 'g') return;
        if (!mapController.layerStates.has(p[1])) return;
        const [min, max] = (p[3] || '').split('-').map(Number);
        const [lowColor, highColor] = (p[4] || '').split('-');
        this.activeLayerId = p[1];
        this.activeConfig = { mode: 'gradient', attribute: p[2], min, max, lowColor: '#' + lowColor, highColor: '#' + highColor, noDataColor: '#' + (p[5] || 'ccc') };
        this.advancedActive = false;
        this.advancedConfig = null;
        this.apply();
    }

    hasAdvancedState() { return this.enableAdvancedStyling && !!(this.advancedActive && this.advancedConfig); }

    getPreferredHashRoute() {
        if (!this.enableAdvancedStyling) return null;
        const r = this.getAdvancedHashRoute({ verbose: false });
        return r.ok ? r.route : null;
    }

    getAdvancedHashRoute({ verbose = false } = {}) {
        if (!this.hasAdvancedState()) return { ok: false, reason: 'no-state' };
        const cfg = this._canonicalizeAdvanced(this.advancedConfig);
        const payload = verbose ? this._encode(cfg, false) : this._encode(this._compactify(cfg), true);
        if (!payload) return { ok: false, reason: 'encode-failed' };
        const route = `${this.routePrefix}${verbose ? 'v.' : 'c.'}${payload}`;
        const full = `${window.location.origin}${window.location.pathname}#${route}`;
        if (full.length > this.maxShareChars) return { ok: false, reason: 'too-long', length: full.length, limit: this.maxShareChars };
        return { ok: true, route, length: full.length };
    }

    async restoreFromAdvancedRoute(route) {
        if (!this.enableAdvancedStyling) return false;
        if (!route?.startsWith(this.routePrefix)) return false;
        const raw = route.slice(this.routePrefix.length);
        const verbose = raw.startsWith('v.');
        if (!verbose && !raw.startsWith('c.')) return false;
        const cfg = this._decode(raw.slice(2), !verbose);
        if (!cfg) return false;
        await this.applyAdvancedFromConfig(cfg);
        return true;
    }

    async applyAdvancedFromConfig(cfg) {
        if (!this.enableAdvancedStyling) throw new Error('Advanced styling is currently disabled');
        const normalized = this._canonicalizeAdvanced(cfg);
        const valid = this._validateAdvanced(normalized);
        if (!valid.ok) throw new Error(valid.errors.join(' | '));
        for (const id of new Set([...(normalized.requiresLayers || []), normalized.targetLayer])) {
            if (!id || mapController.isLayerLoaded(id)) continue;
            const m = dataService.getMapById(id);
            if (!m) throw new Error(`Unknown layer: ${id}`);
            await mapController.loadLayer(m, true);
        }
        const whereFn = normalized.where ? this._compileExpr(normalized.where) : null;
        const rules = (normalized.rules || []).map((r) => ({ ifFn: this._compileExpr(r.if || 'true'), style: r.style || {}, else: r.else || null }));
        const baseStyle = normalized.style || {};
        this.clear();
        this.advancedActive = true;
        this.advancedConfig = normalized;
        mapController.applyLayerStyle(normalized.targetLayer, (feature) => {
            if (feature.geometry?.type === 'Point') return {};
            const ctx = this._ctx(feature);
            if (whereFn && !this._safeEval(whereFn, feature, ctx)) return {};
            let out = this._evalStyle(baseStyle, feature, ctx);
            for (const r of rules) {
                if (this._safeEval(r.ifFn, feature, ctx)) out = { ...out, ...this._evalStyle(r.style, feature, ctx) };
                else if (r.else) out = { ...out, ...this._evalStyle(r.else, feature, ctx) };
            }
            return out;
        });
        window.dispatchEvent(new CustomEvent('conditional-styling-changed'));
    }

    openModal() {
        if (this.modal) this.closeModal();
        const layers = mapController.getPolygonLayers();
        const opts = layers.map((l) => `<option value="${l.id}">${this._esc(l.name)}</option>`).join('');
        const backdrop = document.createElement('div');
        backdrop.className = 'cs-modal-backdrop';
        backdrop.innerHTML = `<div class="cs-modal"><div class="cs-modal__header"><h2 class="cs-modal__title">Conditional Styling</h2><button class="cs-close" aria-label="Close">&times;</button></div><div class="cs-modal__body"><div class="cs-step"><label class="cs-label">Legacy Gradient Layer</label><select id="csLayerSelect" class="cs-select"><option value="">Choose a layer...</option>${opts}</select></div><div class="cs-step"><label class="cs-label">Attribute</label><select id="csAttrSelect" class="cs-select"></select></div><div class="cs-minmax-row"><label>Min <input type="number" id="csMinVal" class="cs-num-input"></label><label>Max <input type="number" id="csMaxVal" class="cs-num-input"></label></div><div class="cs-color-row"><label>Low <input type="color" id="csLowColor" value="#3182ce"></label><label>High <input type="color" id="csHighColor" value="#e53e3e"></label><label>No Data <input type="color" id="csNoDataColor" value="#cccccc"></label></div></div><div class="cs-modal__footer"><button type="button" id="csClearBtn" class="cs-btn cs-btn--danger">Clear Styling</button><button type="button" id="csApplyBtn" class="cs-btn cs-btn--primary">Apply</button><button type="button" id="csCloseBtn" class="cs-btn">Close</button></div></div>`;
        document.body.appendChild(backdrop);
        this.modal = backdrop;
        const q = (s) => backdrop.querySelector(s);
        q('.cs-close').addEventListener('click', () => this.closeModal());
        q('#csCloseBtn').addEventListener('click', () => this.closeModal());
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.closeModal(); });
        q('#csLayerSelect').addEventListener('change', () => { const id = q('#csLayerSelect').value; const d = id ? mapController.getLayerFeatureProperties(id) : null; q('#csAttrSelect').innerHTML = d ? d.attributes.map((a) => `<option value="${a.name}">${this._esc(a.name)}</option>`).join('') : ''; if (d?.attributes?.length) { q('#csMinVal').value = d.attributes[0].min; q('#csMaxVal').value = d.attributes[0].max; } });
        q('#csApplyBtn').addEventListener('click', () => { const id = q('#csLayerSelect').value; const attr = q('#csAttrSelect').value; if (!id || !attr) return; this.advancedActive = false; this.advancedConfig = null; this.activeLayerId = id; this.activeConfig = { mode: 'gradient', attribute: attr, min: parseFloat(q('#csMinVal').value), max: parseFloat(q('#csMaxVal').value), lowColor: q('#csLowColor').value, highColor: q('#csHighColor').value, noDataColor: q('#csNoDataColor').value }; this.apply(); this.closeModal(); window.dispatchEvent(new CustomEvent('conditional-styling-changed')); });
        q('#csClearBtn').addEventListener('click', () => { this.clear(); this.closeModal(); window.dispatchEvent(new CustomEvent('conditional-styling-changed')); });
    }

    closeModal() { if (this.modal) { this.modal.remove(); this.modal = null; } }

    _validateAdvanced(cfg) {
        const errs = [];
        if (cfg.version !== 'v1') errs.push('version must be v1');
        if (!cfg.targetLayer) errs.push('targetLayer is required');
        if (!Array.isArray(cfg.requiresLayers)) errs.push('requiresLayers must be array');
        if (cfg.where && typeof cfg.where !== 'string') errs.push('where must be string');
        if (!Array.isArray(cfg.rules)) errs.push('rules must be array');
        return { ok: errs.length === 0, errors: errs };
    }

    _canonicalizeAdvanced(cfg) { return { version: 'v1', requiresLayers: Array.isArray(cfg?.requiresLayers) ? [...new Set(cfg.requiresLayers)] : [], targetLayer: cfg?.targetLayer || '', where: cfg?.where || '', style: cfg?.style || {}, rules: Array.isArray(cfg?.rules) ? cfg.rules : [] }; }
    _compileExpr(src) { const s = String(src || '').trim() || 'true'; if (!/^[\w\s\.\(\)\[\]'",:+\-*/%<>=!&|?]+$/.test(s)) throw new Error(`Unsupported characters in expression: ${s}`); return new Function('f', 'ctx', '"use strict"; return (' + s + ');'); }
    _safeEval(fn, f, ctx) { try { return fn(f, ctx); } catch { return null; } }
    _evalStyle(st, f, ctx) { const out = {}; Object.entries(st || {}).forEach(([k, v]) => { if (typeof v === 'string' && v.startsWith('=')) out[k] = this._safeEval(this._compileExpr(v.slice(1)), f, ctx); else out[k] = v; }); return out; }
    _ctx(feature) { const p = feature?.properties || {}; const key = (party, year) => String(party || '').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + year + '_pct'; return { attr: (n) => p[n], has: (n) => Object.prototype.hasOwnProperty.call(p, n), num: (n, d = 0) => Number.isFinite(Number(p[n])) ? Number(p[n]) : d, str: (n, d = '') => p[n] == null ? d : String(p[n]), between: (v, lo, hi) => Number(v) >= Number(lo) && Number(v) <= Number(hi), votePct: (party, y) => p[key(party, y)] ?? null }; }
    _compactify(cfg) { const walk = (v) => Array.isArray(v) ? v.map(walk) : (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [this.compactKeyMap[k] || k, walk(x)])) : v); return walk(cfg); }
    _expandCompact(cfg) { const rev = Object.fromEntries(Object.entries(this.compactKeyMap).map(([k, v]) => [v, k])); const walk = (v) => Array.isArray(v) ? v.map(walk) : (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [rev[k] || k, walk(x)])) : v); return walk(cfg); }
    _encode(obj, compact) { try { const j = JSON.stringify(obj); const bytes = new TextEncoder().encode(j); const packed = window.pako?.deflate ? window.pako.deflate(bytes) : bytes; let b = ''; const a = packed instanceof Uint8Array ? packed : new Uint8Array(packed); for (let i = 0; i < a.length; i++) b += String.fromCharCode(a[i]); return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); } catch { return ''; } }
    _decode(payload, compact) { try { let s = payload.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); const arr = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i); const inflated = window.pako?.inflate ? window.pako.inflate(arr) : arr; const json = new TextDecoder().decode(inflated); const parsed = JSON.parse(json); return this._canonicalizeAdvanced(compact ? this._expandCompact(parsed) : parsed); } catch { return null; } }
    _esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
}

const conditionalStyling = new ConditionalStyling();
export default conditionalStyling;
