// Review aids, shared by every app on the shell: a screenshot of the real
// window, and scripted input that replays clicks and keys and takes
// screenshots along the way. Driven by environment variables:
//
//   OPENDECK_SHOT=<file.png>      capture the window after OPENDECK_SHOT_DELAY ms (default 3500), then quit
//   OPENDECK_SHOT_SIZE=<w>x<h>    the window's content size
//   OPENDECK_THEME=light|dark     override the system theme
//   OPENDECK_SCRIPT=<steps.json>  replay steps, then quit. Steps:
//     {"wait":ms} {"click":[x,y]} {"dbl":[x,y]} {"right":[x,y]} {"drag":[x1,y1,x2,y2]}
//     {"key":"Delete","mods":["control"]} {"type":"text"} {"shot":"file.png"} {"eval":"js"}
//   Coordinates are the window's: the strip's band, then the page in front.

const fsp = require("node:fs/promises");
const path = require("node:path");
const { STRIP_H } = require("./tabs.cjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Before the app is ready: a captured window may sit behind others; Windows would report it hidden and stop painting it. */
function prepareReview(app) {
  if (process.env.OPENDECK_SHOT || process.env.OPENDECK_SCRIPT) app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

/** Once ready: the theme override. */
function applyReviewTheme(nativeTheme) {
  if (/^(light|dark)$/.test(process.env.OPENDECK_THEME || "")) nativeTheme.themeSource = process.env.OPENDECK_THEME;
}

/** The whole window as the user sees it: the strip's band over the page in front, stitched from the two views. */
async function captureWindow(win, tabs) {
  const { nativeImage } = require("electron");
  const [w] = win.getContentSize();
  const strip = await tabs.stripContents().capturePage({ x: 0, y: 0, width: w, height: STRIP_H });
  const page = await tabs.activeContents().capturePage();
  const scale = page.getScaleFactors()[0] ?? 1;
  const a = strip.getSize(scale);
  const b = page.getSize(scale);
  const width = Math.min(a.width, b.width);
  const out = Buffer.alloc(width * (a.height + b.height) * 4);
  const copy = (img, size, top) => {
    const src = img.toBitmap({ scaleFactor: scale });
    for (let y = 0; y < size.height; y++) src.copy(out, (top + y) * width * 4, y * size.width * 4, y * size.width * 4 + width * 4);
  };
  copy(strip, a, 0);
  copy(page, b, a.height);
  return nativeImage.createFromBitmap(out, { width, height: a.height + b.height, scaleFactor: scale });
}

async function runScript(file, win, tabs) {
  const steps = JSON.parse(await fsp.readFile(file, "utf8"));
  /** Input below the strip goes to the page in front, in its own coordinates. */
  const target = (y) => (y < STRIP_H ? { wc: tabs.stripContents(), dy: 0 } : { wc: tabs.activeContents(), dy: STRIP_H });
  const mouse = (type, x, y, extra = {}) => {
    const t = target(y);
    t.wc?.sendInputEvent({ type, x, y: y - t.dy, button: "left", clickCount: 1, ...extra });
  };
  const key = (ev) => tabs.activeContents()?.sendInputEvent(ev);
  await sleep(2000);
  for (const s of steps) {
    if (s.wait) await sleep(s.wait);
    else if (s.click || s.right) {
      const [x, y] = s.click || s.right;
      const button = s.right ? "right" : "left";
      mouse("mouseMove", x, y);
      mouse("mouseDown", x, y, { button, modifiers: s.mods || [] });
      mouse("mouseUp", x, y, { button, modifiers: s.mods || [] });
      if (s.right) mouse("contextMenu", x, y, { button });
      await sleep(250);
    } else if (s.dbl) {
      const [x, y] = s.dbl;
      mouse("mouseDown", x, y, { clickCount: 1 });
      mouse("mouseUp", x, y, { clickCount: 1 });
      mouse("mouseDown", x, y, { clickCount: 2 });
      mouse("mouseUp", x, y, { clickCount: 2 });
      await sleep(300);
    } else if (s.drag) {
      const [x1, y1, x2, y2] = s.drag;
      mouse("mouseMove", x1, y1);
      mouse("mouseDown", x1, y1, { modifiers: s.mods || [] });
      for (let i = 1; i <= 12; i++) {
        mouse("mouseMove", x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12, { modifiers: s.mods || [] });
        await sleep(16);
      }
      mouse("mouseUp", x2, y2, { modifiers: s.mods || [] });
      await sleep(300);
    } else if (s.key) {
      key({ type: "keyDown", keyCode: s.key, modifiers: s.mods || [] });
      if (s.key.length === 1 && !(s.mods || []).some((m) => m === "control" || m === "meta")) key({ type: "char", keyCode: s.key });
      key({ type: "keyUp", keyCode: s.key, modifiers: s.mods || [] });
      await sleep(200);
    } else if (s.type) {
      for (const ch of s.type) {
        key({ type: "char", keyCode: ch });
        await sleep(10);
      }
      await sleep(150);
    } else if (s.eval) {
      const r = await tabs.activeContents()?.executeJavaScript(s.eval);
      console.log("eval:", JSON.stringify(r));
    } else if (s.shot) {
      await sleep(150);
      await fsp.writeFile(path.resolve(path.dirname(file), s.shot), (await captureWindow(win, tabs)).toPNG());
    }
  }
}

/** After the window and its tabs exist: size it, and run a screenshot or a script if one was asked for. */
function startReview(app, win, tabs) {
  const [w, h] = (process.env.OPENDECK_SHOT_SIZE || "").split("x").map(Number);
  if (w && h) win.setContentSize(w, h);
  const script = process.env.OPENDECK_SCRIPT;
  const shot = process.env.OPENDECK_SHOT;
  if (script) void runScript(script, win, tabs).catch((e) => console.error(e)).finally(() => app.quit());
  else if (shot) {
    setTimeout(async () => {
      await fsp.writeFile(shot, (await captureWindow(win, tabs)).toPNG());
      app.quit();
    }, Number(process.env.OPENDECK_SHOT_DELAY || 3500));
  }
}

module.exports = { prepareReview, applyReviewTheme, startReview, captureWindow };
