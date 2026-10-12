/**
 * Whether the rebuilt catalogue (src/catalogue/) replaces the classic pane. It is the site's
 * catalogue since 2026-10-12 (civgraph.net/maps): only the archived classic page
 * (civgraph.net/maps/classic/, window.CIVGRAPH_CATALOGUE = 'classic') or ?catalogue=classic
 * shows the classic pane. Kept apart from the catalogue itself so that checking the switch never
 * loads the catalogue's code.
 */
export function catalogueNextRequested() {
  if (typeof window === 'undefined') return false;
  if (window.CIVGRAPH_CATALOGUE === 'classic') return false;
  try {
    return new URLSearchParams(window.location.search).get('catalogue') !== 'classic';
  } catch {
    return true;
  }
}

/**
 * The catalogue view the page was opened at (#...&cat=<route>, or an old #flat-card-<id> link, or
 * a link that opens one map or set, #layers=<id>, as Browse's links do: its row),
 * read when this module first runs: the app rewrites the address while it starts, before the
 * catalogue's own code has loaded, so the catalogue cannot read it from the address itself.
 */
const INITIAL = (() => {
  if (typeof window === 'undefined') return '';
  const hash = String(window.location.hash || '').replace(/^#/, '');
  if (hash.startsWith('flat-card-')) return hash;
  try {
    const params = new URLSearchParams(hash);
    const layers = (params.get('layers') || '').split(',').filter(Boolean);
    const cat = params.get('cat') || '';
    // One map and at most a section (a link copied before links named their row): the map's row.
    if (layers.length === 1 && /^(maps|boundaries|places|statistics|historic)?$/.test(cat)) return `map/${layers[0]}`;
    return cat;
  } catch { return ''; }
})();
export const initialCatalogueRoute = () => INITIAL;
