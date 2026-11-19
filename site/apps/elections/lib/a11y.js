/**
 * The app's screen-reader and keyboard plumbing (14 Nov 2026):
 *
 *   announcement   what the polite announcer says when a view is shown: its title, briefly. The
 *                  view itself is no longer a live region (a whole page read out at every route
 *                  change; Browse dropped the same pattern for the same reason);
 *   focusAfter     where focus goes once a view is drawn: the element of the same id the reader
 *                  was using (a form change re-renders the view), else the new h1;
 *   scroll areas   a box that scrolls (a wide table, a diagram on a phone) is a named region in
 *                  the tab order while it overflows, so a keyboard can scroll it.
 *
 * The words are keyed for translation in data/i18n/strings/elections.txt (R10). The choices are
 * pure functions (unit test elections-app-fixes.test.mjs); the DOM helpers below only apply them
 * (browser spec elections-app.spec.cjs).
 */

/** Every fixed wording (keys of data/i18n/strings/elections.txt). */
export const A11Y_WORDS = Object.freeze({
  loaded: 'Loaded {title}.',
  table: 'Table',
  diagram: 'Diagram',
});

/** The selectors of the boxes that can scroll. */
export const SCROLL_AREAS = '.cg-table-wrap, .el-pivot-wrap, figure.cg-chart';

/** What the announcer says for a view: "Loaded Compare elections." @param {string} title */
export function announcement(title) {
  const t = String(title || '').trim();
  return t ? A11Y_WORDS.loaded.replace('{title}', t) : '';
}

/**
 * A scroll area's accessible name: its table's or figure's caption (to its first colon, so a long
 * caption stays short), else the nearest heading (a count stage's summary, a section's heading),
 * else what it holds.
 * @param {{ caption?: string | null, heading?: string | null, diagram?: boolean }} parts
 */
export function scrollAreaName({ caption, heading, diagram }) {
  const c = /** @type {string} */ (String(caption || '').trim().split(':')[0]).trim();
  if (c) return c;
  const h = String(heading || '').trim();
  if (h) return h;
  return diagram ? A11Y_WORDS.diagram : A11Y_WORDS.table;
}

/**
 * Where focus goes once a view is drawn: nowhere new when the view put it somewhere itself (the
 * methods page focuses the section a link asked for); the id of the control the reader was using
 * when the view re-rendered in place (a form change), when the new view has it; else the h1.
 * @param {{ keepScroll: boolean, activeId: string | null, has: (id: string) => boolean, placed?: boolean }} at
 * @returns {{ to: 'control', id: string } | { to: 'heading' } | { to: 'stay' }}
 */
export function focusAfter({ keepScroll, activeId, has, placed = false }) {
  if (placed) return { to: 'stay' };
  if (keepScroll && activeId && has(activeId)) return { to: 'control', id: activeId };
  return { to: 'heading' };
}

// ------------------------------------------------------------------ DOM

/** Say something through the page's polite announcer (#el-announcer). @param {string} text */
export function announce(text) {
  const el = document.getElementById('el-announcer');
  if (!el || !text) return;
  // Cleared first, so the same words said twice are read twice.
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

/**
 * Move focus after a view is drawn (focusAfter): to the control again, or to the h1, made
 * focusable from script only (tabindex -1) so it is not a tab stop.
 * @param {HTMLElement} root @param {{ keepScroll: boolean, activeId: string | null }} at
 */
export function moveFocus(root, { keepScroll, activeId }) {
  const now = document.activeElement;
  const placed = now instanceof HTMLElement && now !== root && root.contains(now);
  const target = focusAfter({ keepScroll, activeId, has: (id) => !!root.querySelector(`#${CSS.escape(id)}`), placed });
  if (target.to === 'stay') return;
  if (target.to === 'control') {
    /** @type {HTMLElement | null} */ (root.querySelector(`#${CSS.escape(target.id)}`))?.focus({ preventScroll: true });
    return;
  }
  const h1 = /** @type {HTMLElement | null} */ (root.querySelector('h1'));
  if (!h1) return;
  if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
  h1.focus({ preventScroll: keepScroll });
}

/** The text of the last h2 or h3 before an element among its and its ancestors' earlier siblings. @param {Element} el */
function headingBefore(el) {
  for (let e = /** @type {Element | null} */ (el); e && e.id !== 'el-view'; e = e.parentElement) {
    for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (/^H[23]$/.test(s.tagName)) return s.textContent;
  }
  return null;
}

/**
 * Make each scroll area that overflows a named region in the tab order, and take a box that no
 * longer overflows out of it again.
 * @param {ParentNode} root
 */
export function labelScrollAreas(root) {
  for (const box of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(SCROLL_AREAS))) {
    // A box its view already made a named region (a chart's data table) is left as it is.
    if (!box.dataset.scrollArea && box.hasAttribute('tabindex')) continue;
    const overflows = box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1;
    if (!overflows) {
      if (box.dataset.scrollArea) { box.removeAttribute('tabindex'); box.removeAttribute('role'); box.removeAttribute('aria-label'); delete box.dataset.scrollArea; }
      continue;
    }
    if (box.dataset.scrollArea) continue;
    // The nearest heading: a count stage's summary, the section's heading, or the last heading before it.
    const heading = box.closest('details')?.querySelector('summary')?.textContent || box.closest('section')?.querySelector('h2, h3')?.textContent || headingBefore(box);
    const caption = box.querySelector('caption, figcaption')?.textContent || null;
    box.setAttribute('tabindex', '0');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', scrollAreaName({ caption, heading, diagram: !box.querySelector('table') }));
    box.dataset.scrollArea = '1';
  }
}

/**
 * Keep the scroll areas of a view labelled while it lives: now, when the view's content changes
 * (a pivot run, a map's table) and when the window is resized. Stops when the view is left.
 * @param {HTMLElement} root @param {AbortSignal} signal
 */
export function watchScrollAreas(root, signal) {
  let queued = 0;
  const check = () => {
    if (queued || signal.aborted) return;
    queued = requestAnimationFrame(() => { queued = 0; if (!signal.aborted) labelScrollAreas(root); });
  };
  const mutations = new MutationObserver(check);
  mutations.observe(root, { childList: true, subtree: true });
  const sizes = new ResizeObserver(check);
  sizes.observe(root);
  signal.addEventListener('abort', () => { mutations.disconnect(); sizes.disconnect(); if (queued) cancelAnimationFrame(queued); }, { once: true });
  check();
}
