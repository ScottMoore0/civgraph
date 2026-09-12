(function () {
  var header = document.querySelector('.app-header');
  var toggle = document.querySelector('.mobile-menu-toggle');
  var nav = document.getElementById('mainNav');
  if (!header || !toggle || !nav) return;

  function setOpen(open) {
    header.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');

    if (window.civgraphAnimateMenu) {
      window.civgraphAnimateMenu(open, nav);
    }
  }

  toggle.addEventListener('click', function () {
    setOpen(!header.classList.contains('nav-open'));
  });

  nav.addEventListener('click', function (event) {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('click', function (event) {
    if (!header.classList.contains('nav-open')) return;
    if (!header.contains(event.target)) setOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      setOpen(false);
      toggle.focus();
    }
  });

  function usesCollapsedNav() {
    return window.matchMedia(
      '(max-width: 900px), (hover: none) and (pointer: coarse) and (max-width: 1180px)'
    ).matches;
  }

  window.addEventListener('resize', function () {
    if (!usesCollapsedNav()) setOpen(false);
  }, { passive: true });
})();
