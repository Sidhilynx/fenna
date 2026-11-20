/* The living pixel fields. Each section with data-field has a canvas behind
   its words; one requestAnimationFrame loop draws the scenes that are on
   screen and sleeps when none are, or when the tab is hidden. Every scene is
   a grid of dots that answers the pointer in its own way:
     hero       dots light up like a dot matrix around the pointer, with an
                afterglow; a large bot face is built from pixels, its eyes
                follow the pointer, and pixels scatter when you touch it
     glow       the dot matrix alone, for the smaller pages
     construct  pixels assemble into a small app window that follows the pointer
     scatter    pixels are pushed aside around the pointer and settle back
     reveal     a dithered pixel sunset rises from the bottom; the pointer
                uncovers more of it
   Positions are drawn in whole pixels. Under prefers-reduced-motion every
   scene draws one still frame and nothing follows the pointer. */
(function () {
  var faces = window.FENNA_FACES;
  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var scheme = window.matchMedia("(prefers-color-scheme: light)");

  function theme() {
    var set = root.getAttribute("data-theme");
    if (set === "light" || set === "dark") return set;
    return scheme.matches ? "light" : "dark";
  }

  /* ── One loop for every scene ─────────────────────────────────────── */
  var scenes = [];
  var raf = 0;
  var last = 0;

  var inFrame = false;
  var again = false;

  function frame(t) {
    var dt = last ? Math.min(64, t - last) : 16;
    last = t;
    var live = false;
    var i;
    inFrame = true;
    again = false;
    try {
      for (i = 0; i < scenes.length; i++) if (scenes[i].on) scenes[i].measure();
      for (i = 0; i < scenes.length; i++) if (scenes[i].on && scenes[i].frame(t, dt)) live = true;
    } finally {
      inFrame = false;
    }
    raf = 0;
    if ((live || again) && !document.hidden) raf = window.requestAnimationFrame(frame);
    else last = 0;
  }

  /* Asks for a frame. A scene that asks while the loop is drawing gets the next one, never a second loop. */
  function wake() {
    if (inFrame) { again = true; return; }
    if (!raf && !document.hidden) raf = window.requestAnimationFrame(frame);
  }

  function add(scene) {
    scene.on = false;
    scenes.push(scene);
    new IntersectionObserver(function (entries) {
      scene.on = entries[entries.length - 1].isIntersecting;
      if (scene.on) wake();
    }, { rootMargin: "64px 0px" }).observe(scene.el);
  }

  document.addEventListener("visibilitychange", wake);
  reduced.addEventListener("change", wake);

  /* ── The pointer, in viewport coordinates ─────────────────────────── */
  var P = { x: -1e5, y: -1e5, in: false, taps: [] };
  window.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch") return;
    P.x = e.clientX;
    P.y = e.clientY;
    P.in = true;
    wake();
  }, { passive: true });
  document.addEventListener("mouseout", function (e) { if (!e.relatedTarget) P.in = false; });
  window.addEventListener("blur", function () { P.in = false; });
  window.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse") return;
    P.taps.push({ x: e.clientX, y: e.clientY + window.scrollY, t: performance.now() });
    if (P.taps.length > 4) P.taps.shift();
    wake();
  }, { passive: true });

  /* ── Small helpers ────────────────────────────────────────────────── */
  function hash(i, j, s) {
    var n = (i * 374761393 + j * 668265263 + s * 2147483647) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function bayer(i, j) { return (BAYER[(j & 3) * 4 + (i & 3)] + 0.5) / 16; }
  /* Dot strength per level and dot size per level (CSS px). */
  var ALPHA = [0, 0.1, 0.17, 0.3, 0.5, 0.78];
  var SIZE = [0, 2, 2, 4, 4, 6];

  /* ── A field scene ────────────────────────────────────────────────── */
  function Field(host) {
    var canvas = host.querySelector("canvas.field");
    var ctx = canvas.getContext("2d");
    var mode = host.getAttribute("data-field");
    var scene = { el: canvas };
    var w = 0, h = 0, dpr = 1, G = 12, cols = 0, rows = 0;
    var base = new Uint8Array(0);
    var heat = new Uint8Array(0);
    var hot = [];
    var flick = [];
    var rect = { left: 0, top: 0 };
    var ink = "#ededed";
    var dotA = 1;
    var lastTick = 0;
    var buckets = [[], [], [], [], [], []];
    var ripples = [];
    var seenTap = 0;
    var hero = mode === "hero" ? HeroFace(host) : null;
    var ghost = { x: 0, y: 0, tx: 0, ty: 0, p: 0, want: 0, step: 0, until: 0 };
    var push = { x: 0, y: 0, s: 0 };
    var reveal = mode === "reveal" ? Reveal(host) : null;

    function colours() {
      var s = getComputedStyle(root);
      ink = s.getPropertyValue("--dot").trim() || "#ededed";
      dotA = parseFloat(s.getPropertyValue("--dot-a")) || 1;
      if (hero) hero.colours();
      if (reveal) reveal.paint(w, h, G, dpr, cols, rows);
    }

    function layout() {
      w = host.clientWidth;
      h = host.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      G = w < 600 ? 10 : 12;
      cols = Math.ceil(w / G);
      rows = Math.ceil(h / G);
      base = new Uint8Array(cols * rows);
      heat = new Uint8Array(cols * rows);
      hot = [];
      flick = [];
      var density = { hero: 0.3, glow: 0.26, construct: 0.22, scatter: 0.26, reveal: 0.18 }[mode] || 0.2;
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          var r = hash(i, j, 7);
          if (r < density) {
            base[j * cols + i] = r < density * 0.16 ? 2 : 1;
            if (hash(i, j, 3) < 0.05) flick.push(j * cols + i);
          }
        }
      }
      if (hero) hero.layout(canvas, G);
      if (reveal) reveal.layout(w, h, G, dpr, cols, rows);
      colours();
      draw(performance.now(), false, 0, 0);
      wake();
    }

    function setHeat(idx, lvl) {
      if (heat[idx] < lvl) {
        if (!heat[idx]) hot.push(idx);
        heat[idx] = lvl;
      }
    }

    function glowAt(px, py, R, top) {
      var i0 = Math.max(0, Math.floor((px - R) / G)), i1 = Math.min(cols - 1, Math.ceil((px + R) / G));
      var j0 = Math.max(0, Math.floor((py - R) / G)), j1 = Math.min(rows - 1, Math.ceil((py + R) / G));
      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var dx = i * G + G / 2 - px, dy = j * G + G / 2 - py;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < R) setHeat(j * cols + i, Math.ceil((1 - d / R) * top));
        }
      }
    }

    function ring(px, py, r) {
      var band = G * 1.2;
      var i0 = Math.max(0, Math.floor((px - r - band) / G)), i1 = Math.min(cols - 1, Math.ceil((px + r + band) / G));
      var j0 = Math.max(0, Math.floor((py - r - band) / G)), j1 = Math.min(rows - 1, Math.ceil((py + r + band) / G));
      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var dx = i * G + G / 2 - px, dy = j * G + G / 2 - py;
          if (Math.abs(Math.sqrt(dx * dx + dy * dy) - r) < band) setHeat(j * cols + i, 4);
        }
      }
    }

    function tick() {
      for (var k = 0; k < flick.length; k++) {
        var c = flick[k];
        base[c] = (hash(c, (lastTick / 110) | 0, 11) * 4) | 0;
      }
      var keep = [];
      for (k = 0; k < hot.length; k++) {
        if (heat[hot[k]] > 0) heat[hot[k]]--;
        if (heat[hot[k]] > 0) keep.push(hot[k]);
      }
      hot = keep;
    }

    function dot(x, y, lvl) {
      buckets[lvl].push(x, y);
    }

    function flush() {
      for (var l = 1; l < 6; l++) {
        var b = buckets[l];
        if (!b.length) continue;
        var s = Math.max(1, Math.round(SIZE[l] * dpr));
        ctx.globalAlpha = Math.min(1, ALPHA[l] * dotA);
        ctx.beginPath();
        for (var k = 0; k < b.length; k += 2) ctx.rect(Math.round(b[k] * dpr - s / 2), Math.round(b[k + 1] * dpr - s / 2), s, s);
        ctx.fill();
        b.length = 0;
      }
      ctx.globalAlpha = 1;
    }

    /* The window that construct mode assembles: frame, title bar, two lines of content, a button. */
    function ghostCells(gw, gh) {
      var out = [];
      var i;
      for (i = 0; i < gw; i++) out.push([i, 0, 5]);
      for (i = 1; i < gh; i++) out.push([gw - 1, i, 5]);
      for (i = gw - 2; i >= 0; i--) out.push([i, gh - 1, 5]);
      for (i = gh - 2; i > 0; i--) out.push([0, i, 5]);
      for (i = 1; i < gw - 1; i++) out.push([i, 1, 3]);
      for (i = 2; i < Math.min(gw - 2, 8); i++) out.push([i, 3, 2]);
      for (i = 2; i < Math.min(gw - 4, 6); i++) out.push([i, 4, 2]);
      out.push([gw - 4, gh - 3, 4], [gw - 3, gh - 3, 4]);
      return out;
    }

    function draw(t, inside, px, py) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (reveal) reveal.drawBand(ctx);
      ctx.fillStyle = ink;
      var still = reduced.matches;
      var gw = w < 600 ? 9 : 12, gh = w < 600 ? 7 : 8;
      var gx0 = Math.round(ghost.x), gy0 = Math.round(ghost.y);
      var hideGhost = mode === "construct" && ghost.p > 0.05;
      var i, j, c, lvl;
      for (j = 0; j < rows; j++) {
        for (i = 0; i < cols; i++) {
          c = j * cols + i;
          lvl = base[c];
          var hv = heat[c];
          if (mode === "reveal") {
            if (hv && reveal.cell(ctx, i, j, hv)) continue;
            if (reveal.inBand(i, j)) continue;
          } else if (hv) lvl = Math.max(lvl, hv + 1);
          if (!lvl) continue;
          if (hideGhost && i >= gx0 && i < gx0 + gw && j >= gy0 && j < gy0 + gh) continue;
          var x = i * G + G / 2, y = j * G + G / 2;
          if (mode === "scatter" && push.s > 0.02) {
            var dx = x - push.x, dy = y - push.y, d = Math.sqrt(dx * dx + dy * dy), R = 170;
            if (d < R && d > 0.01) {
              var f = (1 - d / R);
              var m = f * f * 30 * push.s;
              x += Math.round((dx / d) * m / 2) * 2;
              y += Math.round((dy / d) * m / 2) * 2;
              lvl = Math.min(4, lvl + 1);
            }
          }
          dot(x, y, lvl);
        }
      }
      if (mode === "construct" && ghost.p > 0) {
        var cells = ghostCells(gw, gh);
        var perim = 2 * (gw + gh) - 4;
        var shown = Math.floor(ghost.p * (cells.length + 6));
        for (var k = 0; k < cells.length && k < shown; k++) {
          var cc = cells[k];
          if (k >= perim && ghost.p < 0.7) break;
          dot((gx0 + cc[0]) * G + G / 2, (gy0 + cc[1]) * G + G / 2, cc[2]);
        }
      }
      flush();
      if (hero) hero.draw(ctx, dpr, t, still, inside, px, py);
    }

    scene.measure = function () { rect = canvas.getBoundingClientRect(); };

    scene.frame = function (t, dt) {
      var still = reduced.matches;
      if (still) {
        for (var z = 0; z < hot.length; z++) heat[hot[z]] = 0;
        hot = [];
        ghost.p = 0;
        push.s = 0;
        draw(t, false, 0, 0);
        return false;
      }
      var px = P.x - rect.left, py = P.y - rect.top;
      var inside = P.in && px >= 0 && py >= 0 && px <= w && py <= h;
      if (t - lastTick >= 110) { lastTick = t; tick(); }

      /* Taps on touch screens: a ring of lit dots, and the scene's own answer. */
      for (var q = 0; q < P.taps.length; q++) {
        var tap = P.taps[q];
        if (tap.t <= seenTap) continue;
        seenTap = tap.t;
        var tx = tap.x - rect.left, ty = tap.y - window.scrollY - rect.top;
        if (tx < 0 || ty < 0 || tx > w || ty > h) continue;
        ripples.push({ x: tx, y: ty, t: tap.t });
        if (hero) hero.poke(tx, ty, t);
        if (mode === "construct") { ghost.x = ghost.tx = Math.round(tx / G) - 4; ghost.y = ghost.ty = Math.round(ty / G) - 3; ghost.until = t + 1600; }
        if (mode === "scatter") { push.x = tx; push.y = ty; push.s = 1; }
      }
      var live = [];
      for (q = 0; q < ripples.length; q++) {
        var rp = ripples[q], age = t - rp.t;
        if (age > 700) continue;
        if (mode !== "construct") ring(rp.x, rp.y, Math.floor(age * 0.42 / G) * G);
        live.push(rp);
      }
      ripples = live;

      if (mode === "hero" && inside) glowAt(px, py, 132, 4);
      if (mode === "glow" && inside) glowAt(px, py, 110, 3);
      if (mode === "reveal" && inside) glowAt(px, py, 150, 4);
      if (mode === "construct") {
        var gw = w < 600 ? 9 : 12, gh = w < 600 ? 7 : 8;
        ghost.want = inside || t < ghost.until ? 1 : 0;
        if (inside) {
          ghost.tx = Math.max(0, Math.min(cols - gw, Math.round(px / G) - Math.floor(gw / 2)));
          ghost.ty = Math.max(0, Math.min(rows - gh, Math.round(py / G) - 2));
          if (ghost.p === 0) { ghost.x = ghost.tx; ghost.y = ghost.ty; }
        }
        if (t - ghost.step > 34) {
          ghost.step = t;
          ghost.x += Math.sign(ghost.tx - ghost.x);
          ghost.y += Math.sign(ghost.ty - ghost.y);
        }
        ghost.p = Math.max(0, Math.min(1, ghost.p + (ghost.want ? 1 : -1.4) * dt / 650));
      }
      if (mode === "scatter") {
        if (inside) {
          push.x += Math.round((px - push.x) * 0.35);
          push.y += Math.round((py - push.y) * 0.35);
          if (push.s === 0) { push.x = px; push.y = py; }
        }
        push.s = Math.max(0, Math.min(1, push.s + (inside ? 1 : -0.8) * dt / 400));
      }
      draw(t, inside, px, py);
      return true;
    };

    new ResizeObserver(layout).observe(host);
    if (document.fonts) document.fonts.ready.then(layout);
    window.addEventListener("fenna-theme", function () { colours(); draw(performance.now(), false, 0, 0); wake(); });
    reduced.addEventListener("change", function () { if (hero) hero.layout(canvas, G); draw(performance.now(), false, 0, 0); });
    add(scene);
    return scene;
  }

  /* ── The hero's face, built from pixels ───────────────────────────── */
  function HeroFace(host) {
    var slot = host.querySelector("[data-face-slot]");
    var api = {};
    var U = 20, ox = 0, oy = 0, G = 12, cw = 0, ch = 0;
    var parts = [];
    var debris = [];
    var avatar = "crate", colour = "ochre";
    var body = "#d0a24c", shade = "#a07a2e";
    var blinkAt = 0, blinkUntil = 0;
    var pokes = [];
    var built = false;

    api.colours = function () {
      var set = faces.colors[theme()][colour] || ["#a8a29a", "#7d776f"];
      body = set[0];
      shade = set[1];
    };

    function homes() {
      var sprite = faces.sprites[avatar];
      var out = [];
      sprite.rects.forEach(function (r) {
        for (var y = r[1]; y < r[1] + r[3]; y++) for (var x = r[0]; x < r[0] + r[2]; x++) out.push({ cx: x, cy: y, k: r[4] });
      });
      return out;
    }

    function make(assemble, from) {
      var now = performance.now();
      parts = homes().map(function (p) {
        var hx = ox + p.cx * U, hy = oy + p.cy * U;
        var sx = hx, sy = hy;
        if (assemble) {
          var a = Math.random() * Math.PI * 2, r = (0.35 + Math.random() * 0.65) * Math.max(cw, ch) * 0.5;
          sx = Math.round((from ? from.x : hx) + Math.cos(a) * r);
          sy = Math.round((from ? from.y : hy) + Math.sin(a) * r * 0.7);
          sx = Math.max(0, Math.min(cw - G, Math.round(sx / G) * G));
          sy = Math.max(0, Math.min(ch - G, Math.round(sy / G) * G));
        }
        return { cx: p.cx, cy: p.cy, k: p.k, hx: hx, hy: hy, x: sx, y: sy, vx: 0, vy: 0, at: assemble ? now + (15 - p.cy) * 24 + Math.random() * 120 : 0 };
      });
      built = !assemble;
    }

    api.layout = function (canvas, grid) {
      G = grid;
      cw = canvas.clientWidth;
      ch = canvas.clientHeight;
      var hr = canvas.getBoundingClientRect(), sr = slot.getBoundingClientRect();
      U = Math.max(8, Math.floor(sr.width / 16));
      ox = Math.round(sr.left - hr.left + (sr.width - U * 16) / 2);
      oy = Math.round(sr.top - hr.top + (sr.height - U * 16) / 2);
      make(!reduced.matches && !parts.length, null);
      if (built || reduced.matches) make(false, null);
      else parts.forEach(function (p) { p.hx = ox + p.cx * U; p.hy = oy + p.cy * U; });
    };

    api.set = function (a, c) {
      if (!faces.sprites[a]) return;
      var still = reduced.matches;
      if (!still) {
        debris = parts.map(function (p) {
          var ang = Math.random() * Math.PI * 2, r = 60 + Math.random() * 220;
          return { x: p.x, y: p.y, tx: p.x + Math.cos(ang) * r, ty: p.y + Math.sin(ang) * r * 0.6, k: p.k, b: body, s: shade, born: performance.now() };
        });
      }
      avatar = a;
      colour = c;
      api.colours();
      make(!still, { x: ox + U * 8, y: oy + U * 8 });
      wake();
    };

    api.poke = function (x, y, t) { pokes.push({ x: x, y: y, t: t }); };

    api.draw = function (ctx, dpr, t, still, inside, px, py) {
      var f = 1;
      var gap = Math.max(1, Math.round(U / 10));
      var size = U - gap;
      var cx = ox + U * 8, cy = oy + U * 8;
      var near = inside && Math.abs(px - cx) < U * 9 && Math.abs(py - cy) < U * 9;
      var R = U * 4.5;
      var live = [];
      for (var q = 0; q < pokes.length; q++) if (t - pokes[q].t < 320) live.push(pokes[q]);
      pokes = live;

      /* The old face falls apart into the field. */
      if (debris.length) {
        var keep = [];
        for (var d = 0; d < debris.length; d++) {
          var o = debris[d], age = t - o.born;
          if (age > 700) continue;
          var k = Math.min(1, age / 420);
          var e = 1 - (1 - k) * (1 - k);
          var x = o.x + (o.tx - o.x) * e, y = o.y + (o.ty - o.y) * e;
          var s = Math.max(2, Math.round((size * (1 - k) + 2 * k) / 2) * 2);
          ctx.globalAlpha = 1 - Math.floor(age / 140) * 0.2;
          ctx.fillStyle = o.k === "s" ? o.s : o.k === "k" ? faces.ink : o.b;
          ctx.fillRect(Math.round(x * dpr), Math.round(y * dpr), Math.round(s * dpr), Math.round(s * dpr));
          keep.push(o);
        }
        debris = keep;
        ctx.globalAlpha = 1;
      }

      var settled = true;
      var byCell = {};
      for (var n = 0; n < parts.length; n++) {
        var p = parts[n];
        if (!still) {
          if (t < p.at) { settled = false; } else {
            f = 1;
            p.vx += (p.hx - p.x) * 0.075;
            p.vy += (p.hy - p.y) * 0.075;
            var pushers = near ? [{ x: px, y: py }] : [];
            for (q = 0; q < pokes.length; q++) pushers.push(pokes[q]);
            for (var m = 0; m < pushers.length; m++) {
              var dx = p.x + U / 2 - pushers[m].x, dy = p.y + U / 2 - pushers[m].y;
              var dd = Math.sqrt(dx * dx + dy * dy);
              if (dd < R && dd > 0.01) {
                var force = (1 - dd / R) * 5.5;
                p.vx += (dx / dd) * force;
                p.vy += (dy / dd) * force;
              }
            }
            p.vx *= 0.74;
            p.vy *= 0.74;
            p.x += p.vx * f;
            p.y += p.vy * f;
            if (Math.abs(p.x - p.hx) > 0.5 || Math.abs(p.y - p.hy) > 0.5 || Math.abs(p.vx) > 0.1) settled = false;
          }
        }
        byCell[p.cx + "," + p.cy] = p;
        var far = Math.abs(p.x - p.hx) + Math.abs(p.y - p.hy);
        var sz = t < p.at ? 2 : far > U * 5 ? Math.max(2, Math.round(size / 3)) : far > U * 2 ? Math.round(size * 0.66) : size;
        ctx.fillStyle = p.k === "s" ? shade : p.k === "k" ? faces.ink : body;
        if (t < p.at) ctx.globalAlpha = 0.5;
        var gx = Math.round(p.x / 2) * 2, gy = Math.round(p.y / 2) * 2;
        ctx.fillRect(Math.round(gx * dpr), Math.round(gy * dpr), Math.round(sz * dpr), Math.round(sz * dpr));
        ctx.globalAlpha = 1;
      }
      if (settled) built = true;

      /* Eyes: they follow the pointer, blink now and then, and go wide when it comes close. */
      if (!built && !still) return;
      var mood = "idle";
      if (!still) {
        if (t > blinkAt) { blinkAt = t + 2600 + Math.random() * 3600; blinkUntil = t + 140; }
        if (t < blinkUntil) mood = "sleep";
        else if (near && Math.abs(px - cx) < U * 6 && Math.abs(py - cy) < U * 6) mood = "need";
      }
      var ex = 0, ey = 0;
      if (!still && P.in) {
        var lx = px - cx, ly = py - cy;
        ex = lx > U * 2.5 ? 1 : lx < -U * 2.5 ? -1 : 0;
        ey = ly > U * 3 ? 1 : ly < -U * 3 ? -1 : 0;
      } else if (!still && pokes.length) {
        ex = pokes[0].x > cx + U ? 1 : pokes[0].x < cx - U ? -1 : 0;
      }
      ctx.fillStyle = faces.ink;
      faces.sprites[avatar].eyes[mood].forEach(function (r) {
        var under = byCell[r[0] + "," + r[1]];
        var bx = under ? under.x - r[0] * U : ox, by = under ? under.y - r[1] * U : oy;
        var x = Math.round((bx + (r[0] + ex) * U) / 2) * 2, y = Math.round((by + (r[1] + ey) * U) / 2) * 2;
        ctx.fillRect(Math.round(x * dpr), Math.round(y * dpr), Math.round((r[2] * U - gap) * dpr), Math.round((r[3] * U - gap) * dpr));
      });
    };

    window.FennaFace = api;
    return api;
  }

  /* ── The final section's hidden layer: a wallpaper, dithered ─────── */
  function Reveal(host) {
    var api = {};
    var img = new Image();
    var cols = 0, rows = 0, G = 12, top = 0, band = null, dpr = 1;
    var pix = null;
    var fills = [];
    img.src = host.getAttribute("data-wallpaper");
    img.onload = function () { api.sample(); wake(); };

    api.layout = function (w, h, grid, ratio, c, r) {
      G = grid;
      cols = c;
      rows = r;
      dpr = ratio;
      var wrap = host.querySelector(".wrap");
      var bottom = wrap ? wrap.offsetTop + wrap.offsetHeight : h * 0.5;
      top = Math.min(rows - 4, Math.max(0, Math.floor((bottom + 24) / G)));
      api.sample();
    };

    /* One colour per cell: the wallpaper covers the band at the bottom; the sky continues above it. */
    api.sample = function () {
      if (!img.complete || !img.naturalWidth || !cols) return;
      var bandRows = rows - top;
      var scale = Math.max(cols / img.naturalWidth, bandRows / img.naturalHeight);
      var sw = cols / scale, sh = bandRows / scale;
      var sx = (img.naturalWidth - sw) / 2, sy = img.naturalHeight - sh;
      var off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      var o = off.getContext("2d");
      o.imageSmoothingEnabled = false;
      o.drawImage(img, sx, sy, sw, sh, 0, top, cols, bandRows);
      o.drawImage(img, sx, sy, sw, 1, 0, 0, cols, top);
      pix = o.getImageData(0, 0, cols, rows).data;
      fills = new Array(cols * rows);
      for (var k = 0; k < cols * rows; k++) fills[k] = "rgb(" + pix[k * 4] + "," + pix[k * 4 + 1] + "," + pix[k * 4 + 2] + ")";
      api.paint();
    };

    api.inBand = function (i, j) {
      if (!pix || j < top) return false;
      return ((j - top) / Math.max(1, rows - top)) * 1.5 > bayer(i, j);
    };

    /* The still band, painted once per size and theme into its own canvas. */
    api.paint = function () {
      if (!pix) return;
      band = document.createElement("canvas");
      band.width = Math.round(cols * G * dpr);
      band.height = Math.round(rows * G * dpr);
      var b = band.getContext("2d");
      var s = Math.round((G - 2) * dpr);
      for (var j = top; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          if (!api.inBand(i, j)) continue;
          b.fillStyle = fills[j * cols + i];
          b.fillRect(Math.round((i * G + 1) * dpr), Math.round((j * G + 1) * dpr), s, s);
        }
      }
    };

    api.drawBand = function (ctx) { if (band) ctx.drawImage(band, 0, 0); };

    /* A cell the pointer has warmed: shown in the wallpaper's colour when its heat beats the dither. */
    api.cell = function (ctx, i, j, hv) {
      if (!pix || api.inBand(i, j) || hv / 4 < bayer(i, j)) return false;
      var keep = ctx.fillStyle;
      ctx.fillStyle = fills[j * cols + i];
      ctx.globalAlpha = 0.95;
      ctx.fillRect(Math.round((i * G + 1) * dpr), Math.round((j * G + 1) * dpr), Math.round((G - 2) * dpr), Math.round((G - 2) * dpr));
      ctx.globalAlpha = 1;
      ctx.fillStyle = keep;
      return true;
    };
    return api;
  }

  window.FennaLoop = { add: add, wake: wake };
  if (faces) document.querySelectorAll("[data-field]").forEach(Field);
})();
