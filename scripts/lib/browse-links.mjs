/**
 * The download and file links of a Browse record, from the shapes the catalogue writes them in
 * (scripts/build/build-browse-indexes.mjs): a URL string, { label, url | href }, { label, file },
 * an object of label -> URL ({ fgb: "https://..." }), or arrays of those.
 *
 * { label, file } is the catalogue's sourceDownloads shape (155 maps). It used to be read as an
 * object of label -> URL, so a map's Downloads panel listed rows "label | ESRI Shapefile (ZIP)"
 * and "bytes | 91098" whose links led to /browse/maps/ESRI%20Shapefile%20(ZIP) (site QA 12 Nov).
 *
 * @typedef {{ label: string, url: string, type?: string }} BrowseLink
 */

/** @param {unknown} value */
const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * The last path segment of a URL, without its query: the label of a bare link.
 * @param {unknown} value
 * @returns {string}
 */
export function fileLabel(value) {
  const text = cleanText(value);
  if (!text) return 'Source';
  const last = text.split(/[\\/]/).pop() || text;
  return last.split('?')[0] || text;
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function asArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== '');
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

/**
 * A { label, file } download, and its mirror when it has one; null for any other object.
 * @param {Record<string, unknown>} link
 * @returns {BrowseLink[] | null}
 */
function labelledFile(link) {
  if (typeof link.file !== 'string' || !link.file) return null;
  const label = cleanText(link.label || link.title || link.name) || fileLabel(link.file);
  /** @type {BrowseLink[]} */
  const out = [{ label, url: link.file }];
  if (typeof link.mirror === 'string' && link.mirror) out.push({ label: `${label} (mirror)`, url: link.mirror });
  return out;
}

/**
 * Files written as a URL, an object of label -> URL, or arrays of those.
 * @param {unknown} value
 * @returns {BrowseLink[]}
 */
export function normalizeFiles(value) {
  if (!value) return [];
  if (typeof value === 'string') return [{ label: fileLabel(value), url: value }];
  if (Array.isArray(value)) return value.flatMap(normalizeFiles);
  if (typeof value === 'object') {
    const labelled = labelledFile(/** @type {Record<string, unknown>} */ (value));
    if (labelled) return labelled;
    return Object.entries(value).flatMap(([label, url]) => {
      if (!url) return [];
      if (typeof url === 'string') return [{ label, url }];
      if (Array.isArray(url)) return url.map((item) => ({ label, url: String(item) }));
      return normalizeFiles(url).map((item) => ({ ...item, label: item.label || label }));
    });
  }
  return [];
}

/**
 * Links written in any of the shapes above.
 * @param {unknown} value
 * @returns {BrowseLink[]}
 */
export function normalizeLinks(value) {
  return asArray(value).flatMap(/** @returns {BrowseLink[]} */ (link) => {
    if (!link) return [];
    if (typeof link === 'string') return [{ label: fileLabel(link), url: link }];
    if (Array.isArray(link)) return link.flatMap(normalizeLinks);
    if (typeof link === 'object') {
      const record = /** @type {Record<string, unknown>} */ (link);
      const url = record.url || record.href;
      if (typeof url === 'string' && url) {
        /** @type {BrowseLink} */
        const out = { label: cleanText(record.label || record.title || record.name || fileLabel(url)), url };
        if (typeof record.type === 'string' && record.type) out.type = record.type;
        return [out];
      }
      return normalizeFiles(record);
    }
    return [];
  }).filter((link) => link.url || link.label);
}
