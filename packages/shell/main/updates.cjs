// Tells the page when a newer version of the app is out. The app asks the
// public GitHub releases of the project once a day; nothing about the user,
// their files or their computer is sent. The page shows a quiet line with a
// download link; nothing is installed without the user. Packaged apps only;
// FENNA_NO_UPDATE_CHECK=1 turns it off.
const { app, ipcMain, shell } = require("electron");

const DAY = 24 * 60 * 60 * 1000;
const FIRST_CHECK = 8000;

/** "0.9.1" → [0, 9, 1]; null for anything that isn't plain x.y.z (pre-releases are skipped). */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `tag` names a later version than `current`. */
function isNewer(current, tag) {
  const a = parseVersion(current);
  const b = parseVersion(tag);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i];
  return false;
}

/** The release's installer for this app on this computer, or null. Names follow the apps' artifactName ("Fenna-Slides-0.9.1-setup.exe"). */
function pickAsset(assets, { product, platform, arch }) {
  const prefix = `${product.replace(/\s+/g, "-")}-`;
  const want =
    platform === "win32"
      ? (n) => n.endsWith("-setup.exe")
      : platform === "darwin"
        ? (n) => n.endsWith(`-${arch}.dmg`)
        : (n) => n.endsWith(".AppImage") && n.includes(arch === "arm64" ? "-arm64" : "-x86_64");
  const hit = (Array.isArray(assets) ? assets : []).find((a) => a && typeof a.name === "string" && a.name.startsWith(prefix) && want(a.name));
  return hit && typeof hit.browser_download_url === "string" ? hit.browser_download_url : null;
}

/** What the page shows from GitHub's "latest release" answer, or null when there is nothing newer. */
function updateFrom(release, { current, product, platform, arch, repo }) {
  if (!release || release.draft || release.prerelease || !isNewer(current, release.tag_name)) return null;
  const page = `https://github.com/${repo}/releases/tag/${encodeURIComponent(release.tag_name)}`;
  return { version: parseVersion(release.tag_name).join("."), url: pickAsset(release.assets, { product, platform, arch }) ?? page };
}

/** Registers shell:update (what's newer, or null) and shell:openUpdate (opens its download in the browser). */
function registerUpdates({ assertSender, repo }) {
  let found = null;
  const allowed = (url) => typeof url === "string" && url.startsWith(`https://github.com/${repo}/releases/`);

  const check = async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": `${app.getName().replace(/\s+/g, "-")}/${app.getVersion()}` },
      });
      if (!res.ok) return;
      found = updateFrom(await res.json(), { current: app.getVersion(), product: app.getName(), platform: process.platform, arch: process.arch, repo });
    } catch {
      // Offline or GitHub unreachable: say nothing, try again tomorrow.
    }
  };

  if (app.isPackaged && process.env.FENNA_NO_UPDATE_CHECK !== "1") {
    setTimeout(check, FIRST_CHECK).unref();
    setInterval(check, DAY).unref();
  }

  ipcMain.handle("shell:update", (e) => {
    assertSender(e);
    return found;
  });
  ipcMain.handle("shell:openUpdate", (e) => {
    assertSender(e);
    if (found && allowed(found.url)) void shell.openExternal(found.url);
  });
}

module.exports = { registerUpdates, _test: { isNewer, pickAsset, updateFrom } };
