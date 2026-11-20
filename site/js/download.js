/* Resolves installers from the latest GitHub release by file-name pattern and
   points the download buttons at the right one for this computer. Without the
   API (offline, rate limited) every link stays on /releases/latest. */
(function () {
  var REPO = "Sidhilynx/fenna";
  var LATEST = "https://github.com/" + REPO + "/releases/latest";
  var API = "https://api.github.com/repos/" + REPO + "/releases/latest";
  var CACHE = "fenna-latest-release";

  var KINDS = {
    win: /-setup\.exe$/i,
    macArm: /-arm64\.dmg$/i,
    macX64: /-x64\.dmg$/i,
    appimage: /\.AppImage$/i,
    deb: /\.deb$/i
  };
  var LABELS = { win: "Windows", macArm: "macOS", macX64: "macOS", appimage: "Linux", deb: "Linux" };

  function detect() {
    var ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    var agent = navigator.userAgent || "";
    if (/android|iphone|ipad|ipod/i.test(agent)) return null;
    if (/win/i.test(ua) || /windows/i.test(agent)) return "win";
    if (/mac/i.test(ua) || /macintosh/i.test(agent)) return "macArm";
    if (/linux|x11|cros/i.test(ua + agent)) return "appimage";
    return null;
  }

  function size(bytes) {
    return bytes ? (bytes / 1048576).toFixed(0) + " MB" : "";
  }

  function find(assets, prefix, kind) {
    for (var i = 0; i < assets.length; i++) {
      var name = assets[i].name;
      if (name.indexOf(prefix) === 0 && KINDS[kind].test(name)) return assets[i];
    }
    return null;
  }

  var mine = detect();
  var primaries = document.querySelectorAll("[data-dl='primary']");
  primaries.forEach(function (a) {
    a.textContent = mine ? "Download for " + LABELS[mine] : "Download";
    if (!mine) a.setAttribute("href", "download.html");
  });

  function apply(release) {
    var assets = release.assets || [];
    primaries.forEach(function (a) {
      var asset = mine && find(assets, "Fenna-Crew-", mine);
      if (asset) a.setAttribute("href", asset.browser_download_url);
    });
    document.querySelectorAll("[data-asset]").forEach(function (a) {
      var asset = find(assets, "Fenna-Crew-", a.getAttribute("data-asset"));
      if (!asset) return;
      a.setAttribute("href", asset.browser_download_url);
      var row = a.closest("li");
      var file = row && row.querySelector(".file");
      if (file) file.textContent = asset.name + "  " + size(asset.size);
    });
    document.querySelectorAll("[data-app]").forEach(function (a) {
      var asset = find(assets, "Fenna-" + a.getAttribute("data-app") + "-", a.getAttribute("data-kind"));
      if (asset) a.setAttribute("href", asset.browser_download_url);
    });
    document.querySelectorAll("[data-version]").forEach(function (el) {
      el.textContent = release.tag_name || "";
    });
  }

  function load() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(CACHE) || "null");
      if (cached && Date.now() - cached.at < 600000) return Promise.resolve(cached.release);
    } catch (e) { /* storage can be blocked */ }
    return fetch(API).then(function (res) {
      if (!res.ok) throw new Error("GitHub returned " + res.status);
      return res.json();
    }).then(function (release) {
      try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), release: { tag_name: release.tag_name, assets: release.assets.map(function (a) { return { name: a.name, size: a.size, browser_download_url: a.browser_download_url }; }) } })); } catch (e) { /* storage can be blocked */ }
      return release;
    });
  }

  load().then(apply).catch(function () { /* links stay on the latest release page */ });
})();
