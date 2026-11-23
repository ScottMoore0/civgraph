/**
 * Build URLs for assets served from the boundaries-data R2 bucket.
 *
 * Bulk assets live on data.civgraph.net rather than in the Pages deployment,
 * which has a 20,000-file limit the site had already exceeded. The bucket's
 * CORS policy allows https://civgraph.net and not localhost, so on a dev server
 * cross-origin fetches are routed through the /_r/ proxy instead. Image tags do
 * not need this -- <img> is not CORS-restricted -- but fetch() of a manifest is,
 * and keeping both on one code path avoids a class of works-in-prod-only bug.
 *
 * map-controller.js devProxiedSource does the same for PMTiles archives, and the FGB worker for FGB URLs.
 * They predate this module and are left alone deliberately: they sit on the hot path
 * for every tile request and are not worth disturbing for tidiness.
 */

import { SITE } from '../../config/src/config.js';

/** The data origin, from the site's config (packages/config/src/config.js; bundled into the app). */
export const CDN_BASE = SITE.dataOrigin;

/**
 * @param {string} key Bucket key, with or without a leading slash (e.g. 'assets/thumbnails/x.webp').
 * @returns {string} An absolute CDN URL, or a /_r/-proxied path when on localhost.
 */
export function cdnUrl(key) {
    if (typeof key !== 'string' || !key) return '';
    const normalized = key.replace(/^\/+/, '');
    if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
        return `/_r/${normalized}`;
    }
    return `${CDN_BASE}/${normalized}`;
}

export default cdnUrl;
