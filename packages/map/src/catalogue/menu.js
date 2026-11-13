/**
 * One pop-up menu at a time, for a row's secondary actions (downloads, link, cite, compare...).
 * Lives on <body> with fixed position, so the pane's scrolling and clipping cannot cut it off;
 * keyboard: arrows move, Home/End jump, Escape or Tab closes, focus returns to the button.
 *
 * Items: { label, icon, onSelect } | { label, icon, href, download, external } | { heading } | { separator }
 */
import { icon } from './icons.js';
import { esc } from './util.js';

/**
 * One item of a menu: an action, a link, a heading or a separator.
 * @typedef {{ label?: string, icon?: string, onSelect?: () => void, href?: string, download?: boolean, external?: boolean, heading?: string, separator?: boolean }} MenuItem
 */

/** The menu open now, with what closes it. @type {{ el: HTMLElement, anchor: HTMLElement, onDoc: (e: Event) => void, onWin: (e: Event) => void } | null} */
let current = null;

/** @param {{ restoreFocus?: boolean }} [options] */
export function closeMenu({ restoreFocus = true } = {}) {
  if (!current) return;
  const { el, anchor, onDoc, onWin } = current;
  current = null;
  document.removeEventListener('pointerdown', onDoc, true);
  window.removeEventListener('resize', onWin, true);
  window.removeEventListener('scroll', onWin, true);
  anchor.setAttribute('aria-expanded', 'false');
  const hadFocus = el.contains(document.activeElement);
  el.remove();
  if (restoreFocus && hadFocus && anchor.isConnected) anchor.focus();
}

/** @param {Element} anchor */
export const menuOpenFor = (anchor) => Boolean(current && current.anchor === anchor);

/**
 * @param {HTMLElement} anchor
 * @param {MenuItem[]} items
 * @param {{ label?: string }} [options]
 */
export function openMenu(anchor, items, { label = 'Actions' } = {}) {
  closeMenu({ restoreFocus: false });
  const el = document.createElement('div');
  el.className = 'cn-menu';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', label);
  el.innerHTML = items.map((it, i) => {
    if (it.heading) return `<div class="cn-menu__heading" role="presentation">${esc(it.heading)}</div>`;
    if (it.separator) return '<div class="cn-menu__sep" role="separator"></div>';
    const inner = `${icon(it.icon || 'chevron-right', 'cn-menu__icon')}<span>${esc(it.label)}</span>`;
    if (it.href) {
      return `<a role="menuitem" tabindex="-1" class="cn-menu__item" data-i="${i}" href="${esc(it.href)}"${it.download ? ' download' : ''}${it.external ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`;
    }
    return `<button type="button" role="menuitem" tabindex="-1" class="cn-menu__item" data-i="${i}">${inner}</button>`;
  }).join('');
  document.body.appendChild(el);
  place(el, anchor);
  anchor.setAttribute('aria-expanded', 'true');

  const itemsEls = () => [.../** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('[role="menuitem"]'))];
  el.addEventListener('click', (e) => {
    // A click inside the menu lands on an element of it.
    const target = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('[role="menuitem"]'));
    if (!target) return;
    const it = items[Number(target.dataset.i)];
    if (it?.onSelect) {
      e.preventDefault();
      closeMenu();
      it.onSelect();
    } else {
      closeMenu({ restoreFocus: false });
    }
  });
  el.addEventListener('keydown', (e) => {
    const list = itemsEls();
    // Focus elsewhere (or on nothing) is not in the list: -1.
    const i = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else if (e.key === 'Escape') closeMenu();
    else if (e.key === 'Tab') { closeMenu(); return; } else return;
    e.preventDefault();
  });
  /** @param {Event} e a pointerdown, whose target is a node */
  const onDoc = (e) => { if (!el.contains(/** @type {Node | null} */ (e.target)) && !anchor.contains(/** @type {Node | null} */ (e.target))) closeMenu({ restoreFocus: false }); };
  /** @param {Event} e */
  const onWin = (e) => {
    // A scroll's target is a node (the document or an element); a resize's, the window, is not read here.
    if (e.type === 'scroll' && el.contains(/** @type {Node | null} */ (e.target))) return;
    // A scroll that leaves the button in sight moves the menu with it rather than closing it:
    // the pane also scrolls by itself, when what a search found besides maps arrives above the
    // rows and the browser keeps the rows in place, and that closed a menu the reader had just
    // opened (map-svg-export "Download menu", flaky under load, 11 Nov 2026).
    if (e.type === 'scroll' && anchor.isConnected) {
      // In sight: inside the box of what scrolled (the pane) when the button is in it, and inside
      // the window.
      const r = anchor.getBoundingClientRect();
      const box = e.target instanceof Element && e.target.contains(anchor) ? e.target.getBoundingClientRect() : null;
      const top = Math.max(0, box ? box.top : 0);
      const bottom = Math.min(window.innerHeight, box ? box.bottom : window.innerHeight);
      if (r.height && r.top >= top && r.bottom <= bottom) { place(el, anchor); return; }
    }
    closeMenu({ restoreFocus: false });
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('resize', onWin, true);
    window.addEventListener('scroll', onWin, true);
  }, 0);
  current = { el, anchor, onDoc, onWin };
  itemsEls()[0]?.focus();
}

/** Below the button, flipped above when there is no room; kept inside the window. */
/**
 * @param {HTMLElement} el
 * @param {Element} anchor
 */
function place(el, anchor) {
  const a = anchor.getBoundingClientRect();
  const margin = 8;
  el.style.position = 'fixed';
  el.style.top = '0px';
  el.style.left = '0px';
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  let { width, height } = el.getBoundingClientRect();
  if (height > vh - margin * 2) {
    el.style.maxHeight = `${vh - margin * 2}px`;
    el.style.overflowY = 'auto';
    height = vh - margin * 2;
  }
  let top = a.bottom + 4;
  if (top + height + margin > vh && a.top - 4 - height >= margin) top = a.top - 4 - height;
  top = Math.min(Math.max(margin, top), Math.max(margin, vh - height - margin));
  let left = a.right - width;
  if (left < margin) left = margin;
  if (left + width + margin > vw) left = vw - width - margin;
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
}
