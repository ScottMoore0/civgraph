import 'maplibre-gl/dist/maplibre-gl.css';
import './test2.css';

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

const startAfterFirstPaint = () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(start);
  });
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
