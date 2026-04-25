/**
 * Data-entry loader: loads the geography map, fetches a small CSV, recolours
 * each feature on the rendered Leaflet layer by joining the CSV value, and
 * surfaces the table in a shared bottom results pane (the same pane that
 * the election controller uses, with a separate DOM id for parallel
 * rendering when both are loaded at once).
 *
 * Schema (entries in db.dataEntries[]):
 *   { id, name, type:'data-entry', category, geography, csv, joinKey,
 *     valueColumn, ramp, domain, logarithmic?, tableColumns?, source? }
 */
import { rampSample } from './colour-palettes.js';

// In-memory registry of currently loaded data entries — supports the active-
// layers UI (so each loaded entry surfaces as a removable layer) and the
// chunked-geography re-recolour pass (newly arriving chunks need the same
// colour applied).
const _loaded = new Map();   // entryId -> { entry, rows, byKey, mapController, layerAddHandler, points: [] }

export function getLoadedDataEntries() {
    return Array.from(_loaded.values()).map(e => e.entry);
}

export function isDataEntryLoaded(id) {
    return _loaded.has(id);
}

// Geographies whose individual features are too small to be visible at a
// glance when the map is zoomed out — show a coloured circle marker at each
// centroid in addition to the polygon.
const POINT_AT_LOW_ZOOM_GEOG = new Set([
    'settlements-2015', 'settlements-2005', 'settlements-2001',
]);

function parseCsv(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const cells = []; let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQ) {
                if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
                else if (c === '"') inQ = false;
                else cur += c;
            } else {
                if (c === '"') inQ = true;
                else if (c === ',') { cells.push(cur); cur = ''; }
                else cur += c;
            }
        }
        cells.push(cur);
        rows.push(cells);
    }
    if (!rows.length) return { header: [], rows: [] };
    const header = rows[0];
    const objs = rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
    return { header, rows: objs };
}

function valueToColor(v, entry) {
    const num = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(num)) return '#999999';
    const [lo, hi] = entry.domain || [0, 1];
    let t;
    if (entry.logarithmic) {
        const safeV = Math.max(num, 1e-9), safeLo = Math.max(lo, 1e-9), safeHi = Math.max(hi, 1e-9);
        t = (Math.log(safeV) - Math.log(safeLo)) / (Math.log(safeHi) - Math.log(safeLo));
    } else {
        t = (num - lo) / (hi - lo);
    }
    return rampSample(entry.ramp || 'viridis', Math.max(0, Math.min(1, t)));
}

function formatCell(col, raw) {
    if (raw === null || raw === undefined || raw === '') return '';
    const num = parseFloat(raw);
    if (!isFinite(num) || !/^-?\d/.test(String(raw))) return String(raw);
    const isPct = /(_pct$|percent|%)/i.test(col);
    const isFloat = isPct || /density|average|ratio|median|index|rate/i.test(col) || (Math.abs(num) < 100 && !Number.isInteger(num));
    return num.toLocaleString(undefined, isFloat
        ? { minimumFractionDigits: isPct ? 1 : 0, maximumFractionDigits: 2 }
        : { maximumFractionDigits: 0 });
}

// ─── Results pane ─────────────────────────────────────────────────────────
// Use the same DOM structure / CSS class as the election results pane so
// the styling is consistent. Distinct id (#dataResultsPane) so the two can
// coexist without trampling each other when both an election and a data
// entry are loaded simultaneously.

function ensureDataResultsPane() {
    let pane = document.getElementById('dataResultsPane');
    if (pane) return pane;
    pane = document.createElement('div');
    pane.id = 'dataResultsPane';
    pane.className = 'election-results-pane data-results-pane';
    const appMain = document.querySelector('.app-main');
    if (appMain && appMain.nextSibling) {
        appMain.parentElement.insertBefore(pane, appMain.nextSibling);
    } else if (appMain) {
        appMain.parentElement.appendChild(pane);
    } else {
        document.body.appendChild(pane);
    }
    return pane;
}

function renderResultsPane() {
    const entries = getLoadedDataEntries();
    const pane = ensureDataResultsPane();
    if (entries.length === 0) {
        pane.classList.remove('election-results-pane--open');
        pane.innerHTML = '';
        return;
    }
    pane.classList.add('election-results-pane--open');
    // Render a tab strip if more than one entry, plus the active table.
    const activeId = pane.dataset.activeEntryId && _loaded.has(pane.dataset.activeEntryId)
        ? pane.dataset.activeEntryId
        : entries[entries.length - 1].id;
    pane.dataset.activeEntryId = activeId;
    const active = _loaded.get(activeId);

    const tabs = entries.length > 1 ? `
        <div class="data-results-tabs" style="display:flex;gap:2px;padding:4px 8px 0;border-bottom:1px solid var(--color-border, #e2e8f0);overflow:auto">
          ${entries.map(e => `
            <button type="button"
              class="data-results-tab ${e.id === activeId ? 'data-results-tab--active' : ''}"
              data-data-entry-id="${e.id}"
              style="border:0;background:${e.id === activeId ? 'var(--color-surface, #fff)' : 'transparent'};
                     border-top:2px solid ${e.id === activeId ? 'var(--color-accent, #38a169)' : 'transparent'};
                     padding:6px 10px;font-size:12px;cursor:pointer;color:var(--color-text)">
              ${escapeHtml(e.name)}
            </button>`).join('')}
        </div>` : '';

    const cols = active.entry.tableColumns?.length
        ? active.entry.tableColumns
        : Object.keys(active.rows[0] || {});
    const sourceLink = active.entry.source?.url
        ? `<a href="${active.entry.source.url}" target="_blank" rel="noopener">${escapeHtml(active.entry.source.title || 'Source')}</a>`
        : escapeHtml(active.entry.source?.title || '');
    pane.innerHTML = `
        <div class="election-pane__header">
            <h3 class="election-pane__title">${escapeHtml(active.entry.name)}</h3>
            <div class="election-pane__header-right">
                <button type="button" class="election-pane__close" data-data-entry-close="${active.entry.id}" title="Close">&#x2715;</button>
            </div>
        </div>
        ${tabs}
        ${sourceLink ? `<div style="font-size:11px;color:var(--color-text-muted,#666);padding:6px 12px 0">${sourceLink}</div>` : ''}
        <div class="election-pane__content" style="overflow:auto;flex:1;min-height:0;padding:8px 12px 12px">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr>${cols.map(c => `<th style="text-align:left;border-bottom:1px solid var(--color-border,#ccc);padding:4px 6px;background:var(--color-surface-elevated,#f5f5f5);position:sticky;top:0">${escapeHtml(c)}</th>`).join('')}</tr></thead>
            <tbody>
              ${active.rows.map((row, i) => `<tr data-row-idx="${i}">
                ${cols.map(c => `<td style="padding:4px 6px;border-bottom:1px solid var(--color-border-light,#eee)">${escapeHtml(formatCell(c, row[c]))}</td>`).join('')}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

    pane.querySelectorAll('.data-results-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            pane.dataset.activeEntryId = btn.dataset.dataEntryId;
            renderResultsPane();
        });
    });
    pane.querySelector('[data-data-entry-close]')?.addEventListener('click', (ev) => {
        const id = ev.currentTarget.dataset.dataEntryClose;
        unloadDataEntry(id);
    });
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// ─── Recolouring ──────────────────────────────────────────────────────────

function styleForEntry(entry, value) {
    return {
        fillColor: valueToColor(value, entry),
        color: '#3a3a3a',
        weight: 0.6,
        fillOpacity: 0.78,
        opacity: 1,
    };
}

function recolourFeature(sub, entry, byKey, mapController, pointGroup) {
    if (!sub || !sub.feature) return;
    const props = sub.feature.properties || {};
    const k = String(props[entry.joinKey] || '');
    const matched = byKey.get(k);
    if (!matched) return;
    const v = matched[entry.valueColumn];
    const colour = valueToColor(v, entry);
    if (typeof sub.setStyle === 'function') {
        sub.setStyle(styleForEntry(entry, v));
    }
    sub._dataEntryValue = v;
    sub._dataEntryId = entry.id;
    if (typeof sub.bindTooltip === 'function') {
        const labelKey = mapController.layerStates.get(entry.geography)?.config?.labelProperty || 'name';
        const label = props[labelKey] || k;
        const tipCols = (entry.tableColumns?.length ? entry.tableColumns : [entry.valueColumn])
            .filter(c => c !== 'Geography' && c !== 'GeographyCode');
        const tipLines = [`<strong>${escapeHtml(label)}</strong>`];
        for (const c of tipCols) {
            const cv = matched[c];
            if (cv === undefined || cv === null || cv === '') continue;
            tipLines.push(`${escapeHtml(c)}: ${escapeHtml(formatCell(c, cv))}`);
        }
        sub.bindTooltip(tipLines.join('<br>'), { sticky: true });
    }
    // For point-at-low-zoom geographies, also drop a circleMarker at the
    // polygon's bounding-box centre so the area is visible when zoomed out.
    if (pointGroup && typeof sub.getBounds === 'function') {
        try {
            const c = sub.getBounds().getCenter();
            const m = window.L.circleMarker([c.lat, c.lng], {
                radius: 4,
                color: '#222',
                weight: 1,
                fillColor: colour,
                fillOpacity: 0.95,
                pane: 'markerPane',
            });
            m._dataEntryId = entry.id;
            m.bindTooltip(sub.getTooltip()?._content || String(label), { sticky: true });
            pointGroup.addLayer(m);
        } catch (_) { /* ignore — feature without geometry */ }
    }
}

function recolourGroup(group, entry, byKey, mapController, pointGroup) {
    if (!group || typeof group.eachLayer !== 'function') return;
    group.eachLayer(layerOrChild => {
        if (typeof layerOrChild.eachLayer === 'function') {
            layerOrChild.eachLayer(sub => recolourFeature(sub, entry, byKey, mapController, pointGroup));
        } else {
            recolourFeature(layerOrChild, entry, byKey, mapController, pointGroup);
        }
    });
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function loadDataEntry(entry, { onMapLoad, mapController, baseUrl = '' }) {
    if (!entry || entry.type !== 'data-entry') throw new Error('not a data entry');

    // Skip if already loaded (idempotent)
    if (_loaded.has(entry.id)) {
        const pane = document.getElementById('dataResultsPane');
        if (pane) { pane.dataset.activeEntryId = entry.id; renderResultsPane(); }
        return { entry, rowCount: _loaded.get(entry.id).rows.length, alreadyLoaded: true };
    }

    // 1. Ensure the geography is loaded
    await onMapLoad(entry.geography);

    // 2. Fetch CSV
    const text = await fetch(baseUrl + entry.csv, { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error(`csv ${r.status}`);
        return r.text();
    });
    const { rows } = parseCsv(text);
    const csvKey = entry.csvKeyColumn || entry.joinKey;
    const byKey = new Map(rows.map(r => [String(r[csvKey]), r]));

    // 3. Recolour the geography's features. For point-at-low-zoom
    // geographies, also build a parallel L.featureGroup of centroid markers.
    const state = mapController.layerStates.get(entry.geography);
    const group = state?.group || state?.geoJsonLayers?.[0];
    let pointGroup = null;
    if (POINT_AT_LOW_ZOOM_GEOG.has(entry.geography) && window.L) {
        pointGroup = window.L.featureGroup();
        pointGroup._dataEntryId = entry.id;
        if (mapController.map) pointGroup.addTo(mapController.map);
    }
    recolourGroup(group, entry, byKey, mapController, pointGroup);

    // 4. Re-recolour any features added later (chunked geographies bring in
    // new sub-layers as the user zooms / pans). Listen on every level of the
    // group so chunks added to nested feature-groups are also caught.
    const layerAddHandler = (e) => {
        const added = e?.layer;
        if (!added) return;
        if (typeof added.eachLayer === 'function') {
            added.eachLayer(sub => recolourFeature(sub, entry, byKey, mapController, pointGroup));
        } else {
            recolourFeature(added, entry, byKey, mapController, pointGroup);
        }
    };
    if (group && typeof group.on === 'function') {
        group.on('layeradd', layerAddHandler);
        // Also bind on existing nested feature groups
        if (typeof group.eachLayer === 'function') {
            group.eachLayer(child => {
                if (child && typeof child.on === 'function') child.on('layeradd', layerAddHandler);
            });
        }
    }

    _loaded.set(entry.id, {
        entry,
        rows,
        byKey,
        mapController,
        layerAddHandler,
        pointGroup,
    });

    // 5. Render the table into the shared results pane
    const pane = ensureDataResultsPane();
    pane.dataset.activeEntryId = entry.id;
    renderResultsPane();

    // 6. Notify the host so it can refresh the active-layers card
    document.dispatchEvent(new CustomEvent('data-entry:loaded', { detail: { entryId: entry.id } }));

    return { entry, rowCount: rows.length };
}

export function unloadDataEntry(entryId) {
    const ctx = _loaded.get(entryId);
    if (!ctx) return;
    const { entry, mapController, layerAddHandler, pointGroup } = ctx;

    // Detach the layeradd listener so subsequent chunk loads don't try to
    // recolour for this (now-gone) entry.
    const state = mapController.layerStates?.get(entry.geography);
    const group = state?.group || state?.geoJsonLayers?.[0];
    if (group && typeof group.off === 'function') {
        group.off('layeradd', layerAddHandler);
        if (typeof group.eachLayer === 'function') {
            group.eachLayer(child => {
                if (child && typeof child.off === 'function') child.off('layeradd', layerAddHandler);
            });
        }
    }

    // Reset the polygon styles to the geography map's default style.
    const baseStyle = state?.config?.style || { color: '#3388ff', weight: 2, fillOpacity: 0 };
    const resetFeature = (sub) => {
        if (!sub || sub._dataEntryId !== entry.id) return;
        if (typeof sub.setStyle === 'function') sub.setStyle(baseStyle);
        if (typeof sub.unbindTooltip === 'function') sub.unbindTooltip();
        delete sub._dataEntryValue;
        delete sub._dataEntryId;
    };
    if (group && typeof group.eachLayer === 'function') {
        group.eachLayer(layerOrChild => {
            if (typeof layerOrChild.eachLayer === 'function') layerOrChild.eachLayer(resetFeature);
            else resetFeature(layerOrChild);
        });
    }

    // Drop the centroid markers, if any.
    if (pointGroup && mapController.map) mapController.map.removeLayer(pointGroup);

    _loaded.delete(entryId);

    // Re-render the pane (or hide it if nothing's left)
    const pane = document.getElementById('dataResultsPane');
    if (pane && pane.dataset.activeEntryId === entryId) {
        delete pane.dataset.activeEntryId;
    }
    renderResultsPane();

    document.dispatchEvent(new CustomEvent('data-entry:unloaded', { detail: { entryId } }));
}

/** Re-apply colours for every data entry that targets this geography.
 *  Called by the host after a viewport-driven layer reload (chunked or
 *  LOD-switched) so that the new sub-layer tree gets the joined values
 *  applied. Also re-attaches the layeradd handler to the (possibly new)
 *  group so future per-chunk additions stay coloured.
 */
export function recolourGeographyEntries(geographyId, mapController) {
    for (const ctx of _loaded.values()) {
        if (ctx.entry.geography !== geographyId) continue;
        const state = mapController.layerStates?.get(geographyId);
        const group = state?.group || state?.geoJsonLayers?.[0];
        if (!group) continue;
        // Reattach layeradd in case the group was reconstructed.
        if (typeof group.off === 'function') group.off('layeradd', ctx.layerAddHandler);
        if (typeof group.on === 'function')  group.on('layeradd', ctx.layerAddHandler);
        if (typeof group.eachLayer === 'function') {
            group.eachLayer(child => {
                if (child && typeof child.off === 'function') {
                    child.off('layeradd', ctx.layerAddHandler);
                    child.on('layeradd', ctx.layerAddHandler);
                }
            });
        }
        recolourGroup(group, ctx.entry, ctx.byKey, mapController, ctx.pointGroup);
    }
}

export function getDataEntries(dataService) {
    const data = dataService.getData?.() || dataService.maps;
    return Array.isArray(data?.dataEntries) ? data.dataEntries : [];
}
