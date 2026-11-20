/* The landing page's moving parts: the hero's bots, the bot's computer you
   can take control of, the approval card, and Builder making an app. Timed
   work runs on the field's one loop (js/field.js), so it stops while the
   tab is hidden or the part is off screen. Under prefers-reduced-motion
   every part shows its finished state. */
(function () {
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var loop = window.FennaLoop;

  /* ── Hero: one bot at a time, built from pixels ───────────────────── */
  var BOTS = [
    { name: "Builder", face: "crate", color: "ochre", when: "On request", job: "Builds the apps, tools and small websites you ask for, tests them, then uses them for you." },
    { name: "Inbox", face: "owl", color: "sea", when: "Weekdays 09:00", job: "Sorts new mail and drafts the replies. Sends nothing without asking." },
    { name: "Research", face: "lantern", color: "slate", when: "Every 2 hours", job: "Watches three pricing pages and tells you when one changes." },
    { name: "Scout", face: "kite", color: "iris", when: "Weekdays 08:00", job: "Finds new leads each morning and says which ones look strong." },
    { name: "Standup", face: "sprout", color: "moss", when: "Mondays 10:00", job: "Writes the team update in a Fenna doc from last week's work." },
    { name: "Fenna", face: "beacon", color: "clay", when: "Leads the crew", job: "Plans the work and hands it to the right bot. Every crew starts with Fenna." }
  ];
  var slot = document.querySelector("[data-face-slot]");
  if (slot && window.FennaFace) {
    var caption = slot.parentElement.querySelector("figcaption");
    var nameEl = document.querySelector("[data-bot-name]");
    var whenEl = document.querySelector("[data-bot-when]");
    var jobEl = document.querySelector("[data-bot-job]");
    var pager = document.querySelector("[data-bot-pager]");
    var current = 0;
    var heroOn = true;
    var held = false;
    var timer = 0;
    pager.innerHTML = BOTS.map(function () { return "<i></i>"; }).join("");

    var show = function (n, byPerson) {
      current = (n + BOTS.length) % BOTS.length;
      var bot = BOTS[current];
      caption.setAttribute("aria-live", byPerson ? "polite" : "off");
      nameEl.textContent = bot.name;
      whenEl.textContent = bot.when;
      jobEl.textContent = bot.job;
      pager.querySelectorAll("i").forEach(function (dot, i) { dot.className = i === current ? "on" : ""; });
      window.FennaFace.set(bot.face, bot.color);
    };
    var schedule = function () {
      window.clearTimeout(timer);
      if (reduced.matches) return;
      timer = window.setTimeout(function () {
        if (heroOn && !held && !document.hidden) show(current + 1, false);
        schedule();
      }, 7000);
    };
    slot.addEventListener("click", function () { show(current + 1, true); schedule(); });
    slot.addEventListener("pointerenter", function () { held = true; });
    slot.addEventListener("pointerleave", function () { held = false; });
    slot.addEventListener("focus", function () { held = true; });
    slot.addEventListener("blur", function () { held = false; });
    new IntersectionObserver(function (e) { heroOn = e[e.length - 1].isIntersecting; }).observe(slot);
    reduced.addEventListener("change", schedule);
    pager.querySelectorAll("i")[0].className = "on";
    schedule();
  }

  /* Places a bot's cursor over a point of its box, in whole pixels. */
  function aim(cursor, box, x, y) {
    cursor.style.setProperty("--cx", Math.round(x - 2) + "px");
    cursor.style.setProperty("--cy", Math.round(y - 2) + "px");
    cursor.dataset.box = box ? "1" : "";
  }
  function centre(el, box) {
    var r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    return [r.left - b.left + r.width / 2, r.top - b.top + r.height / 2];
  }

  /* ── Watch: Books works on its computer; you can take control ────── */
  var screen = document.querySelector("[data-screen]");
  if (screen) {
    var view = screen.querySelector(".screen-view");
    var cursor = screen.querySelector("[data-cursor]");
    var status = screen.querySelector("[data-screen-status]");
    var watchBtn = screen.querySelector("[data-watch]");
    var takeBtn = screen.querySelector("[data-take]");
    var giveBtn = screen.querySelector("[data-give]");
    /* Points on the screenshot (1440 by 900, its top 48 px cropped) and what Books is doing there. */
    var STOPS = [
      [453, 232, "Reading bank-export-nov.csv"],
      [561, 232, "Reading matching-rules.md"],
      [180, 318, "Updating the November sheet"],
      [1318, 537, "Waiting for your OK to send the reconciliation"]
    ];
    var stop = 0;
    var watchOn = false;
    var holding = false;
    var lastMove = 0;
    var place = function () {
      var w = view.clientWidth;
      var s = STOPS[stop];
      aim(cursor, view, (s[0] / 1440) * w, ((s[1] - 48) / 1440) * w);
      if (!holding && !screen.dataset.answered) status.textContent = s[2];
    };
    var hold = function (on) {
      holding = on;
      screen.classList.toggle("held", on);
      watchBtn.setAttribute("aria-pressed", on ? "false" : "true");
      takeBtn.setAttribute("aria-pressed", on ? "true" : "false");
      status.textContent = on ? "Paused while you are in control" : screen.dataset.answered || STOPS[stop][2];
      if (on) giveBtn.focus();
    };
    takeBtn.addEventListener("click", function () { hold(true); });
    watchBtn.addEventListener("click", function () { hold(false); });
    giveBtn.addEventListener("click", function () { hold(false); takeBtn.focus(); });
    new ResizeObserver(place).observe(view);
    loop.add({
      el: view,
      measure: function () {},
      frame: function (t) {
        if (reduced.matches) return false;
        if (!watchOn) { watchOn = true; lastMove = t; }
        if (!holding && t - lastMove > 2200) {
          lastMove = t;
          stop = (stop + 1) % STOPS.length;
          place();
          window.setTimeout(function () { cursor.classList.add("click"); }, 760);
          window.setTimeout(function () { cursor.classList.remove("click"); }, 900);
        }
        return true;
      }
    });
    place();
  }

  /* ── The approval card ─────────────────────────────────────────────── */
  var card = document.querySelector("[data-approval]");
  if (card) {
    var result = card.querySelector("[data-result]");
    var ANSWERS = {
      once: ["Approved once. Books sends it now and asks again next time.", "Sending the November reconciliation"],
      always: ["Approved for Books from now on. It won't ask about this again.", "Sending the November reconciliation"],
      deny: ["Denied. Books stops and doesn't send it.", "Stopped: you denied sending"]
    };
    card.querySelectorAll("[data-answer]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = ANSWERS[b.dataset.answer];
        card.classList.add("done");
        result.textContent = a[0];
        if (screen) {
          screen.dataset.answered = a[1];
          if (!screen.classList.contains("held")) screen.querySelector("[data-screen-status]").textContent = a[1];
        }
        card.querySelector("[data-again]").focus();
      });
    });
    card.querySelector("[data-again]").addEventListener("click", function () {
      card.classList.remove("done");
      result.textContent = "";
      if (screen) delete screen.dataset.answered;
      card.querySelector("[data-answer]").focus();
    });
  }

  /* ── Builder makes an app ──────────────────────────────────────────── */
  var stage = document.querySelector("[data-bstage]");
  if (!stage) return;
  var desk = stage.querySelector("[data-bdesk]");
  var canvas = stage.querySelector("[data-bbuild]");
  var ctx = canvas.getContext("2d");
  var win = stage.querySelector("[data-hwin]");
  var bcursor = stage.querySelector("[data-bcursor]");
  var later = stage.querySelector("[data-later]");
  var laterTask = stage.querySelector("[data-later-task]");
  var tickSq = stage.querySelector("[data-tick]");
  var trySq = stage.querySelector("[data-try]");
  var count = stage.querySelector("[data-count]");
  var streak = stage.querySelector("[data-streak]");
  var replay = document.querySelector("[data-replay]");
  var items = Array.prototype.slice.call(stage.querySelectorAll(".blog li"));
  var C = 6;
  var parts = [];
  var bursts = [];
  var elapsed = 0;
  var playing = false;
  var armed = false;
  var started = false;
  var fired = {};
  var dpr = 1;

  function sizeCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(desk.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(desk.clientHeight * dpr));
  }

  function rel(el) {
    var r = el.getBoundingClientRect(), d = desk.getBoundingClientRect();
    return { x: r.left - d.left, y: r.top - d.top, w: r.width, h: r.height };
  }

  /* The window arrives as pixels, row by row, from Builder's face on the taskbar. */
  function build() {
    sizeCanvas();
    var r = rel(win);
    var from = rel(stage.querySelector(".dtask .slot"));
    var cols = Math.ceil(r.w / C), rows = Math.ceil(r.h / C);
    var bar = Math.round(30 / C);
    var now = elapsed;
    parts = [];
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var edge = i === 0 || j === 0 || i === cols - 1 || j === rows - 1;
        var colour = edge ? "#0d0d0d" : j < bar ? "#161616" : ((j - bar) % 4 === 3 && i > 1 && i < cols - 2) ? "#e2ddd1" : "#f4f1ea";
        parts.push({
          x0: from.x + from.w / 2 + (Math.random() - 0.5) * 40, y0: from.y + (Math.random() - 0.5) * 20,
          x1: r.x + i * C, y1: r.y + j * C, c: colour,
          at: now + j * 34 + i * 3 + Math.random() * 90
        });
      }
    }
  }

  function burst(el) {
    var r = rel(el);
    for (var k = 0; k < 12; k++) {
      var a = (k / 12) * Math.PI * 2;
      bursts.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, dx: Math.cos(a), dy: Math.sin(a), at: elapsed });
    }
  }

  function drawParts() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var alive = false;
    var s = Math.round(C * dpr);
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];
      if (elapsed < p.at) { alive = true; continue; }
      var f = Math.min(1, (elapsed - p.at) / 360);
      if (f < 1) alive = true;
      var e = 1 - Math.pow(1 - f, 3);
      var x = Math.round((p.x0 + (p.x1 - p.x0) * e) / 2) * 2, y = Math.round((p.y0 + (p.y1 - p.y0) * e) / 2) * 2;
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(x * dpr), Math.round(y * dpr), f < 1 ? Math.round(4 * dpr) : s, f < 1 ? Math.round(4 * dpr) : s);
    }
    var keep = [];
    ctx.fillStyle = "#5cc27a";
    for (k = 0; k < bursts.length; k++) {
      var b = bursts[k], age = elapsed - b.at;
      if (age > 480) continue;
      var d = 6 + Math.floor(age / 40) * 3;
      ctx.globalAlpha = 1 - Math.floor(age / 120) * 0.25;
      ctx.fillRect(Math.round((b.x + b.dx * d - 2) * dpr), Math.round((b.y + b.dy * d - 2) * dpr), Math.round(4 * dpr), Math.round(4 * dpr));
      keep.push(b);
    }
    ctx.globalAlpha = 1;
    bursts = keep;
    return alive || bursts.length > 0;
  }

  function point(el) {
    var c = centre(el, desk);
    aim(bcursor, desk, c[0], c[1]);
  }
  function click() {
    bcursor.classList.add("click");
    window.setTimeout(function () { bcursor.classList.remove("click"); }, 160);
  }
  function rest() {
    aim(bcursor, desk, Math.min(desk.clientWidth * 0.82, desk.clientWidth - 110), desk.clientHeight * 0.78);
  }

  /* What happens when, in ms from the start. The chat lines carry their own times in data-at. */
  var EVENTS = [
    [2500, function () { build(); aim(bcursor, desk, desk.clientWidth * 0.55, desk.clientHeight * 0.4); }],
    [4500, function () { win.classList.add("on"); parts = []; }],
    [5000, function () { point(trySq); }],
    [5800, function () { click(); trySq.classList.add("on"); }],
    [6300, function () { click(); trySq.classList.remove("on"); }],
    [6700, function () { point(later); later.classList.add("on"); laterTask.hidden = false; }],
    [7600, rest],
    [10000, function () { tickSq.classList.add("on"); burst(tickSq); count.textContent = "4"; streak.textContent = "Reading: 4 days in a row"; }],
    [11200, function () { playing = false; replay.hidden = false; }]
  ];

  function reset() {
    items.forEach(function (li) { li.classList.remove("on"); });
    win.classList.remove("on");
    later.classList.remove("on");
    laterTask.hidden = true;
    tickSq.classList.remove("on");
    trySq.classList.remove("on");
    count.textContent = "3";
    streak.textContent = "Reading: 3 days in a row";
    parts = [];
    bursts = [];
    fired = {};
    elapsed = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    rest();
  }

  function finish() {
    items.forEach(function (li) { li.classList.toggle("on", !li.classList.contains("typing")); });
    win.classList.add("on");
    later.classList.add("on");
    laterTask.hidden = false;
    tickSq.classList.add("on");
    count.textContent = "4";
    streak.textContent = "Reading: 4 days in a row";
    parts = [];
    bursts = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    rest();
    playing = false;
  }

  function play() {
    reset();
    replay.hidden = true;
    playing = true;
    loop.wake();
  }

  loop.add({
    el: stage,
    measure: function () {},
    frame: function (t, dt) {
      if (reduced.matches) { finish(); return false; }
      if (!started && armed) { started = true; play(); }
      if (!playing && !parts.length && !bursts.length) return false;
      if (playing) elapsed += dt;
      items.forEach(function (li) {
        var at = +li.dataset.at, off = li.dataset.off ? +li.dataset.off : Infinity;
        var on = elapsed >= at && elapsed < off;
        if (on !== li.classList.contains("on")) li.classList.toggle("on", on);
      });
      for (var k = 0; k < EVENTS.length; k++) {
        if (!fired[k] && elapsed >= EVENTS[k][0]) { fired[k] = true; EVENTS[k][1](); }
      }
      return drawParts() || playing;
    }
  });

  new IntersectionObserver(function (e) {
    if (e[e.length - 1].isIntersecting) { armed = true; loop.wake(); }
  }, { threshold: 0.35 }).observe(stage);
  new ResizeObserver(function () { sizeCanvas(); if (!playing) rest(); }).observe(desk);
  replay.addEventListener("click", play);
  reduced.addEventListener("change", function () { if (reduced.matches) finish(); loop.wake(); });
  if (reduced.matches) finish(); else rest();
})();
