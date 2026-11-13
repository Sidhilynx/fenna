// The shell's main-process half: window tabs, the open folders and their
// file API, the assistant host, review aids, and the page preload every app
// uses. See ../README.md for how an app plugs in.
const os = require("node:os");
const path = require("node:path");
const { ipcMain } = require("electron");
const { TabHost, STRIP_H } = require("./tabs.cjs");
const { registerAgent } = require("./agent.cjs");
const { createFolderHost, registerAssetScheme } = require("./folders.cjs");
const { prepareReview, applyReviewTheme, startReview } = require("./review.cjs");
const { registerUpdates } = require("./updates.cjs");

/** The shell's own small calls from the page: Home's greeting, and whether a newer release of the app is out on GitHub (`releases`: "owner/repo"). */
function registerShell({ assertSender, releases }) {
  if (releases) registerUpdates({ assertSender, repo: releases });
  ipcMain.handle("shell:userName", (e) => {
    assertSender(e);
    try {
      return os.userInfo().username || "";
    } catch {
      return "";
    }
  });
}

module.exports = {
  TabHost,
  STRIP_H,
  registerAgent,
  registerShell,
  createFolderHost,
  registerAssetScheme,
  prepareReview,
  applyReviewTheme,
  startReview,
  PRELOAD: path.join(__dirname, "preload.cjs"),
};
