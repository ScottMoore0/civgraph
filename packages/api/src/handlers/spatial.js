/**
 * Edge spatial query — returns features for a given mapId within a bounding box.
 *
 * Usage: GET /_api/spatial?mapId=lgd-2012&bbox=minLng,minLat,maxLng,maxLat
 *        GET /_api/spatial?mapIds=lgd-2012,pc-2023[&bbox=...]  (several maps: { maps: { id: features } })
 *
 * Falls back to reading static chunk files from the origin when KV is not configured.
 */
import { blobStore } from '../../../storage/src/blob-bindings.js';

/** Most maps one batch request may name (the map search asks for up to 30). */
export const MAX_BATCH_MAPS = 40;
const MAP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * One map's spatial chunk: its features with their bboxes, from KV, else the static chunk file.
 * Null when there is none (the single-map answer then says `features: []`).
 * @param {import('../types.js').ApiContext} context
 * @param {URL} url
 * @param {string} mapId
 * @returns {Promise<Array<{ bbox?: number[], [key: string]: unknown }> | null>}
 */
async function readMapFeatures(context, url, mapId) {
    const kv = blobStore(context.env, 'SPATIAL_INDEX');
    // Try KV first (faster, no origin fetch), through the blob store (packages/storage/src/blob.js)
    if (kv) {
        const data = await kv.json(`map:${mapId}`);
        return /** @type {Array<{ bbox?: number[], [key: string]: unknown }> | null} */ (data) || [];
    }
    // Fallback: fetch the static chunk file from the origin
    try {
        const chunkUrl = new URL(`/data/database/spatial-index/${mapId}.json`, url.origin);
        const resp = await fetch(chunkUrl.toString());
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return [];
    }
}

/**
 * The features whose bbox meets the bounding box, with a 20% buffer; all of them when there is
 * no usable bbox parameter.
 * @param {Array<{ bbox?: number[] }>} features
 * @param {string | null} bboxParam
 */
export function filterByBbox(features, bboxParam) {
    if (!bboxParam || features.length === 0) return features;
    const parts = bboxParam.split(',').map(Number);
    if (parts.length !== 4 || !parts.every(Number.isFinite)) return features;
    // four finite numbers (checked above), so the defaults never apply
    const [minLng = 0, minLat = 0, maxLng = 0, maxLat = 0] = parts;
    // 20% buffer
    const latBuf = (maxLat - minLat) * 0.2;
    const lngBuf = (maxLng - minLng) * 0.2;
    const bMinLng = minLng - lngBuf;
    const bMinLat = minLat - latBuf;
    const bMaxLng = maxLng + lngBuf;
    const bMaxLat = maxLat + latBuf;
    return features.filter(f => {
        if (!f.bbox || f.bbox.length < 4) return false;
        const [fMinLng = 0, fMinLat = 0, fMaxLng = 0, fMaxLat = 0] = f.bbox; // four or more (checked above)
        return !(fMaxLng < bMinLng || fMinLng > bMaxLng || fMaxLat < bMinLat || fMinLat > bMaxLat);
    });
}

/**
 * The map ids of a batch request: `mapIds=a,b,c`, trimmed, de-duplicated, in the order given.
 * Null when one is malformed or there are more than MAX_BATCH_MAPS.
 * @param {string} value
 * @returns {string[] | null}
 */
export function parseMapIds(value) {
    const ids = [...new Set(String(value).split(',').map((id) => id.trim()).filter(Boolean))];
    if (!ids.length || ids.length > MAX_BATCH_MAPS || !ids.every((id) => MAP_ID.test(id))) return null;
    return ids;
}

/** @param {import('../types.js').ApiContext} context */
export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const mapId = url.searchParams.get('mapId');
    const mapIdsParam = url.searchParams.get('mapIds');
    const bboxParam = url.searchParams.get('bbox');

    // Several maps in one request: the map search used to ask once per candidate map, about 30
    // requests (and 30 Function invocations) per search (QA 2026-11-11, M9). The answer holds,
    // per map id, exactly what `?mapId=<id>` answers as `features`.
    if (mapIdsParam !== null && !mapId) {
        const ids = parseMapIds(mapIdsParam);
        if (!ids) {
            return new Response(JSON.stringify({ error: `mapIds must list 1 to ${MAX_BATCH_MAPS} map ids, comma-separated` }), {
                status: 400,
                headers: JSON_HEADERS
            });
        }
        const lists = await Promise.all(ids.map((id) => readMapFeatures(context, url, id)));
        /** @type {Record<string, unknown[]>} */
        const maps = {};
        ids.forEach((id, index) => { maps[id] = filterByBbox(lists[index] || [], bboxParam); });
        return new Response(JSON.stringify({ maps }), {
            headers: { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' }
        });
    }

    if (!mapId) {
        return new Response(JSON.stringify({ error: 'mapId required' }), {
            status: 400,
            headers: JSON_HEADERS
        });
    }

    const read = await readMapFeatures(context, url, mapId);
    if (read === null) {
        return new Response(JSON.stringify({ features: [] }), {
            headers: { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=60' }
        });
    }
    const features = filterByBbox(read, bboxParam);

    return new Response(JSON.stringify({ features }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
