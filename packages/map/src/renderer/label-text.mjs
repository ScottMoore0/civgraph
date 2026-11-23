/**
 * What a map label says and where it sits: the styling plan's label choices (OT22, approved by
 * Phelim Birch 21 Nov and the owner 23 Nov 2026; plan PLAN.md section 7). Pure: no DOM, no fetch.
 *
 *   - Title case at display time: an all-caps official name ("MALONE UPPER (MAIN PORTION)") is
 *     drawn "Malone Upper (Main Portion)". Only the drawn label changes: the data, the details
 *     pane, search and downloads keep the official form.
 *   - Bilingual labels: the English name first, the Irish name on a second, smaller italic line,
 *     for a layer whose data carries one (assets/i18n/place-name-fields.json). The map shows it
 *     only where Irish place names are shown at all (labels.js irishLabelLinesShown).
 *   - Label points: a layer's label-point file (labelPointsUrl, built by
 *     packages/maps-pipeline/src/tiles/label-points.mjs) gives each area one point inside it, and
 *     its area, so a label sits inside its area and larger areas are placed first.
 */
import { SITE } from '../../../config/src/config.js';

const SMALL_WORDS = new Set(['of', 'and', 'the', 'upon', 'on', 'in', 'with', 'at', 'by', 'to', 'or', 'de', 'le', 'la', 'du']);
const IRISH_ARTICLES = new Set(['an', 'na', 'sa', 'san', 'i', 'ag', 'ar', 'de', 'do', 'faoi', 'go', 'le', 'ó', 'um']);
const ROMAN = /^(?=[IVXLC]+$)C{0,3}(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
// After an article: na nGall, i bPort, ar an mBóthar.
const ECLIPSIS = /^(m(?=b)|g(?=c)|n(?=d)|bh(?=f)|n(?=g)|b(?=p)|d(?=t)|n-(?=[aeiouáéíóú])|t-(?=[aeiouáéíóú]))(.*)$/i;
const KEEP_UPPER = new Set(['NI', 'ROI', 'UK', 'ED', 'DED', 'DEA', 'LEA', 'CB', 'UD', 'RD', 'TC', 'NS', 'NW', 'NE', 'SW', 'SE', 'II', 'III']);
const SEPARATOR = /^(\s+|-|\(|\)|\/|,)$/;
const REPLACEMENT_CHAR = '�';

/** @param {string} s */
const upper = (s) => s.toUpperCase();
/** @param {string} s */
const lower = (s) => s.toLowerCase();

/**
 * One word with its first letter capital, keeping Mc and O' names and St.
 * @param {string} word
 * @returns {string}
 */
function capWord(word) {
  if (!word) return word;
  const low = lower(word);
  let m = /^mc(\p{L})(.*)$/u.exec(low);
  if (m) return `Mc${upper(/** @type {string} */ (m[1]))}${m[2]}`;
  m = /^o(['’])(\p{L})(.*)$/u.exec(low);
  if (m) return `O${m[1]}${upper(/** @type {string} */ (m[2]))}${m[3]}`;
  if (/^st\.?$/.test(low)) return word.endsWith('.') ? 'St.' : 'St';
  return upper(low.charAt(0)) + low.slice(1);
}

/**
 * An all-caps name in title case, for display: "GRANGE OF SHILVODAN" -> "Grange of Shilvodan",
 * "BELFAST CB" -> "Belfast CB", "DROMORE III" -> "Dromore III", "BAILE NA NGALL" ->
 * "Baile na nGall". A value with any lower-case letter (or none at all) is returned as it is.
 * @param {unknown} value
 * @returns {string}
 */
export function titleCaseCaps(value) {
  const text = String(value ?? '');
  if (!text || text !== upper(text) || text === lower(text)) return text;
  const tokens = text.split(/(\s+|-|\(|\)|\/|,)/);
  let wordIndex = 0;
  let prev = '';
  return tokens.map((tok) => {
    if (!tok || SEPARATOR.test(tok)) return tok;
    const first = wordIndex === 0;
    wordIndex += 1;
    const bare = tok.replace(/\.$/, '');
    const low = lower(tok);
    let out;
    if (/\d/.test(tok)) out = tok.replace(/\p{L}+/gu, (s) => (/^NO$/i.test(s) ? 'No' : (s.length === 1 ? s : capWord(s))));
    else if (!first && ROMAN.test(bare) && bare.length <= 4) out = tok;
    else if (!first && KEEP_UPPER.has(bare)) out = tok;
    else if (!first && (SMALL_WORDS.has(low) || IRISH_ARTICLES.has(low))) out = low;
    else if (!first && IRISH_ARTICLES.has(prev) && ECLIPSIS.test(low)) {
      const e = /** @type {RegExpExecArray} */ (ECLIPSIS.exec(low));
      const rest = /** @type {string} */ (e[2]);
      out = e[1] + upper(rest.charAt(0)) + rest.slice(1);
    } else if (!first && IRISH_ARTICLES.has(prev) && /^h[aeiouáéíóú]/.test(low)) out = `h${upper(low.charAt(1))}${low.slice(2)}`;
    else if (!first && prev === 'an' && /^t(s|[aeiouáéíóú])/.test(low) && low.length > 3) out = `t${upper(low.charAt(1))}${low.slice(2)}`;
    else out = capWord(tok);
    prev = low;
    return out;
  }).join('');
}

/** @typedef {{ primary: string, secondary: string }} LabelLines */

/**
 * The two lines of a label: the English name, title-cased, and under it the Irish name when the
 * layer has one that says something else. A name the source spoiled (U+FFFD where a fada was
 * lost) is left off rather than drawn broken; with no English name the Irish one is the label.
 * @param {string} english  the cleaned value of the layer's label field
 * @param {string} irish    the cleaned value of its Irish-name field ('' when none)
 * @returns {LabelLines}
 */
export function bilingualLines(english, irish) {
  const primary = titleCaseCaps(String(english || '').trim());
  let secondary = titleCaseCaps(String(irish || '').trim().normalize('NFC'));
  if (secondary.includes(REPLACEMENT_CHAR)) secondary = '';
  if (!primary) return { primary: secondary, secondary: '' };
  if (secondary && lower(secondary) === lower(primary)) secondary = '';
  return { primary, secondary };
}

/** One area's label point. @typedef {{ lngLat: [number, number], area: number }} LabelPoint */

/**
 * A label-point file (a GeoJSON FeatureCollection of points with `id` and `area_m2`) as
 * feature id -> point. Features without an id or finite coordinates are skipped.
 * @param {{ features?: Array<{ properties?: Record<string, unknown> | null, geometry?: { coordinates?: unknown } | null }> } | null | undefined} doc
 * @returns {Map<string, LabelPoint>}
 */
export function indexLabelPoints(doc) {
  /** @type {Map<string, LabelPoint>} */
  const out = new Map();
  for (const f of doc?.features || []) {
    const id = f?.properties?.['id'];
    const c = f?.geometry?.coordinates;
    if (id === undefined || id === null || !Array.isArray(c)) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    out.set(String(id), { lngLat: [lng, lat], area: Number(f?.properties?.['area_m2']) || 0 });
  }
  return out;
}

const DATA_ORIGIN = `${SITE.dataOrigin}/`;

/**
 * The address to fetch a layer's label-point file from ('' when it has none): its labelPointsUrl,
 * through the dev server's /_r/ proxy on localhost, because the bucket's CORS rules do not admit
 * localhost (as approximate-segments.js does for its files).
 * @param {{ labelPointsUrl?: unknown } | null | undefined} layer
 * @param {Pick<Location, 'hostname' | 'origin'> | null} [loc]
 * @returns {string}
 */
export function resolveLabelPointsUrl(layer, loc = (typeof location !== 'undefined' ? location : null)) {
  const url = layer?.labelPointsUrl;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return '';
  if (loc?.hostname === 'localhost' && url.startsWith(DATA_ORIGIN)) return `${loc.origin}/_r/${url.slice(DATA_ORIGIN.length)}`;
  return url;
}

/**
 * The collision box of a label of one or two lines, in screen pixels around its centre.
 * @param {{ x: number, y: number }} point
 * @param {unknown} label
 * @param {string} [secondary]  the second (Irish) line, drawn smaller
 * @returns {{ left: number, right: number, top: number, bottom: number }}
 */
export function labelCollisionBox(point, label, secondary = '') {
  const text = String(label);
  const longest = Math.max(text.length, secondary.length * 0.9);
  const width = Math.min(Math.max(longest * 7.5, 34), 150);
  const height = Math.max(16, Math.ceil(text.length / 18) * 15) + (secondary ? Math.ceil(secondary.length / 20) * 13 : 0);
  const padding = 4;
  return {
    left: point.x - width / 2 - padding,
    right: point.x + width / 2 + padding,
    top: point.y - height / 2 - padding,
    bottom: point.y + height / 2 + padding
  };
}
