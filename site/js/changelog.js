/* Fetches the GitHub releases and renders the changelog. */
(function () {
  var REPO = "Sidhilynx/fenna";
  var API = "https://api.github.com/repos/" + REPO + "/releases";
  var ALL = "https://github.com/" + REPO + "/releases";
  var CACHE = "fenna-changelog";
  var container = document.getElementById("releases-container");

  function esc(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function date(iso) {
    return iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "";
  }

  function render(releases) {
    if (!Array.isArray(releases) || releases.length === 0) {
      container.innerHTML = '<p class="state">No releases yet. <a class="link" href="' + ALL + '">See GitHub</a>.</p>';
      return;
    }
    container.innerHTML = releases.map(function (rel, i) {
      var tag = esc(rel.tag_name || rel.name);
      var body = typeof marked !== "undefined" ? marked.parse(rel.body || "") : "<pre>" + esc(rel.body || "") + "</pre>";
      return '<article class="release" id="' + tag + '">' +
        '<div class="release-meta"><span class="release-tag"><a href="#' + tag + '">' + tag + '</a></span>' +
        (i === 0 ? '<span class="chip latest">Latest</span>' : "") +
        '<span class="release-date mono">' + esc(date(rel.published_at || rel.created_at)) + "</span></div>" +
        '<div class="release-body">' + body + "</div></article>";
    }).join("");
    if (location.hash) {
      var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
  }

  function fail() {
    container.innerHTML = '<p class="state">Releases could not be loaded right now. <a class="link" href="' + ALL + '">Read them on GitHub</a>.</p>';
  }

  try {
    var cached = JSON.parse(sessionStorage.getItem(CACHE) || "null");
    if (cached && Date.now() - cached.at < 600000) { render(cached.releases); return; }
  } catch (e) { /* storage can be blocked */ }

  fetch(API).then(function (res) {
    if (!res.ok) throw new Error("GitHub returned " + res.status);
    return res.json();
  }).then(function (releases) {
    try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), releases: releases })); } catch (e) { /* storage can be blocked */ }
    render(releases);
  }).catch(fail);
})();
