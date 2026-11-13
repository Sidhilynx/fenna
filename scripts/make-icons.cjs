// Render every Fenna icon (1024×1024) from SVG with Electron itself:
// docs/media/icons/<product>.png for every app on the roadmap, and
// apps/<app>/build/icon.png for each app that exists, from which
// electron-builder makes the .ico and .icns.
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
  brand:
    `<rect x="10" y="12" width="42" height="38" rx="3" fill="${PAPER}"/>` +
    `<circle cx="20" cy="23" r="5" fill="${INK}"/>` +
    `<circle cx="32" cy="23" r="5" fill="${FOLD}"/>` +
    `<circle cx="44" cy="23" r="3.7" fill="none" stroke="${INK}" stroke-width="2.6"/>` +
    `<rect x="15" y="34" width="20" height="4" rx="2" fill="${INK}"/>` +
    `<rect x="15" y="41.5" width="12" height="3" rx="1.5" fill="${INK}"/>` +
    dot(50, 48),
  data:
    `<rect x="10" y="12" width="42" height="38" rx="3" fill="${PAPER}"/>` +
    `<rect x="16" y="33" width="6" height="11" rx="1.5" fill="${INK}"/>` +
    `<rect x="25" y="26" width="6" height="18" rx="1.5" fill="${INK}"/>` +
    `<rect x="34" y="19" width="6" height="25" rx="1.5" fill="${INK}"/>` +
    dot(50, 48),
  design:
    `<rect x="10" y="12" width="42" height="38" rx="3" fill="${PAPER}"/>` +
    `<rect x="18" y="20" width="18" height="16" fill="none" stroke="${INK}" stroke-width="1.6"/>` +
    `<path d="M15.5 17.5h5v5h-5zM33.5 17.5h5v5h-5zM15.5 33.5h5v5h-5zM33.5 33.5h5v5h-5z" fill="${INK}"/>` +
    `<circle cx="27" cy="28" r="4" fill="${INK}"/>` +
    dot(50, 48),
  meeting:
    `<path d="M13 13h36a3 3 0 0 1 3 3v25a3 3 0 0 1-3 3H24l-8 7v-7h-3a3 3 0 0 1-3-3V16a3 3 0 0 1 3-3z" fill="${PAPER}"/>` +
    `<path d="M18 25.5v5M23.5 21.5v13M29 18.5v19M34.5 22.5v11M40 25.5v5" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
    dot(50, 44),
  motion:
    `<rect x="10" y="12" width="42" height="38" rx="3" fill="${PAPER}"/>` +
    `<path d="M23 19.5v15a1 1 0 0 0 1.5 .9l12.5-7.5a1 1 0 0 0 0-1.8l-12.5-7.5a1 1 0 0 0-1.5 .9z" fill="${INK}"/>` +
    `<path d="M15 43h22" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="24" cy="43" r="3" fill="${INK}"/>` +
    dot(50, 48),
};

// The product name each mark is published under; the mark's key is its app
// folder.
const PRODUCTS = {
  desktop: "slides",
  docs: "docs",
  sheets: "sheets",
  whiteboard: "whiteboard",
  brand: "brand",
  data: "data",
  design: "design",
  meeting: "meeting",
  motion: "motion",
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
    const png = Buffer.from(dataUrl.split(",")[1], "base64");
    const media = path.join(__dirname, "..", "docs", "media", "icons");
    fs.mkdirSync(media, { recursive: true });
    fs.writeFileSync(path.join(media, `${PRODUCTS[name]}.png`), png);
    const build = path.join(__dirname, "..", "apps", name, "build");
    if (fs.existsSync(build)) fs.writeFileSync(path.join(build, "icon.png"), png);
  }
  app.quit();
});
