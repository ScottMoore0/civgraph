(function () {
  /* The headline figures are written into the page at their final values by the build
     (scripts/build/build-site-stats.mjs) and are shown as they are. This fallback, for when GSAP
     is missing, used to zero them and count them up when scrolled into view, so a screenshot or a
     slow scroll caught "0 people" (QA 2026-11-11, M2). It now only makes sure each one carries
     its final value. */
  if (window.gsap && window.ScrollTrigger) return;
  // The site's shared formatter (packages/core/src/format.js, served at /pkg/): a classic
  // script reaches the module by import().
  import('/pkg/core/src/format.js').then(function (format) {
    Array.prototype.slice.call(document.querySelectorAll('.stat__n[data-count]')).forEach(function (el) {
      el.textContent = format.siteNumber(Number(el.dataset.count));
    });
  });
})();
