// Small progressive enhancements. Everything works without JavaScript.
document.documentElement.classList.remove('no-js');
(function () {
  // Mobile menu
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('site-nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { nav.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
    });
  }

  // Homepage slideshow: slow crossfade, pause button, still for reduced-motion visitors.
  var hero = document.querySelector('.hero[data-interval]');
  if (hero) {
    var slides = hero.querySelectorAll('.hero__slide');
    var pause = hero.querySelector('.hero__pause');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var i = 0, timer = null, paused = reduce;
    var show = function (n) {
      slides[i].classList.remove('is-active'); slides[i].setAttribute('aria-hidden', 'true');
      i = (n + slides.length) % slides.length;
      var img = slides[i].querySelector('img'); if (img) img.loading = 'eager';
      slides[i].classList.add('is-active'); slides[i].removeAttribute('aria-hidden');
    };
    var start = function () { stop(); timer = setInterval(function () { show(i + 1); }, (Number(hero.dataset.interval) || 7) * 1000); };
    var stop = function () { if (timer) clearInterval(timer); timer = null; };
    var sync = function () {
      pause.setAttribute('aria-pressed', String(paused));
      pause.querySelector('.sr').textContent = paused ? 'Play slideshow' : 'Pause slideshow';
      paused ? stop() : start();
    };
    pause.addEventListener('click', function () { paused = !paused; sync(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (!paused) start(); });
    sync();
  }

  // Testimonial carousel dots (native scroll-snap does the swiping).
  document.querySelectorAll('[data-carousel]').forEach(function (c) {
    var track = c.querySelector('.carousel__track');
    var dots = c.querySelector('.carousel__dots');
    var items = track.children;
    var pages = function () { var per = Math.max(1, Math.round(track.clientWidth / items[0].getBoundingClientRect().width)); return Math.ceil(items.length / per); };
    var render = function () {
      var n = pages(); dots.innerHTML = '';
      if (n < 2) return;
      for (var k = 0; k < n; k++) {
        var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Show testimonials page ' + (k + 1) + ' of ' + n);
        (function (k) { b.addEventListener('click', function () { track.scrollTo({ left: k * track.clientWidth, behavior: 'smooth' }); }); })(k);
        dots.appendChild(b);
      }
      mark();
    };
    var mark = function () {
      var k = Math.round(track.scrollLeft / track.clientWidth);
      Array.prototype.forEach.call(dots.children, function (d, j) { d.setAttribute('aria-current', String(j === k)); });
    };
    track.addEventListener('scroll', function () { window.requestAnimationFrame(mark); }, { passive: true });
    window.addEventListener('resize', render);
    render();
  });

  // Listing photo gallery: previous/next buttons, thumbnails, keyboard arrows.
  document.querySelectorAll('.gallery').forEach(function (g) {
    var track = g.querySelector('.gallery__track');
    var count = g.querySelector('[data-current]');
    var thumbs = g.querySelectorAll('.gallery__thumbs a');
    var n = track.children.length;
    var cur = function () { return Math.round(track.scrollLeft / track.clientWidth); };
    var go = function (k) { k = Math.max(0, Math.min(n - 1, k)); track.scrollTo({ left: k * track.clientWidth, behavior: 'smooth' }); };
    var mark = function () {
      var k = cur(); if (count) count.textContent = String(k + 1);
      thumbs.forEach(function (t, j) { t.setAttribute('aria-current', String(j === k)); });
    };
    g.querySelectorAll('.gallery__btn').forEach(function (b) { b.addEventListener('click', function () { go(cur() + Number(b.dataset.dir)); }); });
    thumbs.forEach(function (t) { t.addEventListener('click', function (e) { e.preventDefault(); go(Number(t.dataset.go)); track.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }); });
    track.tabIndex = 0;
    track.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { e.preventDefault(); go(cur() + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur() - 1); } });
    track.addEventListener('scroll', function () { window.requestAnimationFrame(mark); }, { passive: true });
    mark();
  });
})();
