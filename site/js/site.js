/* Theme toggle, and the pixel art drawn as crisp SVG: bot faces from the
   app's own sprites, the colour icons of a bot's desktop, the bot's cursor. */
(function () {
  var KEY = "fenna-theme";
  var root = document.documentElement;
  var faces = window.FENNA_FACES;
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

  /* Faces: one rect per sprite rect, coloured by CSS for both themes. */
  function face(el) {
    var sprite = faces && faces.sprites[el.dataset.face];
    var colors = faces && [faces.colors.dark[el.dataset.color], faces.colors.light[el.dataset.color]];
    if (!sprite || !colors[0]) return;
    var mood = el.dataset.mood || "idle";
    var out = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">';
    sprite.rects.forEach(function (r) {
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
    if (el.hasAttribute("data-sit")) {
      /* Stand on the ground: drop the empty rows under the sprite. */
      var low = 0;
      sprite.rects.forEach(function (r) { low = Math.max(low, r[1] + r[3]); });
      el.classList.add("sit");
      el.style.setProperty("--gap", String(16 - low));
    }
  }
  document.querySelectorAll(".face[data-face]").forEach(face);

  /* The header compacts once the page has scrolled a little. */
  var sentinel = document.querySelector(".nav-sentinel");
  var nav = document.querySelector(".nav");
  if (sentinel && nav) {
    new IntersectionObserver(function (e) { nav.classList.toggle("stuck", !e[e.length - 1].isIntersecting); }).observe(sentinel);
  }

  /* The bot's desktop icons, 16 by 16, from the app's fileIcons.ts. Each letter is a palette key. */
  var ICONS = {
    browser: "mmmmmmmmmmmmmmmm|mmmmmmmmmmmmmmmm|mmmmmmmmmmmmmmmm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mwwwwbbbbbbwwwwm|mwwwbbbbbbbbwwwm|mwwwbbnnbbbbwwwm|mwwwbbnnbbbbwwwm|mwwwbbbbbnnbwwwm|mwwwbbbbbnnbwwwm|mwwwbbbbbbbbwwwm|mwwwwbbbbbbwwwwm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mmmmmmmmmmmmmmmm",
    files: "mmmmmmmmmmmmmmmm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mwwAAAAAwwwwwwwm|mwwAAAAAAAAAAwwm|mwwAAAAAAAAAAwwm|mwwaaaaaaaaaawwm|mwwaaaaaaaaaawwm|mwwaaaaaaaaaawwm|mwwaaaaaaaaaawwm|mwwaaaaaaaaaawwm|mwwaaaaaaaaaawwm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mmmmmmmmmmmmmmmm",
    terminal: "mmmmmmmmmmmmmmmm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mwkkkkkkkkkkkkwm|mwkkkkkkkkkkkkwm|mwkknkkkkkkkkkwm|mwkkknkkkkkkkkwm|mwkkkknkkkkkkkwm|mwkkknkkkkkkkkwm|mwkknkkkkkkkkkwm|mwkkkkkkNNNNkkwm|mwkkkkkkkkkkkkwm|mwkkkkkkkkkkkkwm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mmmmmmmmmmmmmmmm",
    activity: "mmmmmmmmmmmmmmmm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mwwwwwwwwNNNwwwm|mwwwwwwwwNNNwwwm|mwwwwwnnnNNNwwwm|mwwwwwnnnNNNwwwm|mwwwwwnnnNNNwwwm|mwwnnnnnnNNNwwwm|mwwnnnnnnNNNwwwm|mwwnnnnnnNNNwwwm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mwwwwwwwwwwwwwwm|mmmmmmmmmmmmmmmm",
    sheet: "................|................|..NNNNNNNNNNNN..|..NnnnnnnnnnnN..|..NnnnnnnnnnnN..|..NwwwNwwwNwwN..|..NwwwNwwwNwwN..|..NNNNNNNNNNNN..|..NwwwNwwwNwwN..|..NwwwNwwwNwwN..|..NNNNNNNNNNNN..|..NwwwNwwwNwwN..|..NwwwNwwwNwwN..|..NNNNNNNNNNNN..|................|................",
    image: "................|................|.bbbbbbbbbbbbbb.|.bbbbbbbbbbbbbb.|.bbbbbbbbbaabbb.|.bbbbbbbbbaabbb.|.bbbbbbbbbbbbbb.|.bbnnnbbbbbbbbb.|.bnnnnnbbbbbbbb.|.nnnnnnnbbbbbbb.|.nnnnnnnnnbbbbb.|.NNNNNNNNNNNNNN.|.NNNNNNNNNNNNNN.|.NNNNNNNNNNNNNN.|................|................",
    text: "................|...mmmmmmmmmm...|...mwwwwwwwwm...|...mwwwwwwwwm...|...mwkkkkkkwm...|...mwwwwwwwwm...|...mwkkkkkkwm...|...mwwwwwwwwm...|...mwkkkkkkwm...|...mwwwwwwwwm...|...mwkkkkwwwm...|...mwwwwwwwwm...|...mwwwwwwwwm...|...mwwwwwwwwm...|...mmmmmmmmmm...|................"
  };

  /* Rows of keys to SVG rects, merging runs of the same key on a row. */
  function grid(rows, w, h) {
    var out = '<svg viewBox="0 0 ' + w + " " + h + '" aria-hidden="true" focusable="false">';
    rows.forEach(function (row, y) {
      var x = 0;
      while (x < row.length) {
        var k = row[x], n = 1;
        while (row[x + n] === k) n++;
        if (k !== ".") out += '<rect class="' + k + '" x="' + x + '" y="' + y + '" width="' + n + '" height="1"/>';
        x += n;
      }
    });
    return out + "</svg>";
  }

  document.querySelectorAll(".pxi[data-icon]").forEach(function (el) {
    var rows = ICONS[el.dataset.icon];
    if (rows) el.innerHTML = grid(rows.split("|"), 16, 16);
  });

  /* The bot's cursor: an arrow with a dark rim, 9 by 13. */
  var ARROW = [
    "o........", "oo.......", "ofo......", "offo.....", "offfo....", "offffo...", "offfffo..",
    "offffffo.", "offffoooo", "offofo...", "ofo.ofo..", "oo..ofo..", ".....oo.."
  ];
  var arrow = grid(ARROW, 9, 13).replace(/class="o"/g, 'class="rim"').replace(/class="f"/g, 'class="arrow"');
  document.querySelectorAll(".bot-cursor").forEach(function (el) {
    el.insertAdjacentHTML("afterbegin", arrow);
  });
})();
