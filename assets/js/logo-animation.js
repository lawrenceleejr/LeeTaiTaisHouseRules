/* Lee TaiTai's House Rules — hero logo animation.

   Ported from the Claude Design handoff (logo-scene.jsx) to vanilla JS/DOM.
   Five scenes on a 9.9s loop: Shuffle → Stack → Reveal → Hold → Scatter.

   The wash is a real simulation, not keyframes: 30 tiles are colliding bodies
   on one table layer, shoved around by six travelling "palm" pushes that enter
   from the table edges. Everything else moves only because a pushed tile
   shoves its neighbours. The sim is deterministic and precomputed once, then
   sampled by authored time, so every frame is a pure function of T.

   Tiles are slabs: the top plate's silhouette is swept straight down the
   screen through EXT layers, so thickness reads correctly at any in-plane
   rotation. The whole table is a perspective-tilted plane.
*/
(function () {
  'use strict';

  var root = document.querySelector('.logo-anim');
  if (!root) return;

  var still = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (still.matches) return; // the static fallback in the markup stands

  // ---------- composition ----------
  var W = 1920, H = 1080, CX = 960, CY = 540;
  var TW = 196, TH = 262, DEPTH = 24, GAP = 26;
  var ROW_W = TW * 3 + GAP * 2;
  var ROW_X = (W - ROW_W) / 2;
  var ROW_Y = 268;
  var CHARS = ['李', '太', '太'];
  var EXT = 7;

  // scene cue times (seconds), from OM_SCENES in the handoff
  var CUES = { Shuffle: 0, Stack: 1.9, Reveal: 2.7, Hold: 4.8, Scatter: 8.8 };
  var TOTAL = 9.9;

  // ---------- easing ----------
  var E = {
    linear: function (t) { return t; },
    easeInQuad: function (t) { return t * t; },
    easeOutQuad: function (t) { return 1 - (1 - t) * (1 - t); },
    easeInOutQuad: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    easeInCubic: function (t) { return t * t * t; },
    easeOutCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    easeInOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    easeOutExpo: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    easeInOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // animate({from,to,start,end,ease})(t) — the handoff's tween helper
  function tween(from, to, start, end, ease, t) {
    if (end <= start) return t >= end ? to : from;
    var p = clamp((t - start) / (end - start), 0, 1);
    return from + (to - from) * (ease || E.linear)(p);
  }

  // ---------- the wash simulation ----------
  var N = 30, FPS = 60, SIM_SECS = 4;
  var WASH_SCALE = 0.5;
  // exact drawn half-extents of a wash tile (+ bevel margin), so resting
  // tiles visually touch rather than overlapping or floating apart
  var HW = TW * WASH_SCALE / 2 + 2;
  var HH = TH * WASH_SCALE / 2 + DEPTH / 2 + 4;
  var RMAX = Math.hypot(HW, HH); // broad-phase circle
  var BX0 = 120, BX1 = 1800, BY0 = 140, BY1 = 980;

  // each push is a wide palm entering from one side, travelling with its own
  // shove: [time, x, y, strength, direction, radius]
  var PUSHES = [
    [0.05, 260, 480, 5200, 0.0, 420],            // left palm sweeps right
    [0.50, 1660, 640, 5200, Math.PI, 440],       // right palm answers
    [0.95, 900, 880, 4800, -Math.PI / 2, 460],   // bottom pushes up
    [1.35, 1500, 260, 4600, Math.PI * 0.78, 430],// top-right shoves down-left
    [1.75, 380, 820, 4600, -Math.PI * 0.3, 430], // bottom-left shoves up-right
    [2.15, 960, 240, 4400, Math.PI / 2, 450]     // top pushes down
  ];

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var SIM = null;
  function buildSim() {
    var r = rng(20250824);
    var px = [], py = [], vx = [], vy = [], rot = [], om = [];
    var i, j, f, it, c, w;

    // Chaotic dense start that still terminates: jittered rows over the whole
    // table, then the solver relaxes any residual overlap before frame 0.
    var COLS = 6, ROWS = 5;
    var cw = (BX1 - BX0) / COLS, ch = (BY1 - BY0) / ROWS;
    var cells = [];
    for (c = 0; c < COLS; c++) for (w = 0; w < ROWS; w++) cells.push([c, w]);
    for (i = cells.length - 1; i > 0; i--) { // shuffle so N < cells is unbiased
      j = Math.floor(r() * (i + 1));
      var tmp = cells[i]; cells[i] = cells[j]; cells[j] = tmp;
    }
    for (i = 0; i < N; i++) {
      var cell = cells[i % cells.length];
      px.push(clamp(BX0 + (cell[0] + 0.5) * cw + (r() - 0.5) * cw * 0.55, BX0 + HW, BX1 - HW));
      py.push(clamp(BY0 + (cell[1] + 0.5) * ch + (r() - 0.5) * ch * 0.55, BY0 + HH, BY1 - HH));
      vx.push(0); vy.push(0);
      rot.push((r() - 0.5) * 36); om.push(0);
    }

    var nFrames = SIM_SECS * FPS;
    var frames = new Float32Array(nFrames * N * 3);
    var dt = 1 / FPS;
    var D2R = Math.PI / 180;

    for (f = 0; f < nFrames; f++) {
      var t = f * dt;

      for (i = 0; i < N; i++) {
        for (var p = 0; p < PUSHES.length; p++) {
          var pu = PUSHES[p];
          var age = t - pu[0];
          if (age < 0 || age > 0.5) continue;
          var dir = pu[4];
          // the palm travels with its own push
          var hx = pu[1] + Math.cos(dir) * age * 900;
          var hy = pu[2] + Math.sin(dir) * age * 900;
          var dist = Math.hypot(px[i] - hx, py[i] - hy) / pu[5];
          var wgt = Math.exp(-dist * dist) * (1 - age / 0.5);
          vx[i] += Math.cos(dir) * pu[3] * wgt * dt;
          vy[i] += Math.sin(dir) * pu[3] * wgt * dt;
        }
        vx[i] *= 0.975; vy[i] *= 0.975; om[i] *= 0.90;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; rot[i] += om[i] * dt;
      }

      // walls first, pair separation last, so tiles never end a step overlapped
      for (it = 0; it < 6; it++) {
        for (i = 0; i < N; i++) {
          var ci0 = Math.cos(rot[i] * D2R), si0 = Math.sin(rot[i] * D2R);
          var ex = HW * Math.abs(ci0) + HH * Math.abs(si0);
          var ey = HW * Math.abs(si0) + HH * Math.abs(ci0);
          if (px[i] < BX0 + ex) { px[i] = BX0 + ex; vx[i] = Math.abs(vx[i]) * 0.86; }
          if (px[i] > BX1 - ex) { px[i] = BX1 - ex; vx[i] = -Math.abs(vx[i]) * 0.86; }
          if (py[i] < BY0 + ey) { py[i] = BY0 + ey; vy[i] = Math.abs(vy[i]) * 0.86; }
          if (py[i] > BY1 - ey) { py[i] = BY1 - ey; vy[i] = -Math.abs(vy[i]) * 0.86; }
        }
        for (i = 0; i < N; i++) {
          var ci = Math.cos(rot[i] * D2R), si = Math.sin(rot[i] * D2R);
          for (j = i + 1; j < N; j++) {
            var ddx = px[j] - px[i], ddy = py[j] - py[i];
            if (ddx * ddx + ddy * ddy >= 4 * RMAX * RMAX) continue;
            var cj = Math.cos(rot[j] * D2R), sj = Math.sin(rot[j] * D2R);
            // SAT over both rectangles' axes
            var axes = [[ci, si], [-si, ci], [cj, sj], [-sj, cj]];
            var ov = Infinity, ax = 1, ay = 0, sep = false;
            for (var k = 0; k < 4; k++) {
              var lx = axes[k][0], ly = axes[k][1];
              var ri = HW * Math.abs(lx * ci + ly * si) + HH * Math.abs(-lx * si + ly * ci);
              var rj = HW * Math.abs(lx * cj + ly * sj) + HH * Math.abs(-lx * sj + ly * cj);
              var d = ddx * lx + ddy * ly;
              var o = ri + rj - Math.abs(d);
              if (o <= 0) { sep = true; break; }
              if (o < ov) { ov = o; ax = d >= 0 ? lx : -lx; ay = d >= 0 ? ly : -ly; }
            }
            if (sep) continue;
            px[i] -= ax * ov / 2; py[i] -= ay * ov / 2;
            px[j] += ax * ov / 2; py[j] += ay * ov / 2;
            var rel = (vx[j] - vx[i]) * ax + (vy[j] - vy[i]) * ay;
            if (rel < 0) {
              var imp = -rel * 0.88;
              vx[i] -= ax * imp; vy[i] -= ay * imp;
              vx[j] += ax * imp; vy[j] += ay * imp;
              if (rel < -60) {
                var spin = ((vx[j] - vx[i]) * -ay + (vy[j] - vy[i]) * ax) * 0.10;
                om[i] -= spin; om[j] += spin;
              }
            }
          }
        }
      }

      var base = f * N * 3;
      for (i = 0; i < N; i++) {
        frames[base + i * 3] = px[i];
        frames[base + i * 3 + 1] = py[i];
        frames[base + i * 3 + 2] = rot[i];
      }
    }
    return frames;
  }

  function washPos(i, T, out) {
    var last = SIM_SECS * FPS - 1;
    var ft = clamp(T * FPS, 0, last);
    var f0 = Math.floor(ft), f1 = Math.min(f0 + 1, last), k = ft - f0;
    var a = f0 * N * 3 + i * 3, b = f1 * N * 3 + i * 3;
    out.x = (SIM[a] + (SIM[b] - SIM[a]) * k) - TW / 2;
    out.y = (SIM[a + 1] + (SIM[b + 1] - SIM[a + 1]) * k) - TH / 2;
    out.rot = SIM[a + 2] + (SIM[b + 2] - SIM[a + 2]) * k;
    return out;
  }

  var LOGO_IDX = [11, 13, 20];

  // ---------- DOM ----------
  var stage = document.createElement('div');
  stage.className = 'la-stage';

  var table = document.createElement('div');
  table.className = 'la-table';

  var plane = document.createElement('div');
  plane.className = 'la-plane';
  table.appendChild(plane);

  var tiles = [];
  for (var n = 0; n < N; n++) {
    var slot = LOGO_IDX.indexOf(n);
    var el = document.createElement('div');
    el.className = 'la-tile';

    var shadow = document.createElement('div');
    shadow.className = 'la-shadow';
    el.appendChild(shadow);

    for (var e = 0; e < EXT; e++) {
      var ext = document.createElement('div');
      ext.className = 'la-ext' + (e === 0 ? ' la-ext-deep' : '');
      ext.style.setProperty('--ty', (DEPTH * (EXT - e) / EXT) + 'px');
      el.appendChild(ext);
    }

    var plate = document.createElement('div');
    plate.className = 'la-plate';

    var back = document.createElement('div');
    back.className = 'la-back';
    plate.appendChild(back);

    var face = document.createElement('div');
    face.className = 'la-face' + (slot === 0 ? ' la-face-hero' : '');
    var pip = document.createElement('span');
    pip.className = 'la-pip';
    face.appendChild(pip);
    var glyph = document.createElement('span');
    glyph.className = 'la-glyph';
    glyph.lang = 'zh-Hant';
    glyph.textContent = slot >= 0 ? CHARS[slot] : '一';
    face.appendChild(glyph);
    plate.appendChild(face);

    var edge = document.createElement('div');
    edge.className = 'la-edgeband';
    plate.appendChild(edge);

    var shade = document.createElement('div');
    shade.className = 'la-shadeband';
    plate.appendChild(shade);

    el.appendChild(plate);
    plane.appendChild(el);
    tiles.push({ el: el, shadow: shadow, plate: plate, face: face, back: back, edge: edge, shade: shade, slot: slot });
  }

  // wordmark
  var lockup = document.createElement('div');
  lockup.className = 'la-wordmark';
  lockup.style.top = (ROW_Y + TH + DEPTH + 46) + 'px';

  var kickerRow = document.createElement('div');
  kickerRow.className = 'la-kicker-row';
  var ruleL = document.createElement('div');
  ruleL.className = 'la-rule la-rule-l';
  var ruleR = document.createElement('div');
  ruleR.className = 'la-rule la-rule-r';
  var kicker = document.createElement('div');
  kicker.className = 'la-kicker';
  kickerRow.appendChild(ruleL);
  kickerRow.appendChild(kicker);
  kickerRow.appendChild(ruleR);

  var sign = document.createElement('div');
  sign.className = 'la-sign';
  lockup.appendChild(kickerRow);
  lockup.appendChild(sign);

  // letter rows: each character rises and un-rotates on its own beat
  function makeLetters(host, text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === ' ') {
        var sp = document.createElement('span');
        sp.className = 'la-space';
        host.appendChild(sp);
        continue;
      }
      var mask = document.createElement('span');
      mask.className = 'la-mask';
      var inner = document.createElement('span');
      inner.className = 'la-letter';
      inner.textContent = ch;
      mask.appendChild(inner);
      host.appendChild(mask);
      out.push(inner);
    }
    return out;
  }
  var kickerLetters = makeLetters(kicker, "LEE TAITAI'S");
  var signLetters = makeLetters(sign, 'HOUSE RULES');

  table.appendChild(lockup);
  stage.appendChild(table);

  // ---------- fit the 1920×1080 composition to the container ----------
  function fit() {
    stage.style.transform = 'scale(' + (root.clientWidth / W) + ')';
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(root);
  else window.addEventListener('resize', fit);

  // ---------- frame ----------
  var wp = { x: 0, y: 0, rot: 0 };
  var home = { x: 0, y: 0, rot: 0 };

  function slamAt(i) { return CUES.Reveal + i * 0.3 + 0.22; } // moment of impact

  function draw(T) {
    // camera: settles in, kicks on each slam, pulls back for the loop seam
    var camIn = tween(1.08, 1.0, 0, CUES.Hold, E.easeInOutCubic, T);
    var camOut = tween(0, 0.08, CUES.Scatter, TOTAL, E.easeInQuad, T);
    var shake = 0;
    for (var s = 0; s < 3; s++) {
      var ds = T - slamAt(s);
      if (ds >= 0 && ds < 0.45) shake += Math.sin(ds * 58) * 13 * Math.exp(-ds * 12);
    }
    var tilt = tween(26, 7, CUES.Stack - 0.2, CUES.Reveal + 0.2, E.easeInOutCubic, T)
      + tween(0, 19, TOTAL - 0.55, TOTAL, E.easeInOutSine, T);
    var lockupY = tween(0, -12, CUES.Hold, TOTAL, E.easeInOutSine, T);
    var outP = tween(0, 1, CUES.Scatter, CUES.Scatter + 0.4, E.easeInQuad, T);
    var rule = tween(0, 1, CUES.Reveal + 1.1, CUES.Reveal + 1.6, E.easeInOutCubic, T);

    table.style.transform = 'scale(' + (camIn + camOut) + ') translateY(' + shake + 'px)';
    plane.style.transform = 'translateY(' + (-(tilt / 26) * 86) + 'px) scale('
      + (1 - (tilt / 26) * 0.11) + ') rotateX(' + tilt + 'deg)';

    for (var i = 0; i < N; i++) {
      var t = tiles[i];
      var slot = t.slot;
      var isLogo = slot >= 0;

      washPos(i, T, wp);
      var x = wp.x, y = wp.y, rot = wp.rot;
      var flipDeg = 180, sx = WASH_SCALE, sy = WASH_SCALE, lift = 0, opacity = 1;

      if (isLogo) {
        // gather into the row
        var g = tween(0, 1, CUES.Stack, CUES.Stack + 0.6 + slot * 0.05, E.easeInOutCubic, T);
        var tx = ROW_X + slot * (TW + GAP);
        x = wp.x + (tx - wp.x) * g;
        y = wp.y + (ROW_Y - wp.y) * g;
        rot = wp.rot * (1 - g);
        sx = sy = WASH_SCALE + (1 - WASH_SCALE) * g;

        // slam-flip: lift, turn over, drive it down onto the table
        var sAt = slamAt(slot);
        var up = tween(0, 1, sAt - 0.3, sAt - 0.09, E.easeOutQuad, T);
        var down = tween(0, 1, sAt - 0.09, sAt, E.easeInQuad, T);
        lift = (up - down) * 128;
        sx = sy = sx + (up - down) * 0.09;
        flipDeg = tween(180, 0, sAt - 0.3, sAt - 0.05, E.easeInOutQuad, T);
        rot += (up - down) * (slot === 1 ? -5 : slot === 0 ? 4 : -3);

        // impact squash
        var d = T - sAt;
        if (d >= 0 && d < 0.5) {
          var q = Math.sin(d * 34) * 0.075 * Math.exp(-d * 10);
          sx += q; sy -= q;
        }
        // breathing hold
        if (T > CUES.Hold) {
          var b = Math.sin((T - CUES.Hold) * 1.7) * 0.005;
          sx += b; sy += b;
        }
        // scatter
        var so = CUES.Scatter + (2 - slot) * 0.07;
        var sp = tween(0, 1, so, so + 0.55, E.easeInCubic, T);
        x += sp * (slot === 0 ? -940 : slot === 1 ? 130 : 1010);
        y += sp * (slot === 1 ? 1040 : 540);
        rot += sp * (slot === 0 ? -72 : slot === 1 ? 22 : 84);
        opacity = 1 - clamp(sp * 1.6, 0, 1);
      } else {
        // the rest are swept off the table when the hand gathers the three
        var pOff = tween(0, 1, CUES.Stack, CUES.Stack + 0.5, E.easeInQuad, T);
        var away = Math.atan2(wp.y + TH / 2 - CY, wp.x + TW / 2 - CX);
        x += Math.cos(away) * pOff * 1500;
        y += Math.sin(away) * pOff * 1100;
        rot += pOff * (i % 2 ? 70 : -70);
        opacity = 1 - clamp(pOff * 1.5, 0, 1);
      }

      // loop seam: over the last beat every tile flies back in from off-frame
      // and lands exactly on its T=0 churn position, face-down
      var back = tween(0, 1, TOTAL - 0.55, TOTAL, E.easeOutCubic, T);
      if (back > 0) {
        washPos(i, 0, home);
        var aw = Math.atan2(home.y + TH / 2 - CY, home.x + TW / 2 - CX);
        var ox = home.x + Math.cos(aw) * 1500, oy = home.y + Math.sin(aw) * 1100;
        x = ox + (home.x - ox) * back;
        y = oy + (home.y - oy) * back;
        rot = home.rot + (1 - back) * (i % 2 ? 90 : -90);
        flipDeg = 180; sx = WASH_SCALE; sy = WASH_SCALE; lift = 0;
        opacity = clamp(back * 3, 0, 1);
      }

      // ---- paint ----
      var kf = Math.cos(flipDeg * Math.PI / 180);
      var faceUp = kf > 0;
      var shade = (1 - Math.abs(kf)) * 0.6;
      // never let the slab collapse to nothing: at 90° you see its edge
      var squeeze = Math.max(Math.abs(kf), (DEPTH + 8) / TW);
      var edge = clamp((1 - Math.abs(kf) - 0.4) / 0.45, 0, 1);

      var el = t.el;
      el.style.transform = 'translate(' + x + 'px,' + (y - lift) + 'px)';
      el.style.opacity = opacity;
      el.style.zIndex = Math.round(y + lift * 10);
      // one shared plate transform drives the top plate and every extrusion layer
      el.style.setProperty('--plate', 'rotate(' + rot + 'deg) scale(' + (sx * squeeze) + ',' + sy + ')');
      t.shadow.style.setProperty('--ty', (DEPTH + 12 + lift * 0.35) + 'px');
      t.shadow.style.boxShadow = '0 ' + (12 + lift * 0.5) + 'px ' + (20 + lift * 0.7)
        + 'px ' + (4 + lift * 0.2) + 'px rgba(4,18,13,.45)';
      t.face.style.display = faceUp ? '' : 'none';
      t.back.style.display = faceUp ? 'none' : '';
      t.edge.style.opacity = edge;
      t.shade.style.opacity = shade * (1 - edge);
    }

    // wordmark
    lockup.style.opacity = 1 - outP;
    lockup.style.transform = 'translateY(' + (lockupY + outP * 90) + 'px)';
    ruleL.style.width = (rule * 150) + 'px';
    ruleR.style.width = (rule * 150) + 'px';

    paintLetters(kickerLetters, T, CUES.Reveal + 1.05, 0.022, 0.5, 34);
    paintLetters(signLetters, T, CUES.Reveal + 1.2, 0.035, 0.62, 128);
  }

  function paintLetters(letters, T, start, step, dur, size) {
    for (var i = 0; i < letters.length; i++) {
      var s = start + i * step;
      var p = tween(0, 1, s, s + dur, E.easeOutExpo, T);
      letters[i].style.transform = 'translateY(' + ((1 - p) * size * 1.05)
        + 'px) rotate(' + ((1 - p) * -6) + 'deg)';
      letters[i].style.opacity = clamp(p * 2, 0, 1);
    }
  }

  // ---------- run ----------
  var raf = 0, t0 = 0, running = false;

  function frame(now) {
    if (!running) return;
    if (!t0) t0 = now;
    draw(((now - t0) / 1000) % TOTAL);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    t0 = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function begin() {
    SIM = buildSim();
    root.classList.add('is-live'); // hides the static fallback
    root.appendChild(stage);
    fit();
    draw(0);
    // pause on an exact frame — used to inspect a single scene
    root.seek = function (T) { stop(); draw(T); };
    // only burn frames while the hero is actually on screen
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { en.isIntersecting ? start() : stop(); });
      }).observe(root);
    } else {
      start();
    }
    document.addEventListener('visibilitychange', function () {
      document.hidden ? stop() : start();
    });
  }

  // building the sim is ~4M SAT tests; keep it off the critical path
  if (window.requestIdleCallback) requestIdleCallback(begin, { timeout: 1500 });
  else setTimeout(begin, 1);
})();
