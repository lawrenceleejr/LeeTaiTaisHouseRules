/* Lee TaiTai's House Rules — scroll outro.

   A real rounded box, rendered as 3D geometry rather than faked from stacked
   CSS planes (which showed their slicing edge-on). The solid is the Minkowski
   sum of a box with a sphere, which is what gives a mahjong tile its shape:
   flat faces, a roll-over on all twelve edges, and spherical corners.

   The surface is swept as rings of a rounded-rect cross-section: at depth z
   the cross-section is the face rectangle eroded by inset(z), with its corner
   radius reduced to match, so the corners round in all three axes at once.
   Rings cluster in the roll-over where the curvature is.

   The body is convex, so back-face culling alone gives correct occlusion —
   visible faces never overlap, and no depth sorting is needed.
*/
(function () {
  'use strict';

  var section = document.getElementById('tile-reveal');
  if (!section) return;
  var canvas = section.querySelector('.trt-canvas');
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');
  var still = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- proportions of a real tile ----------
  // width 1, height 1.375, depth 0.76; one radius rounds every edge.
  var MH = 1.375, MD = 0.76, MR = 0.11;
  var GREEN_DEPTH = 0.2;      // back fifth is the green backing plate
  var FOCAL = 1200;           // matches the perspective used elsewhere

  var BONE = [246, 236, 214];
  var GREEN = [31, 109, 82];

  // ---------- mesh ----------
  // ring: cross-section at depth z, eroded by `inset`
  function ring(w, h, d, r, z, inset, corners) {
    var rr = Math.max(r - inset, 0);
    var ex = w / 2 - inset - rr;   // centres of the corner arcs
    var ey = h / 2 - inset - rr;
    var pts = [];
    var quads = [[ex, ey, 0], [-ex, ey, 90], [-ex, -ey, 180], [ex, -ey, 270]];
    for (var c = 0; c < 4; c++) {
      var cx = quads[c][0], cy = quads[c][1], a0 = quads[c][2] * Math.PI / 180;
      for (var k = 0; k <= corners; k++) {
        var a = a0 + (k / corners) * Math.PI / 2;
        pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a), z]);
      }
    }
    return pts;
  }

  function buildMesh(corners, rolls) {
    var w = 1, h = MH, d = MD, r = MR;
    var core = d / 2 - r;
    var rings = [];

    // back roll-over, flat core, front roll-over
    for (var i = rolls; i >= 0; i--) {
      var a = (i / rolls) * Math.PI / 2;
      rings.push(ring(w, h, d, r, -(core + r * Math.sin(a)), r * (1 - Math.cos(a)), corners));
    }
    for (var j = 0; j <= rolls; j++) {
      var b = (j / rolls) * Math.PI / 2;
      rings.push(ring(w, h, d, r, core + r * Math.sin(b), r * (1 - Math.cos(b)), corners));
    }

    var faces = [];
    for (var s = 0; s < rings.length - 1; s++) {
      var A = rings[s], B = rings[s + 1];
      for (var p = 0; p < A.length; p++) {
        var q = (p + 1) % A.length;
        faces.push([A[p], A[q], B[q], B[p]]);
      }
    }

    // the flat caps: a rounded box's end face is a plain rectangle
    var fx = w / 2 - r, fy = h / 2 - r, fz = d / 2;
    var front = [[-fx, -fy, fz], [fx, -fy, fz], [fx, fy, fz], [-fx, fy, fz]];
    var back = [[fx, -fy, -fz], [-fx, -fy, -fz], [-fx, fy, -fz], [fx, fy, -fz]];
    return { faces: faces, front: front, back: back };
  }

  var MESH = buildMesh(8, 9); // corner and roll-over segments

  // ---------- the glyph, pre-rendered once and mapped onto the front cap ----------
  var faceTex = null;
  function buildFaceTexture(px) {
    var fw = 1 - 2 * MR, fh = MH - 2 * MR;
    var c = document.createElement('canvas');
    c.width = Math.round(px);
    c.height = Math.round(px * fh / fw);
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, c.width * 0.4, c.height);
    grad.addColorStop(0, '#fffdf4');
    grad.addColorStop(1, '#f3e9d2');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    // the inset rule found on a real tile face
    g.strokeStyle = 'rgba(196,146,44,.45)';
    g.lineWidth = Math.max(2, c.width * 0.016);
    var m = c.width * 0.075, rad = c.width * 0.06;
    g.beginPath();
    if (g.roundRect) g.roundRect(m, m, c.width - 2 * m, c.height - 2 * m, rad);
    else g.rect(m, m, c.width - 2 * m, c.height - 2 * m);
    g.stroke();
    g.fillStyle = '#c0392b';
    g.font = '600 ' + Math.round(c.width * 0.78) + 'px "Noto Serif TC","Songti TC",serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('中', c.width / 2, c.height * 0.52);
    return c;
  }

  // affine-map one triangle of the texture onto the projected cap
  function drawTri(img, s, dpts, a, b, cc) {
    var sx0 = s[a][0], sy0 = s[a][1], sx1 = s[b][0], sy1 = s[b][1], sx2 = s[cc][0], sy2 = s[cc][1];
    var dx0 = dpts[a][0], dy0 = dpts[a][1], dx1 = dpts[b][0], dy1 = dpts[b][1],
        dx2 = dpts[cc][0], dy2 = dpts[cc][1];
    var den = sx0 * (sy2 - sy1) - sx1 * sy2 + sx2 * sy1 + (sx1 - sx2) * sy0;
    if (!den) return;
    // nudge each vertex out from the centroid so the two triangles overlap by
    // a hair — otherwise antialiasing leaves a seam along their shared diagonal
    var gx = (dx0 + dx1 + dx2) / 3, gy = (dy0 + dy1 + dy2) / 3;
    function out(x, y) {
      var vx = x - gx, vy = y - gy, l = Math.hypot(vx, vy) || 1;
      return [x + vx / l * 0.9, y + vy / l * 0.9];
    }
    var o0 = out(dx0, dy0), o1 = out(dx1, dy1), o2 = out(dx2, dy2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(o0[0], o0[1]); ctx.lineTo(o1[0], o1[1]); ctx.lineTo(o2[0], o2[1]); ctx.closePath();
    ctx.clip();
    ctx.transform(
      -(sy0 * (dx2 - dx1) - sy1 * dx2 + sy2 * dx1 + (sy1 - sy2) * dx0) / den,
      (sy1 * dy2 + sy0 * (dy1 - dy2) - sy2 * dy1 + (sy2 - sy1) * dy0) / den,
      (sx0 * (dx2 - dx1) - sx1 * dx2 + sx2 * dx1 + (sx1 - sx2) * dx0) / den,
      -(sx1 * dy2 + sx0 * (dy1 - dy2) - sx2 * dy1 + (sx2 - sx1) * dy0) / den,
      (sx0 * (sy2 * dx1 - sy1 * dx2) + sy0 * (sx1 * dx2 - sx2 * dx1) + (sx2 * sy1 - sx1 * sy2) * dx0) / den,
      (sx0 * (sy2 * dy1 - sy1 * dy2) + sy0 * (sx1 * dy2 - sx2 * dy1) + (sx2 * sy1 - sx1 * sy2) * dy0) / den
    );
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  // ---------- render ----------
  // y-up, matching model space: key light from upper-left, toward the viewer
  var LIGHT = (function () {
    var v = [-0.38, 0.62, 0.69];
    var n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
  })();

  var cw = 0, chh = 0, dpr = 1;

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (Math.abs(r.width - cw) < 0.5 && Math.abs(r.height - chh) < 0.5) return true;
    cw = r.width; chh = r.height;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(chh * dpr);
    faceTex = buildFaceTexture(Math.max(256, Math.min(768, cw * dpr * 0.8)));
    return true;
  }

  function intensity(nz, k) {
    // a touch of rim so the roll-over reads against the page
    return 0.38 + 0.8 * Math.max(0, k) + 0.09 * Math.pow(1 - Math.abs(nz), 3);
  }

  function shade(base, i) {
    return 'rgb(' + Math.min(255, base[0] * i | 0) + ','
      + Math.min(255, base[1] * i | 0) + ',' + Math.min(255, base[2] * i | 0) + ')';
  }

  function render(p) {
    if (!resize()) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, chh);

    // scale the model so the tile's width matches the layout box
    var unit = Math.min(cw / 1.9, chh / (MH * 1.45));
    var damp = 1 - p;

    var ry = (180 + p * 540) * Math.PI / 180;
    var rx = Math.cos(p * 720 * Math.PI / 180) * 17 * damp * Math.PI / 180;
    var rz = Math.sin(p * 900 * Math.PI / 180) * 15 * damp * Math.PI / 180;
    var tx = Math.sin(p * 540 * Math.PI / 180) * 0.05 * cw * damp;
    var ty = -(1 - p) * 0.12 * chh; // y-up, so the tile starts low and rises
    var tz = -980 + p * 1040;

    var cy = Math.cos(ry), sy = Math.sin(ry);
    var cx = Math.cos(rx), sx = Math.sin(rx);
    var cz = Math.cos(rz), sz = Math.sin(rz);

    // local → rotateZ → rotateX → rotateY, matching the CSS convention.
    // Stays y-up throughout; the flip to screen coords happens in project(),
    // so the space keeps its handedness and normals stay meaningful.
    function xform(v) {
      var x = v[0] * unit, y = v[1] * unit, z = v[2] * unit;
      var x1 = x * cz - y * sz, y1 = x * sz + y * cz, z1 = z;
      var y2 = y1 * cx - z1 * sx, z2 = y1 * sx + z1 * cx, x2 = x1;
      var x3 = x2 * cy + z2 * sy, z3 = -x2 * sy + z2 * cy, y3 = y2;
      return [x3 + tx, y3 + ty, z3 + tz];
    }

    function project(v) {
      var s = FOCAL / (FOCAL - v[2]);
      return [cw / 2 + v[0] * s, chh / 2 - v[1] * s, v[2]];
    }

    function poly(quad, base) {
      var v0 = xform(quad[0]), v1 = xform(quad[1]), v2 = xform(quad[2]), v3 = xform(quad[3]);
      var ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
      var bx = v3[0] - v0[0], by = v3[1] - v0[1], bz = v3[2] - v0[2];
      var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      var nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      // cull geometrically against the eye, which is unambiguous where a
      // winding test would depend on handedness
      var mx = (v0[0] + v1[0] + v2[0] + v3[0]) / 4;
      var my = (v0[1] + v1[1] + v2[1] + v3[1]) / 4;
      var mz = (v0[2] + v1[2] + v2[2] + v3[2]) / 4;
      var ex = -mx, ey = -my, ez = FOCAL - mz;
      var el = Math.hypot(ex, ey, ez) || 1;
      if (nx * (ex / el) + ny * (ey / el) + nz * (ez / el) <= 0) return null;
      var p0 = project(v0), p1 = project(v1), p2 = project(v2), p3 = project(v3);
      var lit = intensity(nz, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      var fill = shade(base, lit);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      // stroke the same colour to close antialiasing seams between facets
      ctx.strokeStyle = fill;
      ctx.lineWidth = 1;
      ctx.stroke();
      return { pts: [p0, p1, p2, p3], lit: lit };
    }

    // soft contact shadow, drawn before the solid
    var sc = FOCAL / (FOCAL - tz);
    ctx.save();
    ctx.globalAlpha = 0.3 * Math.max(0, Math.min(1, sc));
    var shx = cw / 2 + tx * sc, shy = chh / 2 - (ty - MH * 0.58 * unit) * sc;
    var sg = ctx.createRadialGradient(shx, shy, 0, shx, shy, unit * sc * 0.95);
    sg.addColorStop(0, 'rgba(62,48,18,.55)');
    sg.addColorStop(1, 'rgba(62,48,18,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, cw, chh);
    ctx.restore();

    var greenZ = -MD / 2 + GREEN_DEPTH * MD;
    for (var i = 0; i < MESH.faces.length; i++) {
      var q = MESH.faces[i];
      var zc = (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4;
      poly(q, zc <= greenZ ? GREEN : BONE);
    }
    poly(MESH.back, GREEN);

    var cap = poly(MESH.front, BONE);
    if (cap && faceTex) {
      var src = [[0, 0], [faceTex.width, 0], [faceTex.width, faceTex.height], [0, faceTex.height]];
      drawTri(faceTex, src, cap.pts, 0, 1, 2);
      drawTri(faceTex, src, cap.pts, 0, 2, 3);
      // light the printed face like every other facet, so it turns with the tile
      var dim = Math.max(0, Math.min(0.7, 1 - cap.lit));
      if (dim > 0.002) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cap.pts[0][0], cap.pts[0][1]);
        for (var c = 1; c < 4; c++) ctx.lineTo(cap.pts[c][0], cap.pts[c][1]);
        ctx.closePath();
        ctx.fillStyle = 'rgba(26,20,8,' + dim.toFixed(3) + ')';
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ---------- scroll progress ----------
  var track = section.querySelector('.tile-reveal-track');
  var ticking = false, live = false, last = -1;

  function progress() {
    var travel = track.offsetHeight - window.innerHeight;
    if (travel <= 0) return 1;
    return Math.min(1, Math.max(0, (window.scrollY - section.offsetTop) / travel));
  }

  function paint() {
    ticking = false;
    var p = progress();
    section.style.setProperty('--p', p.toFixed(4)); // the words key off this
    if (Math.abs(p - last) < 0.0005) return;
    last = p;
    render(p);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(paint);
  }

  section.classList.add('is-live'); // retires the static fallback

  if (still.matches) {
    // no tumble: show the finished tile, face on
    section.style.setProperty('--p', '1');
    var settle = function () { last = -1; render(1); };
    settle();
    window.addEventListener('resize', settle, { passive: true });
    return;
  }

  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting === live) return;
        live = en.isIntersecting;
        if (live) {
          window.addEventListener('scroll', onScroll, { passive: true });
          paint();
        } else {
          window.removeEventListener('scroll', onScroll);
        }
      });
    }).observe(section);
  } else {
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  window.addEventListener('resize', function () { last = -1; onScroll(); }, { passive: true });
  paint();

  // used to inspect a single frame
  section.seek = function (p) { last = -1; section.style.setProperty('--p', p); render(p); };
})();
