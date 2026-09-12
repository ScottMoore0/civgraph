(function () {
  if (window.gsap && window.ScrollTrigger) return;
  var shot = document.querySelector('.shot-hero');
  if (!shot) return;

  function reveal() {
    shot.classList.add('is-revealed');
  }

  if (!('IntersectionObserver' in window)) {
    reveal();
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) {
      window.setTimeout(reveal, 40);
      observer.disconnect();
    }
  }, {
    threshold: 0.08,
    rootMargin: '0px 0px -70px 0px'
  });

  observer.observe(shot);
})();
