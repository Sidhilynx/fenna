import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createAppWindows } = require("../src/main/appwindows.cjs");

type Thumb = { isEmpty: () => boolean; toPNG: () => Buffer; getSize: () => { width: number; height: number } };
type Src = { id: string; name: string; thumbnail: Thumb };

const PNG = Buffer.from("PNG bytes");
const PNG64 = PNG.toString("base64");

/** A thumbnail that is drawn (not empty) and reports the given size. */
function thumb(size = { width: 1280, height: 960 }, empty = false): Thumb {
  return { isEmpty: () => empty, toPNG: () => PNG, getSize: () => size };
}

/** A fake desktopCapturer whose getSources returns the given windows. */
function capturer(sources: Src[]) {
  return { getSources: vi.fn(async () => sources.map((s) => ({ ...s }))) };
}

const WINDOWS: Src[] = [
  { id: "win:1", name: "Flutter demo", thumbnail: thumb() },
  { id: "win:2", name: "", thumbnail: thumb() },
  { id: "win:3", name: "Fenna Crew", thumbnail: thumb() },
  { id: "win:4", name: "Fenna Slides - deck.fenna", thumbnail: thumb() },
  { id: "win:5", name: "Android Emulator - Pixel_7", thumbnail: thumb() },
  { id: "win:6", name: "Notes", thumbnail: thumb() },
];

describe("list", () => {
  it("lists visible windows with refs, skipping Crew's own and unnamed ones", async () => {
    const dc = capturer(WINDOWS);
    const aw = createAppWindows({ desktopCapturer: dc });
    const r = await aw.list();
    expect(r.text).toBe("w1  Flutter demo\nw2  Android Emulator - Pixel_7\nw3  Notes");
    expect(dc.getSources).toHaveBeenCalledWith({ types: ["window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  });

  it("says how to start the app when no windows are open", async () => {
    const aw = createAppWindows({ desktopCapturer: capturer([WINDOWS[2], WINDOWS[1]]) });
    expect((await aw.list()).text).toBe("No app windows are open. Start the app with your shell first, then list again.");
  });

  it("reassigns refs on every list", async () => {
    let sources = WINDOWS;
    const dc = { getSources: vi.fn(async () => sources.map((s) => ({ ...s }))) };
    const aw = createAppWindows({ desktopCapturer: dc });
    await aw.list();
    sources = [WINDOWS[5], WINDOWS[0]];
    expect((await aw.list()).text).toBe("w1  Notes\nw2  Flutter demo");
    const r = await aw.capture({ window: "w1" });
    expect(r.text).toBe('Captured "Notes" at 1280×960.');
  });
});

describe("capture", () => {
  it("captures by ref from the last list and returns a base64 PNG", async () => {
    const aw = createAppWindows({ desktopCapturer: capturer(WINDOWS) });
    await aw.list();
    const r = await aw.capture({ window: "w2" });
    expect(r).toEqual({
      text: 'Captured "Android Emulator - Pixel_7" at 1280×960.',
      image: { data: PNG64, mimeType: "image/png" },
    });
  });

  it("captures by a name part, ignoring case", async () => {
    const aw = createAppWindows({ desktopCapturer: capturer(WINDOWS) });
    const r = await aw.capture({ window: "FLUTTER" });
    expect(r.text).toBe('Captured "Flutter demo" at 1280×960.');
  });

  it("prefers an exact name over partial matches", async () => {
    const aw = createAppWindows({
      desktopCapturer: capturer([
        { id: "a", name: "Notes", thumbnail: thumb() },
        { id: "b", name: "Notes 2", thumbnail: thumb() },
      ]),
    });
    expect((await aw.capture({ window: "notes" })).text).toBe('Captured "Notes" at 1280×960.');
  });

  it("throws listing the names when a name matches several windows", async () => {
    const aw = createAppWindows({
      desktopCapturer: capturer([
        { id: "a", name: "Editor - a.txt", thumbnail: thumb() },
        { id: "b", name: "Editor - b.txt", thumbnail: thumb() },
      ]),
    });
    await expect(aw.capture({ window: "editor" })).rejects.toThrow('Several windows match "editor": "Editor - a.txt", "Editor - b.txt".');
  });

  it("throws when no window matches the name", async () => {
    const aw = createAppWindows({ desktopCapturer: capturer(WINDOWS) });
    await expect(aw.capture({ window: "Zed" })).rejects.toThrow('No open window has "Zed" in its name.');
  });

  it("tells the bot to list again for a ref it never got", async () => {
    const aw = createAppWindows({ desktopCapturer: capturer(WINDOWS) });
    await expect(aw.capture({ window: "w1" })).rejects.toThrow("There is no window w1 in the last list. Run the list action again");
    await aw.list();
    await expect(aw.capture({ window: "w9" })).rejects.toThrow("There is no window w9 in the last list. Run the list action again");
  });

  it("says the window is gone when a listed ref has closed", async () => {
    let sources = WINDOWS;
    const dc = { getSources: vi.fn(async () => sources.map((s) => ({ ...s }))) };
    const aw = createAppWindows({ desktopCapturer: dc });
    await aw.list();
    sources = [WINDOWS[0]];
    await expect(aw.capture({ window: "w2" })).rejects.toThrow('"Android Emulator - Pixel_7" is gone. Run the list action again');
  });

  it("says to bring the window forward when its thumbnail is empty", async () => {
    const aw = createAppWindows({
      desktopCapturer: capturer([{ id: "a", name: "Hidden app", thumbnail: thumb({ width: 0, height: 0 }, true) }]),
    });
    await expect(aw.capture({ window: "hidden" })).rejects.toThrow("That window is minimized or hidden. Bring it to the front and capture again.");
  });

  it("asks for a window when none is named", async () => {
    const aw = createAppWindows({ desktopCapturer: capturer(WINDOWS) });
    await expect(aw.capture({})).rejects.toThrow("Name the window to capture");
  });

  it("defaults to 1280 wide and 0.75 times that tall", async () => {
    const dc = capturer(WINDOWS);
    const aw = createAppWindows({ desktopCapturer: dc });
    await aw.capture({ window: "notes" });
    expect(dc.getSources).toHaveBeenCalledWith({ types: ["window"], thumbnailSize: { width: 1280, height: 960 }, fetchWindowIcons: false });
  });

  it.each([
    [100, 320, 240],
    [320, 320, 240],
    [1000, 1000, 750],
    [1921, 1920, 1440],
    [5000, 1920, 1440],
    ["800", 800, 600],
    [undefined, 1280, 960],
    [null, 1280, 960],
    ["wide", 1280, 960],
  ])("width %s captures at %s x %s", async (width, w, h) => {
    const dc = capturer(WINDOWS);
    const aw = createAppWindows({ desktopCapturer: dc });
    await aw.capture({ window: "notes", width });
    expect(dc.getSources).toHaveBeenCalledWith({ types: ["window"], thumbnailSize: { width: w, height: h }, fetchWindowIcons: false });
  });

  it("reports the size the picture actually has", async () => {
    const aw = createAppWindows({
      desktopCapturer: capturer([{ id: "a", name: "Qt app", thumbnail: thumb({ width: 640, height: 480 }) }]),
    });
    expect((await aw.capture({ window: "qt" })).text).toBe('Captured "Qt app" at 640×480.');
  });
});

describe("no capturer", () => {
  it("every call says this needs the Crew app", async () => {
    const aw = createAppWindows({ desktopCapturer: null });
    const msg = "Seeing app windows needs the Crew app.";
    await expect(aw.list()).rejects.toThrow(msg);
    await expect(aw.capture({ window: "w1" })).rejects.toThrow(msg);
    await expect(aw.handle({}, { action: "list" })).rejects.toThrow(msg);
    await expect(aw.handle({}, { action: "nope" })).rejects.toThrow(msg);
  });
});

describe("handle", () => {
  it("dispatches list and capture", async () => {
    const aw = createAppWindows({ desktopCapturer: capturer(WINDOWS) });
    expect((await aw.handle({}, { action: "list" })).text).toBe("w1  Flutter demo\nw2  Android Emulator - Pixel_7\nw3  Notes");
    const r = await aw.handle({}, { action: "capture", window: "w3", width: 640 });
    expect(r.text).toBe('Captured "Notes" at 1280×960.');
  });

  it("refuses any other action in plain words", async () => {
    const aw = createAppWindows({ desktopCapturer: capturer(WINDOWS) });
    await expect(aw.handle({}, { action: "drag" })).rejects.toThrow('Use the action list, capture, click, type or press, not "drag".');
    await expect(aw.handle({}, {})).rejects.toThrow('Use the action list, capture, click, type or press, not "".');
  });
});

describe("click, type and press in the last captured window", () => {
  const input = () => ({ click: vi.fn(async () => {}), type: vi.fn(async () => {}), press: vi.fn(async () => {}) });
  const SRC: Src[] = [{ id: "window:132456:0", name: "Flutter demo", thumbnail: thumb({ width: 1280, height: 960 }) }, { id: "window:777:0", name: "Notes", thumbnail: thumb() }];

  it("needs a capture first, then measures clicks in that picture's pixels", async () => {
    const io = input();
    const aw = createAppWindows({ desktopCapturer: capturer(SRC), input: io });
    await expect(aw.handle({}, { action: "click", x: 10, y: 10 })).rejects.toThrow(/Capture the window first/);
    await aw.handle({}, { action: "capture", window: "Flutter" });
    const r = await aw.handle({}, { action: "click", x: 640.4, y: 480, double: true });
    expect(io.click).toHaveBeenCalledWith({ title: "Flutter demo", handle: "132456" }, { x: 640, y: 480, imageWidth: 1280, imageHeight: 960, button: "left", double: true });
    expect(r.text).toMatch(/Capture again/);
  });

  it("types and presses keys in the captured window only", async () => {
    const io = input();
    const aw = createAppWindows({ desktopCapturer: capturer(SRC), input: io });
    await aw.handle({}, { action: "capture", window: "Flutter" });
    await aw.handle({}, { action: "type", text: "hello" });
    await aw.handle({}, { action: "press", key: "Enter" });
    expect(io.type).toHaveBeenCalledWith({ title: "Flutter demo", handle: "132456" }, "hello");
    expect(io.press).toHaveBeenCalledWith({ title: "Flutter demo", handle: "132456" }, "Enter");
    await expect(aw.handle({}, { action: "type", window: "Notes", text: "x" })).rejects.toThrow(/last capture was "Flutter demo"/);
    await expect(aw.handle({}, { action: "click" })).rejects.toThrow(/Give x and y/);
    await expect(aw.handle({}, { action: "type", text: "" })).rejects.toThrow(/Say the text/);
  });

  it("says when input isn't available, and which actions move the mouse", async () => {
    const aw = createAppWindows({ desktopCapturer: capturer(SRC) });
    await aw.handle({}, { action: "capture", window: "Flutter" });
    await expect(aw.handle({}, { action: "click", x: 1, y: 1 })).rejects.toThrow(/isn't available here/);
    expect(["click", "type", "press", "capture", "list"].map(aw.usesInput)).toEqual([true, true, true, false, false]);
  });
});
