/* Theme toggle, the pixel faces and the pixel field. */
(function () {
  var KEY = "fenna-theme";
  var root = document.documentElement;
  var faces = window.FENNA_FACES;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var scheme = window.matchMedia("(prefers-color-scheme: light)");

  function theme() {
    var set = root.getAttribute("data-theme");
    if (set === "light" || set === "dark") return set;
    return scheme.matches ? "light" : "dark";
  }

  function setTheme(next) {
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* storage can be blocked */ }
    syncToggle();
    window.dispatchEvent(new Event("fenna-theme"));
  }

  function syncToggle() {
    var to = theme() === "dark" ? "light" : "dark";
    document.querySelectorAll(".theme").forEach(function (b) {
      b.setAttribute("aria-label", "Switch to the " + to + " theme");
    });
  }

  document.querySelectorAll(".theme").forEach(function (b) {
    b.addEventListener("click", function () { setTheme(theme() === "dark" ? "light" : "dark"); });
  });
  syncToggle();
  scheme.addEventListener("change", function () { syncToggle(); window.dispatchEvent(new Event("fenna-theme")); });

  /* Faces: crisp SVG rects from the app's own sprite data. */
  function face(el) {
    var sprite = faces && faces.sprites[el.dataset.face];
    var colors = faces && [faces.colors.dark[el.dataset.color], faces.colors.light[el.dataset.color]];
    if (!sprite || !colors[0]) return;
    var mood = el.dataset.mood || "idle";
    var low = 0;
    var out = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">';
    sprite.rects.forEach(function (r) {
      low = Math.max(low, r[1] + r[3]);
      out += '<rect class="' + r[4] + '" x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '"/>';
    });
    out += '<g class="eyes">';
    sprite.eyes[mood].forEach(function (r) {
      out += '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '"/>';
    });
    out += "</g>";
    if (mood === "need") out += '<rect class="dot" x="14" y="0" width="2" height="2"/>';
    el.innerHTML = out + "</svg>";
    el.style.setProperty("--fbd", colors[0][0]);
    el.style.setProperty("--fsd", colors[0][1]);
    el.style.setProperty("--fbl", colors[1][0]);
    el.style.setProperty("--fsl", colors[1][1]);
    if (el.hasAttribute("data-sit")) { el.classList.add("sit"); el.style.setProperty("--gap", String(16 - low)); }
  }
  document.querySelectorAll(".face[data-face]").forEach(face);

  /* The pixel field: sparse squares of the face colours, a few flickering in whole steps. */
  var STEPS = [0, 0.1, 0.2, 0.32];
  var PITCH = 16;
  var SIZE = 8;

  function field(canvas) {
    var ctx = canvas.getContext("2d");
    var cells = [];
    var flick = [];
    var timer = 0;
    var visible = true;

    function seeded(seed) {
      return function () {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };
    }

    function build() {
      var dpr = window.devicePixelRatio || 1;
      var w = canvas.clientWidth;
      var h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var rnd = seeded(7);
      var names = Object.keys(faces.colors.dark);
      cells = [];
      for (var y = 0; y < h; y += PITCH) {
        for (var x = 0; x < w; x += PITCH) {
          if (rnd() < 0.085) cells.push({ x: x, y: y, c: names[Math.floor(rnd() * names.length)], a: 1 + Math.floor(rnd() * 2), f: 0 });
        }
      }
      flick = cells.filter(function () { return rnd() < 0.08; });
      flick.forEach(function (c) { c.f = 1; });
      draw();
    }

    function draw() {
      var set = faces.colors[theme()];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cells.forEach(function (c) {
        ctx.globalAlpha = STEPS[c.a] * (theme() === "dark" ? 1 : 1.6);
        ctx.fillStyle = set[c.c][0];
        ctx.fillRect(c.x, c.y, SIZE, SIZE);
      });
    }

    function tick() {
      flick.forEach(function (c) { c.a = Math.floor(Math.random() * STEPS.length); });
      draw();
    }

    function run() {
      window.clearInterval(timer);
      if (!reduced.matches && visible) timer = window.setInterval(tick, 700);
    }

    new ResizeObserver(build).observe(canvas);
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; run(); }).observe(canvas);
    window.addEventListener("fenna-theme", draw);
    reduced.addEventListener("change", run);
    build();
    run();
  }
  if (faces) document.querySelectorAll(".stage canvas").forEach(field);
})();
