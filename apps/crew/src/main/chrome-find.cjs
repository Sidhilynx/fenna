// Finds Google Chrome's executable on this computer. Crew drives the bot's
// own Chrome profile for Google sign-in and Meet calls, and Google refuses
// sign-in in other browsers, so only Google Chrome counts: not Chromium, not
// Edge. Returns null when Chrome isn't installed, and the account section
// says so.

const fs = require("node:fs");
const path = require("node:path");

const WIN_CHROME = ["Google", "Chrome", "Application", "chrome.exe"];
const MAC_CHROME = ["Google Chrome.app", "Contents", "MacOS", "Google Chrome"];

/** The places Chrome may be installed on `platform`, most likely first. */
function candidates(platform, env) {
  if (platform === "win32") {
    return [
      ["ProgramFiles", WIN_CHROME],
      ["ProgramFiles(x86)", WIN_CHROME],
      ["LOCALAPPDATA", WIN_CHROME],
    ].flatMap(([variable, parts]) => (env[variable] ? [path.win32.join(env[variable], ...parts)] : []));
  }
  if (platform === "darwin") {
    const system = path.posix.join("/Applications", ...MAC_CHROME);
    return env.HOME ? [system, path.posix.join(env.HOME, "Applications", ...MAC_CHROME)] : [system];
  }
  if (platform === "linux") {
    return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"];
  }
  return [];
}

/**
 * The path of Google Chrome's executable, or null when none is found.
 * OPENDECK_CHROME wins when it is set and exists (for tests and odd installs).
 * Unset environment variables are skipped, and an unknown platform finds
 * nothing unless the override exists.
 * @param {{ platform?: string, env?: Record<string, string | undefined>, exists?: (p: string) => boolean }} [options]
 * @returns {string | null}
 */
function findChrome({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const override = env.OPENDECK_CHROME;
  if (override && exists(override)) return override;
  return candidates(platform, env).find((file) => exists(file)) ?? null;
}

module.exports = { findChrome };
