/**
 * One pop-up menu at a time, for a row's secondary actions (downloads, link, cite, compare...).
 * Lives on <body> with fixed position, so the pane's scrolling and clipping cannot cut it off;
 * keyboard: arrows move, Home/End jump, Escape or Tab closes, focus returns to the button.
 *
 * Items: { label, icon, onSelect } | { label, icon, href, download, external } | { heading } | { separator }
 */
import { icon } from './icons.js';
import { esc } from './util.js';

let current = null;

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

export const menuOpenFor = (anchor) => Boolean(current && current.anchor === anchor);

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

  const itemsEls = () => [...el.querySelectorAll('[role="menuitem"]')];
  el.addEventListener('click', (e) => {
    const target = e.target.closest('[role="menuitem"]');
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
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else if (e.key === 'Escape') closeMenu();
    else if (e.key === 'Tab') { closeMenu(); return; } else return;
    e.preventDefault();
  });
  const onDoc = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu({ restoreFocus: false }); };
  const onWin = (e) => { if (e.type === 'scroll' && el.contains(e.target)) return; closeMenu({ restoreFocus: false }); };
  setTimeout(() => {
    document.addEventListener('pointerdown', onDoc, true);
    window.addEventListener('resize', onWin, true);
    window.addEventListener('scroll', onWin, true);
  }, 0);
  current = { el, anchor, onDoc, onWin };
  itemsEls()[0]?.focus();
}

/** Below the button, flipped above when there is no room; kept inside the window. */
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
