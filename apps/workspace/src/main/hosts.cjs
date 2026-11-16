// Folder hosts and descriptors for all five Fenna products.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createFolderHost } = require("@opendeck/shell/main");
const { newDeckFiles } = require("@opendeck/format");
const { newDocFiles } = require("@opendeck/doc");
const { newWorkbookFiles } = require("@opendeck/sheet");
const { newBoardFiles } = require("@opendeck/board");
const { newDesignFiles } = require("@opendeck/artboard");

const SLIDE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TAB_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SHEET_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ARTBOARD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.html$/;

const MAX_COVER = 500 * 1024;

async function describeDeck(root) {
  const text = await fsp.readFile(path.join(root, "deck.json"), "utf8").catch(() => null);
  const slidesDir = path.join(root, "slides");
  if (text === null && !fs.existsSync(slidesDir)) return null;
  let index = null;
  try {
    index = text ? JSON.parse(text) : null;
  } catch {}
  const times = await Promise.all([path.join(root, "deck.json"), slidesDir].map((p) => fsp.stat(p).then((s) => s.mtimeMs, () => 0)));
  const first = index && Array.isArray(index.slides) && typeof index.slides[0] === "string" && SLIDE_ID.test(index.slides[0]) ? index.slides[0] : null;
  const coverFile = first ? path.join(slidesDir, `${first}.html`) : null;
  const size = coverFile ? await fsp.stat(coverFile).then((s) => s.size, () => Infinity) : Infinity;
  const cover = size <= MAX_COVER ? await fsp.readFile(coverFile, "utf8").catch(() => null) : null;
  const title = index && typeof index.title === "string" && index.title.trim() ? index.title.trim().slice(0, 200) : path.basename(root);
  return { title, edited: Math.max(...times), index, cover };
}

async function describeDoc(root) {
  const text = await fsp.readFile(path.join(root, "doc.json"), "utf8").catch(() => null);
  const tabsDir = path.join(root, "tabs");
  if (text === null && !fs.existsSync(tabsDir)) return null;
  let index = null;
  try {
    index = text ? JSON.parse(text) : null;
  } catch {}
  const times = await Promise.all([path.join(root, "doc.json"), tabsDir].map((p) => fsp.stat(p).then((s) => s.mtimeMs, () => 0)));
  const first = index && Array.isArray(index.tabs) && typeof index.tabs[0] === "string" && TAB_ID.test(index.tabs[0]) ? index.tabs[0] : null;
  const coverFile = first ? path.join(tabsDir, `${first}.html`) : null;
  const size = coverFile ? await fsp.stat(coverFile).then((s) => s.size, () => Infinity) : Infinity;
  const cover = size <= MAX_COVER ? await fsp.readFile(coverFile, "utf8").catch(() => null) : null;
  const title = index && typeof index.title === "string" && index.title.trim() ? index.title.trim().slice(0, 200) : path.basename(root);
  return { title, edited: Math.max(...times), index, cover };
}

async function describeSheet(root) {
  const text = await fsp.readFile(path.join(root, "sheet.json"), "utf8").catch(() => null);
  const sheetsDir = path.join(root, "sheets");
  if (text === null && !fs.existsSync(sheetsDir)) return null;
  let index = null;
  try {
    index = text ? JSON.parse(text) : null;
  } catch {}
  const times = await Promise.all([path.join(root, "sheet.json"), sheetsDir].map((p) => fsp.stat(p).then((s) => s.mtimeMs, () => 0)));
  const title = index && typeof index.title === "string" && index.title.trim() ? index.title.trim().slice(0, 200) : path.basename(root);
  return { title, edited: Math.max(...times), index, cover: null };
}

async function describeBoard(root) {
  const boardText = await fsp.readFile(path.join(root, "board.json"), "utf8").catch(() => null);
  const canvasFile = path.join(root, "canvas.json");
  if (boardText === null && !fs.existsSync(canvasFile)) return null;
  let meta = null;
  try {
    meta = boardText ? JSON.parse(boardText) : null;
  } catch {}
  const times = await Promise.all([path.join(root, "board.json"), canvasFile].map((p) => fsp.stat(p).then((s) => s.mtimeMs, () => 0)));
  const title = meta && typeof meta.title === "string" && meta.title.trim() ? meta.title.trim().slice(0, 200) : path.basename(root);
  return { title, edited: Math.max(...times), index: meta, cover: null };
}

async function describeDesign(root) {
  const text = await fsp.readFile(path.join(root, "design.json"), "utf8").catch(() => null);
  if (text === null) return null;
  let meta = null;
  try {
    meta = JSON.parse(text);
  } catch {}
  const order = meta && Array.isArray(meta.order) ? meta.order.filter((f) => typeof f === "string" && ARTBOARD_RE.test(f)) : [];
  const stamps = await Promise.all(["design.json", ...order.map((f) => `artboards/${f}`)].map((rel) => fsp.stat(path.join(root, rel)).then((s) => s.mtimeMs, () => 0)));
  let cover = null;
  const first = order[0];
  if (first) {
    const full = path.join(root, "artboards", first);
    const size = await fsp.stat(full).then((s) => s.size, () => Infinity);
    if (size <= MAX_COVER) cover = { file: first, html: await fsp.readFile(full, "utf8").catch(() => null) };
    if (cover && cover.html === null) cover = null;
  }
  const title = meta && typeof meta.title === "string" && meta.title.trim() ? meta.title.trim().slice(0, 200) : path.basename(root);
  return { title, edited: Math.max(...stamps), index: meta, cover };
}

function createAllHosts(userDataDir) {
  const deck = createFolderHost({
    prefix: "deck",
    scheme: "odasset",
    files: /^(deck\.json|comments\.json|slides\/[A-Za-z][A-Za-z0-9_-]{0,63}\.html|assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/,
    dirs: /^(slides|assets)$/,
    removable: (rel) => rel.startsWith("slides/"),
    newFolders: ["slides", "assets"],
    words: { open: "Open a deck folder", create: "Create a deck", untitled: "Untitled deck" },
    describe: describeDeck,
    userDataDir,
  });

  const doc = createFolderHost({
    prefix: "doc",
    scheme: "oddoc",
    files: /^(doc\.json|comments\.json|history\.json|tabs\/[A-Za-z][A-Za-z0-9_-]{0,63}\.html|assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/,
    dirs: /^(tabs|assets)$/,
    removable: (rel) => rel.startsWith("tabs/"),
    newFolders: ["tabs", "assets"],
    words: { open: "Open a doc folder", create: "Create a doc", untitled: "Untitled doc" },
    describe: describeDoc,
    userDataDir,
  });

  const sheet = createFolderHost({
    prefix: "sheet",
    scheme: "odsheet",
    files: /^(sheet\.json|comments\.json|history\.json|sheets\/[A-Za-z][A-Za-z0-9_-]{0,63}\.json|assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/,
    dirs: /^(sheets|assets)$/,
    removable: (rel) => rel.startsWith("sheets/"),
    newFolders: ["sheets", "assets"],
    words: { open: "Open a sheet folder", create: "Create a sheet", untitled: "Untitled" },
    describe: describeSheet,
    userDataDir,
    maxWrite: 64 * 1024 * 1024,
  });

  const board = createFolderHost({
    prefix: "board",
    scheme: "odboard",
    files: /^(board\.json|canvas\.json|comments\.json|history\.json|assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/,
    dirs: /^(assets)$/,
    removable: () => false,
    newFolders: ["assets"],
    words: { open: "Open a whiteboard folder", create: "Create a whiteboard", untitled: "Untitled whiteboard" },
    describe: describeBoard,
    userDataDir,
    maxWrite: 64 * 1024 * 1024,
  });

  const design = createFolderHost({
    prefix: "design",
    scheme: "oddesign",
    files: /^(design\.json|notes\.json|comments\.json|history\.json|artboards\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.html|assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})$/,
    dirs: /^(artboards|assets)$/,
    removable: (rel) => /^artboards\//.test(rel),
    newFolders: ["artboards", "assets"],
    words: { open: "Open a design folder", create: "Create a design", untitled: "Untitled design" },
    describe: describeDesign,
    userDataDir,
    maxWrite: 64 * 1024 * 1024,
  });

  return { deck, doc, sheet, board, design };
}

function detectProductKind(root) {
  if (!root || typeof root !== "string") return null;
  if (fs.existsSync(path.join(root, "deck.json"))) return "deck";
  if (fs.existsSync(path.join(root, "doc.json"))) return "doc";
  if (fs.existsSync(path.join(root, "sheet.json"))) return "sheet";
  if (fs.existsSync(path.join(root, "board.json")) || fs.existsSync(path.join(root, "canvas.json"))) return "board";
  if (fs.existsSync(path.join(root, "design.json")) || fs.existsSync(path.join(root, "artboard.json"))) return "design";
  return null;
}

function starterFilesFor(kind, title) {
  const t = title || `Untitled ${kind}`;
  switch (kind) {
    case "deck":
      return newDeckFiles(t);
    case "doc":
      return newDocFiles(t);
    case "sheet":
      return newWorkbookFiles(t);
    case "board":
      return newBoardFiles(t);
    case "design":
      return newDesignFiles(t);
    default:
      return newDeckFiles(t);
  }
}

module.exports = {
  createAllHosts,
  detectProductKind,
  starterFilesFor,
  describeDeck,
  describeDoc,
  describeSheet,
  describeBoard,
  describeDesign,
};
