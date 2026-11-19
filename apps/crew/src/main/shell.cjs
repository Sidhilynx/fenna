// The bot's terminal: a small POSIX-like shell over the bot's own disk. It never
// starts a process. Every path goes through disk.locate (or disk.op), so nothing
// outside the bot's disk is read or written, and links are refused there.
//
// A line is words, quotes and backslashes; `;` and `&&` between commands; `|`
// between built-ins; `>` and `>>` into a file in Files or Downloads. Paths start
// with a root (Files, Documents, Downloads, Trash) or are relative to the folder
// the terminal is in; `~` is Files.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zip = require("./ziplite.cjs");

const ROOTS = ["Files", "Documents", "Downloads", "Trash"];
const DOC_KINDS = ["doc", "sheet", "deck", "board", "design"];
const OUTSIDE = "That file is outside this bot's disk.";
const LINE_MS = 30_000;
const OUTPUT_MAX = 64 * 1024;
const HISTORY_MAX = 500;
const READ_MAX = 5 * 1024 * 1024;
const GREP_BUDGET = 200 * 1024 * 1024;
const ITEM_BUDGET = 20_000;
const FIND_MAX = 2000;
const TREE_MAX = 500;
const ZIP_IN_MAX = 200 * 1024 * 1024;
const ARCHIVE_MAX = 512 * 1024 * 1024;
const UNZIP_MAX = 2 * 1024 ** 3;
const IMG_MAX = 50 * 1024 * 1024;
const IMG_SIDE_MAX = 10_000;
const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const SCRIPT_MAX = 1024 * 1024;
const CSV_CELLS_MAX = 1_000_000;
const EXTRACT_BATCH = 200;
const EXTRACT_BYTES = 64 * 1024 * 1024;
const SAVE_MS = 400;
const FILE = "terminal.json";
const SHEET_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const lstatOf = (p) => {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return null;
    throw e;
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** Bytes the way the disk shows them. */
function size(n) {
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** A line of output: each part ends with a newline. */
function textOf(lines) {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

const linesOf = (text) => (text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/));
const isDocKind = (kind) => DOC_KINDS.includes(kind);
const isDirEntry = (e) => e.kind === "folder" || isDocKind(e.kind);
const when = (iso) => String(iso).slice(0, 16).replace("T", " ");

/** The output as the person sees it: at most 64 KB, cut on a character. */
function capOutput(text) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= OUTPUT_MAX) return text;
  return `${buf.subarray(0, OUTPUT_MAX).toString("utf8").replace(/\uFFFD$/, "")}\n(output cut at 64 KB)\n`;
}

function syntax(msg) {
  return new Error(`sh: syntax error: ${msg}`);
}

/**
 * Splits a line into words and operators. Quotes keep their spaces. A backslash
 * escapes a space, a quote, a backslash or an operator; anywhere else it is kept,
 * so a Windows-style path stays what it was typed as (and is refused as outside).
 */
function tokenize(line) {
  const toks = [];
  let cur = null;
  const push = () => {
    if (cur !== null) {
      toks.push({ type: "word", text: cur });
      cur = null;
    }
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === " " || c === "\t") {
      push();
      i++;
    } else if (c === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) throw syntax("unclosed single quote");
      cur = (cur ?? "") + line.slice(i + 1, j);
      i = j + 1;
    } else if (c === '"') {
      cur = cur ?? "";
      i++;
      let closed = false;
      while (i < line.length) {
        const d = line[i];
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === "\\" && i + 1 < line.length && /["\\$`]/.test(line[i + 1])) {
          cur += line[i + 1];
          i += 2;
          continue;
        }
        cur += d;
        i++;
      }
      if (!closed) throw syntax("unclosed double quote");
    } else if (c === "\\") {
      const n = line[i + 1];
      if (n !== undefined && /[ "'\\;|&<>]/.test(n)) {
        cur = (cur ?? "") + n;
        i += 2;
      } else {
        cur = (cur ?? "") + c;
        i++;
      }
    } else if (c === "&" && line[i + 1] === "&") {
      push();
      toks.push({ type: "op", op: "&&" });
      i += 2;
    } else if (c === "|" || c === ";") {
      push();
      toks.push({ type: "op", op: c });
      i++;
    } else if (c === ">") {
      push();
      const op = line[i + 1] === ">" ? ">>" : ">";
      toks.push({ type: "op", op });
      i += op.length;
    } else if (c === "&") {
      throw syntax("use && to run the next command when this one works");
    } else {
      cur = (cur ?? "") + c;
      i++;
    }
  }
  push();
  return toks;
}

/**
 * A line as items, each { pipe: [{ words, redir }], and }: pipelines joined by
 * `;` (and: false) or `&&` (and: true, runs only when the one before worked).
 * redir is { append, target } for a > or >> after the command's words.
 */
function parse(line) {
  const toks = tokenize(line);
  const items = [];
  let pipe = [];
  let cmd = null;
  let andNext = false;
  let lastOp = null;
  let waiting = null;
  const need = () => {
    cmd = cmd ?? { words: [], redir: null };
    return cmd;
  };
  const flush = (where) => {
    if (cmd) {
      pipe.push(cmd);
      cmd = null;
    }
    if (!pipe.length || pipe.some((c) => !c.words.length)) throw syntax(`missing command ${where}`);
    items.push({ pipe, and: andNext });
    pipe = [];
  };
  for (const t of toks) {
    if (t.type === "word") {
      if (waiting) {
        const c = need();
        if (c.redir) throw syntax("only one > per command");
        c.redir = { append: waiting.append, target: t.text };
        waiting = null;
      } else need().words.push(t.text);
      lastOp = null;
      continue;
    }
    if (waiting) throw syntax(`${waiting.op} needs a file name after it`);
    if (t.op === ">" || t.op === ">>") {
      if (need().redir) throw syntax("only one > per command");
      waiting = { op: t.op, append: t.op === ">>" };
      lastOp = t.op;
      continue;
    }
    if (t.op === "|") {
      if (!cmd || !cmd.words.length) throw syntax("| needs a command before it");
      pipe.push(cmd);
      cmd = null;
      lastOp = "|";
      continue;
    }
    // ; or &&
    flush(`before ${t.op}`);
    andNext = t.op === "&&";
    lastOp = t.op;
  }
  if (waiting) throw syntax(`${waiting.op} needs a file name after it`);
  if (lastOp === "|" || lastOp === "&&") throw syntax(`missing command after ${lastOp}`);
  if (cmd || pipe.length) flush("at the end");
  return items;
}

/** A path as the person typed it, against the folder the terminal is in. Throws when it leaves the disk. */
function resolvePath(cwd, input) {
  if (typeof input !== "string" || input === "") return cwd;
  let p = input;
  if (p === "~" || p.startsWith("~/")) p = `Files${p.slice(1)}`;
  if (/^[\\/]/.test(p) || /^[A-Za-z]:/.test(p)) throw new Error(OUTSIDE);
  const parts = p.split("/").filter((s) => s !== "");
  const out = ROOTS.includes(parts[0]) ? [] : cwd.split("/");
  for (const s of parts) {
    if (s === ".") continue;
    if (s === "..") {
      if (out.length <= 1) throw new Error(OUTSIDE);
      out.pop();
      continue;
    }
    out.push(s);
  }
  return out.join("/");
}

/** Where a located path is: "missing", "file", "folder" or "doc" (a document is one entry). */
function kindOf(loc) {
  if (loc.isRoot) return "folder";
  const st = lstatOf(loc.abs);
  if (!st || st.isSymbolicLink()) return "missing";
  if (st.isDirectory()) return loc.root === "Documents" && loc.rest.length === 1 ? "doc" : "folder";
  return st.isFile() ? "file" : "missing";
}

function folderOrThrow(loc, shown) {
  const k = kindOf(loc);
  if (k === "missing") throw new Error(`${shown}: no such folder`);
  if (k !== "folder") throw new Error(`${shown}: not a folder`);
}

/** A glob (* and ?) as a pattern on a name, ignoring case. */
function globRe(glob) {
  const body = glob
    .split("")
    .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`, "i");
}

/** Options and operands of a command: single-letter flags, letters that take a value, and long names. */
function scan(name, args, { flags = "", withValue = "", long = {}, numeric = false } = {}) {
  const on = new Set();
  const vals = {};
  const rest = [];
  let literal = false;
  const bad = (what) => new Error(`unknown option ${what}. Try ${name} --help.`);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (literal || a === "-" || !a.startsWith("-")) {
      rest.push(a);
      continue;
    }
    if (a === "--") {
      literal = true;
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const key = eq < 0 ? a.slice(2) : a.slice(2, eq);
      if (!Object.prototype.hasOwnProperty.call(long, key)) throw bad(`--${key}`);
      if (long[key] === "v") {
        const v = eq < 0 ? args[++i] : a.slice(eq + 1);
        if (v === undefined) throw new Error(`--${key} needs a value.`);
        vals[key] = v;
      } else on.add(key);
      continue;
    }
    if (numeric && /^-\d+$/.test(a)) {
      vals.n = a.slice(1);
      continue;
    }
    for (let j = 1; j < a.length; j++) {
      const c = a[j];
      if (withValue.includes(c)) {
        const v = j + 1 < a.length ? a.slice(j + 1) : args[++i];
        if (v === undefined) throw new Error(`-${c} needs a value.`);
        vals[c] = v;
        break;
      }
      if (!flags.includes(c)) throw bad(`-${c}`);
      on.add(c);
    }
  }
  return { on, vals, rest };
}

function intArg(what, v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what} must be a whole number from ${min} to ${max}.`);
  return n;
}

const COMMANDS = {};
const def = (name, usage, about, run) => {
  COMMANDS[name] = { usage, about, run };
};

/** Files and folders under a disk folder, each one through the disk's own listing. */
function entriesAt(ctx, p) {
  return ctx.disk.list(ctx.slug, p).entries;
}

/** Calls fn for every entry under a folder, folders first and then what is inside them. */
function eachEntry(ctx, dir, fn) {
  for (const e of entriesAt(ctx, dir)) {
    ctx.step();
    fn(e);
    if (e.kind === "folder") eachEntry(ctx, e.path, fn);
  }
}

/** A path located from what the person typed, and checked. */
function place(ctx, input) {
  const p = resolvePath(ctx.cwd, input);
  return { path: p, loc: ctx.disk.locate(ctx.slug, p) };
}

function writable(loc, shown) {
  if (loc.isRoot) throw new Error(`${shown}: the roots can't be changed.`);
  if (loc.root !== "Files" && loc.root !== "Downloads") throw new Error(`${shown}: Files and Downloads hold files. Documents holds documents only, and Trash only what was thrown away.`);
}

function parentOf(p) {
  return p.split("/").slice(0, -1).join("/");
}

/** The contents of files named, or of what is piped in. Each source is { name, text }. */
function sourcesOf(ctx, files, input, name) {
  if (!files.length) {
    if (input === null) throw new Error(`nothing to read. Name a file, or pipe into ${name}.`);
    return [{ name: null, text: input }];
  }
  return files.map((f) => ({ name: f, text: readText(ctx, f) }));
}

/** A text file's contents: up to 5 MB, and not a binary file. */
function readText(ctx, p) {
  const { loc } = place(ctx, p);
  const k = kindOf(loc);
  if (k === "missing") throw new Error(`${p}: no such file`);
  if (k === "folder") throw new Error(`${p}: is a folder`);
  if (k === "doc") throw new Error(`${p}: is a document. Open it in its editor.`);
  const st = fs.statSync(loc.abs);
  if (st.size > READ_MAX) throw new Error(`${p}: is ${size(st.size)}; the most read here is 5 MB.`);
  const buf = fs.readFileSync(loc.abs);
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${p}: is a binary file. Open it in its editor.`);
  return buf.toString("utf8");
}

/** A new file in Files or Downloads, made through the disk (quota-checked). Returns its disk path. */
function newFile(ctx, shown, bytes, unique) {
  const { path: p, loc } = place(ctx, shown);
  writable(loc, shown);
  const dir = parentOf(p);
  let name = loc.segs.at(-1);
  if (kindOf(loc) !== "missing") {
    if (!unique) throw new Error(`${name} is already there. Pick another name.`);
    name = uniqueName(ctx, dir, name);
  }
  ctx.disk.op(ctx.slug, { op: "import", to: dir, files: [{ name, bytes }] });
  return `${dir}/${name}`;
}

/** A name in a folder that nothing has: "a.txt", then "a (2).txt". */
function uniqueName(ctx, dir, name) {
  const taken = new Set(entriesAt(ctx, dir).map((e) => e.name));
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Bytes under a located path on the real disk, links not followed. */
function treeBytes(ctx, abs) {
  ctx.step();
  const st = lstatOf(abs);
  if (!st || st.isSymbolicLink()) return 0;
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  let n = 0;
  for (const name of fs.readdirSync(abs)) n += treeBytes(ctx, path.join(abs, name));
  return n;
}

// ── The commands ─────────────────────────────────────────────────────

def("help", "help [command]", "list the commands, or say what one does", (args) => {
  if (args.length) {
    const c = Object.prototype.hasOwnProperty.call(COMMANDS, args[0]) ? COMMANDS[args[0]] : null;
    if (!c) throw new Error(`no command "${args[0]}". Type help for the list.`);
    return textOf([c.usage, `  ${c.about}`]);
  }
  return textOf(Object.values(COMMANDS).map((c) => `${c.usage.padEnd(38)}${c.about}`));
});

def("pwd", "pwd", "print the folder you are in", (_a, _i, ctx) => textOf([ctx.cwd]));

def("cd", "cd [folder]", "change folder; with no folder, go to Files", (args, _i, ctx) => {
  const target = args[0] ?? "Files";
  const { path: p, loc } = place(ctx, target);
  folderOrThrow(loc, target);
  ctx.cwd = p;
  return "";
});

def("ls", "ls [-l] [-a] [folder or file...]", "list folders and files (names with a dot are hidden)", (args, _i, ctx) => {
  const { on, rest } = scan("ls", args, { flags: "la" });
  const targets = rest.length ? rest : [ctx.cwd];
  const sections = targets.map((t) => {
    const { path: p, loc } = place(ctx, t);
    const k = kindOf(loc);
    if (k === "missing") throw new Error(`${t}: no such file or folder`);
    let entries;
    if (k === "folder") entries = entriesAt(ctx, p);
    else {
      const st = fs.statSync(loc.abs);
      const bytes = k === "doc" ? treeBytes(ctx, loc.abs) : st.size;
      entries = [{ name: loc.segs.at(-1), kind: k === "doc" ? "doc" : "file", size: bytes, edited: st.mtime.toISOString() }];
    }
    const lines = entries.map((e) => {
      if (!on.has("l")) return e.kind === "folder" ? `${e.name}/` : e.name;
      const col = e.kind === "folder" ? "dir" : isDocKind(e.kind) ? e.kind : "file";
      const amount = e.kind === "folder" ? "" : size(e.size);
      return `${col.padEnd(6)} ${amount.padStart(8)}  ${when(e.edited)}  ${e.name}${e.kind === "folder" ? "/" : ""}`;
    });
    return { title: t, lines };
  });
  return sections.map((s) => (targets.length > 1 ? `${s.title}:\n${textOf(s.lines)}` : textOf(s.lines))).join("\n");
});

def("tree", "tree [-L depth] [folder]", "show what is in a folder as a tree", (args, _i, ctx) => {
  const { vals, rest } = scan("tree", args, { withValue: "L" });
  const depth = vals.L === undefined ? Infinity : intArg("-L", vals.L, 1, 20);
  const start = rest[0] ?? ctx.cwd;
  const { path: p, loc } = place(ctx, start);
  folderOrThrow(loc, start);
  const lines = [p];
  let cut = false;
  const walk = (dir, prefix, level) => {
    const kids = entriesAt(ctx, dir);
    kids.forEach((e, i) => {
      ctx.step();
      if (lines.length > TREE_MAX) {
        cut = true;
        return;
      }
      const last = i === kids.length - 1;
      lines.push(`${prefix}${last ? "`-- " : "|-- "}${e.name}${e.kind === "folder" ? "/" : ""}`);
      if (e.kind === "folder" && level < depth) walk(e.path, `${prefix}${last ? "    " : "|   "}`, level + 1);
    });
  };
  walk(p, "", 1);
  if (cut) lines.push(`... (the first ${TREE_MAX} shown; use -L to show less)`);
  return textOf(lines);
});

def("cat", "cat [file...]", "print files, or what is piped in", (args, input, ctx) =>
  sourcesOf(ctx, args, input, "cat")
    .map((s) => s.text)
    .join(""),
);

def("head", "head [-n lines] [file...]", "the first lines of files (10 by default)", (args, input, ctx) => {
  const { vals, rest } = scan("head", args, { withValue: "n", numeric: true });
  const n = vals.n === undefined ? 10 : intArg("-n", vals.n, 0, 100_000);
  const lines = sourcesOf(ctx, rest, input, "head").flatMap((s) => linesOf(s.text));
  return textOf(lines.slice(0, n));
});

def("tail", "tail [-n lines] [file...]", "the last lines of files (10 by default)", (args, input, ctx) => {
  const { vals, rest } = scan("tail", args, { withValue: "n", numeric: true });
  const n = vals.n === undefined ? 10 : intArg("-n", vals.n, 0, 100_000);
  const lines = sourcesOf(ctx, rest, input, "tail").flatMap((s) => linesOf(s.text));
  return textOf(n === 0 ? [] : lines.slice(-n));
});

def("wc", "wc [-l] [-w] [-c] [file...]", "count lines, words and bytes", (args, input, ctx) => {
  const { on, rest } = scan("wc", args, { flags: "lwc" });
  const all = !on.has("l") && !on.has("w") && !on.has("c");
  const rows = sourcesOf(ctx, rest, input, "wc").map((s) => ({
    l: (s.text.match(/\n/g) || []).length,
    w: s.text.split(/\s+/).filter(Boolean).length,
    c: Buffer.byteLength(s.text, "utf8"),
    name: s.name,
  }));
  const sum = rows.reduce((t, r) => ({ l: t.l + r.l, w: t.w + r.w, c: t.c + r.c }), { l: 0, w: 0, c: 0 });
  const show = (r) =>
    [all || on.has("l") ? r.l : null, all || on.has("w") ? r.w : null, all || on.has("c") ? r.c : null]
      .filter((x) => x !== null)
      .map((x) => String(x).padStart(8))
      .join("") + (r.name ? ` ${r.name}` : "");
  const lines = rows.map(show);
  if (rows.length > 1) lines.push(show({ ...sum, name: "total" }));
  return textOf(lines);
});

def("echo", "echo [words...]", "print the words", (args) => textOf([args.join(" ")]));

def("touch", "touch file...", "make an empty file, or set an existing file's time to now", (args, _i, ctx) => {
  if (!args.length) throw new Error("name a file, like touch Files/notes.txt");
  for (const a of args) {
    const { loc } = place(ctx, a);
    writable(loc, a);
    const k = kindOf(loc);
    if (k === "folder" || k === "doc") throw new Error(`${a}: is a folder`);
    if (k === "file") {
      const now = new Date();
      fs.utimesSync(loc.abs, now, now);
    } else newFile(ctx, a, Buffer.alloc(0), false);
  }
  return "";
});

def("mkdir", "mkdir [-p] folder...", "make folders (-p makes the folders on the way too)", (args, _i, ctx) => {
  const { on, rest } = scan("mkdir", args, { flags: "p" });
  if (!rest.length) throw new Error("name a folder, like mkdir Files/notes");
  for (const a of rest) {
    const { path: p } = place(ctx, a);
    if (!on.has("p")) {
      ctx.disk.op(ctx.slug, { op: "mkdir", path: p });
      continue;
    }
    const segs = p.split("/");
    for (let k = 2; k <= segs.length; k++) {
      const part = segs.slice(0, k).join("/");
      const kind = kindOf(place(ctx, part).loc);
      if (kind === "missing") ctx.disk.op(ctx.slug, { op: "mkdir", path: part });
      else if (kind !== "folder" && kind !== "doc") throw new Error(`${a}: a file is in the way at ${part}`);
    }
  }
  return "";
});

/** mv and cp: into a folder, or to a new name for one item. */
function transfer(ctx, name, args, copying) {
  const { on, rest } = scan(name, args, { flags: "r" });
  if (rest.length < 2) throw new Error(`say what to ${copying ? "copy" : "move"} and where, like ${name} Files/a.txt Files/archive`);
  const destInput = rest.at(-1);
  const srcs = rest.slice(0, -1).map((s) => {
    const { path: p, loc } = place(ctx, s);
    const k = kindOf(loc);
    if (k === "missing") throw new Error(`${s}: no such file or folder`);
    if (copying && k === "folder" && !on.has("r")) throw new Error(`${s} is a folder; add -r to copy it`);
    return { path: p };
  });
  const dst = place(ctx, destInput);
  const dk = kindOf(dst.loc);
  const op = copying ? "copy" : "move";
  if (dk === "folder") {
    ctx.disk.op(ctx.slug, { op, paths: srcs.map((s) => s.path), to: dst.path });
    return "";
  }
  if (srcs.length > 1) throw new Error(`${destInput}: isn't a folder`);
  if (dk !== "missing") throw new Error(`${destInput} is already there.`);
  const dir = parentOf(dst.path);
  if (kindOf(place(ctx, dir).loc) !== "folder") throw new Error(`${destInput}: no such folder`);
  const want = dst.loc.segs.at(-1);
  const src = srcs[0].path;
  if (!copying && parentOf(src) === dir) {
    ctx.disk.op(ctx.slug, { op: "rename", path: src, name: want });
    return "";
  }
  // The disk picks the name the copy or move lands under; rename it to the one asked for.
  const before = new Set(entriesAt(ctx, dir).map((e) => e.name));
  ctx.disk.op(ctx.slug, { op, paths: [src], to: dir });
  const added = entriesAt(ctx, dir).find((e) => !before.has(e.name));
  if (added && added.name !== want) ctx.disk.op(ctx.slug, { op: "rename", path: added.path, name: want });
  return "";
}

def("mv", "mv item... folder-or-name", "move items into a folder, or move one item to a new name", (args, _i, ctx) => transfer(ctx, "mv", args, false));
def("cp", "cp [-r] item... folder-or-name", "copy items into a folder (-r for folders)", (args, _i, ctx) => transfer(ctx, "cp", args, true));

def("rm", "rm [-r] item...", "move items to Trash (restore brings them back)", (args, _i, ctx) => {
  const { on, rest } = scan("rm", args, { flags: "r" });
  if (!rest.length) throw new Error("name what to remove, like rm Files/old.txt");
  const paths = rest.map((s) => {
    const { path: p, loc } = place(ctx, s);
    const k = kindOf(loc);
    if (k === "missing") throw new Error(`${s}: no such file or folder`);
    if (k === "folder" && !on.has("r")) throw new Error(`${s} is a folder; add -r to move it to Trash`);
    return p;
  });
  ctx.disk.op(ctx.slug, { op: "trash", paths });
  return textOf([`moved to Trash: ${paths.join(", ")}`]);
});

def("restore", "restore Trash/item...", "put a thrown-away item back where it was", (args, _i, ctx) => {
  if (!args.length) throw new Error("say what to restore, like restore Trash/notes");
  const paths = args.map((a) => place(ctx, a).path);
  ctx.disk.op(ctx.slug, { op: "restore", paths });
  return textOf([`restored: ${paths.join(", ")}`]);
});

def("find", "find [folder] [-name pattern] [-type f|d]", "list what is under a folder, by name or kind", (args, _i, ctx) => {
  let start = null;
  let glob = null;
  let type = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-name" || a === "-type") {
      const v = args[++i];
      if (v === undefined) throw new Error(`${a} needs a value.`);
      if (a === "-name") glob = v;
      else if (v === "f" || v === "d") type = v;
      else throw new Error("-type is f (a file) or d (a folder).");
    } else if (a.startsWith("-")) throw new Error(`unknown option ${a}. Try find --help.`);
    else start = a;
  }
  const shown = start ?? ctx.cwd;
  const { path: p, loc } = place(ctx, shown);
  const k = kindOf(loc);
  if (k === "missing") throw new Error(`${shown}: no such file or folder`);
  const re = glob === null ? null : globRe(glob);
  const out = [];
  let more = false;
  const add = (where, name, dirish) => {
    if (re && !re.test(name)) return;
    if (type !== null && (type === "d") !== dirish) return;
    if (out.length >= FIND_MAX) {
      more = true;
      return;
    }
    out.push(where);
  };
  add(p, loc.segs.at(-1), k !== "file");
  if (k === "folder") eachEntry(ctx, p, (e) => add(e.path, e.name, isDirEntry(e)));
  return textOf(more ? [...out, `... (the first ${FIND_MAX} shown)`] : out);
});

def("grep", "grep [-i] [-n] [-r] pattern [file or folder...]", "find lines that match a pattern (text files up to 5 MB)", (args, input, ctx) => {
  const { on, rest } = scan("grep", args, { flags: "inr" });
  const [pattern, ...targets] = rest;
  if (pattern === undefined) throw new Error("say the pattern, like grep -i budget Documents");
  let re;
  try {
    re = new RegExp(pattern, on.has("i") ? "i" : "");
  } catch (e) {
    throw new Error(`bad pattern: ${e.message}`);
  }
  const found = [];
  const errs = [];
  let scanned = 0;
  // A file's name leads its lines when more than one file is searched.
  const showNames = on.has("r") || targets.length > 1;
  const search = (name, text) => {
    linesOf(text).forEach((l, i) => {
      if (!re.test(l)) return;
      const shownLine = l.length > 500 ? `${l.slice(0, 500)}...` : l;
      found.push(`${name !== null && showNames ? `${name}:` : ""}${on.has("n") ? `${i + 1}:` : ""}${shownLine}`);
    });
  };
  const searchFile = (p) => {
    const { loc } = place(ctx, p);
    const st = fs.statSync(loc.abs);
    if (st.size > READ_MAX) {
      errs.push(`grep: ${p}: skipped, it is over 5 MB\n`);
      return;
    }
    const buf = fs.readFileSync(loc.abs);
    if (buf.subarray(0, 8000).includes(0)) return;
    scanned += st.size;
    if (scanned > GREP_BUDGET) throw new Error("stopped after 200 MB; search a smaller folder");
    search(p, buf.toString("utf8"));
  };
  if (!targets.length) {
    if (input !== null) search(null, input);
    else if (on.has("r")) targets.push(ctx.cwd);
    else throw new Error("nothing to search. Name a file, or pipe into grep.");
  }
  for (const t of targets) {
    const { path: p, loc } = place(ctx, t);
    const k = kindOf(loc);
    if (k === "missing") errs.push(`grep: ${t}: no such file or folder\n`);
    else if (k === "folder") {
      if (!on.has("r")) errs.push(`grep: ${t}: is a folder (add -r)\n`);
      else
        eachEntry(ctx, p, (e) => {
          if (e.kind !== "folder" && !isDocKind(e.kind)) searchFile(e.path);
        });
    } else if (k === "doc") errs.push(`grep: ${t}: is a document\n`);
    else searchFile(p);
  }
  return { out: textOf(found), err: errs.join(""), ok: found.length > 0 };
});

def("sort", "sort [-r] [-n] [file...]", "sort lines (-n by number, -r backwards)", (args, input, ctx) => {
  const { on, rest } = scan("sort", args, { flags: "rn" });
  const lines = sourcesOf(ctx, rest, input, "sort").flatMap((s) => linesOf(s.text));
  const key = (s) => {
    const v = parseFloat(s);
    return Number.isNaN(v) ? 0 : v;
  };
  lines.sort(on.has("n") ? (a, b) => key(a) - key(b) : (a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (on.has("r")) lines.reverse();
  return textOf(lines);
});

def("uniq", "uniq [-c] [file...]", "drop lines that repeat the one before (-c counts them)", (args, input, ctx) => {
  const { on, rest } = scan("uniq", args, { flags: "c" });
  const lines = sourcesOf(ctx, rest, input, "uniq").flatMap((s) => linesOf(s.text));
  const groups = [];
  for (const l of lines) {
    const last = groups.at(-1);
    if (last && last.text === l) last.n++;
    else groups.push({ text: l, n: 1 });
  }
  return textOf(groups.map((g) => (on.has("c") ? `${String(g.n).padStart(7)} ${g.text}` : g.text)));
});

def("du", "du [-h] [folder or file...]", "how much space a folder or file takes", (args, _i, ctx) => {
  const { on, rest } = scan("du", args, { flags: "h" });
  const targets = rest.length ? rest : [ctx.cwd];
  return textOf(
    targets.map((t) => {
      const { loc } = place(ctx, t);
      if (kindOf(loc) === "missing") throw new Error(`${t}: no such file or folder`);
      const bytes = treeBytes(ctx, loc.abs);
      return `${on.has("h") ? size(bytes) : String(bytes)}\t${t}`;
    }),
  );
});

def("df", "df", "how much of the bot's disk is used", (_a, _i, ctx) => {
  const used = ctx.disk.used(ctx.slug);
  const quota = ctx.disk.quota(ctx.slug);
  return textOf([`${size(used)} used of ${size(quota)}; ${size(Math.max(0, quota - used))} free`]);
});

def("stat", "stat item", "what an item is, its size and when it changed", (args, _i, ctx) => {
  if (args.length !== 1) throw new Error("name one item, like stat Files/notes.txt");
  const { path: p, loc } = place(ctx, args[0]);
  const k = kindOf(loc);
  if (k === "missing") throw new Error(`${args[0]}: no such file or folder`);
  const st = lstatOf(loc.abs);
  const kids = k === "folder" ? entriesAt(ctx, p).length : null;
  return textOf([
    `path: ${p}`,
    `type: ${k === "doc" ? "document" : k}${kids === null ? "" : ` (${kids} ${kids === 1 ? "item" : "items"})`}`,
    `size: ${k === "folder" ? "-" : size(st.size)}`,
    `modified: ${when(st.mtime.toISOString())}`,
  ]);
});

def("open", "open item", "say where an item is; the person opens it in the bot's computer", (args, _i, ctx) => {
  if (args.length !== 1) throw new Error("name one item, like open Documents/q3-report");
  const { path: p, loc } = place(ctx, args[0]);
  if (kindOf(loc) === "missing") throw new Error(`${args[0]}: no such file or folder`);
  return textOf([`${p} is in the bot's computer, where the person opens it. Read it here with cat or head.`]);
});

def("clear", "clear", "clear the screen", () => "");

def("history", "history", "the commands run in this terminal, oldest first", (_a, _i, ctx) =>
  textOf(ctx.history.map((e, i) => `${String(i + 1).padStart(4)}  ${e.line}`)),
);

def("zip", "zip archive.zip item...", "put files and folders into a new .zip in Files or Downloads", (args, _i, ctx) => {
  const [arch, ...items] = args;
  if (!arch || !items.length) throw new Error("say an archive and what to put in it, like zip Files/notes.zip Files/notes");
  if (!/\.zip$/i.test(arch)) throw new Error(`${arch}: the archive's name ends in .zip`);
  const entries = [];
  const seenTop = new Set();
  let total = 0;
  const addTree = (abs, name) => {
    ctx.step();
    const st = lstatOf(abs);
    if (!st || st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      entries.push({ name: `${name}/`, data: Buffer.alloc(0) });
      for (const child of fs.readdirSync(abs).sort()) addTree(path.join(abs, child), `${name}/${child}`);
      return;
    }
    if (!st.isFile()) return;
    total += st.size;
    if (total > ZIP_IN_MAX) throw new Error("more than 200 MB to zip; zip smaller folders.");
    entries.push({ name, data: fs.readFileSync(abs) });
  };
  for (const it of items) {
    const { loc } = place(ctx, it);
    const k = kindOf(loc);
    if (k === "missing") throw new Error(`${it}: no such file or folder`);
    const top = loc.segs.at(-1);
    if (seenTop.has(top)) throw new Error(`two items are both called ${top}; zip them separately.`);
    seenTop.add(top);
    addTree(loc.abs, top);
  }
  const bytes = zip.createZip(entries);
  const out = newFile(ctx, arch, bytes, false);
  const files = entries.filter((e) => !e.name.endsWith("/")).length;
  return textOf([`zipped ${files} ${files === 1 ? "file" : "files"} into ${out} (${size(bytes.length)})`]);
});

def("unzip", "unzip archive.zip [-d folder]", "unpack a .zip into a folder (named after it, unless -d)", (args, _i, ctx) => {
  const { vals, rest } = scan("unzip", args, { withValue: "d" });
  if (rest.length !== 1) throw new Error("name one archive, like unzip Files/notes.zip");
  const { loc } = place(ctx, rest[0]);
  if (kindOf(loc) !== "file") throw new Error(`${rest[0]}: no such file`);
  const st = fs.statSync(loc.abs);
  if (st.size > ARCHIVE_MAX) throw new Error(`${rest[0]} is ${size(st.size)}; unzip takes archives up to 512 MB.`);
  const buf = fs.readFileSync(loc.abs);
  const free = ctx.disk.free(ctx.slug);
  const limit = Math.min(free, UNZIP_MAX);
  let z;
  try {
    z = zip.readZip(buf, { maxTotal: limit });
  } catch (e) {
    if (e.code === "TOO_BIG") {
      const why = limit === UNZIP_MAX ? "the 2 GB unzip limit" : `the ${size(free)} free on the bot's disk`;
      throw new Error(`it would unzip to ${size(e.total)}, more than ${why}. Nothing was unzipped.`);
    }
    if (e.code === "TOO_MANY") throw new Error(`${e.message} Nothing was unzipped.`);
    throw e;
  }

  const dest = place(ctx, vals.d ?? rest[0].replace(/\.zip$/i, ""));
  writable(dest.loc, vals.d ?? rest[0]);
  const dk = kindOf(dest.loc);
  if (dk === "file" || dk === "doc") throw new Error(`${dest.path} is a file, not a folder.`);
  const made = new Set();
  const ensure = (p) => {
    if (made.has(p)) return;
    const k = kindOf(place(ctx, p).loc);
    if (k === "missing") {
      ensure(parentOf(p));
      ctx.disk.op(ctx.slug, { op: "mkdir", path: p });
    } else if (k !== "folder") throw new Error(`${p} is not a folder.`);
    made.add(p);
  };
  ensure(dest.path);

  const pending = new Map();
  let files = 0;
  const flush = (folder) => {
    const b = pending.get(folder);
    if (!b || !b.files.length) return;
    pending.delete(folder);
    ctx.disk.op(ctx.slug, { op: "import", to: folder, files: b.files });
  };
  try {
    for (const e of z.entries) {
      ctx.check();
      const target = `${dest.path}/${e.segs.join("/")}`;
      if (e.dir) {
        ensure(target);
        continue;
      }
      const folder = parentOf(target);
      ensure(folder);
      const bytes = zip.inflateEntry(buf, e);
      let b = pending.get(folder);
      if (!b) {
        b = { files: [], bytes: 0 };
        pending.set(folder, b);
      }
      b.files.push({ name: e.segs.at(-1), bytes });
      b.bytes += bytes.length;
      files++;
      if (b.files.length >= EXTRACT_BATCH || b.bytes >= EXTRACT_BYTES) flush(folder);
    }
    for (const folder of [...pending.keys()]) flush(folder);
  } catch (e) {
    throw new Error(`${e.message} Files before it are already unzipped.`);
  }
  return textOf([`unzipped ${files} ${files === 1 ? "file" : "files"} into ${dest.path}`]);
});

/** Electron's nativeImage (or the one a test gives the shell). */
function imageModule(ctx) {
  if (ctx.nativeImage) return ctx.nativeImage;
  const electron = require("electron");
  if (!electron || typeof electron !== "object" || !electron.nativeImage) throw new Error("Images aren't available here.");
  return electron.nativeImage;
}

def("img", "img image [--width N] [--height N] [--to png|jpg] [-o file]", "resize or convert an image", (args, _i, ctx) => {
  const { vals, rest } = scan("img", args, { withValue: "o", long: { width: "v", height: "v", to: "v" } });
  if (rest.length !== 1) throw new Error("name one image, like img Files/photo.jpg --width 800");
  const width = vals.width === undefined ? null : intArg("--width", vals.width, 1, IMG_SIDE_MAX);
  const height = vals.height === undefined ? null : intArg("--height", vals.height, 1, IMG_SIDE_MAX);
  let to = vals.to === undefined ? null : vals.to.toLowerCase();
  if (to === "jpeg") to = "jpg";
  if (to !== null && to !== "png" && to !== "jpg") throw new Error("--to is png or jpg.");
  if (width === null && height === null && to === null) throw new Error("say what to change: --width, --height or --to.");
  const { path: p, loc } = place(ctx, rest[0]);
  if (kindOf(loc) !== "file") throw new Error(`${rest[0]}: no such file`);
  const ext = path.extname(p).slice(1).toLowerCase();
  if (!IMG_EXT.includes(ext)) throw new Error(`${rest[0]} isn't an image Fenna can read (png, jpg, gif, webp or bmp).`);
  const st = fs.statSync(loc.abs);
  if (st.size > IMG_MAX) throw new Error(`${rest[0]} is ${size(st.size)}; images up to 50 MB only.`);
  const img = imageModule(ctx).createFromBuffer(fs.readFileSync(loc.abs));
  if (img.isEmpty()) throw new Error(`${rest[0]} can't be read as an image.`);
  const { width: w0, height: h0 } = img.getSize();
  let w = width;
  let h = height;
  if (w === null && h === null) {
    w = w0;
    h = h0;
  } else if (w === null) w = Math.max(1, Math.round((w0 * h) / h0));
  else if (h === null) h = Math.max(1, Math.round((h0 * w) / w0));
  if (w > IMG_SIDE_MAX || h > IMG_SIDE_MAX) throw new Error(`the picture can be at most ${IMG_SIDE_MAX} pixels on a side.`);
  const resized = w === w0 && h === h0 ? img : img.resize({ width: w, height: h });
  const outExt = to ?? (ext === "png" || ext === "jpg" || ext === "jpeg" ? (ext === "jpeg" ? "jpg" : ext) : "png");
  const bytes = outExt === "jpg" ? resized.toJPEG(90) : resized.toPNG();
  const stem = loc.segs.at(-1).slice(0, loc.segs.at(-1).length - path.extname(p).length);
  const explicit = vals.o !== undefined;
  const out = explicit ? newFile(ctx, vals.o, bytes, false) : newFile(ctx, `${parentOf(p)}/${stem}-resized.${outExt}`, bytes, true);
  return textOf([`${out} (${w} x ${h} pixels)`]);
});

def("csv", "csv sheet [-o file.csv]", "a sheet as CSV: printed, or saved with -o", (args, _i, ctx) => {
  const { vals, rest } = scan("csv", args, { withValue: "o" });
  if (rest.length !== 1) throw new Error("name a sheet, like csv Documents/budget");
  if (vals.o !== undefined && !/\.csv$/i.test(vals.o)) throw new Error("-o is a .csv file name, like -o budget.csv");
  const { loc } = place(ctx, rest[0]);
  const k = kindOf(loc);
  let sheet;
  if (k === "doc" || k === "folder") {
    const index = readJson(path.join(loc.abs, "sheet.json"));
    const first = index && Array.isArray(index.sheets) && index.sheets[0] ? index.sheets[0].id : null;
    if (typeof first !== "string" || !SHEET_ID.test(first)) throw new Error(`${rest[0]} isn't a sheet.`);
    sheet = readJson(path.join(loc.abs, "sheets", `${first}.json`));
    if (!sheet) throw new Error(`${rest[0]}: its first sheet is missing.`);
  } else if (k === "file" && /\.json$/i.test(rest[0])) {
    const obj = readJson(loc.abs);
    if (!obj) throw new Error(`${rest[0]} isn't a sheet.`);
    if (obj.cells) sheet = obj;
    else {
      const first = Array.isArray(obj.sheets) && obj.sheets[0] ? obj.sheets[0].id : null;
      if (typeof first !== "string" || !SHEET_ID.test(first)) throw new Error(`${rest[0]} isn't a sheet.`);
      sheet = readJson(path.join(path.dirname(loc.abs), "sheets", `${first}.json`));
      if (!sheet) throw new Error(`${rest[0]}: its first sheet is missing.`);
    }
  } else throw new Error(`${rest[0]}: give a sheet document in Documents, or a sheet .json file.`);
  const csv = sheetCsv(sheet);
  if (vals.o === undefined) return csv || "(no cells)\n";
  const out = newFile(ctx, vals.o, Buffer.from(csv, "utf8"), false);
  return textOf([`${out} (${size(Buffer.byteLength(csv, "utf8"))})`]);
});

/** A sheet's cells as CSV (RFC 4180): the stored values, from A1 to the last filled cell. */
function sheetCsv(sheet) {
  const cells = sheet.cells && typeof sheet.cells === "object" ? sheet.cells : {};
  const grid = new Map();
  let maxR = -1;
  let maxC = -1;
  for (const [ref, cell] of Object.entries(cells)) {
    const m = /^([A-Z]{1,3})(\d{1,7})$/.exec(ref);
    if (!m) continue;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    c -= 1;
    const r = Number(m[2]) - 1;
    const text = cellText(cell);
    if (text === "") continue;
    grid.set(`${r},${c}`, text);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  if (maxR < 0) return "";
  if ((maxR + 1) * (maxC + 1) > CSV_CELLS_MAX) throw new Error("the sheet is too big to make into CSV here.");
  const rows = [];
  for (let r = 0; r <= maxR; r++) {
    const fields = [];
    for (let c = 0; c <= maxC; c++) fields.push(csvField(grid.get(`${r},${c}`) ?? ""));
    rows.push(fields.join(","));
  }
  return `${rows.join("\r\n")}\r\n`;
}

function cellText(cell) {
  if (!cell || typeof cell !== "object") return "";
  const v = cell.v;
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return typeof v === "string" ? v : "";
}

/** One CSV field: quoted when it holds a comma, a quote or a line break; quotes doubled. */
function csvField(s) {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

def("run", "run script.js [args...]", "run one of your JavaScript files in a sandbox", async (args, _i, ctx) => {
  if (!ctx.sandbox) return { out: "Scripts aren't available.\n", err: "", ok: false };
  const [file, ...rest] = args;
  if (!file) throw new Error("name a script, like run Files/report.js");
  if (!/\.js$/i.test(file)) throw new Error(`${file}: only .js scripts run here.`);
  const { loc } = place(ctx, file);
  if (kindOf(loc) !== "file") throw new Error(`${file}: no such file`);
  const st = fs.statSync(loc.abs);
  if (st.size > SCRIPT_MAX) throw new Error(`${file} is ${size(st.size)}; scripts up to 1 MB only.`);
  const code = fs.readFileSync(loc.abs, "utf8");
  const r = await ctx.sandbox.run(ctx.slug, { code, args: rest, cwd: ctx.cwd });
  return { out: typeof r?.out === "string" ? r.out : "", err: "", ok: !!r?.ok };
});

// ── Running a line ───────────────────────────────────────────────────

/** Runs one command. Its output and its error (already a line) come back apart, so a pipe gets the output only. */
async function runCommand(words, input, ctx) {
  const [name, ...args] = words;
  const cmd = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
  if (!cmd) return { out: "", err: `sh: ${name}: command not found. Type help for the list.\n`, ok: false };
  if (args[0] === "--help") return { out: textOf([cmd.usage, `  ${cmd.about}`]), err: "", ok: true };
  try {
    ctx.check();
    const r = await cmd.run(args, input, ctx);
    if (typeof r === "string") return { out: r, err: "", ok: true };
    return { out: r.out || "", err: r.err || "", ok: r.ok !== false };
  } catch (e) {
    return { out: "", err: `${name}: ${e.message}\n`, ok: false };
  }
}

/** Writes what a command printed to a file in Files or Downloads, quota-checked. */
function writeRedirect(ctx, redir, text) {
  const { path: p, loc } = place(ctx, redir.target);
  writable(loc, redir.target);
  const k = kindOf(loc);
  if (k === "folder" || k === "doc") throw new Error(`${redir.target}: is a folder`);
  const dir = parentOf(p);
  if (kindOf(place(ctx, dir).loc) !== "folder") throw new Error(`${dir}: no such folder`);
  const old = k === "file" ? fs.statSync(loc.abs).size : 0;
  const add = Buffer.byteLength(text, "utf8") - (redir.append ? 0 : old);
  const free = ctx.disk.free(ctx.slug);
  if (add > free) throw new Error(`That won't fit in the bot's disk. It needs ${size(add)}, and ${size(free)} is free.`);
  if (redir.append) fs.appendFileSync(loc.abs, text, "utf8");
  else fs.writeFileSync(loc.abs, text, "utf8");
  ctx.notify();
}

const withNewline = (s) => (s && !s.endsWith("\n") ? `${s}\n` : s);

/** A pipeline: each command's output is the next one's input. The last one's output is the result. */
async function runPipe(pipe, ctx) {
  let input = null;
  let text = "";
  let ok = true;
  const errs = [];
  for (const cmd of pipe) {
    const r = await runCommand(cmd.words, input, ctx);
    if (r.err) errs.push(r.err);
    ok = r.ok;
    if (cmd.redir) {
      try {
        writeRedirect(ctx, cmd.redir, r.out);
      } catch (e) {
        errs.push(`${cmd.words[0]}: ${e.message}\n`);
        ok = false;
      }
      input = "";
      text = "";
    } else {
      input = r.out;
      text = r.out;
    }
  }
  return { text: withNewline(errs.join("")) + withNewline(text), ok };
}

/** A line: items in order; an && item runs only when the one before it worked. */
async function runLine(items, ctx) {
  let last = true;
  let text = "";
  for (const item of items) {
    if (item.and && !last) continue;
    const r = await runPipe(item.pipe, ctx);
    text += r.text;
    last = r.ok;
  }
  return { text, ok: last };
}

// ── Keeping the history ──────────────────────────────────────────────

const VALID_ENTRY = (e) =>
  e &&
  typeof e.id === "string" &&
  typeof e.at === "string" &&
  typeof e.cwd === "string" &&
  typeof e.line === "string" &&
  typeof e.out === "string" &&
  typeof e.ok === "boolean" &&
  (e.who === "person" || e.who === "bot");

/**
 * @param {object} o
 * @param {{ list(slug: string, dir: string): { entries: object[] }, locate(slug: string, p: string): object, op(slug: string, op: object): object, used(slug: string): number, quota(slug: string): number, free(slug: string): number }} o.disk
 * @param {{ botDir(slug: string): string }} o.store  the crew store (where terminal.json is kept)
 * @param {(channel: string, payload: object) => void} [o.broadcast]
 * @param {{ run(slug: string, o: { file: string, code: string, args: string[], cwd: string }): Promise<{ out: string, ok: boolean }> } | null} [o.sandbox]
 * @param {() => Date} [o.now]
 * @param {object} [o.nativeImage]  the nativeImage module (a fake in tests); Electron's by default
 */
function createShell({ disk, store, broadcast = () => {}, sandbox = null, now = () => new Date(), nativeImage = null }) {
  /** slug → { cwd, entries } */
  const states = new Map();
  /** slug → the timer of a save waiting to write */
  const timers = new Map();

  function loadSaved(slug) {
    const v = readJson(path.join(store.botDir(slug), FILE));
    const entries = v && Array.isArray(v.entries) ? v.entries.filter(VALID_ENTRY).slice(-HISTORY_MAX) : [];
    const cwd = v && typeof v.cwd === "string" && ROOTS.includes(v.cwd.split("/")[0]) ? v.cwd : "Files";
    return { cwd, entries };
  }

  function stateOf(slug) {
    let st = states.get(slug);
    if (!st) {
      st = loadSaved(slug);
      states.set(slug, st);
    }
    return st;
  }

  function writeNow(slug) {
    const st = states.get(slug);
    if (!st) return;
    let dir;
    try {
      dir = store.botDir(slug);
    } catch {
      return;
    }
    if (!fs.existsSync(dir)) return;
    const file = path.join(dir, FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, `${JSON.stringify({ cwd: st.cwd, entries: st.entries }, null, 1)}\n`);
      fs.renameSync(tmp, file);
    } catch {
      // The next save writes it again.
    }
  }

  function save(slug) {
    clearTimeout(timers.get(slug));
    const t = setTimeout(() => {
      timers.delete(slug);
      writeNow(slug);
    }, SAVE_MS);
    t.unref?.();
    timers.set(slug, t);
  }

  /** Writes every history that waits to be saved now. */
  function flush() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    for (const slug of states.keys()) writeNow(slug);
  }

  function record(slug, st, base, e) {
    const entry = { ...base, cwd: e.cwd, out: capOutput(e.out), ok: e.ok };
    st.entries.push(entry);
    if (st.entries.length > HISTORY_MAX) st.entries.splice(0, st.entries.length - HISTORY_MAX);
    save(slug);
    broadcast("crew:term", { slug, entry });
    return entry;
  }

  /**
   * Runs a line in the bot's terminal and records it.
   * cwd: the folder to run in (a disk path); null or "" for where the terminal was last.
   * who: "person" or "bot".
   */
  async function exec(slug, line, cwd = null, who = "person") {
    const st = stateOf(slug);
    const text = typeof line === "string" ? line : "";
    const base = { id: crypto.randomUUID(), at: now().toISOString(), who, line: text };
    if (!text.trim()) return { ...base, cwd: st.cwd, out: "", ok: true };

    const explicit = typeof cwd === "string" && cwd.trim() !== "";
    let start = explicit ? cwd : st.cwd;
    try {
      folderOrThrow(disk.locate(slug, start), start);
    } catch (e) {
      if (explicit) return record(slug, st, base, { cwd: st.cwd, out: `cwd: ${e.message}\n`, ok: false });
      start = "Files";
    }

    let items;
    try {
      items = parse(text);
    } catch (e) {
      return record(slug, st, base, { cwd: start, out: `${e.message}\n`, ok: false });
    }

    const ctx = {
      slug,
      disk,
      sandbox,
      nativeImage,
      cwd: start,
      history: st.entries,
      deadline: Date.now() + LINE_MS,
      items: 0,
      check() {
        if (Date.now() > this.deadline) throw new Error("stopped: a line can run 30 seconds at most.");
      },
      step() {
        this.items++;
        if (this.items > ITEM_BUDGET) throw new Error("stopped after 20 000 items; search a smaller folder.");
        this.check();
      },
      notify() {
        broadcast("crew:disk", { slug });
      },
    };

    let timer = null;
    const limit = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ text: "stopped: a line can run 30 seconds at most.\n", ok: false }), LINE_MS);
      timer.unref?.();
    });
    let result;
    try {
      result = await Promise.race([runLine(items, ctx), limit]);
    } catch (e) {
      result = { text: `sh: ${e.message}\n`, ok: false };
    } finally {
      clearTimeout(timer);
    }
    st.cwd = ctx.cwd;
    return record(slug, st, base, { cwd: ctx.cwd, out: result.text, ok: result.ok });
  }

  return {
    exec,
    /** The bot's terminal entries, oldest first (at most 500). */
    history(slug) {
      return stateOf(slug).entries.slice();
    },
    /** Writes the histories that are waiting to be saved (called when the app stops). */
    flush,
  };
}

module.exports = { createShell, tokenize, parse, resolvePath, sheetCsv, capOutput, OUTPUT_MAX, HISTORY_MAX };

