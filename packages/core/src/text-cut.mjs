/**
 * Shortening a note for a place that has room for only so much of it (the catalogue pane's map
 * note: scripts/build/catalogue/build-catalogue.mjs). A note that fits is kept whole. A longer one
 * ends at the last sentence that fits, so it never stops mid-sentence; only when no sentence ends
 * in the second half of the room is it cut after a clause ("; ") or a word, with an ellipsis. Pure.
 */

/** Words that end in a full stop without ending a sentence ("Co. Londonderry", "St. Mary's", "No. 3"). */
const ABBREVIATIONS = new Set([
  'co', 'cos', 'st', 'sts', 'mt', 'no', 'nos', 'vol', 'vols', 'pt', 'pts', 'ed', 'eds', 'p', 'pp', 'c', 'ca', 'cf', 'vs',
  'rev', 'revd', 'dr', 'mr', 'mrs', 'ms', 'messrs', 'hon', 'rt', 'gen', 'col', 'capt', 'lt', 'sgt', 'jr', 'sr',
  'bros', 'ltd', 'inc', 'approx', 'fig', 'figs', 'sq', 'e.g', 'i.e', 'viz', 'al', 'etc',
]);

/**
 * Whether the full stop (or ! or ?) at `i` ends a sentence: it is followed by a space and a capital
 * (or an opening quote or bracket), or by the end, and the word before it is not an abbreviation or
 * a single initial.
 * @param {string} text
 * @param {number} i  index of the stop
 * @returns {number}  the index just after the sentence (closing quotes and brackets included), or -1
 */
function sentenceEndAt(text, i) {
  let j = i + 1;
  while (j < text.length && /["'”’)\]]/.test(text[j] ?? '')) j += 1;
  if (j < text.length && !/\s/.test(text[j] ?? '')) return -1;
  let k = j;
  while (k < text.length && /\s/.test(text[k] ?? '')) k += 1;
  if (k < text.length && !/[\p{Lu}"'“‘(\[]/u.test(text[k] ?? '')) return -1;
  if (text[i] === '.') {
    const word = (/([\p{L}.]+)$/u.exec(text.slice(0, i))?.[1] ?? '').toLowerCase();
    if (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word)) return -1;
  }
  return j;
}

/**
 * The note, whole if it has `limit` characters or fewer; otherwise up to the end of the last
 * sentence that fits, or, when that would keep less than half the room, cut after a clause or a
 * word with "…".
 * @param {unknown} text
 * @param {number} limit  the most characters kept (an ellipsis included)
 * @returns {string}
 */
export function cutNote(text, limit) {
  const value = String(text ?? '').trim();
  if (value.length <= limit) return value;
  let best = -1;
  for (let i = 0; i < limit; i += 1) {
    if (!'.!?'.includes(value[i] ?? '')) continue;
    const end = sentenceEndAt(value, i);
    if (end > 0 && end <= limit) best = end;
  }
  if (best >= limit / 2) return value.slice(0, best).trim();
  // No sentence ends late enough: end after the last clause (a "; ") or else the last word that
  // fits, and say there is more.
  const room = value.slice(0, limit - 1);
  const clause = room.lastIndexOf('; ');
  const space = /\s/.test(value[limit - 1] ?? '') ? limit - 1 : room.search(/\s\S*$/);
  const at = clause > limit / 2 ? clause : space;
  const cut = at > limit / 2 ? room.slice(0, at) : room;
  return `${cut.replace(/[\s,;:.(–-]+$/, '')}…`;
}
