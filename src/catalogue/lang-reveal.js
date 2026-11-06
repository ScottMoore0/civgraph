/**
 * The interface-language control (assets/i18n/i18n.js) is shown only to a reader who types one
 * phrase, and nothing else, into the Maps search box. Nothing on the site mentions it. Once typed,
 * the browser keeps the flag the site-head bootstrap reads (localStorage 'civgraph.langPreview'),
 * so the control also appears on the site's other pages; its own Hide action, or any page opened
 * with ?lang-preview=0, clears the flag again.
 *
 * Only typing counts: a query that arrives in the address (#q=...) runs as a search but reveals
 * nothing, so a shared link cannot switch the control on for someone else.
 *
 * The Irish and Ulster-Scots texts are drafts awaiting review (data/i18n/README.md).
 */

export const LANGUAGE_PHRASE = 'language toggle';
const FLAG_KEY = 'civgraph.langPreview';
const SEARCH_INPUT_ID = 'searchInput';

/** True when the whole query is the phrase: any case, surrounding spaces and punctuation ignored. */
export function isLanguagePhrase(query) {
  const s = String(query ?? '')
    .toLowerCase()
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '')
    .replace(/\s+/g, ' ');
  return s === LANGUAGE_PHRASE;
}

/** Whether this browser already shows the control. */
export function languageOptionsShown() {
  try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; }
}

// What the reader last typed (or pasted) into the search box: trusted input events only, so a
// query set by a script or read from the address does not count as typed.
let lastTyped = '';
if (typeof document !== 'undefined') {
  document.addEventListener('input', (e) => {
    if (e.isTrusted && e.target && e.target.id === SEARCH_INPUT_ID) lastTyped = e.target.value;
  }, true);
}

/** Whether the reader typed the phrase into the search box. */
export function typedLanguagePhrase() { return isLanguagePhrase(lastTyped); }

/** After the control's Hide: only typing the phrase again brings it back. */
export function forgetTypedPhrase() { lastTyped = ''; }

/**
 * Turn the control on: the site-head bootstrap's civgraphLangReveal() sets the flag and loads the
 * runtime (which then builds the control). A page without the bootstrap keeps the flag, so the
 * control appears from the next page on. Returns true when the runtime was asked to load.
 */
export function revealLanguageOptions() {
  if (typeof window !== 'undefined' && typeof window.civgraphLangReveal === 'function') {
    window.civgraphLangReveal();
    return true;
  }
  try { localStorage.setItem(FLAG_KEY, '1'); } catch { /* private mode */ }
  return false;
}
