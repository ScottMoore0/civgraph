/**
 * Data-entry loader (MVP): loads the geography map, fetches a small CSV,
 * recolours each feature on the rendered Leaflet layer by joining the
 * CSV value, and shows a small panel listing the rows.
 *
 * Schema (entries in db.dataEntries[]):
 *   { id, name, type:'data-entry', category, geography, csv, joinKey,
 *     valueColumn, ramp, domain, logarithmic?, tableColumns?, source? }
 */
import { rampSample } from './colour-palettes.js';

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

function ensurePanel() {
    let panel = document.getElementById('dataEntryPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'dataEntryPanel';
        panel.className = 'data-entry-panel';
        panel.style.cssText = `
            position: fixed; right: 12px; bottom: 12px; max-height: 50vh;
            width: 360px; background: var(--surface-primary, #fff); color: var(--text-primary, #111);
            border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 4px 18px rgba(0,0,0,0.18);
            z-index: 5000; padding: 10px 12px; font-size: 13px; overflow: hidden; display: flex;
            flex-direction: column;`;
        document.body.appendChild(panel);
    }
    return panel;
}

function renderPanel(entry, csvRows) {
    const panel = ensurePanel();
    const cols = entry.tableColumns && entry.tableColumns.length
        ? entry.tableColumns
        : Object.keys(csvRows[0] || {});
    const sourceLink = entry.source?.url
        ? `<a href="${entry.source.url}" target="_blank" rel="noopener">${entry.source.title || 'Source'}</a>`
        : (entry.source?.title || '');
    panel.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <strong style="font-size:14px;line-height:1.3">${entry.name}</strong>
          <button id="dataEntryPanelClose" aria-label="Close" style="background:transparent;border:0;font-size:18px;cursor:pointer;line-height:1;padding:0 4px">×</button>
        </div>
        ${sourceLink ? `<div style="font-size:11px;color:#666;margin-bottom:6px">${sourceLink}</div>` : ''}
        <div style="overflow:auto;flex:1;min-height:0">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr>${cols.map(c => `<th style="text-align:left;border-bottom:1px solid #ccc;padding:4px 6px;background:#f5f5f5;position:sticky;top:0">${c}</th>`).join('')}</tr></thead>
            <tbody>
              ${csvRows.map((row, i) => `<tr data-row-idx="${i}" style="cursor:default">
                ${cols.map(c => `<td style="padding:4px 6px;border-bottom:1px solid #eee">${typeof row[c] === 'number' || /^-?\d/.test(String(row[c])) ? Number(row[c]).toLocaleString() : (row[c] ?? '')}</td>`).join('')}
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    panel.querySelector('#dataEntryPanelClose').addEventListener('click', () => panel.remove());
    return panel;
}

/**
 * Load and apply a data entry. Returns once the geography layer has been
 * loaded and recoloured. Callers should provide:
 *   onMapLoad(mapId)    — load the geography map into mapController
 *   mapController        — to walk the rendered Leaflet layer
 *   baseUrl              — prefix for csv path (usually '')
 */
export async function loadDataEntry(entry, { onMapLoad, mapController, baseUrl = '' }) {
    if (!entry || entry.type !== 'data-entry') throw new Error('not a data entry');

    // 1. Ensure the geography is loaded
    await onMapLoad(entry.geography);

    // 2. Fetch CSV
    const text = await fetch(baseUrl + entry.csv, { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error(`csv ${r.status}`);
        return r.text();
    });
    const { rows } = parseCsv(text);
    const byKey = new Map(rows.map(r => [String(r[entry.joinKey]), r]));

    // 3. Walk Leaflet layer, restyle each feature
    const state = mapController.layerStates.get(entry.geography);
    const group = state?.group || state?.geoJsonLayers?.[0];
    if (group && typeof group.eachLayer === 'function') {
        group.eachLayer(layerOrChild => {
            const recolour = (sub) => {
                if (!sub || !sub.feature) return;
                const props = sub.feature.properties || {};
                const k = String(props[entry.joinKey] || '');
                const matched = byKey.get(k);
                if (!matched) return;
                const v = matched[entry.valueColumn];
                const colour = valueToColor(v, entry);
                if (typeof sub.setStyle === 'function') {
                    sub.setStyle({ fillColor: colour, color: '#3a3a3a', weight: 0.6, fillOpacity: 0.78, opacity: 1 });
                }
                sub._dataEntryValue = v;
                if (typeof sub.bindTooltip === 'function') {
                    const label = props[mapController.layerStates.get(entry.geography)?.config?.labelProperty || 'name'] || k;
                    const fmtV = isNaN(parseFloat(v)) ? v : Number(v).toLocaleString();
                    sub.bindTooltip(`<strong>${label}</strong><br>${entry.valueColumn}: ${fmtV}`, { sticky: true });
                }
            };
            if (typeof layerOrChild.eachLayer === 'function') layerOrChild.eachLayer(recolour);
            else recolour(layerOrChild);
        });
    }

    // 4. Show the panel with the table
    renderPanel(entry, rows);

    return { entry, rowCount: rows.length };
}

export function getDataEntries(dataService) {
    const data = dataService.getData?.() || dataService.maps;
    return Array.isArray(data?.dataEntries) ? data.dataEntries : [];
}
