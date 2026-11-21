// Clicking and typing in an app window the bot captured. A Flutter, Electron,
// Qt or native window, or an emulator, is an ordinary window to the computer,
// so the bot can work it the way a person would. Only tools the system ships
// with are used: PowerShell on Windows. On Linux and macOS the person installs
// xdotool or cliclick once. The coordinates a bot gives are pixels of the
// captured picture; they are mapped onto the screen here.

const childProcess = require("node:child_process");

const MAX_TEXT = 2000;
const COMMAND_MS = 30_000;
const OFF_SCREEN = -30_000;
const NOT_FOUND_EXIT = 3;
const UNSUPPORTED = "Clicking in app windows isn't supported on this system.";
const KEY_REFUSED = "Crew doesn't close apps by key. Stop the app's command instead.";
const XDOTOOL_MISSING = "Clicking in app windows on Linux needs xdotool (sudo apt install xdotool).";
const CLICLICK_MISSING = "Clicking in app windows on macOS needs cliclick (brew install cliclick).";
const MINIMIZED = "That window is minimized or off screen. Bring it to the front and capture it again.";

/** The keys a bot may press, with each system's name for them. */
const KEYS = {
  Enter: { win: "{ENTER}", xdo: "Return", mac: 36 },
  Tab: { win: "{TAB}", xdo: "Tab", mac: 48 },
  Escape: { win: "{ESC}", xdo: "Escape", mac: 53 },
  Backspace: { win: "{BACKSPACE}", xdo: "BackSpace", mac: 51 },
  ArrowUp: { win: "{UP}", xdo: "Up", mac: 126 },
  ArrowDown: { win: "{DOWN}", xdo: "Down", mac: 125 },
  ArrowLeft: { win: "{LEFT}", xdo: "Left", mac: 123 },
  ArrowRight: { win: "{RIGHT}", xdo: "Right", mac: 124 },
};

/** The C# over user32.dll that the Windows script uses. It holds no user text. */
const WIN_TYPES = [
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class CrewWin {",
  '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);',
  '[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);',
  '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
  '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
  '[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);',
  '[DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);',
  "public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
  "public static RECT GetRect(IntPtr h) { RECT r; GetWindowRect(h, out r); return r; }",
  "}",
].join(" ");

const RECT_BODY = [
  "$r = [CrewWin]::GetRect($h)",
  'Write-Output "$($r.Left) $($r.Top) $($r.Right) $($r.Bottom)"',
].join("\n");

const CLICK_BODY = [
  "[void][CrewWin]::SetCursorPos($p.x, $p.y)",
  "for ($i = 0; $i -lt $p.clicks; $i++) {",
  "[CrewWin]::mouse_event($p.down, 0, 0, 0, [UIntPtr]::Zero)",
  "[CrewWin]::mouse_event($p.up, 0, 0, 0, [UIntPtr]::Zero)",
  "}",
].join("\n");

const SENDWAIT_BODY = "[System.Windows.Forms.SendKeys]::SendWait($p.keys)";

/**
 * The window's handle inside a desktopCapturer source id: "window:132456:0"
 * gives "132456". Any other id gives null.
 * @param {string} sourceId
 * @returns {string | null}
 */
function handleOf(sourceId) {
  const m = /^window:(\d+):\d+$/.exec(String(sourceId ?? ""));
  return m ? m[1] : null;
}

/**
 * Runs a program without a shell. Never rejects: code -1 when the program
 * isn't installed, -2 when it ran past 30 seconds and was stopped. `out` is
 * the program's output, or its error text when it printed no output.
 * @param {string} command
 * @param {string[]} args
 * @param {{ input?: string }} [opts]  text written to the program's stdin
 * @returns {Promise<{ code: number, out: string }>}
 */
function runCommand(command, args, { input } = {}) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stopped = false;
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      stopped = true;
      child.kill();
    }, COMMAND_MS);
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) =>
      finish({ code: -1, out: err.code === "ENOENT" ? `${command} isn't installed.` : err.message }),
    );
    child.on("close", (code) => {
      if (stopped) finish({ code: -2, out: `${command} didn't finish within 30 seconds, so Crew stopped it.` });
      else finish({ code: code ?? -2, out: (stdout.trim() ? stdout : stderr).trim() });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/** An error that says what failed, in plain words, with the first line of the system's reason. */
function failure(action, out) {
  const why = String(out ?? "").split(/\r?\n/)[0].trim();
  return new Error(`Crew couldn't ${action}.${why ? ` ${why}` : ""}`);
}

function notFound(target) {
  return new Error(`No open window is named "${target.title}". Check that the app is open and not minimized, then capture it again.`);
}

/** Throws unless the target names a window: a title is required, a handle is optional. */
function checkTarget(target) {
  const title = target && typeof target.title === "string" ? target.title.trim() : "";
  if (!title) throw new Error("Name the window: give its title, as the capture list shows it.");
  const handle = target.handle;
  if (handle !== undefined && handle !== null && !/^\d+$/.test(String(handle))) {
    throw new Error("The window handle must be a number, like the one in the capture's source id.");
  }
}

function inside(v, size) {
  return Number.isFinite(v) && Number.isFinite(size) && v >= 0 && v < size;
}

/** The text as SendKeys reads it: special characters in braces, line breaks as Enter. */
function sendKeysText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`))
    .join("{ENTER}");
}

/** An AppleScript string literal: backslashes and double quotes escaped, line breaks flattened. */
function appleString(text) {
  const flat = String(text).replace(/[\r\n]+/g, " ");
  return `"${flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Escapes a window title for xdotool's search, which reads it as a regular expression. */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A key a bot may press: `{ name }` for a named key, or `{ letter }` for Control
 * plus a letter. Alt+F4 and Control+W or Control+Q are refused: they close apps.
 * @param {string} key
 * @returns {{ name?: string, letter?: string }}
 */
function parseKey(key) {
  const text = String(key ?? "").trim();
  const parts = text.split("+").map((p) => p.trim());
  const lower = parts.map((p) => p.toLowerCase());
  if (lower.includes("alt") && lower.includes("f4")) throw new Error(KEY_REFUSED);
  const named = Object.keys(KEYS).find((k) => k.toLowerCase() === text.toLowerCase());
  if (named) return { name: named };
  if (parts.length === 2 && (lower[0] === "control" || lower[0] === "ctrl") && /^[a-z]$/i.test(parts[1])) {
    const letter = parts[1].toLowerCase();
    if (letter === "w" || letter === "q") throw new Error(KEY_REFUSED);
    return { letter };
  }
  throw new Error(`Unknown key "${text}". Allowed: ${Object.keys(KEYS).join(", ")}, and Control+A to Control+Z.`);
}

/** The PowerShell script. The title and text travel base64-encoded in a payload, never as script text. */
function winScript(payload, body, front) {
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    `Add-Type -TypeDefinition '${WIN_TYPES}'`,
    `$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json`,
    "$h = if ($p.handle) { [IntPtr]::new([Int64]$p.handle) } else { [CrewWin]::FindWindow($null, [string]$p.title) }",
    `if (-not [CrewWin]::IsWindow($h)) { exit ${NOT_FOUND_EXIT} }`,
  ];
  if (front) {
    lines.push(
      "if ([CrewWin]::IsIconic($h)) { [void][CrewWin]::ShowWindow($h, 9) }",
      "[void][CrewWin]::SetForegroundWindow($h)",
      "Start-Sleep -Milliseconds 150",
    );
  }
  lines.push(body);
  return lines.join("\n");
}

function winDriver(run) {
  const ps = async (target, payload, body, front, action) => {
    const res = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      winScript({ handle: target.handle == null ? null : String(target.handle), title: target.title, ...payload }, body, front),
    ]);
    if (res.code === NOT_FOUND_EXIT) throw notFound(target);
    if (res.code !== 0) throw failure(action, res.out);
    return res.out;
  };

  return {
    async locate(target) {
      const out = await ps(target, {}, RECT_BODY, false, "find the window");
      const [left, top, right, bottom] = out.trim().split(/\s+/).map(Number);
      if (![left, top, right, bottom].every(Number.isFinite)) throw failure("read the window's position", out);
      return { left, top, width: right - left, height: bottom - top };
    },
    async clickAt(target, found, { screenX, screenY, button, double }) {
      const [down, up] = button === "right" ? [8, 16] : [2, 4];
      await ps(target, { x: screenX, y: screenY, down, up, clicks: double ? 2 : 1 }, CLICK_BODY, true, "click in the window");
    },
    async type(target, text) {
      await ps(target, { keys: sendKeysText(text) }, SENDWAIT_BODY, true, "type into the window");
    },
    async press(target, key) {
      await ps(target, { keys: key.name ? KEYS[key.name].win : `^${key.letter}` }, SENDWAIT_BODY, true, "press the key");
    },
  };
}

/** Parses "x y w h" from xdotool's --shell geometry output. */
function geometryOf(out) {
  const field = (key) => {
    const m = new RegExp(`^${key}=(-?\\d+)`, "m").exec(out);
    return m ? Number(m[1]) : NaN;
  };
  return { left: field("X"), top: field("Y"), width: field("WIDTH"), height: field("HEIGHT") };
}

function linuxDriver(run) {
  const xdo = async (args) => {
    const res = await run("xdotool", args, {});
    if (res.code === -1) throw new Error(XDOTOOL_MISSING);
    return res;
  };

  const front = async (id) => {
    const res = await xdo(["windowactivate", "--sync", id]);
    if (res.code !== 0) throw failure("bring the window to the front", res.out);
  };

  const locate = async (target) => {
    let id = target.handle == null ? "" : String(target.handle);
    if (!id) {
      const search = await xdo(["search", "--name", escapeRegex(target.title.trim())]);
      id = search.out.split(/\r?\n/)[0].trim();
      if (search.code !== 0 || !id) throw notFound(target);
    }
    const geo = await xdo(["getwindowgeometry", "--shell", id]);
    if (geo.code !== 0) throw notFound(target);
    const found = geometryOf(geo.out);
    if (![found.left, found.top, found.width, found.height].every(Number.isFinite)) {
      throw failure("read the window's size", geo.out);
    }
    return { id, ...found };
  };

  return {
    locate,
    async clickAt(target, found, { screenX, screenY, button, double }) {
      await front(found.id);
      const moved = await xdo(["mousemove", String(screenX), String(screenY)]);
      if (moved.code !== 0) throw failure("move the mouse", moved.out);
      const b = button === "right" ? "3" : "1";
      const clicked = await xdo(double ? ["click", "--repeat", "2", b] : ["click", b]);
      if (clicked.code !== 0) throw failure("click in the window", clicked.out);
    },
    async type(target, text) {
      const { id } = await locate(target);
      await front(id);
      const res = await xdo(["type", "--delay", "20", "--", text]);
      if (res.code !== 0) throw failure("type into the window", res.out);
    },
    async press(target, key) {
      const { id } = await locate(target);
      await front(id);
      const name = key.name ? KEYS[key.name].xdo : `ctrl+${key.letter}`;
      const res = await xdo(["key", name]);
      if (res.code !== 0) throw failure("press the key", res.out);
    },
  };
}

/** An AppleScript that finds the window by title, optionally bringing its app to the front. */
function macFindLines(title, activate) {
  return [
    `set wantName to ${appleString(title)}`,
    'tell application "System Events"',
    "repeat with p in (every process whose background only is false)",
    "repeat with w in (every window of p)",
    "try",
    "if (name of w as text) is wantName then",
    ...(activate ? ["set frontmost of p to true"] : []),
    "set pos to position of w",
    "set sz to size of w",
    'return (name of p as text) & tab & (item 1 of pos) & " " & (item 2 of pos) & " " & (item 1 of sz) & " " & (item 2 of sz)',
    "end if",
    "end try",
    "end repeat",
    "end repeat",
    "end tell",
    'return ""',
  ];
}

/** AppleScript lines that type text: each line break is an Enter key. */
function macTypeLines(text) {
  const lines = [];
  text.replace(/\r\n?/g, "\n").split("\n").forEach((segment, i) => {
    if (i > 0) lines.push(`tell application "System Events" to key code ${KEYS.Enter.mac}`);
    if (segment) lines.push(`tell application "System Events" to keystroke ${appleString(segment)}`);
  });
  return lines;
}

function macDriver(run) {
  const osa = (lines) => run("osascript", lines.flatMap((line) => ["-e", line]), {});

  const find = async (target, activate) => {
    const res = await osa(macFindLines(target.title.trim(), activate));
    if (res.code !== 0) throw failure("find the window", res.out);
    const text = res.out.trim();
    if (!text) throw notFound(target);
    return text;
  };

  return {
    async locate(target) {
      const [, nums = ""] = (await find(target, false)).split("\t");
      const [left, top, width, height] = nums.split(" ").map(Number);
      if (![left, top, width, height].every(Number.isFinite)) throw failure("read the window's size", nums);
      return { left, top, width, height };
    },
    async clickAt(target, found, { screenX, screenY, button, double }) {
      await find(target, true);
      const at = `${screenX},${screenY}`;
      let args;
      if (button === "right") args = double ? [`rc:${at}`, `rc:${at}`] : [`rc:${at}`];
      else args = [double ? `dc:${at}` : `c:${at}`];
      const res = await run("cliclick", args, {});
      if (res.code === -1) throw new Error(CLICLICK_MISSING);
      if (res.code !== 0) throw failure("click in the window", res.out);
    },
    async type(target, text) {
      await find(target, true);
      const res = await osa(macTypeLines(text));
      if (res.code !== 0) throw failure("type into the window", res.out);
    },
    async press(target, key) {
      await find(target, true);
      const line = key.name
        ? `tell application "System Events" to key code ${KEYS[key.name].mac}`
        : `tell application "System Events" to keystroke "${key.letter}" using {control down}`;
      const res = await osa([line]);
      if (res.code !== 0) throw failure("press the key", res.out);
    },
  };
}

const DRIVERS = { win32: winDriver, linux: linuxDriver, darwin: macDriver };

/** Finds a window and rejects a minimized or off-screen one, which has no place to click. */
async function locateVisible(driver, target) {
  const found = await driver.locate(target);
  if (found.width <= 0 || found.height <= 0 || found.left <= OFF_SCREEN || found.top <= OFF_SCREEN) {
    throw new Error(MINIMIZED);
  }
  return found;
}

/**
 * Clicking, typing and key presses in an app window. Coordinates are pixels of
 * the captured image; they are mapped onto the window's place on screen.
 * @param {{ platform?: string, run?: (command: string, args: string[], opts?: { input?: string }) => Promise<{ code: number, out: string }> }} [o]
 */
function createDesktopInput({ platform = process.platform, run = runCommand } = {}) {
  const make = Object.prototype.hasOwnProperty.call(DRIVERS, platform) ? DRIVERS[platform] : null;
  const driver = make ? make(run) : null;
  const need = () => {
    if (!driver) throw new Error(UNSUPPORTED);
    return driver;
  };

  return {
    /** The window's place on screen: { left, top, width, height }. */
    async rect(target) {
      const d = need();
      checkTarget(target);
      const { left, top, width, height } = await locateVisible(d, target);
      return { left, top, width, height };
    },

    /**
     * Clicks at a point of the captured image. The window is brought to the front first.
     * @param {{ title: string, handle?: string }} target
     * @param {{ x: number, y: number, imageWidth: number, imageHeight: number, button?: "left" | "right", double?: boolean }} opts
     */
    async click(target, opts = {}) {
      const d = need();
      checkTarget(target);
      const { x, y, imageWidth, imageHeight, button = "left", double = false } = opts;
      if (!(inside(x, imageWidth) && inside(y, imageHeight))) {
        throw new Error(`x and y must be inside the captured image (${imageWidth}×${imageHeight}).`);
      }
      if (button !== "left" && button !== "right") throw new Error('The button must be "left" or "right".');
      const found = await locateVisible(d, target);
      const screenX = found.left + Math.round((x * found.width) / imageWidth);
      const screenY = found.top + Math.round((y * found.height) / imageHeight);
      await d.clickAt(target, found, { screenX, screenY, button, double: Boolean(double) });
    },

    /** Brings the window to the front and types the text into it. Up to 2000 characters. */
    async type(target, text) {
      const d = need();
      checkTarget(target);
      if (typeof text !== "string" || text === "") throw new Error("Give the text to type.");
      if (text.length > MAX_TEXT) throw new Error(`Type up to ${MAX_TEXT} characters at a time. Split longer text into parts.`);
      await d.type(target, text);
    },

    /** Brings the window to the front and presses one key, such as Enter or Control+S. */
    async press(target, key) {
      const d = need();
      checkTarget(target);
      await d.press(target, parseKey(key));
    },
  };
}

module.exports = { createDesktopInput, handleOf, runCommand };
