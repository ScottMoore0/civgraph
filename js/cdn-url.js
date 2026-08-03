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
 * mapController._rewriteForDevProxy does the same rewrite for tile and FGB URLs.
 * It predates this module and is left alone deliberately: it sits on the hot path
 * for every tile request and is not worth disturbing for tidiness.
 */

export const CDN_BASE = 'https://data.civgraph.net';

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
