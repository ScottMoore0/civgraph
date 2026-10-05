/**
 * Whether the rebuilt catalogue (src/catalogue/) replaces the current pane. Off on the live site:
 * it is switched on by ?catalogue=next, or by the test-site server (tools/test-site/), which sets
 * window.CIVGRAPH_CATALOGUE = 'next' on every page it serves. Kept apart from the catalogue
 * itself so that checking the switch never loads the catalogue's code.
 */
export function catalogueNextRequested() {
  if (typeof window === 'undefined') return false;
  if (window.CIVGRAPH_CATALOGUE === 'next') return true;
  try {
    return new URLSearchParams(window.location.search).get('catalogue') === 'next';
  } catch {
    return false;
  }
}

/**
 * The catalogue view the page was opened at (#...&cat=<route>, or an old #flat-card-<id> link),
 * read when this module first runs: the app rewrites the address while it starts, before the
 * catalogue's own code has loaded, so the catalogue cannot read it from the address itself.
 */
const INITIAL = (() => {
  if (typeof window === 'undefined') return '';
  const hash = String(window.location.hash || '').replace(/^#/, '');
  if (hash.startsWith('flat-card-')) return hash;
  try { return new URLSearchParams(hash).get('cat') || ''; } catch { return ''; }
})();
export const initialCatalogueRoute = () => INITIAL;
