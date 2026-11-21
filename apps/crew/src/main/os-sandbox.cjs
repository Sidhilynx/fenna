// The OS sandbox for a brain's CLI process: the CLI and everything it starts
// can write only to the folders it is given, and can't read the person's
// secrets (ssh keys, cloud logins, tokens). Linux uses bubblewrap, macOS uses
// sandbox-exec. Windows has no sandbox here yet, so the command runs as it is.
//
// wrap() only builds the command line and checks what it is given. It starts
// nothing, so it is tested without a sandbox tool installed.

const fs = require("node:fs");
const path = require("node:path");

const BWRAP_PATHS = ["/usr/bin/bwrap", "/bin/bwrap"];
const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const MAC_TEMP_DIRS = ["/private/tmp", "/private/var/folders"];
const MAC_DEVICES = ["/dev/null", "/dev/tty"];
const SECRET_PATHS = [".ssh", ".aws", ".azure", ".config/gcloud", ".gnupg", ".docker", ".kube", ".npmrc", ".pypirc", ".netrc", ".git-credentials", ".config/gh"];

/** Throws unless the writable and deny lists are full paths, and at least one folder is writable. */
function checkPaths(writable, readDeny) {
  if (!Array.isArray(writable) || writable.length === 0) throw new Error("Give at least one folder the command may write to, like /home/me/repo.");
  for (const p of [...writable, ...readDeny]) {
    if (typeof p !== "string" || !path.isAbsolute(p)) throw new Error(`"${String(p)}" isn't a full path. Give the folder's full path, like /home/me/repo.`);
  }
}

/** Whether `p` is an existing folder (bubblewrap can only hide a folder with a tmpfs). */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The bubblewrap arguments: the disk read-only, the writable folders bound, secret folders hidden, then the command. */
function bwrapArgs(writable, readDeny, command, args) {
  const out = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"];
  for (const dir of writable) out.push("--bind", dir, dir);
  for (const p of readDeny) if (isDir(p)) out.push("--tmpfs", p);
  out.push("--die-with-parent", "--", command, ...args);
  return out;
}

/** A path as a quoted SBPL string: backslashes and quotes escaped. */
const sbplPath = (p) => `"${String(p).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The sandbox-exec profile: writes only to the folders given and the temp folders, and no reads of the deny list. */
function seatbeltProfile(writable, readDeny) {
  const parts = ["(version 1)", "(allow default)", "(deny file-write*)"];
  parts.push(`(allow file-write* ${writable.map((d) => `(subpath ${sbplPath(d)})`).join(" ")})`);
  parts.push(`(allow file-write* ${[...MAC_TEMP_DIRS.map((d) => `(subpath ${sbplPath(d)})`), ...MAC_DEVICES.map((d) => `(literal ${sbplPath(d)})`)].join(" ")})`);
  if (readDeny.length) parts.push(`(deny file-read* ${readDeny.map((p) => `(subpath ${sbplPath(p)})`).join(" ")})`);
  return parts.join("");
}

/**
 * The command to run, wrapped in the OS sandbox this platform has. `sandbox`
 * says which one: "bubblewrap", "seatbelt", or "none" (the command unchanged).
 * @param {object} o
 * @param {string} o.platform  process.platform
 * @param {string} o.command
 * @param {string[]} [o.args]
 * @param {string[]} o.writable  full paths the command may write to (at least one)
 * @param {string[]} [o.readDeny]  full paths the command may not read (folders are hidden)
 * @param {string} [o.home]  the person's home folder; wrap doesn't use it, the caller builds readDeny from it
 * @param {{ bwrap?: boolean, sandboxExec?: boolean }} [o.available]  from detect()
 * @returns {{ command: string, args: string[], sandbox: "bubblewrap" | "seatbelt" | "none" }}
 */
function wrap({ platform, command, args = [], writable, readDeny = [], available = {} }) {
  checkPaths(writable, readDeny);
  if (platform === "linux" && available.bwrap) {
    return { command: "bwrap", args: bwrapArgs(writable, readDeny, command, args), sandbox: "bubblewrap" };
  }
  if (platform === "darwin" && available.sandboxExec) {
    return { command: SANDBOX_EXEC, args: ["-p", seatbeltProfile(writable, readDeny), command, ...args], sandbox: "seatbelt" };
  }
  return { command, args: [...args], sandbox: "none" };
}

/** The secret folders and files under the person's home that a command may not read. */
function defaultReadDeny(home) {
  return SECRET_PATHS.map((p) => path.join(home, p));
}

/** Which OS sandbox tools are installed here. `exists` is fs.existsSync unless a test passes its own. */
function detect(platform, exists = fs.existsSync) {
  return {
    bwrap: platform === "linux" && BWRAP_PATHS.some((f) => Boolean(exists(f))),
    sandboxExec: platform === "darwin" && Boolean(exists(SANDBOX_EXEC)),
  };
}

/** One sentence for the person about where commands run. */
function describe(sandbox, platform) {
  if (sandbox === "bubblewrap") return "Commands run in a Linux sandbox: they can change only the bot's repos.";
  if (sandbox === "seatbelt") return "Commands run in a macOS sandbox: they can change only the bot's repos.";
  if (platform === "win32") return "Windows has no Crew sandbox yet: Crew relies on each AI's own limits and your approvals.";
  return "No sandbox tool was found (install bubblewrap): commands run as you.";
}

module.exports = { wrap, defaultReadDeny, detect, describe, seatbeltProfile, bwrapArgs };
