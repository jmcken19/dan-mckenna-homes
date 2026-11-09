// Small progressive enhancements. Everything works without JavaScript.
document.documentElement.classList.remove('no-js');
(function () {
  // Sections marked data-reveal fade in when they scroll into view.
  var reveals = document.querySelectorAll('[data-reveal]');
  if (reveals.length && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('reveal-ready');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-revealed'); io.unobserve(en.target); } });
    }, { threshold: 0.15 });
    reveals.forEach(function (r) { io.observe(r); });
  }

  // Contact form: send without leaving the page; on any problem, point to call/text instead.
  document.querySelectorAll('[data-cform]').forEach(function (form) {
    var status = form.querySelector('.cform__status');
    var btn = form.querySelector('.cform__send');
    form.addEventListener('submit', function (e) {
      if (!window.fetch || !window.FormData) return; // falls back to a normal form post
      e.preventDefault();
      if (btn.disabled) return;
      if (form._honey && form._honey.value) return; // spam trap
      btn.disabled = true; var label = btn.textContent; btn.textContent = 'Sending…';
      status.className = 'cform__status'; status.textContent = '';
      var data = {};
      new FormData(form).forEach(function (v, k) { if (k !== '_next') data[k] = v; });
      fetch(form.dataset.ajax, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || String(j.success) === 'false') throw new Error(j.message || 'failed'); }); })
        .then(function () {
          form.reset();
          status.classList.add('is-ok');
          status.textContent = 'Thank you! Your message was sent. Dan will get back to you soon.';
          btn.textContent = 'Sent ✓';
        })
        .catch(function () {
          status.classList.add('is-bad');
          status.textContent = 'Sorry, your message could not be sent right now. Please call or text Dan instead.';
          btn.disabled = false; btn.textContent = label;
        });
    });
  });

  // Testing banner: let the viewer hide it (remembered in this browser)
  document.querySelectorAll('[data-hide-preview]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.documentElement.classList.add('preview-hidden');
      // In the editor's preview, hiding lasts only until the page is refreshed.
      if (location.pathname.indexOf('/api/') !== 0) { try { localStorage.setItem('dmhHidePreview', '1'); } catch (e) {} }
    });
  });

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

  // Homepage slideshow: starts by itself when there are 2+ photos and Dan chose "Moving".
  var hero = document.querySelector('.hero[data-interval]');
  if (hero) {
    var slides = hero.querySelectorAll('.hero__slide');
    var pause = hero.querySelector('.hero__pause');
    // Owner's choice: when the slideshow is set to Moving it always starts by itself,
    // for every visitor (no Play button to press). Keyboard users can still pause it.
    var i = 0, timer = null, paused = false;
    var show = function (n) {
      var old = slides[i];
      old.classList.remove('is-active'); old.setAttribute('aria-hidden', 'true');
      if (hero.classList.contains('hero--slide')) { old.classList.add('is-leaving'); setTimeout(function () { old.classList.remove('is-leaving'); }, 1100); }
      i = (n + slides.length) % slides.length;
      var img = slides[i].querySelector('img'); if (img) img.loading = 'eager';
      slides[i].classList.add('is-active'); slides[i].removeAttribute('aria-hidden');
    };
    var start = function () { stop(); timer = setInterval(function () { show(i + 1); }, (Number(hero.dataset.interval) || 7) * 1000); };
    var stop = function () { if (timer) clearInterval(timer); timer = null; };
    var hover = false;
    var sync = function () {
      pause.setAttribute('aria-pressed', String(paused));
      pause.textContent = paused ? 'Play slideshow' : 'Pause slideshow';
      (paused || hover) ? stop() : start();
    };
    pause.addEventListener('click', function () { paused = !paused; sync(); });

    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (!paused && !hover) start(); });
    sync();
  }

  // Reviews drifting slowly sideways in an endless loop, starting at a random review.
  // Pauses while someone touches/hovers/focuses it; keyboard users get a Pause button.
  document.querySelectorAll('[data-marquee]').forEach(function (c) {
    var track = c.querySelector('.carousel__track');
    var originals = Array.prototype.slice.call(track.children);
    if (originals.length < 2) { c.removeAttribute('data-marquee'); return; }
    c.removeAttribute('data-carousel');
    c.classList.add('is-marquee');
    // Copy the cards once so the row can loop without a jump. Copies are hidden from screen readers and keyboard.
    originals.forEach(function (el) {
      var copy = el.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      copy.setAttribute('inert', '');
      copy.querySelectorAll('a, button').forEach(function (a) { a.setAttribute('tabindex', '-1'); });
      track.appendChild(copy);
    });
    var pauseBtn = c.querySelector('.marquee-pause');
    var speed = 0.35; // pixels per frame ≈ 21 px/second: slow enough to read
    var userPaused = false, holdUntil = 0, inside = false, pos = 0, last = 0;
    var loopWidth = function () { return track.children[originals.length].offsetLeft - track.children[0].offsetLeft; };
    var start = originals[Math.floor(Math.random() * originals.length)];
    pos = start.offsetLeft - track.children[0].offsetLeft;
    track.scrollLeft = pos;
    var hold = function (ms) { holdUntil = Date.now() + ms; };
    ['pointerenter', 'focusin', 'touchstart'].forEach(function (ev) { track.addEventListener(ev, function () { inside = true; }, { passive: true }); });
    // Mouse leaves → carry on right away. After a finger swipe, wait a moment so the swipe can glide to a stop.
    ['pointerleave', 'focusout'].forEach(function (ev) { track.addEventListener(ev, function (e) { if (e.pointerType === 'touch') return; inside = false; pos = track.scrollLeft; }, { passive: true }); });
    track.addEventListener('touchend', function () { inside = false; hold(1200); pos = track.scrollLeft; }, { passive: true });
    // Keep the loop endless when someone drags or swipes past either end.
    var wrap = function () {
      var w = loopWidth();
      if (track.scrollLeft >= w) track.scrollLeft -= w;
      else if (track.scrollLeft < 2) track.scrollLeft += w;
      pos = track.scrollLeft;
    };
    track.addEventListener('scroll', function () { if (inside || dragging) wrap(); }, { passive: true });

    // Drag with the mouse (phones and touchpads already swipe natively).
    var dragging = false, moved = 0, startX = 0, startLeft = 0;
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      dragging = true; moved = 0; startX = e.clientX; startLeft = track.scrollLeft;
      c.classList.add('is-dragging');
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX; moved = Math.max(moved, Math.abs(dx));
      track.scrollLeft = startLeft - dx; wrap(); startLeft = track.scrollLeft + dx;
      if (moved > 3) e.preventDefault();
    });
    window.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false; c.classList.remove('is-dragging'); pos = track.scrollLeft;
    });
    // A drag shouldn't also count as clicking "Read more".
    track.addEventListener('click', function (e) { if (moved > 5) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, true);
    track.addEventListener('dragstart', function (e) { e.preventDefault(); });
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.addEventListener('click', function () {
        userPaused = !userPaused;
        pauseBtn.setAttribute('aria-pressed', String(userPaused));
        pauseBtn.textContent = userPaused ? 'Play reviews' : 'Pause reviews';
        pos = track.scrollLeft;
      });
    }
    var step = function (now) {
      var dt = last ? Math.min(now - last, 50) : 16; last = now;
      if (!userPaused && !inside && !dragging && !document.hidden && Date.now() > holdUntil) {
        pos += speed * dt / 16;
        var w = loopWidth();
        if (pos >= w) pos -= w;
        track.scrollLeft = pos;
      } else if (track.scrollLeft >= loopWidth()) {
        track.scrollLeft -= loopWidth(); pos = track.scrollLeft;
      }
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  });

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
