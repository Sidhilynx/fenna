#!/usr/bin/env node
// Checks an app's renderer against docs/ui-rules.md, mechanically.
//   node scripts/check-ui.mjs apps/crew            errors only; exit 1 if any
//   node scripts/check-ui.mjs apps/crew --warn     also the warnings
// Each finding is `file:line  rule  what to do`. The rules are in
// docs/ui-rules.md; change them there first, then here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const showWarn = args.includes("--warn");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error("Name an app folder, like: node scripts/check-ui.mjs apps/crew");
  process.exit(2);
}

// The mascot is the one drawing allowed its own colors (docs/apps/crew.md, Decisions).
const MASCOT_FILES = new Set(["Fox.tsx"]);

// Spacing scale in px (docs/ui-rules.md, Spacing).
const SPACE = new Set([0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64]);

// Words that are never UI copy. Each entry: pattern, what to write instead.
const BANNED = [
  [/\bchrome\b/i, "Don't name another product's browser; say \"Browser\"."],
  [/\b(windows )?(file )?explorer\b/i, "Say \"Show in folder\"."],
  [/\bwin ?\+ ?h\b/i, "Don't name OS shortcuts in our copy."],
  [/\b(unleash|supercharge|seamless(ly)?|effortless(ly)?|powerful|leverage|synerg\w*|revolutionary|cutting-edge|game-?changer|elevate|empower\w*|magic(al)?)\b/i, "Marketing word. Say what it does."],
  [/\bAI-powered\b/i, "Everything here is; drop it."],
  [/\b(recipes?|deploy(ed|ing)?|launch(ed)?)\b/i, "Say \"Create\", \"Start\" or \"Run\"."],
  [/\b(execution|executes?|initiali[sz]ed|stream connected)\b/i, "Engineer word. Say \"run\", \"started\"."],
  [/\baction required\b/i, "Say what the person must do: \"Approve sending the email?\""],
  [/\bseamless|robust|intuitive|comprehensive\b/i, "Filler. Cut it."],
  [/!\s*$/, "No exclamation marks in UI copy."],
];

// Proper nouns and acronyms that may be capitalized mid-sentence.
const PROPER = new Set(["Fenna", "Crew", "Claude", "Code", "Codex", "Antigravity", "Gemini", "Docs", "Sheets", "Slides", "Whiteboard", "MCP", "CLI", "CLIs", "AI", "URL", "OAuth", "ID", "OK", "PDF", "CSV", "HTTP", "HTTPS", "API", "GitHub", "Google", "Mac", "Linux", "I"]);

const findings = [];
const add = (level, file, line, rule, msg) => findings.push({ level, file, line, rule, msg });

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "build" || name === "test" || name === "android" || name === "ios") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|lab|lch)\(/;

function checkCss(file, text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const stack = [];
  let buf = "";
  let bufLine = 1;
  let line = 1;
  const flush = () => {
    const d = buf.trim();
    buf = "";
    const m = /^([-a-z]+)\s*:\s*([\s\S]+)$/.exec(d);
    if (m && !m[1].startsWith("--")) checkDecl(file, bufLine, m[1], m[2], stack);
  };
  for (const ch of src) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      flush();
      stack.pop();
    } else if (ch === ";") flush();
    else {
      if (!buf.trim() && ch.trim()) bufLine = line;
      buf += ch;
    }
    if (ch === "\n") line++;
  }
}

function checkDecl(file, n, prop, value, stack) {
  const tokenScope = stack.some((s) => /:root|\[data-theme/.test(s));
  const where = stack.join(" ");
  if (!tokenScope && COLOR.test(value)) add("error", file, n, "color", `Raw color in \`${prop}\` (${where}). Add a token on :root for both themes and use var(--…).`);
  if (/gradient\(/.test(value)) add("error", file, n, "gradient", "No gradients in the UI.");
  if (prop === "font-size" && !/var\(--|inherit|\dem\b|%/.test(value)) add("error", file, n, "font-size", `\`font-size: ${value.trim()}\`. Use a --fs-* token.`);
  if (prop === "font-weight" && /(700|800|900|bold|bolder)/.test(value)) add("error", file, n, "font-weight", "Weights are 400, 500 and 600 only.");
  if (prop === "border-radius" && /(99\d|9999|50%)/.test(value) && !/avatar|face|dot|fox|knob|spinner|cursor/i.test(where)) add("error", file, n, "pill", `No pills (${where}). Use --r-sm / --r-md; full rounds only for faces and dots.`);
  if (/^(margin|padding|gap|row-gap|column-gap|inset|top|left|right|bottom)/.test(prop)) {
    for (const m of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
      if (!SPACE.has(Math.abs(Number(m[1])))) {
        add("warn", file, n, "spacing", `${prop}: ${m[1]}px is off the spacing scale (${[...SPACE].join(", ")}).`);
        break;
      }
    }
  }
  if (prop === "box-shadow" && !tokenScope && !/var\(--|none/.test(value)) add("warn", file, n, "shadow", "Shadows only from tokens, and only on things that float (menus, dialogs).");
  if (/^(animation|transition)/.test(prop)) {
    for (const m of value.matchAll(/(\d+)ms/g)) if (Number(m[1]) > 200 && !/infinite/.test(value)) add("warn", file, n, "motion", `${m[1]}ms is slow. Motion is 120–200 ms.`);
  }
}

function copyIssues(text) {
  const out = [];
  for (const [re, msg] of BANNED) if (re.test(text)) out.push(["copy", msg]);
  if (/\p{Extended_Pictographic}|[✓✔✗✘★☆→←⚡✨]/u.test(text)) out.push(["emoji", "No emoji or symbol glyphs in copy; use a Glyph or words."]);
  const words = text.trim().split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  const caps = words.slice(1).filter((w) => /^[A-Z][a-z]/.test(w) && !PROPER.has(w.replace(/[^A-Za-z]/g, "")));
  if (words.length >= 2 && caps.length >= 1 && caps.length >= (words.length - 1) / 2) out.push(["case", `"${text.trim()}" is Title Case. Use sentence case.`]);
  if (/\s&\s/.test(text) && words.length <= 5) out.push(["copy", `"${text.trim()}": no "&" in labels. Pick the one word that's true.`]);
  return out;
}

function checkTsx(file, text) {
  const base = path.basename(file);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^\s*(\/\/|\*|import )/.test(line)) return;
    if (!MASCOT_FILES.has(base)) {
      if (/["'`]#[0-9a-fA-F]{3,8}["'`]|\b(rgba?|hsla?)\(/.test(line)) add("error", file, n, "color", "Raw color in a component. Use a CSS class with tokens.");
      if (/linearGradient|radialGradient|gradient\(/.test(line)) add("error", file, n, "gradient", "No gradients in the UI.");
    }
    if (/style=\{\{[^}]*fontSize\s*:\s*\d/.test(line)) add("error", file, n, "font-size", "Inline font size. Use a class with a --fs-* token.");
    if (/console\.(log|debug)/.test(line)) add("error", file, n, "console", "No console.log.");
    if (/\b(TODO|FIXME|XXX)\b/.test(line)) add("error", file, n, "todo", "No TODOs.");
    const texts = [];
    for (const m of line.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) texts.push(m[1]);
    for (const m of line.matchAll(/\b(title|aria-label|placeholder|label|alt)=["']([^"']+)["']/g)) texts.push(m[2]);
    for (const m of line.matchAll(/\b(label|title|hint|empty|message)\s*:\s*["']([^"']{3,})["']/g)) texts.push(m[2]);
    if (/^\s*[A-Za-z][^<>{}=;()]*[a-z.?]\s*$/.test(line) && /^\s{6,}/.test(line) && !/^\s*(return|const|let|if|else|export|type|interface)\b/.test(line)) texts.push(line);
    for (const t of texts) for (const [rule, msg] of copyIssues(t)) add(rule === "case" ? "warn" : "error", file, n, rule, msg);
  });
}

for (const root of roots) {
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    if (file.endsWith(".css")) checkCss(file, text);
    else checkTsx(file, text);
  }
}

const shown = findings.filter((f) => f.level === "error" || showWarn);
for (const f of shown) console.log(`${path.relative(process.cwd(), f.file)}:${f.line}  ${f.level === "warn" ? "warn " : ""}${f.rule}  ${f.msg}`);
const errors = findings.filter((f) => f.level === "error").length;
const warns = findings.length - errors;
const byRule = {};
for (const f of findings) byRule[`${f.level} ${f.rule}`] = (byRule[`${f.level} ${f.rule}`] || 0) + 1;
console.log(`\n${errors} errors, ${warns} warnings${showWarn ? "" : " (--warn to list)"}`);
console.log(Object.entries(byRule).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
process.exit(errors ? 1 : 0);
