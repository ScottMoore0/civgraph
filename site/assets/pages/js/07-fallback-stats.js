(function () {
  if (window.gsap && window.ScrollTrigger) return;
  var stats = Array.prototype.slice.call(document.querySelectorAll('.stat__n[data-count]'));
  if (!stats.length) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var formatter = new Intl.NumberFormat('en-GB');

  function setFinal(el) {
    el.textContent = formatter.format(Number(el.dataset.count));
  }

  if (reduced || !('IntersectionObserver' in window)) {
    stats.forEach(setFinal);
    return;
  }

  /* Start at zero only after JS is active, so the source HTML still contains
     the real values for no-JS users and crawlers. */
  stats.forEach(function (el) {
    el.textContent = '0';
  });

  function animateCount(el, delay) {
    var target = Number(el.dataset.count);
    var duration = 1600;
    var startTime = null;

    window.setTimeout(function () {
      function frame(ts) {
        if (startTime === null) startTime = ts;
        var progress = Math.min((ts - startTime) / duration, 1);

        // Ease out: quick initial movement, then settle cleanly on the total.
        var eased = 1 - Math.pow(1 - progress, 3);
        var current = Math.round(target * eased);

        el.textContent = formatter.format(current);

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          setFinal(el);
        }
      }
      requestAnimationFrame(frame);
    }, delay);
  }

  var row = document.querySelector('.stats');
  var hasRun = false;

  var observer = new IntersectionObserver(function (entries) {
    if (!entries[0].isIntersecting || hasRun) return;
    hasRun = true;

    stats.forEach(function (el, index) {
      animateCount(el, index * 95);
    });

    observer.disconnect();
  }, {
    threshold: 0.3
  });

  observer.observe(row);
})();
