// Bringing memory in from other AI tools. Pure functions: the prompt a person
// pastes into another assistant, the parser for what comes back (or for a file),
// the memory files this computer's CLIs keep, and the append to a bot's memory.md.
// Imported text is data: it is parsed here, shown to the person and written only
// after they approve it. Nothing in this module reaches the network.

const fs = require("node:fs");
const path = require("node:path");

const CATEGORIES = ["about", "work", "projects", "preferences", "style", "tools", "people", "routines", "avoid"];
const MAX_FACT = 500;
const MAX_FACTS = 300;
const MAX_READ = 1_000_000;
const MAX_PROJECTS = 200;

const MEMORY_PROMPT = `Please list everything you remember about me, and anything you were told to remember about me, from our past conversations and from any saved memory or custom instructions. Use exactly this format and nothing else before or after the block:

\`\`\`
FENNA-MEMORY v1
- [about] The user ...
- [work] The user ...
\`\`\`

Rules:
- One fact per line, starting with "- [category] ". Use only these categories: about, work, projects, preferences, style, tools, people, routines, avoid.
- Write each fact in the third person, as one short sentence, starting with "The user" (or the person's name if the user gave it).
- Cover, when you know them: who the user is and what they do, their work and projects, what they prefer, how they like writing and answers to read, the tools and software they use, the people they mention (by role or relationship only), their routines, and things to avoid.
- Leave out secrets and sensitive details: passwords, keys or tokens, card or bank numbers, account or ID numbers, contact details, and health details.
- If you are not sure of something, leave it out. Do not guess, and do not add advice for yourself.`;

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|passcode|pwd|api[ _-]?key|secret|token|pin)\b\s*(?:[:=]|\bis\b|\bwas\b)/i,
  /\b(?:\d[ -]?){13,19}\b/,
];
const LONG_TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;

/** A line that looks like it holds a secret: a known key shape, a password label, a card-like number, or a long mixed token. */
function looksSecret(line) {
  if (SECRET_PATTERNS.some((re) => re.test(line))) return true;
  for (const token of line.match(LONG_TOKEN) || []) {
    if (/[A-Za-z]/.test(token) && /\d/.test(token)) return true;
  }
  return false;
}

/** The comparison key: lower case, one space between words. */
const keyOf = (text) => String(text).toLowerCase().replace(/\s+/g, " ").trim();

/** One fact as it is kept: one line, no list marker, at most MAX_FACT characters. */
function cleanFact(text) {
  const one = String(text)
    .replace(/\s+/g, " ")
    .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\[ ?[xX ]? ?\]\s*/, "")
    .trim();
  return one.length > MAX_FACT ? one.slice(0, MAX_FACT).trimEnd() : one;
}

const categoryOf = (word) => {
  const c = String(word || "").toLowerCase();
  return CATEGORIES.includes(c) ? c : "other";
};

const MEMORY_KEYS = new Set(["memory", "memories", "saved_memories", "facts", "fact", "instructions", "custom_instructions", "about_user_message", "about_model_message", "preferences", "notes", "note"]);
const SKIP_KEYS = new Set(["id", "created", "created_at", "updated", "updated_at", "timestamp", "time", "date", "type", "role", "title", "model", "url", "source", "name"]);

/** Strings under the memory keys of a JSON export, at any depth; other keys are not read. */
function jsonStrings(value, key, inMemory, out) {
  if (typeof value === "string") {
    if (inMemory && !SKIP_KEYS.has(key)) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) jsonStrings(item, key, inMemory, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) jsonStrings(v, k, inMemory || MEMORY_KEYS.has(k), out);
  }
  return out;
}

/** The fenced FENNA-MEMORY blocks: each bullet line is a fact, "- [category] fact". */
function fennaCandidates(raw) {
  const out = [];
  let inBlock = false;
  for (const line of raw.split("\n")) {
    if (/^\s*FENNA-MEMORY\s+v1\s*$/i.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\s*```/.test(line)) {
      inBlock = false;
      continue;
    }
    const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s*(?:\[([A-Za-z]+)\]\s*)?(.+)$/);
    if (m) out.push({ category: categoryOf(m[1]), text: m[2] });
  }
  return out;
}

/** Markdown or plain text: each bullet is one fact, each paragraph is one fact. Front matter, headings and code blocks are left out. */
function textCandidates(raw) {
  let body = raw;
  const fm = body.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  if (fm) body = body.slice(fm[0].length);
  const out = [];
  let current = null;
  let fence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fence = !fence;
      current = null;
      continue;
    }
    if (fence) continue;
    if (!line.trim() || /^\s*#{1,6}\s/.test(line)) {
      current = null;
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      current = { category: "other", text: bullet[1], bullet: true };
      out.push(current);
      continue;
    }
    const indented = /^\s+\S/.test(line);
    if (current && (current.bullet ? indented : true)) {
      current.text += ` ${line.trim()}`;
      continue;
    }
    current = { category: "other", text: line.trim(), bullet: false };
    out.push(current);
  }
  return out;
}

/**
 * Reads text from another assistant's answer, a memory export or a file.
 * Returns the facts (deduplicated, cleaned, capped), how many lines looked like
 * secrets and were left out, and how many facts were past the cap.
 * @param {string} input
 * @returns {{ format: "fenna" | "json" | "text" | "empty", facts: { category: string, text: string }[], secretsLeftOut: number, tooMany: number }}
 */
function parseMemory(input) {
  const raw = typeof input === "string" ? input.replace(/\r\n?/g, "\n") : "";
  let format = "empty";
  let candidates = [];
  if (/^\s*FENNA-MEMORY\s+v1\s*$/im.test(raw)) {
    format = "fenna";
    candidates = fennaCandidates(raw);
  } else {
    const trimmed = raw.trim();
    let json = null;
    if (/^[[{]/.test(trimmed)) {
      try {
        json = JSON.parse(trimmed);
      } catch {
        json = null;
      }
    }
    if (json !== null) {
      format = "json";
      const strings = Array.isArray(json) && json.every((x) => typeof x === "string") ? json : jsonStrings(json, undefined, false, []);
      for (const s of strings) for (const line of s.split("\n")) candidates.push({ category: "other", text: line });
    } else if (trimmed) {
      format = "text";
      candidates = textCandidates(raw);
    }
  }

  let secretsLeftOut = 0;
  const seen = new Set();
  const facts = [];
  let tooMany = 0;
  for (const c of candidates) {
    const text = cleanFact(c.text);
    if (text.length < 3 || !/[A-Za-z]/.test(text)) continue;
    if (looksSecret(text)) {
      secretsLeftOut++;
      continue;
    }
    const key = keyOf(text);
    if (seen.has(key)) continue;
    seen.add(key);
    if (facts.length >= MAX_FACTS) {
      tooMany++;
      continue;
    }
    facts.push({ category: c.category, text });
  }
  return { format, facts, secretsLeftOut, tooMany };
}

const localDay = (now) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** The memory files this computer's CLIs keep, that exist: id, group, label, path and size. Reads only the home folder. */
function scanMemoryFiles(home) {
  const known = [
    { id: "claude-md", group: "Claude Code", label: "CLAUDE.md", file: path.join(home, ".claude", "CLAUDE.md") },
    { id: "codex-agents", group: "Codex", label: "AGENTS.md", file: path.join(home, ".codex", "AGENTS.md") },
    { id: "gemini-md", group: "Gemini CLI", label: "GEMINI.md", file: path.join(home, ".gemini", "GEMINI.md") },
  ];
  const projects = path.join(home, ".claude", "projects");
  let dirs = [];
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().slice(0, MAX_PROJECTS);
  } catch {
    dirs = [];
  }
  for (const dir of dirs) {
    const memDir = path.join(projects, dir, "memory");
    let files = [];
    try {
      files = fs.readdirSync(memDir).filter((f) => f.toLowerCase().endsWith(".md")).sort();
    } catch {
      files = [];
    }
    for (const f of files) known.push({ id: `project:${dir}/${f}`, group: "Claude Code projects", label: f, file: path.join(memDir, f) });
  }
  const out = [];
  for (const k of known) {
    try {
      const st = fs.statSync(k.file);
      if (st.isFile()) out.push({ id: k.id, group: k.group, label: k.label, path: k.file, size: st.size });
    } catch {
      // Not there: not listed.
    }
  }
  return out;
}

/** The source label written in a heading: which tool and which file. */
function sourceOf(entry) {
  return entry.group === "Claude Code projects" ? `Claude Code project memory, ${entry.label}` : `${entry.group}, ${entry.label}`;
}

/**
 * Reads the ticked memory files, by the ids a fresh scan gives (a path is never
 * taken from the page). Each file is read up to MAX_READ bytes; a bigger one is refused.
 */
function readMemoryFiles(home, ids) {
  const found = new Map(scanMemoryFiles(home).map((e) => [e.id, e]));
  return ids.map((id) => {
    const entry = found.get(id);
    if (!entry) return { id, source: "", format: "empty", facts: [], secretsLeftOut: 0, tooMany: 0, error: "That file is no longer there." };
    const source = sourceOf(entry);
    if (entry.size > MAX_READ) return { id, source, format: "empty", facts: [], secretsLeftOut: 0, tooMany: 0, error: `${entry.label} is bigger than 1 MB. Copy the part you want into a text file and choose that.` };
    let text = "";
    try {
      text = fs.readFileSync(entry.path, "utf8");
    } catch {
      return { id, source, format: "empty", facts: [], secretsLeftOut: 0, tooMany: 0, error: `${entry.label} could not be read.` };
    }
    return { id, source, ...parseMemory(text) };
  });
}

/**
 * Appends approved facts to a memory.md text, under one dated heading per source,
 * skipping any fact already there (case and spacing aside, and with or without
 * the date a remembered line carries).
 * @param {string} existing
 * @param {{ source: string, facts: { text: string }[] }[]} groups
 * @param {string} day  yyyy-mm-dd
 * @returns {{ text: string, added: number, skipped: number }}
 */
function appendImported(existing, groups, day) {
  const seen = new Set();
  for (const line of String(existing || "").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    seen.add(keyOf(line.replace(/^\s*[-*+]\s*/, "")));
    seen.add(keyOf(line.replace(/^\s*[-*+]\s*\d{4}-\d{2}-\d{2}:\s*/, "")));
  }
  const sections = [];
  let added = 0;
  let skipped = 0;
  for (const g of groups) {
    const lines = [];
    for (const f of g.facts) {
      const text = cleanFact(f.text);
      const key = keyOf(text);
      if (!text || !key) continue;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      lines.push(`- ${text}`);
    }
    if (lines.length) {
      const source = String(g.source).replace(/\s+/g, " ").trim().slice(0, 80);
      sections.push(`## Imported ${day} (from ${source})\n\n${lines.join("\n")}\n`);
      added += lines.length;
    }
  }
  if (!added) return { text: existing || "", added, skipped };
  const head = String(existing || "").replace(/\s+$/, "");
  const text = (head ? `${head}\n\n` : "") + sections.join("\n");
  return { text, added, skipped };
}

module.exports = {
  MAX_FACT,
  MAX_FACTS,
  MEMORY_PROMPT,
  looksSecret,
  parseMemory,
  scanMemoryFiles,
  readMemoryFiles,
  appendImported,
  localDay,
};
