/**
 * Handles OS detection, multi-app asset parsing, and cumulative download tracking
 * across all published releases from the GitHub Releases API.
 */

(function () {
  const GITHUB_REPO = "Sidhilynx/fenna";
  const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
  const CURRENT_TAG = "v0.9.3";
  const BASE_DL = `https://github.com/${GITHUB_REPO}/releases/download/${CURRENT_TAG}`;

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  // Fallback defaults
  function defaultMatrix() {
    return {
      workspace: {
        win: `${BASE_DL}/Fenna-Workspace-0.9.3-setup.exe`,
        macArm: `${BASE_DL}/Fenna-Workspace-0.9.3-arm64.dmg`,
        macIntel: `${BASE_DL}/Fenna-Workspace-0.9.3-x64.dmg`,
        linuxAppImage: `${BASE_DL}/Fenna-Workspace-0.9.3-x86_64.AppImage`,
        linuxDeb: `https://github.com/${GITHUB_REPO}/releases/latest`,
      },
      whiteboard: {
        win: `${BASE_DL}/Fenna-Whiteboard-0.9.3-setup.exe`,
        macArm: `${BASE_DL}/Fenna-Whiteboard-0.9.3-arm64.dmg`,
        macIntel: `${BASE_DL}/Fenna-Whiteboard-0.9.3-x64.dmg`,
        linuxAppImage: `${BASE_DL}/Fenna-Whiteboard-0.9.3-x86_64.AppImage`,
        linuxDeb: `${BASE_DL}/Fenna-Whiteboard-0.9.3-amd64.deb`,
      },
      slides: {
        win: `${BASE_DL}/Fenna-Slides-0.9.3-setup.exe`,
        macArm: `${BASE_DL}/Fenna-Slides-0.9.3-arm64.dmg`,
        macIntel: `${BASE_DL}/Fenna-Slides-0.9.3-x64.dmg`,
        linuxAppImage: `${BASE_DL}/Fenna-Slides-0.9.3-x86_64.AppImage`,
        linuxDeb: `${BASE_DL}/Fenna-Slides-0.9.3-amd64.deb`,
      },
      docs: {
        win: `${BASE_DL}/Fenna-Docs-0.9.3-setup.exe`,
        macArm: `${BASE_DL}/Fenna-Docs-0.9.3-arm64.dmg`,
        macIntel: `${BASE_DL}/Fenna-Docs-0.9.3-x64.dmg`,
        linuxAppImage: `${BASE_DL}/Fenna-Docs-0.9.3-x86_64.AppImage`,
        linuxDeb: `${BASE_DL}/Fenna-Docs-0.9.3-amd64.deb`,
      },
      sheets: {
        win: `${BASE_DL}/Fenna-Sheets-0.9.3-setup.exe`,
        macArm: `${BASE_DL}/Fenna-Sheets-0.9.3-arm64.dmg`,
        macIntel: `${BASE_DL}/Fenna-Sheets-0.9.3-x64.dmg`,
        linuxAppImage: `${BASE_DL}/Fenna-Sheets-0.9.3-x86_64.AppImage`,
        linuxDeb: `${BASE_DL}/Fenna-Sheets-0.9.3-amd64.deb`,
      },
      design: {
        win: `${BASE_DL}/Fenna-Design-0.9.3-setup.exe`,
        macArm: `${BASE_DL}/Fenna-Design-0.9.3-arm64.dmg`,
        macIntel: `${BASE_DL}/Fenna-Design-0.9.3-x64.dmg`,
        linuxAppImage: `${BASE_DL}/Fenna-Design-0.9.3-x86_64.AppImage`,
        linuxDeb: `${BASE_DL}/Fenna-Design-0.9.3-amd64.deb`,
      },
    };
  }

  function detectOS() {
    const ua = navigator.userAgent;
    const platform = navigator.platform || "";

    if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) {
      return "mac";
    }
    if (/Win/i.test(platform) || /Windows/i.test(ua)) {
      return "windows";
    }
    if (/Linux/i.test(platform) || /Linux/i.test(ua)) {
      return "linux";
    }
    return "unknown";
  }

  function parseAssetInfo(filename) {
    const name = filename.toLowerCase();
    let app = "unknown";

    if (name.includes("workspace")) app = "workspace";
    else if (name.includes("whiteboard") || name.includes("board")) app = "whiteboard";
    else if (name.includes("slides") || name.includes("desktop")) app = "slides";
    else if (name.includes("docs") || name.includes("doc")) app = "docs";
    else if (name.includes("sheets") || name.includes("sheet")) app = "sheets";
    else if (name.includes("design") || name.includes("artboard")) app = "design";

    let target = "unknown";
    if (name.endsWith(".exe")) {
      target = "win";
    } else if (name.endsWith(".dmg")) {
      if (name.includes("arm64")) {
        target = "macArm";
      } else if (name.includes("x64") || name.includes("intel")) {
        target = "macIntel";
      } else {
        target = "macArm";
      }
    } else if (name.endsWith(".appimage")) {
      target = "linuxAppImage";
    } else if (name.endsWith(".deb")) {
      target = "linuxDeb";
    }

    return { app, target };
  }

  function setupTabs() {
    const tabBtns = document.querySelectorAll(".tab-btn");
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetTab = btn.getAttribute("data-tab");
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));

        btn.classList.add("active");
        const panel = document.getElementById(`tab-${targetTab}`);
        if (panel) panel.classList.add("active");
      });
    });

    const os = detectOS();
    const matchingBtn = document.querySelector(`.tab-btn[data-tab="${os}"]`);
    if (matchingBtn) {
      matchingBtn.click();
    }
  }

  function setupCopyButtons() {
    document.querySelectorAll(".btn-copy").forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-copy") || "";
        navigator.clipboard.writeText(text).then(() => {
          const original = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = original;
          }, 1800);
        });
      });
    });
  }

  function applyAssetUrls(appMatrix, latestTag, stats) {
    const os = detectOS();
    const wsAssets = appMatrix.workspace;

    // 1. Update version tag display
    document.querySelectorAll(".version-tag-display").forEach((el) => {
      el.textContent = latestTag;
    });

    // 2. Update all-time cumulative download counters
    const counterEl = document.getElementById("total-downloads-stat");
    if (counterEl) {
      counterEl.textContent = `${stats.total.toLocaleString()} total downloads`;
    }

    const counterBadge = document.getElementById("hero-download-stat-badge");
    if (counterBadge && stats.total > 0) {
      counterBadge.textContent = `${stats.total} total downloads across all versions`;
      counterBadge.style.display = "inline-flex";
    }

    // 3. Update home hero primary download button
    const heroBtn = document.getElementById("hero-download-btn");
    if (heroBtn) {
      if (os === "mac") {
        heroBtn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Download Workspace for macOS</span>
        `;
        heroBtn.href = wsAssets.macArm || wsAssets.macIntel;
      } else if (os === "windows") {
        heroBtn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Download Workspace for Windows</span>
        `;
        heroBtn.href = wsAssets.win;
      } else if (os === "linux") {
        heroBtn.innerHTML = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Download Workspace for Linux</span>
        `;
        heroBtn.href = wsAssets.linuxAppImage || wsAssets.linuxDeb;
      }
    }

    // 4. Highlight detected OS card
    const osCard = document.getElementById(`card-${os}`);
    if (osCard) {
      osCard.classList.add("highlight");
    }

    // 5. Update download links
    const targets = ["win", "macArm", "macIntel", "linuxAppImage", "linuxDeb"];
    const apps = ["workspace", "whiteboard", "slides", "docs", "sheets", "design"];

    apps.forEach((app) => {
      targets.forEach((tgt) => {
        const linkEl = document.getElementById(`dl-${app}-${tgt}`);
        if (linkEl && appMatrix[app] && appMatrix[app][tgt]) {
          linkEl.href = appMatrix[app][tgt];
        }
      });
    });

    // 6. Update download breakdown stats if present
    const statBreakdown = document.getElementById("stats-breakdown-table");
    if (statBreakdown) {
      let rows = "";
      for (const [appName, count] of Object.entries(stats.perApp)) {
        rows += `
          <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px;">
            <span style="color: #fff; text-transform: capitalize;">${appName}</span>
            <span style="font-family: ui-monospace, monospace; color: #5b8cff;">${count} downloads</span>
          </div>
        `;
      }
      statBreakdown.innerHTML = rows;
    }
  }

  // Fetch all releases to compute permanent all-time stats and get latest assets
  async function initDownloads() {
    const appMatrix = defaultMatrix();
    let latestTag = CURRENT_TAG;
    const stats = {
      total: 0,
      perOS: { Windows: 0, macOS: 0, Linux: 0 },
      perApp: { workspace: 0, whiteboard: 0, slides: 0, docs: 0, sheets: 0, design: 0 },
    };

    try {
      const res = await fetch(RELEASES_API);
      if (res.ok) {
        const releases = await res.json();
        if (Array.isArray(releases) && releases.length > 0) {
          // Latest release is first
          const latestRelease = releases[0];
          latestTag = latestRelease.tag_name || latestRelease.name || CURRENT_TAG;

          // 1. Parse latest assets for download links
          if (Array.isArray(latestRelease.assets)) {
            for (const asset of latestRelease.assets) {
              const { app, target } = parseAssetInfo(asset.name);
              if (appMatrix[app] && target !== "unknown") {
                appMatrix[app][target] = asset.browser_download_url;
              }
            }
          }

          // 2. Aggregate all-time permanent download stats across ALL releases
          for (const rel of releases) {
            if (Array.isArray(rel.assets)) {
              for (const asset of rel.assets) {
                const count = asset.download_count || 0;
                stats.total += count;

                const { app, target } = parseAssetInfo(asset.name);
                if (stats.perApp[app] !== undefined) {
                  stats.perApp[app] += count;
                }

                if (target === "win") stats.perOS.Windows += count;
                else if (target === "macArm" || target === "macIntel") stats.perOS.macOS += count;
                else if (target === "linuxAppImage" || target === "linuxDeb") stats.perOS.Linux += count;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("Could not fetch release metrics from GitHub API:", err);
    } finally {
      applyAssetUrls(appMatrix, latestTag, stats);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupTabs();
    setupCopyButtons();
    initDownloads();
  });
})();
