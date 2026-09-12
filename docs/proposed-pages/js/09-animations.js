(function () {
  if (!window.gsap || !window.ScrollTrigger) return;

  gsap.registerPlugin(ScrollTrigger);

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var formatter = new Intl.NumberFormat('en-GB');

  function revealEverythingImmediately() {
    var shot = document.querySelector('.shot-hero');
    if (shot) {
      shot.classList.add('is-revealed');
      gsap.set(shot, { clearProps: 'all' });
    }

    document.querySelectorAll('.why-exists-images .scroll-reveal').forEach(function (el) {
      el.classList.add('is-revealed');
      gsap.set(el, { clearProps: 'all' });
    });

    document.querySelectorAll('.stat__n[data-count]').forEach(function (el) {
      el.textContent = formatter.format(Number(el.dataset.count));
    });
    return;
  }

  if (reduced) {
    revealEverythingImmediately();
    return;
  }

  /* ---------------------------------------------------------------
     1. Hero entrance
     Desktop/laptop: copy and actions lead, Ireland settles in beside them.
     Mobile/iPad portrait: follows the visual order copy -> Ireland -> CTAs.
     --------------------------------------------------------------- */
  var heroTitle = document.querySelector('.hero h1');
  var heroLede = document.querySelector('.hero .lede');
  var heroGraphic = document.querySelector('.hero__graphic');
  var heroButtons = document.querySelectorAll('.hero .cta-row .btn');
  var edges = Array.prototype.slice.call(document.querySelectorAll('.constellation .cg-edge'));
  var nodes = Array.prototype.slice.call(document.querySelectorAll('.constellation .cg-node'));

  /* Draw the graph in without moving the island itself. */
  edges.forEach(function (edge) {
    try {
      var length = edge.getTotalLength();
      edge.style.strokeDasharray = length;
      edge.style.strokeDashoffset = length;
    } catch (e) {}
  });

  gsap.set(nodes, { transformOrigin: 'center center', scale: .72, opacity: 0 });

  var heroMM = gsap.matchMedia();

  heroMM.add('(max-width: 900px)', function () {
    var tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    if (heroTitle) tl.from(heroTitle, { y: 22, autoAlpha: 0, duration: .7 });
    if (heroLede) tl.from(heroLede, { y: 18, autoAlpha: 0, duration: .62 }, '-=.42');

    if (heroGraphic) {
      tl.from(heroGraphic, {
        autoAlpha: 0,
        scale: .965,
        duration: .75,
        transformOrigin: '50% 50%'
      }, '-=.18');
    }

    if (edges.length) {
      tl.to(edges, {
        strokeDashoffset: 0,
        duration: .75,
        stagger: .018,
        ease: 'power2.out'
      }, '-=.55');
    }

    if (nodes.length) {
      tl.to(nodes, {
        opacity: 1,
        scale: 1,
        duration: .42,
        stagger: .025,
        ease: 'back.out(1.7)',
        clearProps: 'transform'
      }, '-=.62');
    }

    if (heroButtons.length) {
      tl.fromTo(heroButtons,
        { y: 16 },
        {
          y: 0,
          duration: .52,
          stagger: .09,
          clearProps: 'transform'
        },
        '-=.18'
      );
    }

    tl.call(function () {
      edges.forEach(function (edge) {
        edge.style.strokeDasharray = '';
        edge.style.strokeDashoffset = '';
      });
    });
  });

  heroMM.add('(min-width: 901px)', function () {
    var tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    if (heroTitle) tl.from(heroTitle, { y: 22, autoAlpha: 0, duration: .7 });
    if (heroLede) tl.from(heroLede, { y: 18, autoAlpha: 0, duration: .62 }, '-=.42');
    if (heroButtons.length) {
      tl.fromTo(heroButtons,
        { y: 15 },
        {
          y: 0,
          duration: .5,
          stagger: .08,
          clearProps: 'transform'
        },
        '-=.32'
      );
    }

    if (heroGraphic) {
      tl.from(heroGraphic, {
        autoAlpha: 0,
        scale: .965,
        duration: .78,
        transformOrigin: '50% 50%'
      }, .16);
    }

    if (edges.length) {
      tl.to(edges, {
        strokeDashoffset: 0,
        duration: .82,
        stagger: .016,
        ease: 'power2.out'
      }, .42);
    }

    if (nodes.length) {
      tl.to(nodes, {
        opacity: 1,
        scale: 1,
        duration: .4,
        stagger: .024,
        ease: 'back.out(1.7)',
        clearProps: 'transform'
      }, .7);
    }

    tl.call(function () {
      edges.forEach(function (edge) {
        edge.style.strokeDasharray = '';
        edge.style.strokeDashoffset = '';
      });
    });
  });

  /* ---------------------------------------------------------------
     2. Hero -> main screenshot
     Scrubbed lightly with the scroll so the interface seems to rise
     naturally out of the opening hero instead of simply popping in.
     --------------------------------------------------------------- */
  var heroShot = document.querySelector('.shot-hero');
  if (heroShot) {
    gsap.set(heroShot, { autoAlpha: 0, y: 58, scale: .972 });

    gsap.to(heroShot, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: heroShot,
        start: 'top 96%',
        end: 'top 73%',
        scrub: .55,
        invalidateOnRefresh: true
      }
    });
  }

  /* ---------------------------------------------------------------
     3. Statistics
     Keep the same final numbers and comma formatting, now using a GSAP
     timeline and ScrollTrigger instead of a custom rAF counter.
     --------------------------------------------------------------- */
  var statsRow = document.querySelector('.stats');
  var statNumbers = Array.prototype.slice.call(document.querySelectorAll('.stat__n[data-count]'));

  if (statsRow && statNumbers.length) {
    statNumbers.forEach(function (el) { el.textContent = '0'; });

    ScrollTrigger.create({
      trigger: statsRow,
      start: 'top 80%',
      once: true,
      onEnter: function () {
        statNumbers.forEach(function (el, index) {
          var counter = { value: 0 };
          gsap.to(counter, {
            value: Number(el.dataset.count),
            duration: 1.65,
            delay: index * .09,
            ease: 'power3.out',
            onUpdate: function () {
              el.textContent = formatter.format(Math.round(counter.value));
            },
            onComplete: function () {
              el.textContent = formatter.format(Number(el.dataset.count));
            }
          });
        });

        gsap.fromTo(
          statsRow.querySelectorAll('.stat'),
          { y: 18, autoAlpha: .55 },
          {
            y: 0,
            autoAlpha: 1,
            duration: .58,
            stagger: .06,
            ease: 'power2.out',
            clearProps: 'transform,opacity,visibility'
          }
        );
      }
    });
  }

  /* ---------------------------------------------------------------
     4. Start-anywhere cards
     One restrained stagger on entry; hover behavior stays CSS-driven.
     --------------------------------------------------------------- */
  var cards = document.querySelectorAll('.cards .card');
  if (cards.length) {
    gsap.fromTo(cards,
      { y: 28, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: .72,
        stagger: .1,
        ease: 'power3.out',
        clearProps: 'transform,opacity,visibility',
        scrollTrigger: {
          trigger: document.querySelector('.cards'),
          start: 'top 82%',
          once: true
        }
      }
    );
  }

  /* ---------------------------------------------------------------
     5. Why-it-exists images
     Preserve the desktop/iPad composition; animate both with a subtle
     offset and scale so they feel connected rather than independently
     faded in.
     --------------------------------------------------------------- */
  var whyImages = document.querySelectorAll('.why-exists-images .scroll-reveal');
  if (whyImages.length) {
    gsap.fromTo(whyImages,
      { y: 36, autoAlpha: 0, scale: .985 },
      {
        y: 0,
        autoAlpha: 1,
        scale: 1,
        duration: .78,
        stagger: .12,
        ease: 'power3.out',
        onComplete: function () {
          whyImages.forEach(function (el) { el.classList.add('is-revealed'); });
        },
        scrollTrigger: {
          trigger: document.querySelector('.why-exists-images'),
          start: 'top 84%',
          once: true
        }
      }
    );
  }

  /* ---------------------------------------------------------------
     6. Remaining content sections
     Only headings/copy lift slightly; no pinning or scroll-jacking.
     --------------------------------------------------------------- */
  document.querySelectorAll('main > .wrap > section').forEach(function (section) {
    if (section.querySelector('.cards')) return;
    var targets = section.querySelectorAll('h2, p, .cta-row');
    if (!targets.length) return;

    gsap.fromTo(targets,
      { y: 18, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: .58,
        stagger: .06,
        ease: 'power2.out',
        clearProps: 'transform,opacity,visibility',
        scrollTrigger: {
          trigger: section,
          start: 'top 86%',
          once: true
        }
      }
    );
  });

  /* ---------------------------------------------------------------
     7. Footer
     A very small final reveal; intentionally understated.
     --------------------------------------------------------------- */
  var footer = document.querySelector('.ftr');
  if (footer) {
    gsap.fromTo(footer,
      { y: 22, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: .7,
        ease: 'power2.out',
        clearProps: 'transform,opacity,visibility',
        scrollTrigger: {
          trigger: footer,
          start: 'top 94%',
          once: true
        }
      }
    );
  }

  /* Stagger the mobile/tablet menu contents after the existing smooth
     container transition opens. */
  window.civgraphAnimateMenu = function (open, nav) {
    if (!nav || !open) return;
    var items = nav.querySelectorAll('.app-header__link, .support-btn, .theme-toggle');
    gsap.killTweensOf(items);
    gsap.fromTo(items,
      { y: -8, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: .28,
        stagger: .035,
        ease: 'power2.out',
        clearProps: 'transform,opacity,visibility'
      }
    );
  };

  /* Image dimensions/fonts can change trigger positions after load. */
  window.addEventListener('load', function () {
    ScrollTrigger.refresh();
  }, { once: true });
})();
