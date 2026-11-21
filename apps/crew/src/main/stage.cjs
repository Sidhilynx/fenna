// What a bot shows when it shares its screen in a call: one library
// document in a hidden offscreen editor window (editors.cjs openStage). Its
// frames are pushed to the call's page as JPEGs, only when the window
// paints something new and at most 4 a second, one at a time; the page
// keeps showing the last frame between them. The model never sees these
// frames. While the bot writes to a doc, the window scrolls to its end so
// the call sees the newest text.

const fs = require("node:fs");

const STAGE = { width: 1280, height: 720 };
const FPS = 4;
const JPEG_QUALITY = 72;
const FOLLOW_MS = 400;

/** Scrolls every scrolled box on the page (and the page) to its end. Runs in the editor window. */
const SCROLL_TO_END = `(() => {
  const boxes = [document.scrollingElement, ...document.querySelectorAll("*")].filter((el) => el && el.scrollHeight - el.clientHeight > 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY + (el === document.scrollingElement ? "auto" : "")));
  for (const el of boxes) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
})()`;

/**
 * @param {object} o
 * @param {{ openStage: Function }} o.editors
 * @param {string} o.preload   the editors' preload
 * @param {(ms: number, fn: Function) => any} [o.setTimer]
 */
function createStage({ editors, preload, setTimer = (ms, fn) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h) }) {
  /**
   * Start showing `item` of the bot's library; every new frame goes to push(dataUrl).
   * @returns {{ kind: string, title: string, stop: () => void }}
   */
  function start(slug, item, push) {
    const shown = editors.openStage(slug, item, { ...STAGE, preload });
    const wc = shown.win.webContents;
    let stopped = false;
    let sending = false;
    let latest = null;
    let last = 0;
    let trailing = null;
    let follow = null;
    let watcher = null;

    async function send() {
      if (stopped || sending || !latest) return;
      const image = latest;
      latest = null;
      sending = true;
      last = Date.now();
      try {
        await push(`data:image/jpeg;base64,${image.toJPEG(JPEG_QUALITY).toString("base64")}`);
      } catch {
        /* the call's page is busy or gone: the next frame tries again */
      } finally {
        sending = false;
        if (latest) schedule();
      }
    }

    function schedule() {
      if (trailing || stopped) return;
      const wait = Math.max(0, 1000 / FPS - (Date.now() - last));
      trailing = setTimer(wait, () => {
        trailing = null;
        void send();
      });
    }

    wc.setFrameRate(FPS);
    wc.on("paint", (_e, _dirty, image) => {
      if (stopped || image.isEmpty()) return;
      latest = image;
      schedule();
    });
    wc.once("did-finish-load", () => {
      if (!stopped) wc.invalidate();
    });
    if (shown.kind === "doc") {
      try {
        watcher = fs.watch(shown.root, { recursive: true }, () => {
          if (stopped || follow) return;
          follow = setTimer(FOLLOW_MS, () => {
            follow = null;
            if (!stopped && !wc.isDestroyed()) void wc.executeJavaScript(SCROLL_TO_END).catch(() => {});
          });
        });
      } catch {
        watcher = null;
      }
    }

    return {
      kind: shown.kind,
      title: shown.title,
      /** Paint again, so the call gets a frame now (after it starts presenting). */
      refresh() {
        if (!stopped && !wc.isDestroyed()) wc.invalidate();
      },
      stop() {
        if (stopped) return;
        stopped = true;
        if (trailing) clearTimer(trailing);
        if (follow) clearTimer(follow);
        if (watcher) watcher.close();
        shown.close();
      },
    };
  }

  return { start };
}

module.exports = { createStage, STAGE, FPS };
