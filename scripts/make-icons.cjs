// Render every app's icon (apps/<app>/build/icon.png, 1024×1024) from SVG with
// Electron itself. electron-builder makes the .ico and .icns from these PNGs.
// Run from the repo root: node_modules\electron\dist\electron.exe scripts\make-icons.cjs
//
// The Fenna family: a solid paper shape on an ink tile, and a round bite out
// of the shape's bottom-right corner with a dot inside: the AI's cursor on
// your file. Only the shape changes per app.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const INK = "#141414";
const PAPER = "#ededed";
const FOLD = "#a1a1a1";

// Drawn on a 64-unit grid; the tile spans 2..62. The viewBox leaves the same
// transparent margin as before (64px of 1024 on each side).
const dot = (cx, cy) =>
  `<circle cx="${cx}" cy="${cy}" r="9.5" fill="${INK}"/><circle cx="${cx}" cy="${cy}" r="5" fill="${PAPER}"/>`;

const MARKS = {
  desktop:
    `<rect x="10" y="16" width="42" height="28" rx="3" fill="${PAPER}"/>` +
    `<rect x="16" y="22" width="18" height="3.5" rx="1.75" fill="${INK}"/>` +
    dot(50, 44),
  docs:
    `<path d="M18 9h14l11 11v31a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z" fill="${PAPER}"/>` +
    `<path d="M32 9v9a2 2 0 0 0 2 2h9z" fill="${FOLD}"/>` +
    `<rect x="21" y="28" width="16" height="3" rx="1.5" fill="${INK}"/>` +
    `<rect x="21" y="35" width="16" height="3" rx="1.5" fill="${INK}"/>` +
    `<rect x="21" y="42" width="9" height="3" rx="1.5" fill="${INK}"/>` +
    dot(43, 51),
  sheets:
    `<rect x="11" y="11" width="38" height="38" rx="3" fill="${PAPER}"/>` +
    `<path d="M23.7 11v38M36.3 11v38M11 23.7h38M11 36.3h38" stroke="${INK}" stroke-width="2.6"/>` +
    dot(49, 49),
  whiteboard:
    `<rect x="10" y="12" width="42" height="38" rx="3" fill="${PAPER}"/>` +
    `<rect x="16" y="18" width="11" height="11" rx="1.5" fill="${INK}"/>` +
    `<path d="M27 23.5h7" stroke="${INK}" stroke-width="2.6"/>` +
    `<circle cx="39" cy="23.5" r="5" fill="none" stroke="${INK}" stroke-width="2.6"/>` +
    `<path d="M16 40c3-4 6 4 9 0s6 4 9 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>` +
    dot(50, 48),
};

const svgFor = (mark) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="-2.2857 -2.2857 68.5714 68.5714">` +
  `<rect x="2" y="2" width="60" height="60" rx="14" fill="${INK}"/>${mark}</svg>`;

app.whenReady().then(async () => {
  // Draw each SVG on a 1024px canvas inside a page: exact size, transparent
  // corners, whatever the screen's size or scaling.
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadURL("data:text/html,<html><body></body></html>");
  for (const [name, mark] of Object.entries(MARKS)) {
    const b64 = Buffer.from(svgFor(mark)).toString("base64");
    const dataUrl = await w.webContents.executeJavaScript(`new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 1024;
        c.getContext("2d").drawImage(img, 0, 0, 1024, 1024);
        resolve(c.toDataURL("image/png"));
      };
      img.src = "data:image/svg+xml;base64,${b64}";
    })`);
    const out = path.join(__dirname, "..", "apps", name, "build", "icon.png");
    fs.writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
  }
  app.quit();
});
