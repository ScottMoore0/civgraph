export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

export function formatValue(value) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value;
}

export function boundsToMapLibre(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const [[south, west], [north, east]] = bounds;
  return [[west, south], [east, north]];
}

export function boundsToFlatBbox(bounds) {
  const converted = boundsToMapLibre(bounds);
  if (!converted) return undefined;
  return [converted[0][0], converted[0][1], converted[1][0], converted[1][1]];
}

export function boundsToImageCoordinates(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const [[south, west], [north, east]] = bounds;
  if (![south, west, north, east].every(Number.isFinite)) return null;
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south]
  ];
}

export function absoluteTileTemplate(template) {
  if (/^https?:\/\//i.test(template)) return template;
  const origin = location.origin.replace(/\/$/, '');
  return template.startsWith('/') ? `${origin}${template}` : `${origin}/${template}`;
}

export function showToast(els, message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 5000);
}

export async function copyText(value) {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard API is unavailable');
  }
  await navigator.clipboard.writeText(String(value ?? ''));
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeSearchText(value) {
  return String(value ?? '').trim().toLowerCase();
}
