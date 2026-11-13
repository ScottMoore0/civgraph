import 'maplibre-gl/dist/maplibre-gl.css';
import './test2.css';
// The design system's button (cg-button): the count toolbar's button uses it.
import '../../ui/assets/components/button.css';

const start = () => {
  if (window.__civgraphTest2BootStarted) return;
  window.__civgraphTest2BootStarted = true;
  window.__civgraphTest2RuntimeImportStartedAt = performance?.now?.() || Date.now();
  import('./app.js').catch((error) => {
    console.error('[Test2] Failed to load runtime', error);
    const target = document.getElementById('map') || document.body;
    target.insertAdjacentHTML('beforeend', `<div class="map-error">Failed to load Civgraph runtime: ${escapeHtml(error?.message || error)}</div>`);
  });
};

// After the first paint, so the page shell shows before the runtime is parsed. A page that is
// not being drawn -- a background tab, a hidden pane -- gets no animation frames, and the
// catalogue never left "Loading the catalogue..." there (UX review 2026-10-31, L10); a timer
// starts it instead. The runtime waits for the map's style before it adds any layer
// (app.js whenStyleLoaded), so starting without a frame no longer drops layers.
const FIRST_PAINT_FALLBACK_MS = 300;
const startAfterFirstPaint = () => {
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    start();
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(go);
  });
  setTimeout(go, FIRST_PAINT_FALLBACK_MS);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startAfterFirstPaint, { once: true });
} else {
  startAfterFirstPaint();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}
