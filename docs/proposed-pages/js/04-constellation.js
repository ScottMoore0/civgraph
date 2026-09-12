/* The island behaves the way the logo does: a graph of nodes and links.
   Hovering or focusing a node lights it and everything it connects to.
   Place-name labels are intentionally disabled. */
(function () {
  var root = document.querySelector('.constellation');
  if (!root) return;

  var svg = root.querySelector('.constellation__svg');
  var plate = root.querySelector('.constellation__plate');
  var signals = root.querySelector('.constellation__signals');
  var nodes = Array.prototype.slice.call(root.querySelectorAll('.cg-node'));
  var edges = Array.prototype.slice.call(root.querySelectorAll('.cg-edge'));
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function light(node, on) {
    node.classList.toggle('is-active', on);
    var list = (node.getAttribute('data-edges') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      var e = edges[parseInt(list[i], 10)];
      if (e) e.classList.toggle('is-lit', on);
    }
  }

  nodes.forEach(function (node) {
    node.addEventListener('mouseenter', function () { light(node, true); });
    node.addEventListener('mouseleave', function () { light(node, false); });
    node.addEventListener('focus', function () { light(node, true); });
    node.addEventListener('blur', function () { light(node, false); });
    node.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); node.click(); }
    });
  });

  /* Whole-island parallax intentionally disabled: the Ireland silhouette stays fixed on hover. */

  /* --- signals -------------------------------------------------------
     Small waves of dots travel across well-separated links so several parts
     of the island show the graph connections at the same time. Decorative:
     reduced-motion users lose no information. */

  if (!reduce.matches && edges.length) {
    var SVGNS = 'http://www.w3.org/2000/svg';

    var edgeInfo = edges.map(function (edge, index) {
      var x1 = +edge.getAttribute('x1'), y1 = +edge.getAttribute('y1');
      var x2 = +edge.getAttribute('x2'), y2 = +edge.getAttribute('y2');
      return {
        edge: edge,
        index: index,
        mx: (x1 + x2) / 2,
        my: (y1 + y2) / 2
      };
    });

    function runSignal(edge) {
      var x1 = +edge.getAttribute('x1'), y1 = +edge.getAttribute('y1');
      var x2 = +edge.getAttribute('x2'), y2 = +edge.getAttribute('y2');
      if (Math.random() < 0.5) { var tx = x1, ty = y1; x1 = x2; y1 = y2; x2 = tx; y2 = ty; }

      var dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('class', 'cg-signal');
      dot.setAttribute('r', '3');
      signals.appendChild(dot);

      /* Prefer GSAP for the travelling signal; retain the original
         requestAnimationFrame implementation as an offline fallback. */
      if (window.gsap) {
        dot.setAttribute('cx', x1);
        dot.setAttribute('cy', y1);
        dot.setAttribute('opacity', '0');

        gsap.timeline({
          onComplete: function () {
            if (dot.parentNode) dot.parentNode.removeChild(dot);
          }
        })
        .to(dot, { opacity: 1, duration: .28, ease: 'power1.out' }, 0)
        .to(dot, {
          attr: { cx: x2, cy: y2 },
          duration: 1.45,
          ease: 'power1.inOut'
        }, 0)
        .to(dot, { opacity: 0, duration: .38, ease: 'power1.in' }, 1.07);
      } else {
        var start = null;
        var dur = 1450;
        function step(ts) {
          if (start === null) start = ts;
          var t = Math.min((ts - start) / dur, 1);
          var ease = t * t * (3 - 2 * t);
          dot.setAttribute('cx', (x1 + (x2 - x1) * ease).toFixed(1));
          dot.setAttribute('cy', (y1 + (y2 - y1) * ease).toFixed(1));
          dot.setAttribute('opacity', (t < 0.5 ? t * 2 : (1 - t) * 2).toFixed(2));
          if (t < 1) requestAnimationFrame(step);
          else if (dot.parentNode) dot.parentNode.removeChild(dot);
        }
        requestAnimationFrame(step);
      }
    }

    function chooseDiverseEdges(count) {
      var chosen = [];
      var first = edgeInfo[Math.floor(Math.random() * edgeInfo.length)];
      chosen.push(first);

      while (chosen.length < count && chosen.length < edgeInfo.length) {
        var best = null;
        var bestScore = -1;

        // Sample candidates, then choose the one furthest from all already selected.
        for (var s = 0; s < Math.min(28, edgeInfo.length * 2); s++) {
          var candidate = edgeInfo[Math.floor(Math.random() * edgeInfo.length)];
          if (chosen.some(function (item) { return item.index === candidate.index; })) continue;

          var minDist = Infinity;
          for (var i = 0; i < chosen.length; i++) {
            var dx = candidate.mx - chosen[i].mx;
            var dy = candidate.my - chosen[i].my;
            minDist = Math.min(minDist, dx * dx + dy * dy);
          }
          if (minDist > bestScore) {
            bestScore = minDist;
            best = candidate;
          }
        }

        if (!best) {
          best = edgeInfo.find(function (candidate) {
            return !chosen.some(function (item) { return item.index === candidate.index; });
          });
        }
        if (!best) break;
        chosen.push(best);
      }
      return chosen;
    }

    function runWave() {
      var selected = chooseDiverseEdges(3);
      selected.forEach(function (item, i) {
        setTimeout(function () { runSignal(item.edge); }, i * 120);
      });
    }

    var timer = null;
    function schedule() {
      timer = setTimeout(function () {
        runWave();
        schedule();
      }, 1050 + Math.random() * 650);
    }

    // Stop the loop when the tab is hidden; no point animating into nothing.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearTimeout(timer); timer = null; }
      else if (!timer) schedule();
    });
    schedule();
  }
})();
