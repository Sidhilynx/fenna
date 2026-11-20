// Files leaving a bot's disk for the person's computer: a native drag out of
// the Crew window (onto the desktop or into Explorer), and "Save a copy to…".
// Every path is checked by the bot's disk (disk.exportable) before anything is
// dragged or copied, and a path the disk refuses never reaches the dialog.

const fs = require("node:fs");
const path = require("node:path");

const MAX_PATHS = 200;
const MAX_PATH_LENGTH = 4096;

/**
 * @param {object} o
 * @param {{ exportable(slug: string, p: string): { abs: string, name: string } }} o.disk
 * @param {object} o.electron  the electron module (nativeImage, BrowserWindow, dialog, app); a fake in tests
 * @param {string} o.iconFile  an image for the drag's picture (a non-empty PNG)
 * @param {(from: string, to: string) => void} [o.copy]  copies a file; fs.copyFileSync by default
 */
function createTransfer({ disk, electron, iconFile, copy = fs.copyFileSync }) {
  let icon = null;
  const dragIcon = () => {
    if (!icon) icon = electron.nativeImage.createFromPath(iconFile);
    return icon;
  };

  /** The files a page named, each checked by the bot's disk. Throws with what to do when one can't go. */
  function checked(slug, paths, max) {
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > max) throw new Error(`Say which files, up to ${max}.`);
    return paths.map((p) => {
      if (typeof p !== "string" || !p || p.length > MAX_PATH_LENGTH) throw new Error("That isn't a file on the bot's disk.");
      return disk.exportable(slug, p);
    });
  }

  /** Starts the native drag of these files, from the window that sent the message. Throws before the drag when a file can't go. */
  function dragOut(sender, slug, paths) {
    const files = checked(slug, paths, MAX_PATHS).map((f) => f.abs);
    sender.startDrag({ file: files[0], files, icon: dragIcon() });
  }

  /** Asks where to save a copy of one file, then copies it there. Resolves to the new path, or null when the person cancels. */
  async function saveCopy(sender, slug, p) {
    const [file] = checked(slug, [p], 1);
    const { BrowserWindow, dialog, app } = electron;
    const win = BrowserWindow.fromWebContents(sender);
    const options = { defaultPath: path.join(app.getPath("downloads"), file.name) };
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (r.canceled || !r.filePath) return null;
    if (path.resolve(r.filePath) === path.resolve(file.abs)) throw new Error("That is the file itself. Choose another place.");
    copy(file.abs, r.filePath);
    return r.filePath;
  }

  return { dragOut, saveCopy, checked };
}

module.exports = { createTransfer, MAX_PATHS };
