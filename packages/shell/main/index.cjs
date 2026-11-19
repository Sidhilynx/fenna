// The shell's main-process half: window tabs, the open folders and their
// file API, the assistant host, review aids, and the page preload every app
// uses. See ../README.md for how an app plugs in.
const os = require("node:os");
const path = require("node:path");
const { ipcMain } = require("electron");
const { TabHost, STRIP_H } = require("./tabs.cjs");
const { registerAgent, registerAssistantSetup, startRun, stopRun, assistantCatalog } = require("./agent.cjs");
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
  ipcMain.handle("shell:theme", (e, nextMode) => {
    assertSender(e);
    const { nativeTheme } = require("electron");
    if (nextMode && ["dark", "light", "system"].includes(nextMode)) {
      nativeTheme.themeSource = nextMode;
    }
    return {
      mode: nativeTheme.themeSource,
      dark: nativeTheme.shouldUseDarkColors,
    };
  });
}

module.exports = {
  TabHost,
  STRIP_H,
  registerAgent,
  registerAssistantSetup,
  startRun,
  stopRun,
  assistantCatalog,
  registerShell,
  createFolderHost,
  registerAssetScheme,
  prepareReview,
  applyReviewTheme,
  startReview,
  PRELOAD: path.join(__dirname, "preload.cjs"),
};
