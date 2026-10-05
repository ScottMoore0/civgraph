/**
 * The split between the catalogue pane and the map on desktops and laptops, for the rebuilt
 * catalogue (test site only: UIController installs it when catalogueNextRequested()).
 *
 * The catalogue's lists read best at about 400-560px, so the pane takes that -- about 36% of a
 * laptop screen, less of a large monitor -- rather than half, and the map keeps the rest. While
 * the pane shows something wide it widens, and narrows again after:
 *   medium  election results, a map's or feature's details
 *   wide    the Tables tab, a book open in the viewer
 * A width the reader drags to is kept (and remembered) instead; double-clicking the handle goes
 * back to choosing automatically. Phones, which show one pane at a time, are left alone.
 */
export const SPLIT_WIDTHS = {
  catalogue: 'clamp(400px, 36%, 560px)',
  medium: 'clamp(460px, 42%, 680px)',
  wide: 'clamp(560px, 55%, 1000px)',
};
const KEY = 'civgraph.catalogueNext.split.v1';

const readSaved = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const writeSaved = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };

/** What the pane is showing, as far as its width is concerned. */
export function paneContent(doc = document) {
  const tab = doc.querySelector('.pane--info .pane-tab-content:not(.pane-tab-content--hidden)')?.dataset.tabContent || 'catalogue';
  if (tab === 'tables') return 'wide';
  if (tab === 'elections') return 'medium';
  if (doc.getElementById('catalogueFlatView')?.classList.contains('catalogue-flat-view--book-viewer')) return 'wide';
  const detail = doc.getElementById('catalogueDetailView');
  if (detail && !detail.classList.contains('hidden')) return 'medium';
  return 'catalogue';
}

export function installSplit(ui, { host, splitDrag }) {
  let manual = Number(readSaved().manual) || null;
  let applied = '';

  const apply = () => {
    if (ui.isMobile) return;
    const value = manual ? `${manual}%` : SPLIT_WIDTHS[paneContent()];
    if (value === applied && host.style.getPropertyValue('--split-position') === value) return;
    applied = value;
    host.style.setProperty('--split-position', value);
    // The map redraws for its new width, as after a drag.
    requestAnimationFrame(() => ui.onSplitChange?.(ui.currentStateId));
  };

  // A drag sets the width by hand: keep it, here and on the next visit.
  let dragging = false;
  const start = () => { dragging = true; };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const pct = parseFloat(host.style.getPropertyValue('--split-position'));
    if (!Number.isFinite(pct)) return;
    manual = Math.round(pct * 10) / 10;
    applied = `${manual}%`;
    writeSaved({ manual });
  };
  splitDrag.addEventListener('mousedown', start);
  splitDrag.addEventListener('touchstart', start, { passive: true });
  document.addEventListener('mouseup', end);
  document.addEventListener('touchend', end);
  // Double-click (after the handle's own reset to half): back to the automatic widths.
  splitDrag.addEventListener('dblclick', () => {
    manual = null;
    applied = '';
    writeSaved(null);
    apply();
  });

  // Follow what the pane shows: which tab is open, a details page, the book viewer.
  const observer = new MutationObserver(() => { if (!manual) apply(); });
  const watch = () => {
    document.querySelectorAll('.pane--info .pane-tab-content, #catalogueDetailView, #catalogueFlatView').forEach((el) => {
      if (el.dataset.cnSplitWatched) return;
      el.dataset.cnSplitWatched = '1';
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
  };
  watch();
  window.matchMedia?.('(max-width: 768px)')?.addEventListener?.('change', () => { applied = ''; apply(); });
  apply();
  return { apply, watch };
}
