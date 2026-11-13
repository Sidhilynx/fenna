// Capture the real app the way a reviewer looks at it: on a COPY of a file
// (the original is never touched), with a fresh Electron profile (the
// user's own tabs and recent list are never touched), at a given size and
// theme, optionally replaying a script of clicks, keys and screenshots.
//
//   node scripts/shot.mjs --app sheets --file examples/sample-sheet --out shots/main.png
//   node scripts/shot.mjs --app whiteboard --file examples/sample-board --script steps.json --out shots/
//   node scripts/shot.mjs --app docs --file examples/sample-doc --all --out shots/home.png
//   node scripts/shot.mjs --app whiteboard --home --out shots/home.png        (Home, no file open)
//
// Options:
//   --app      desktop | docs | sheets | whiteboard
//   --file     the document folder; it is copied first
//   --home     open on Home instead of a file
//   --size     1440x900 (default) or 1000x700 ...
//   --theme    dark (default) | light
//   --all      run 1440x900 and 1000x700, dark and light; names get "-1440x900-dark" etc.
//   --script   a steps file (see packages/shell/main/review.cjs). Extra step {"js": "..."}
//              runs page JavaScript with the helpers below already defined.
//              Shots in a script are written next to --out (a folder, or a file's folder).
//   --delay    ms before a plain screenshot (default 9000)
//   --keep     reuse the previous copy instead of copying again (to look at what a script did)
//
// Prints each eval result, and the path of the copy so you can check on disk
// what the app saved. Build the app first (npm run build -w @opendeck/<app>).
//
// Helpers inside {"js"} steps:
//   $q(sel), $qa(sel)                 querySelector / querySelectorAll as an array
//   $fire(el, type, {button, shift})  a mouse event at the element's centre
//   $btn(label)                       press the button whose aria-label, title or text is label
//   $mi(text)                         click the open menu's item whose text starts with text
//   $focus(sel)                       focus an element (a synthetic mousedown does not move focus)
// A js step sees the page as it was before the previous step's re-render
// finished: put a {"wait": 300} between a step that changes state and one
// that reads the DOM, and never select-and-read in the same step.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

const APPS = {
  desktop: { dir: "apps/desktop", env: "OPENDECK_DECK" },
  docs: { dir: "apps/docs", env: "OPENDECK_DOC" },
  sheets: { dir: "apps/sheets", env: "OPENDECK_SHEET" },
  whiteboard: { dir: "apps/whiteboard", env: "OPENDECK_BOARD" },
};

const appName = opt("--app", "");
const file = opt("--file", "");
const home = flag("--home");
const all = flag("--all");
const keep = flag("--keep");
const size = opt("--size", "1440x900");
const theme = opt("--theme", "dark");
const script = opt("--script", "");
const delay = opt("--delay", "9000");
const out = path.resolve(opt("--out", "shots/shot.png"));
const app = APPS[appName];
if (!app || (!file && !home)) {
  console.error("usage: node scripts/shot.mjs --app desktop|docs|sheets|whiteboard (--file <folder> | --home) [--size WxH] [--theme dark|light] [--all] [--script steps.json] --out <file.png|folder>");
  process.exit(2);
}
const electron = path.join(repo, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");

const HELPERS = `
window.$q=(s)=>document.querySelector(s);
window.$qa=(s)=>[...document.querySelectorAll(s)];
window.$fire=(el,type,o={})=>{if(!el)throw new Error("no element for "+type);const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:o.button??0,clientX:r.left+r.width/2,clientY:r.top+r.height/2,shiftKey:!!o.shift}));};
window.$btn=(label)=>{const b=$qa("button,[role=button]").find(x=>x.getAttribute("aria-label")===label||x.title===label||x.textContent.trim()===label);if(!b)return "no button "+label;b.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));b.click();return "ok "+label;};
window.$mi=(t)=>{const m=$qa("[role=menuitem],.menu-item").find(x=>x.textContent.trim().startsWith(t));if(!m)return "no item "+t;m.click();return "ok "+t;};
window.$focus=(s)=>{const el=$q(s);if(!el)return "no "+s;el.focus();return "focused "+s;};
`;

const work = path.join(tmpdir(), `opendeck-shot-${appName}`);
const copy = path.join(work, "file");

function prepare(profileDir) {
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  mkdirSync(work, { recursive: true });
  if (file && !(keep && existsSync(copy))) {
    rmSync(copy, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    cpSync(path.resolve(file), copy, { recursive: true });
  }
}

function stepsFile(outDir) {
  const steps = JSON.parse(readFileSync(path.resolve(script), "utf8")).map((s) => (s.js !== undefined ? { eval: HELPERS + s.js } : s));
  mkdirSync(outDir, { recursive: true });
  const f = path.join(outDir, `.steps-${process.pid}.json`);
  writeFileSync(f, JSON.stringify(steps));
  return f;
}

function run(sz, th, target) {
  const profileDir = path.join(work, `profile-${sz}-${th}`);
  prepare(profileDir);
  const env = { ...process.env, OPENDECK_SHOT_SIZE: sz, OPENDECK_THEME: th, OPENDECK_SHOT_DELAY: delay };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.OPENDECK_SHOT;
  delete env.OPENDECK_SCRIPT;
  // A path that does not exist opens Home.
  env[app.env] = file ? copy : path.join(work, "no-file-here");
  const outDir = target.endsWith(".png") ? path.dirname(target) : target;
  mkdirSync(outDir, { recursive: true });
  let tmpSteps = "";
  if (script) env.OPENDECK_SCRIPT = tmpSteps = stepsFile(outDir);
  else env.OPENDECK_SHOT = target.endsWith(".png") ? target : path.join(target, "shot.png");
  const r = spawnSync(electron, [path.join(repo, app.dir), `--user-data-dir=${profileDir}`], { env, encoding: "utf8", timeout: 180_000 });
  if (tmpSteps) rmSync(tmpSteps, { force: true });
  const lines = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split(/\r?\n/).filter((l) => /eval:|Error|error|refused|Uncaught/.test(l) && !/gpu|GPU|devtools|Autofill/.test(l));
  for (const l of lines) console.log(l.length > 600 ? `${l.slice(0, 600)}…` : l);
  if (r.error) console.error(`electron failed: ${r.error.message}`);
}

const combos = all
  ? [
      ["1440x900", "dark"],
      ["1440x900", "light"],
      ["1000x700", "dark"],
      ["1000x700", "light"],
    ]
  : [[size, theme]];
for (const [sz, th] of combos) {
  const target = all && out.endsWith(".png") ? out.replace(/\.png$/, `-${sz}-${th}.png`) : out;
  console.log(`[${appName} ${sz} ${th}] → ${target}`);
  run(sz, th, target);
}
if (file) console.log(`copy the app worked on: ${copy}`);
