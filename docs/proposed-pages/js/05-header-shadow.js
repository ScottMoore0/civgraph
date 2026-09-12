(function () {
  var header = document.querySelector('.app-header');
  if (!header) return;

  function syncHeaderHeight() {
    document.documentElement.style.setProperty(
      '--header-height',
      header.getBoundingClientRect().height.toFixed(1) + 'px'
    );
  }

  syncHeaderHeight();
  window.addEventListener('resize', syncHeaderHeight, { passive: true });

  if ('ResizeObserver' in window) {
    new ResizeObserver(syncHeaderHeight).observe(header);
  }
})();
