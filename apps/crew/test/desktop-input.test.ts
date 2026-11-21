import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createDesktopInput, handleOf, runCommand } = require("../src/main/desktop-input.cjs");

type Reply = { code: number; out: string };
type Call = { command: string; args: string[] };

/** A fake run: records every call and answers with what the reply function returns. */
function fakeRun(reply: (command: string, args: string[]) => Reply) {
  const calls: Call[] = [];
  const run = vi.fn(async (command: string, args: string[]) => {
    calls.push({ command, args });
    return reply(command, args);
  });
  return { run, calls };
}

const OK: Reply = { code: 0, out: "" };

/** The JSON payload a Windows script carries, decoded from its base64 literal. */
function payloadOf(script: string): Record<string, unknown> {
  const m = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(script);
  if (!m) throw new Error("the script has no payload");
  return JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
}

/** The script is the last argument of every powershell.exe call. */
function scriptOf(call: Call): string {
  return call.args[call.args.length - 1];
}

const WIN_TARGET = { title: "Flutter demo" };
const SIZE = { imageWidth: 1280, imageHeight: 960 };

describe("handleOf", () => {
  it("reads the decimal handle from a desktopCapturer window id", () => {
    expect(handleOf("window:132456:0")).toBe("132456");
  });

  it("gives null for screens, malformed ids and nothing", () => {
    expect(handleOf("screen:0:0")).toBeNull();
    expect(handleOf("window:abc:0")).toBeNull();
    expect(handleOf("window:132456")).toBeNull();
    expect(handleOf(undefined)).toBeNull();
  });
});

describe("runCommand", () => {
  it("resolves code -1 and a plain message when the program isn't installed", async () => {
    const r = await runCommand("crew-no-such-program-xyz", []);
    expect(r).toEqual({ code: -1, out: "crew-no-such-program-xyz isn't installed." });
  });

  it("returns the output and exit code of a program that runs", async () => {
    const r = await runCommand(process.execPath, ["-e", "process.stdout.write('hi'); process.exit(4)"]);
    expect(r).toEqual({ code: 4, out: "hi" });
  });

  it("writes input to the program's stdin", async () => {
    const r = await runCommand(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input: "piped" });
    expect(r.out).toBe("piped");
  });
});

describe("bounds and arguments", () => {
  const { run } = fakeRun(() => OK);
  const api = createDesktopInput({ platform: "win32", run });

  it("rejects points outside the captured image", async () => {
    const msg = "x and y must be inside the captured image (1280×960).";
    await expect(api.click(WIN_TARGET, { x: 1280, y: 0, ...SIZE })).rejects.toThrow(msg);
    await expect(api.click(WIN_TARGET, { x: -1, y: 0, ...SIZE })).rejects.toThrow(msg);
    await expect(api.click(WIN_TARGET, { x: 0, y: 960, ...SIZE })).rejects.toThrow(msg);
    await expect(api.click(WIN_TARGET, { x: Number.NaN, y: 0, ...SIZE })).rejects.toThrow(msg);
  });

  it("rejects a button other than left or right", async () => {
    await expect(api.click(WIN_TARGET, { x: 1, y: 1, ...SIZE, button: "middle" as "left" })).rejects.toThrow(
      'The button must be "left" or "right".',
    );
  });

  it("rejects text longer than 2000 characters and accepts exactly 2000", async () => {
    await expect(api.type(WIN_TARGET, "a".repeat(2001))).rejects.toThrow("Type up to 2000 characters at a time");
    await expect(api.type(WIN_TARGET, "")).rejects.toThrow("Give the text to type.");
    await expect(api.type(WIN_TARGET, "a".repeat(2000))).resolves.toBeUndefined();
  });

  it("needs a window title", async () => {
    await expect(api.rect({ title: "  " })).rejects.toThrow("Name the window");
    await expect(api.rect({ title: "Notes", handle: "12ab" })).rejects.toThrow("The window handle must be a number");
  });

  it("says so on a platform without support, before running anything", async () => {
    const calls = fakeRun(() => OK);
    const other = createDesktopInput({ platform: "freebsd", run: calls.run });
    const msg = "Clicking in app windows isn't supported on this system.";
    await expect(other.rect(WIN_TARGET)).rejects.toThrow(msg);
    await expect(other.click(WIN_TARGET, { x: 0, y: 0, ...SIZE })).rejects.toThrow(msg);
    await expect(other.type(WIN_TARGET, "a")).rejects.toThrow(msg);
    await expect(other.press(WIN_TARGET, "Enter")).rejects.toThrow(msg);
    expect(calls.run).not.toHaveBeenCalled();
  });
});

describe("keys", () => {
  it("refuses Alt+F4 and closing keys with the app-stop message", async () => {
    const api = createDesktopInput({ platform: "win32", run: fakeRun(() => OK).run });
    const msg = "Crew doesn't close apps by key. Stop the app's command instead.";
    await expect(api.press(WIN_TARGET, "Alt+F4")).rejects.toThrow(msg);
    await expect(api.press(WIN_TARGET, "F4+Alt")).rejects.toThrow(msg);
    await expect(api.press(WIN_TARGET, "Control+W")).rejects.toThrow(msg);
  });

  it("lists the allowed keys for an unknown one", async () => {
    const api = createDesktopInput({ platform: "win32", run: fakeRun(() => OK).run });
    const err = await api.press(WIN_TARGET, "F5").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      'Unknown key "F5". Allowed: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, and Control+A to Control+Z.',
    );
  });

  it("accepts named keys in any case", async () => {
    const { run, calls } = fakeRun(() => OK);
    const api = createDesktopInput({ platform: "win32", run });
    await api.press(WIN_TARGET, "enter");
    expect(payloadOf(scriptOf(calls[0])).keys).toBe("{ENTER}");
  });
});

describe("windows", () => {
  /** A Windows fake: rect answers "L T R B", every other script answers OK. */
  function winRun(rect = "100 50 740 530") {
    return fakeRun((command, args) => {
      const script = args[args.length - 1];
      if (command === "powershell.exe" && script.includes("GetRect")) return { code: 0, out: rect };
      return OK;
    });
  }

  it("reads the window rectangle and runs PowerShell with the fixed arguments", async () => {
    const { run, calls } = winRun();
    const api = createDesktopInput({ platform: "win32", run });
    expect(await api.rect(WIN_TARGET)).toEqual({ left: 100, top: 50, width: 640, height: 480 });
    expect(calls[0].command).toBe("powershell.exe");
    expect(calls[0].args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]);
    expect(payloadOf(scriptOf(calls[0]))).toEqual({ handle: null, title: "Flutter demo" });
  });

  it("passes a handle in the payload when the capture gave one", async () => {
    const { run, calls } = winRun();
    await createDesktopInput({ platform: "win32", run }).rect({ title: "Flutter demo", handle: "132456" });
    expect(payloadOf(scriptOf(calls[0])).handle).toBe("132456");
  });

  it("maps a point of the captured image onto the screen (1280×960 of a 640×480 window at 100,50)", async () => {
    const { run, calls } = winRun();
    await createDesktopInput({ platform: "win32", run }).click(WIN_TARGET, { x: 640, y: 480, ...SIZE });
    const clickCall = calls[calls.length - 1];
    const p = payloadOf(scriptOf(clickCall));
    expect(p.x).toBe(420);
    expect(p.y).toBe(290);
    expect(p.down).toBe(2);
    expect(p.up).toBe(4);
    expect(p.clicks).toBe(1);
    expect(scriptOf(clickCall)).toContain("SetForegroundWindow");
  });

  it("uses the right-button flags and two clicks for a double click", async () => {
    const { run, calls } = winRun();
    const api = createDesktopInput({ platform: "win32", run });
    await api.click(WIN_TARGET, { x: 0, y: 0, ...SIZE, button: "right", double: true });
    const p = payloadOf(scriptOf(calls[calls.length - 1]));
    expect(p).toMatchObject({ down: 8, up: 16, clicks: 2, x: 100, y: 50 });
  });

  it("refuses a minimized window, which reports its place far off screen", async () => {
    const { run } = winRun("-32000 -32000 -31840 -31972");
    await expect(createDesktopInput({ platform: "win32", run }).click(WIN_TARGET, { x: 1, y: 1, ...SIZE })).rejects.toThrow(
      "That window is minimized or off screen.",
    );
  });

  it("never puts the raw title or text into the script", async () => {
    const title = `Bob's "Notes" $(calc) \`whoami\``;
    const text = `"; Remove-Item C:\\ -Recurse $(Get-Process) \`n`;
    const { run, calls } = winRun();
    const api = createDesktopInput({ platform: "win32", run });
    await api.rect({ title });
    await api.type({ title }, text);
    for (const call of calls) {
      const script = scriptOf(call);
      expect(script).not.toContain(title);
      expect(script).not.toContain("$(calc)");
      expect(script).not.toContain("Remove-Item");
      expect(script).not.toContain("Get-Process");
    }
    expect(payloadOf(scriptOf(calls[0])).title).toBe(title);
  });

  it("escapes typed text for SendKeys and keeps line breaks as Enter", async () => {
    const { run, calls } = winRun();
    await createDesktopInput({ platform: "win32", run }).type(WIN_TARGET, "a+b^c%d~e(f)g{h}i[j]k\nnext");
    const p = payloadOf(scriptOf(calls[calls.length - 1]));
    expect(p.keys).toBe("a{+}b{^}c{%}d{~}e{(}f{)}g{{}h{}}i{[}j{]}k{ENTER}next");
    expect(scriptOf(calls[calls.length - 1])).toContain("SendWait");
  });

  it("maps Control+letter to the caret form and named keys to SendKeys codes", async () => {
    const { run, calls } = winRun();
    const api = createDesktopInput({ platform: "win32", run });
    await api.press(WIN_TARGET, "Control+S");
    expect(payloadOf(scriptOf(calls[calls.length - 1])).keys).toBe("^s");
    await api.press(WIN_TARGET, "ArrowUp");
    expect(payloadOf(scriptOf(calls[calls.length - 1])).keys).toBe("{UP}");
  });

  it("says the window is not open when the script finds no window", async () => {
    const run = vi.fn(async () => ({ code: 3, out: "" }));
    await expect(createDesktopInput({ platform: "win32", run }).type(WIN_TARGET, "a")).rejects.toThrow(
      'No open window is named "Flutter demo".',
    );
  });

  it("reports the first line of a PowerShell error", async () => {
    const run = vi.fn(async () => ({ code: 1, out: "Add-Type failed\nat line 4" }));
    await expect(createDesktopInput({ platform: "win32", run }).press(WIN_TARGET, "Enter")).rejects.toThrow(
      "Crew couldn't press the key. Add-Type failed",
    );
  });
});

describe("linux", () => {
  /** A Linux fake: search finds window 12345, geometry is 640×480 at 100,50. */
  function linuxRun(search: Reply = { code: 0, out: "12345\n" }) {
    return fakeRun((command, args) => {
      if (args[0] === "search") return search;
      if (args[0] === "getwindowgeometry") {
        return { code: 0, out: "WINDOW=12345\nX=100\nY=50\nWIDTH=640\nHEIGHT=480\nSCREEN=0\n" };
      }
      return OK;
    });
  }

  it("finds the window by a regex-escaped name and parses its geometry", async () => {
    const { run, calls } = linuxRun();
    const api = createDesktopInput({ platform: "linux", run });
    expect(await api.rect({ title: "Demo (v1.2)" })).toEqual({ left: 100, top: 50, width: 640, height: 480 });
    expect(calls[0]).toEqual({ command: "xdotool", args: ["search", "--name", "Demo \\(v1\\.2\\)"] });
    expect(calls[1]).toEqual({ command: "xdotool", args: ["getwindowgeometry", "--shell", "12345"] });
  });

  it("skips the search when the capture gave a handle", async () => {
    const { run, calls } = linuxRun();
    await createDesktopInput({ platform: "linux", run }).rect({ title: "Demo", handle: "777" });
    expect(calls.map((c) => c.args[0])).toEqual(["getwindowgeometry"]);
    expect(calls[0].args).toEqual(["getwindowgeometry", "--shell", "777"]);
  });

  it("says the window is not open when search finds nothing", async () => {
    const { run } = linuxRun({ code: 1, out: "" });
    await expect(createDesktopInput({ platform: "linux", run }).rect({ title: "Nope" })).rejects.toThrow(
      'No open window is named "Nope".',
    );
  });

  it("clicks after activating the window, moving first", async () => {
    const { run, calls } = linuxRun();
    await createDesktopInput({ platform: "linux", run }).click(WIN_TARGET, { x: 640, y: 480, ...SIZE });
    expect(calls.slice(-3).map((c) => c.args)).toEqual([
      ["windowactivate", "--sync", "12345"],
      ["mousemove", "420", "290"],
      ["click", "1"],
    ]);
  });

  it("double clicks and right clicks with xdotool's options", async () => {
    const { run, calls } = linuxRun();
    const api = createDesktopInput({ platform: "linux", run });
    await api.click(WIN_TARGET, { x: 640, y: 480, ...SIZE, double: true });
    expect(calls[calls.length - 1].args).toEqual(["click", "--repeat", "2", "1"]);
    await api.click(WIN_TARGET, { x: 640, y: 480, ...SIZE, button: "right" });
    expect(calls[calls.length - 1].args).toEqual(["click", "3"]);
  });

  it("types with a 20 ms delay after the -- separator", async () => {
    const { run, calls } = linuxRun();
    await createDesktopInput({ platform: "linux", run }).type(WIN_TARGET, "-rf hello");
    expect(calls.slice(-2).map((c) => c.args)).toEqual([
      ["windowactivate", "--sync", "12345"],
      ["type", "--delay", "20", "--", "-rf hello"],
    ]);
  });

  it("presses named keys and Control+letter in xdotool names", async () => {
    const { run, calls } = linuxRun();
    const api = createDesktopInput({ platform: "linux", run });
    await api.press(WIN_TARGET, "Enter");
    expect(calls[calls.length - 1].args).toEqual(["key", "Return"]);
    await api.press(WIN_TARGET, "Control+S");
    expect(calls[calls.length - 1].args).toEqual(["key", "ctrl+s"]);
  });

  it("explains how to install xdotool when it is missing", async () => {
    const run = vi.fn(async () => ({ code: -1, out: "xdotool isn't installed." }));
    const api = createDesktopInput({ platform: "linux", run });
    const msg = "Clicking in app windows on Linux needs xdotool (sudo apt install xdotool).";
    await expect(api.rect(WIN_TARGET)).rejects.toThrow(msg);
    await expect(api.type(WIN_TARGET, "a")).rejects.toThrow(msg);
  });
});

describe("macOS", () => {
  /** A macOS fake: the window is at 100,50 and 640×480; cliclick and keystrokes succeed. */
  function macRun(found = "Notes\t100 50 640 480\n") {
    return fakeRun((command, args) => {
      if (command === "osascript" && args.some((a) => a.includes("wantName"))) return { code: 0, out: found };
      return OK;
    });
  }

  it("reads the window rectangle through System Events", async () => {
    const { run, calls } = macRun();
    expect(await createDesktopInput({ platform: "darwin", run }).rect({ title: "Notes" })).toEqual({
      left: 100,
      top: 50,
      width: 640,
      height: 480,
    });
    expect(calls[0].command).toBe("osascript");
    expect(calls[0].args.filter((_, i) => i % 2 === 0).every((a) => a === "-e")).toBe(true);
    expect(calls[0].args).toContain('set wantName to "Notes"');
  });

  it("escapes backslashes and double quotes in AppleScript strings", async () => {
    const { run, calls } = macRun();
    await createDesktopInput({ platform: "darwin", run }).rect({ title: 'Say "hi" \\ there' });
    expect(calls[0].args).toContain('set wantName to "Say \\"hi\\" \\\\ there"');
  });

  it("activates the window, then clicks with cliclick at the mapped point", async () => {
    const { run, calls } = macRun();
    await createDesktopInput({ platform: "darwin", run }).click(WIN_TARGET, { x: 640, y: 480, ...SIZE });
    expect(calls[calls.length - 1]).toEqual({ command: "cliclick", args: ["c:420,290"] });
    expect(calls[calls.length - 2].args).toContain("set frontmost of p to true");
  });

  it("uses cliclick's right-click and double-click commands", async () => {
    const { run, calls } = macRun();
    const api = createDesktopInput({ platform: "darwin", run });
    await api.click(WIN_TARGET, { x: 640, y: 480, ...SIZE, double: true });
    expect(calls[calls.length - 1].args).toEqual(["dc:420,290"]);
    await api.click(WIN_TARGET, { x: 640, y: 480, ...SIZE, button: "right" });
    expect(calls[calls.length - 1].args).toEqual(["rc:420,290"]);
  });

  it("explains how to install cliclick when it is missing", async () => {
    const { run } = fakeRun((command) => (command === "cliclick" ? { code: -1, out: "cliclick isn't installed." } : { code: 0, out: "Notes\t100 50 640 480\n" }));
    await expect(createDesktopInput({ platform: "darwin", run }).click(WIN_TARGET, { x: 1, y: 1, ...SIZE })).rejects.toThrow(
      "Clicking in app windows on macOS needs cliclick (brew install cliclick).",
    );
  });

  it("escapes typed text and turns line breaks into Return", async () => {
    const { run, calls } = macRun();
    await createDesktopInput({ platform: "darwin", run }).type(WIN_TARGET, 'He said "yes"\nok');
    const lines = calls[calls.length - 1].args.filter((_, i) => i % 2 === 1);
    expect(lines).toEqual([
      'tell application "System Events" to keystroke "He said \\"yes\\""',
      'tell application "System Events" to key code 36',
      'tell application "System Events" to keystroke "ok"',
    ]);
  });

  it("presses named keys by key code and Control+letter by keystroke", async () => {
    const { run, calls } = macRun();
    const api = createDesktopInput({ platform: "darwin", run });
    await api.press(WIN_TARGET, "Enter");
    expect(calls[calls.length - 1].args).toEqual(["-e", 'tell application "System Events" to key code 36']);
    await api.press(WIN_TARGET, "Control+A");
    expect(calls[calls.length - 1].args).toEqual(["-e", 'tell application "System Events" to keystroke "a" using {control down}']);
  });

  it("says the window is not open when no window has that name", async () => {
    const { run } = macRun("");
    await expect(createDesktopInput({ platform: "darwin", run }).rect({ title: "Ghost" })).rejects.toThrow(
      'No open window is named "Ghost".',
    );
  });
});
