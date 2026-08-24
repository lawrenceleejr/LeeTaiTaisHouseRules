// Lee TaiTai's House Rules — tiny enhancements. No frameworks; TaiTai doesn't trust them.
(function () {
  'use strict';

  // Theme toggle: cycles light/dark, persisted. Default follows the system.
  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var current = root.dataset.theme || (systemDark ? 'dark' : 'light');
      var next = current === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem('ltt-theme', next);
      } catch (e) {
        /* private mode: theme just won't stick */
      }
    });
  }

  // Mobile nav
  var navToggle = document.getElementById('nav-toggle');
  var nav = document.getElementById('site-nav');
  if (navToggle && nav) {
    navToggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Scroll outro: publish 0 → 1 progress as --p while the giant tile is on screen.
  // The CSS does the rest; reduced motion opts out and keeps the finished state.
  var reveal = document.getElementById('tile-reveal');
  var still = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reveal && !still.matches) {
    var track = reveal.querySelector('.tile-reveal-track');
    var ticking = false;
    var live = false;

    var paint = function () {
      ticking = false;
      // travel = how far the sticky stage scrolls before it unsticks
      var travel = track.offsetHeight - window.innerHeight;
      if (travel <= 0) return;
      var p = (window.scrollY - reveal.offsetTop) / travel;
      reveal.style.setProperty('--p', Math.min(1, Math.max(0, p)).toFixed(4));
    };

    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(paint);
    };

    // only listen while the section is actually in view
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting === live) return;
        live = entry.isIntersecting;
        if (live) {
          window.addEventListener('scroll', onScroll, { passive: true });
          paint();
        } else {
          window.removeEventListener('scroll', onScroll);
        }
      });
    }).observe(reveal);

    window.addEventListener('resize', onScroll, { passive: true });
    paint();
  }
})();
