/*
 * Shared behaviour for the site chrome: the header (partials/site-header.html), the
 * Support Us popup (partials/support-modal.html) and the footer.
 *
 * Every page that carries the shared header loads this one script, so the theme toggle,
 * the collapsed mobile navigation and the popup behave identically everywhere. The map
 * app (app/src/app.js) does not bind its own handlers when the shared header is present;
 * it listens for `civgraph:themechange` to keep the basemap in step instead.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var THEME_KEY = 'theme';
  // Must match the collapsed-navigation media queries in site-chrome.css.
  var COLLAPSED_NAV = '(max-width: 900px), (hover: none) and (pointer: coarse) and (max-width: 1180px)';

  function storedTheme() {
    try {
      var value = localStorage.getItem(THEME_KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch (error) {
      return null;
    }
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // partials/site-head.html stamps the theme before first paint; this covers a page
  // that loads the script without it.
  if (root.dataset.theme !== 'dark' && root.dataset.theme !== 'light') {
    root.dataset.theme = storedTheme() || systemTheme();
  }

  function setupTheme(header) {
    header.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        try { localStorage.setItem(THEME_KEY, next); } catch (error) { /* private mode */ }
        document.dispatchEvent(new CustomEvent('civgraph:themechange', { detail: { theme: next } }));
      });
    });
  }

  function setupNavigation(header) {
    var toggle = header.querySelector('.mobile-menu-toggle');
    var nav = header.querySelector('.app-header__nav');
    if (!toggle || !nav) return;

    function isOpen() {
      return header.classList.contains('nav-open');
    }

    function setOpen(open) {
      header.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      // Home and About stagger the menu items in with GSAP; other pages have no hook.
      if (typeof window.civgraphAnimateMenu === 'function') window.civgraphAnimateMenu(open, nav);
    }

    toggle.addEventListener('click', function () {
      setOpen(!isOpen());
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('click', function (event) {
      if (isOpen() && !header.contains(event.target)) setOpen(false);
    });

    // Only when the menu is open: Escape with it closed must not pull focus to the toggle.
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || !isOpen()) return;
      setOpen(false);
      toggle.focus();
    });

    var collapsed = window.matchMedia(COLLAPSED_NAV);
    var onChange = function () {
      if (!collapsed.matches) setOpen(false);
    };
    if (collapsed.addEventListener) collapsed.addEventListener('change', onChange);
    else if (collapsed.addListener) collapsed.addListener(onChange);
  }

  function setupHeaderHeight(header) {
    // The map app pins its header to --header-height and lays the panes out from it, so
    // measuring there would feed the constraint back into itself.
    if (header.dataset.headerLayout === 'app') return;

    function sync() {
      root.style.setProperty('--header-height', header.getBoundingClientRect().height.toFixed(1) + 'px');
    }

    sync();
    window.addEventListener('resize', sync, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(sync).observe(header);
  }

  function setupSupportModal() {
    var modal = document.getElementById('supportModal');
    var openers = document.querySelectorAll('[data-support-open]');
    if (!modal || !openers.length) return;

    // role="dialog" aria-modal="true" promises that focus stays inside the dialog, the
    // background is inert, and focus returns to the opener on close (T3-06).
    var FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    var lastFocused = null;

    function focusables() {
      return Array.prototype.filter.call(modal.querySelectorAll(FOCUSABLE), function (el) {
        return el.offsetParent !== null;
      });
    }

    // Computed on open rather than cached: the map shell adds body children at runtime.
    function backgroundSiblings() {
      return Array.prototype.filter.call(document.body.children, function (el) {
        return el !== modal;
      });
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        // Captured and stopped here, so nothing behind the dialog (an open menu, a map
        // pane) also reacts and takes focus away from the opener.
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    function open() {
      lastFocused = document.activeElement;
      modal.classList.remove('hidden');
      backgroundSiblings().forEach(function (el) {
        el.setAttribute('aria-hidden', 'true');
        if ('inert' in el) el.inert = true;
      });
      document.addEventListener('keydown', onKeydown, true);
      (focusables()[0] || modal).focus();
    }

    function close() {
      if (modal.classList.contains('hidden')) return;
      modal.classList.add('hidden');
      backgroundSiblings().forEach(function (el) {
        el.removeAttribute('aria-hidden');
        if ('inert' in el) el.inert = false;
      });
      document.removeEventListener('keydown', onKeydown, true);
      if (lastFocused && typeof lastFocused.focus === 'function' && document.contains(lastFocused)) {
        lastFocused.focus();
      }
      lastFocused = null;
    }

    Array.prototype.forEach.call(openers, function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        open();
      });
    });
    var backdrop = modal.querySelector('.support-modal__backdrop');
    var closeButton = modal.querySelector('.support-modal__close');
    if (backdrop) backdrop.addEventListener('click', close);
    if (closeButton) closeButton.addEventListener('click', close);
  }

  function init() {
    var header = document.querySelector('.app-header[data-site-chrome]');
    if (!header) return;
    setupTheme(header);
    setupNavigation(header);
    setupHeaderHeight(header);
    setupSupportModal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
