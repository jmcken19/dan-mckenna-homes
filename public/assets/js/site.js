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

  // Email links: the address is not written in the page code (spam harvesters read it there). Put the real
  // mailto: link and the readable address back now. Other half: src/lib/mail.mjs → scrambleMail().
  function unscramble(v) { try { return decodeURIComponent(atob(v.split('').reverse().join(''))); } catch (e) { return ''; } }
  document.querySelectorAll('a[data-mail]').forEach(function (a) {
    var addr = unscramble(a.getAttribute('data-mail'));
    var subject = a.getAttribute('data-mail-subject');
    if (addr) a.href = 'mailto:' + addr + (subject ? '?subject=' + encodeURIComponent(subject) : '');
  });
  document.querySelectorAll('[data-mail-text]').forEach(function (el) {
    var addr = unscramble(el.getAttribute('data-mail-text'));
    if (addr) el.textContent = addr;
  });

  // Contact form: send without leaving the page; on any problem, point to call/text instead.
  // Forms with data-api post to this site's own /api/contact with a Cloudflare Turnstile token (the "are you a
  // person" check – normally invisible). Forms with data-ajax are the older FormSubmit form.
  var turnstileLoading = null;
  function loadTurnstile() {
    if (!turnstileLoading) {
      turnstileLoading = new Promise(function (resolve, reject) {
        if (window.turnstile) return resolve(window.turnstile);
        var sc = document.createElement('script');
        sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        sc.async = true; sc.defer = true;
        sc.onload = function () { window.turnstile ? window.turnstile.ready(function () { resolve(window.turnstile); }) : reject(new Error('turnstile')); };
        sc.onerror = function () { turnstileLoading = null; reject(new Error('turnstile')); };
        document.head.appendChild(sc);
      });
    }
    return turnstileLoading;
  }
  document.querySelectorAll('[data-cform]').forEach(function (form) {
    var status = form.querySelector('.cform__status');
    var btn = form.querySelector('.cform__send');
    var api = form.getAttribute('data-api');
    var isApi = form.classList.contains('cform--api');
    var loadedAt = Date.now();
    if (form._t) form._t.value = String(loadedAt);
    // Turnstile: start it the first time the visitor touches the form (so other pages stay fast), keep its token.
    var check = { id: null, token: '', waiting: null, started: false };
    function startCheck() {
      if (check.started || !api) return;
      check.started = true;
      loadTurnstile().then(function (ts) {
        check.id = ts.render(form.querySelector('[data-turnstile]'), {
          sitekey: form.getAttribute('data-sitekey'),
          appearance: 'interaction-only', // nothing to see unless Cloudflare needs a click
          size: 'flexible',
          callback: function (token) { check.token = token; if (check.waiting) { var w = check.waiting; check.waiting = null; w.resolve(token); } },
          'expired-callback': function () { check.token = ''; },
          'error-callback': function () { check.token = ''; if (check.waiting) { var w = check.waiting; check.waiting = null; w.reject(new Error('check')); } return true; },
        });
      }).catch(function () { check.started = false; if (check.waiting) { var w = check.waiting; check.waiting = null; w.reject(new Error('check')); } });
    }
    function getToken() {
      if (check.token) return Promise.resolve(check.token);
      return new Promise(function (resolve, reject) {
        check.waiting = { resolve: resolve, reject: reject };
        startCheck();
        setTimeout(function () { if (check.waiting) { check.waiting = null; reject(new Error('check')); } }, 30000);
      });
    }
    function resetCheck() { check.token = ''; try { if (window.turnstile && check.id !== null) window.turnstile.reset(check.id); } catch (e) {} }
    if (api) { form.addEventListener('focusin', startCheck); form.addEventListener('pointerdown', startCheck); }

    form.addEventListener('submit', function (e) {
      if (isApi) { e.preventDefault(); if (!api) return; } // previews: the form is switched off
      else if (!window.fetch || !window.FormData) return; // older form falls back to a normal form post
      e.preventDefault();
      if (btn.disabled) return;
      if (!isApi && form._honey && form._honey.value) return; // spam trap (the new form's is checked on the server)
      btn.disabled = true; var label = btn.textContent; btn.textContent = 'Sending…';
      status.className = 'cform__status'; status.textContent = '';
      var data = {};
      new FormData(form).forEach(function (v, k) { if (k !== '_next' && k !== 'cf-turnstile-response') data[k] = v; });
      var ready = Promise.resolve();
      if (isApi) {
        data._sent = Date.now(); data.page = location.pathname;
        ready = getToken().then(function (token) { data.token = token; });
      }
      ready
        .then(function () { return fetch(isApi ? api : form.dataset.ajax, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) }); })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || (isApi ? j.success !== true : String(j.success) === 'false')) throw new Error(j.message || 'failed'); }); })
        .then(function () {
          form.reset();
          if (form._t) form._t.value = String(Date.now());
          status.classList.add('is-ok');
          status.textContent = form.getAttribute('data-msg-ok');
          btn.textContent = 'Sent ✓';
        })
        .catch(function () {
          status.classList.add('is-bad');
          status.textContent = form.getAttribute('data-msg-bad');
          btn.disabled = false; btn.textContent = label;
        })
        .then(function () { if (isApi) resetCheck(); });
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
  // Moved with a GPU transform (smooth on phones). Drag with mouse or finger; a flick keeps gliding.
  // Pauses while the mouse is over it or a card has keyboard focus; keyboard users also get a Pause button.
  document.querySelectorAll('[data-marquee]').forEach(function (c) {
    var track = c.querySelector('.carousel__track');
    var originals = Array.prototype.slice.call(track.children);
    if (originals.length < 2) { c.removeAttribute('data-marquee'); return; }
    c.removeAttribute('data-carousel');
    c.classList.add('is-marquee');
    var inner = document.createElement('div');
    inner.className = 'marquee__inner';
    originals.forEach(function (el) { inner.appendChild(el); });
    // Copy the cards once so the row can loop without a jump. Copies are hidden from screen readers and keyboard.
    originals.forEach(function (el) {
      var copy = el.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      copy.setAttribute('inert', '');
      copy.querySelectorAll('a, button').forEach(function (a) { a.setAttribute('tabindex', '-1'); });
      inner.appendChild(copy);
    });
    track.appendChild(inner);

    var pauseBtn = c.querySelector('.marquee-pause');
    var SPEED = 0.022;            // px per ms ≈ 22 px/second: slow enough to read
    var x = 0, vel = 0, last = 0;
    var userPaused = false, hover = false, focused = false, dragging = false, holdUntil = 0;
    var loopW = function () { return inner.children[originals.length].offsetLeft - inner.children[0].offsetLeft; };
    var wrap = function () { var w = loopW(); if (w > 0) { x = ((x % w) + w) % w; } };
    var paint = function () { inner.style.transform = 'translate3d(' + (-x).toFixed(2) + 'px,0,0)'; };
    x = originals[Math.floor(Math.random() * originals.length)].offsetLeft - originals[0].offsetLeft;
    paint();
    // The track never scrolls itself (focus could otherwise nudge it).
    track.addEventListener('scroll', function () { track.scrollLeft = 0; }, { passive: true });

    // Dragging with mouse, finger or pen. Vertical finger moves still scroll the page (touch-action: pan-y).
    var startX = 0, startY = 0, startOff = 0, moved = 0, pid = null, decided = false, lastMoveX = 0, lastMoveT = 0;
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pid = e.pointerId; startX = lastMoveX = e.clientX; startY = e.clientY; startOff = x; moved = 0; vel = 0;
      decided = e.pointerType === 'mouse'; dragging = decided; lastMoveT = performance.now();
      if (dragging) { c.classList.add('is-dragging'); try { track.setPointerCapture(pid); } catch (err) {} }
    });
    track.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pid) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        decided = true;
        if (Math.abs(dy) > Math.abs(dx)) { pid = null; return; } // a page scroll, not a swipe
        dragging = true; c.classList.add('is-dragging'); // touches are already captured by the browser
      }
      if (!dragging) return;
      moved = Math.max(moved, Math.abs(dx));
      var now = performance.now(), dt = Math.max(now - lastMoveT, 1);
      vel = 0.8 * vel + 0.2 * (-(e.clientX - lastMoveX) / dt); // px per ms, smoothed
      lastMoveX = e.clientX; lastMoveT = now;
      x = startOff - dx; wrap(); paint();
      if (e.cancelable) e.preventDefault();
    });
    var endDrag = function (e) {
      if (e.pointerId !== pid) return;
      pid = null;
      if (!dragging) return;
      dragging = false; c.classList.remove('is-dragging');
      if (performance.now() - lastMoveT > 80) vel = 0;  // held still before letting go: no glide
      vel = Math.max(-3, Math.min(3, vel));
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    // A drag shouldn't also count as clicking "Read more".
    track.addEventListener('click', function (e) { if (moved > 5) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, true);
    track.addEventListener('dragstart', function (e) { e.preventDefault(); });

    // Mouse over → pause; mouse leaves → carry on right away.
    track.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hover = true; });
    track.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hover = false; });
    // Keyboard: pause while a card has focus and bring it into view; arrow keys move one card.
    track.addEventListener('focusin', function (e) {
      focused = true;
      var card = e.target.closest('.marquee__inner > *');
      if (card) { x = card.offsetLeft - inner.children[0].offsetLeft; wrap(); paint(); }
    });
    track.addEventListener('focusout', function () { focused = false; });
    track.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var step = (inner.children[1].offsetLeft - inner.children[0].offsetLeft) || 300;
      x += e.key === 'ArrowRight' ? step : -step; wrap(); paint(); holdUntil = performance.now() + 4000;
    });
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.addEventListener('click', function () {
        userPaused = !userPaused;
        pauseBtn.setAttribute('aria-pressed', String(userPaused));
        pauseBtn.textContent = userPaused ? 'Play reviews' : 'Pause reviews';
      });
    }
    window.addEventListener('resize', function () { wrap(); paint(); });

    var frame = function (now) {
      var dt = last ? Math.min(now - last, 50) : 16; last = now;
      if (!dragging && !document.hidden) {
        if (Math.abs(vel) > 0.01) {                    // gliding after a flick
          x += vel * dt; vel *= Math.pow(0.94, dt / 16); wrap(); paint();
          if (Math.abs(vel) <= 0.01) { vel = 0; holdUntil = now + 600; }
        } else if (!userPaused && !hover && !focused && now > holdUntil) {
          x += SPEED * dt; wrap(); paint();
        }
      }
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
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
