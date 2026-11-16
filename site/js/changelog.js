/**
 * Fetches GitHub releases and renders the changelog.
 * Displays version notes, release download counts, and per-asset sizes & download stats.
 */

(function () {
  const GITHUB_REPO = "Sidhilynx/fenna";
  const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
  const FALLBACK_URL = `https://github.com/${GITHUB_REPO}/releases`;
  const CACHE_KEY = "fenna_changelog_cache_v2";
  const CACHE_TIME_KEY = "fenna_changelog_time_v2";
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  function formatDate(isoStr) {
    if (!isoStr) return "";
    const date = new Date(isoStr);
    return date.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function getPlatformButtons(assets) {
    if (!Array.isArray(assets) || assets.length === 0) return "";
    let buttons = "";

    for (const asset of assets) {
      const name = asset.name;
      const lower = name.toLowerCase();
      let label = "";

      if (lower.endsWith(".exe")) {
        label = "Windows (.exe)";
      } else if (lower.endsWith("-arm64.dmg")) {
        label = "macOS Apple Silicon (.dmg)";
      } else if (lower.endsWith("-x64.dmg") || lower.endsWith(".dmg")) {
        label = "macOS Intel (.dmg)";
      } else if (lower.endsWith(".appimage")) {
        label = "Linux (.AppImage)";
      } else if (lower.endsWith(".deb")) {
        label = "Linux (.deb)";
      }

      // App name prefix
      let appPrefix = "";
      if (lower.includes("workspace")) appPrefix = "Workspace";
      else if (lower.includes("whiteboard")) appPrefix = "Whiteboard";
      else if (lower.includes("slides")) appPrefix = "Slides";
      else if (lower.includes("docs")) appPrefix = "Docs";
      else if (lower.includes("sheets")) appPrefix = "Sheets";
      else if (lower.includes("design")) appPrefix = "Design";

      const count = asset.download_count ? `${asset.download_count} ⤓` : "";
      const size = formatBytes(asset.size);

      if (label && (appPrefix === "Workspace" || assets.length < 10)) {
        buttons += `
          <a href="${asset.browser_download_url}" class="btn-dl" title="${name}">
            <span>${appPrefix} ${label}</span>
            <span style="opacity: 0.7; font-family: ui-monospace, monospace; font-size: 11px; margin-left: 6px;">${size} ${count ? '· ' + count : ''}</span>
          </a>
        `;
      }
    }

    return buttons ? `<div class="release-downloads">${buttons}</div>` : "";
  }

  function renderReleases(releases) {
    const container = document.getElementById("releases-container");
    if (!container) return;

    if (!Array.isArray(releases) || releases.length === 0) {
      container.innerHTML = `
        <div class="release-entry">
          <p class="release-body">No public releases found yet.</p>
          <a href="${FALLBACK_URL}" class="btn-secondary" target="_blank" rel="noopener noreferrer">View GitHub Releases →</a>
        </div>
      `;
      return;
    }

    let html = "";
    releases.forEach((rel, index) => {
      const tag = rel.tag_name || rel.name;
      const date = formatDate(rel.published_at || rel.created_at);
      const isLatest = index === 0;
      const bodyHtml = typeof marked !== "undefined" && marked.parse ? marked.parse(rel.body || "") : `<pre>${rel.body || ""}</pre>`;
      const dlButtons = getPlatformButtons(rel.assets);

      // Calculate total downloads for this release
      let relTotalDownloads = 0;
      if (Array.isArray(rel.assets)) {
        relTotalDownloads = rel.assets.reduce((sum, a) => sum + (a.download_count || 0), 0);
      }

      html += `
        <article class="release-entry" id="${tag}">
          <div class="release-meta-row">
            <div class="release-tag">
              <a href="#${tag}">${tag}</a>
              ${isLatest ? '<span class="latest-pill">Latest</span>' : ""}
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              ${relTotalDownloads > 0 ? `<span class="release-date" style="color: #5b8cff;">${relTotalDownloads} downloads</span>` : ""}
              <span class="release-date">${date}</span>
            </div>
          </div>
          <div class="release-body">
            ${bodyHtml}
          </div>
          ${dlButtons}
        </article>
      `;
    });

    container.innerHTML = html;
  }

  function renderFallback(message) {
    const container = document.getElementById("releases-container");
    if (!container) return;

    container.innerHTML = `
      <div class="release-entry">
        <p class="release-body" style="color: #8a8f98; margin-bottom: 16px;">
          ${message || "Unable to load releases right now."}
        </p>
        <a href="${FALLBACK_URL}" class="btn-primary" target="_blank" rel="noopener noreferrer">
          View all releases on GitHub →
        </a>
      </div>
    `;
  }

  async function loadChangelog() {
    try {
      const cachedTime = sessionStorage.getItem(CACHE_TIME_KEY);
      const cachedData = sessionStorage.getItem(CACHE_KEY);

      if (cachedTime && cachedData && Date.now() - parseInt(cachedTime, 10) < CACHE_TTL_MS) {
        renderReleases(JSON.parse(cachedData));
        return;
      }
    } catch {}

    try {
      const res = await fetch(RELEASES_API);
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const data = await res.json();

      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
        sessionStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
      } catch {}

      renderReleases(data);
    } catch (err) {
      renderFallback("GitHub rate limit reached or offline. You can view all releases directly on GitHub.");
    }
  }

  document.addEventListener("DOMContentLoaded", loadChangelog);
})();
