/**
 * Developer logging, off unless asked for: ?debug in the address, or localStorage
 * 'civgraph.debug' = '1'. The map app wrote about 200 "[DataService] ..." lines to the console
 * for one layer selection, on every visitor's machine (QA 2026-11-11, M10).
 */
/** @type {boolean | null} */
let enabled = null;

/** Whether developer logging is on for this page. */
export function debugEnabled() {
  if (enabled !== null) return enabled;
  enabled = false;
  try {
    if (typeof location !== 'undefined' && /[?&]debug(?:=1|=true)?(?:&|$)/.test(location.search)) enabled = true;
    else if (typeof localStorage !== 'undefined' && localStorage.getItem('civgraph.debug') === '1') enabled = true;
  } catch { /* storage blocked: off */ }
  return enabled;
}

/**
 * console.log, when developer logging is on.
 * @param {...unknown} args
 */
export function debugLog(...args) {
  if (debugEnabled()) console.log(...args);
}
